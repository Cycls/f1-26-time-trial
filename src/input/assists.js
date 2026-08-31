/**
 * Driver assists. Owner: INPUT.
 *
 * PHYSICS owns the vehicle model, so every assist here is implemented as INPUT
 * SHAPING — which is genuinely how traction control and braking assist work: they
 * sit between the pedal and the engine/brake demand, they do not change the tyre.
 *
 *   Traction control   Full / Medium / Off      throttle clamp on rear slip
 *   ABS                On / Off                 brake modulation on wheel lock
 *   Racing line        Full / Corners only / Off  (visual; drawn by GAME)
 *   Braking assist     Off / Low / Medium / High  auto brake into a corner
 *   Steering assist    On / Off                 pure-pursuit nudge toward the line
 *   Gearbox            Automatic / Manual / Manual & Suggested
 *
 * Every setting is mirrored into state.input.assists so the HUD and the critic can
 * see it, along with live "is it intervening right now" flags.
 */
import { clamp } from './curves.js';

export const ASSIST_OPTIONS = {
  tc: ['full', 'medium', 'off'],
  abs: ['on', 'off'],
  racingLine: ['full', 'corners', 'off'],
  brakingAssist: ['off', 'low', 'medium', 'high'],
  steeringAssist: ['off', 'on'],
  gearbox: ['auto', 'manual', 'manualSuggested'],
};

export const ASSIST_LABELS = {
  tc: { full: 'Full', medium: 'Medium', off: 'Off' },
  abs: { on: 'On', off: 'Off' },
  racingLine: { full: 'Full', corners: 'Corners only', off: 'Off' },
  brakingAssist: { off: 'Off', low: 'Low', medium: 'Medium', high: 'High' },
  steeringAssist: { off: 'Off', on: 'On' },
  gearbox: { auto: 'Automatic', manual: 'Manual', manualSuggested: 'Manual & Suggested' },
};

export const DEFAULT_ASSISTS = {
  tc: 'medium', abs: 'on', racingLine: 'corners',
  brakingAssist: 'off', steeringAssist: 'off', gearbox: 'auto',
};

const TC_TARGET = { full: 0.06, medium: 0.14, off: Infinity };
const BA_GATE = { off: null, low: [1.00, 2.0], medium: [0.78, 2.4], high: [0.58, 2.0] };

const A_BRAKE_MAX = 3.3 * 9.81;             // m/s^2 — 2026 peak, per the reference

export class Assists {
  constructor(ctx) {
    this.ctx = ctx;
    this.state = ctx.state;
    this.settings = { ...DEFAULT_ASSISTS };
    this.tcCut = 0;
    this.absCut = 0;
    this.absPhase = 0;
    this.steerGain = 0.24;                  // learned input->road-wheel-angle gain
    this.flags = { tc: false, abs: false, braking: false, steering: false };
    this.suggestedGear = 1;
    this.shiftSuggest = 0;                  // -1 down, 0 none, +1 up
  }

  set(key, value) {
    if (!(key in ASSIST_OPTIONS)) return false;
    if (!ASSIST_OPTIONS[key].includes(value)) return false;
    this.settings[key] = value;
    if (key === 'gearbox') this.#pushGearbox();
    safeEmit(this.ctx.bus, 'input:assist', { key, value });
    return true;
  }

  cycle(key, dir = 1) {
    const opts = ASSIST_OPTIONS[key]; if (!opts) return;
    const i = opts.indexOf(this.settings[key]);
    this.set(key, opts[(i + dir + opts.length) % opts.length]);
  }

  /**
   * Gearbox mode is an input concern but the shifting itself lives in PHYSICS.
   * We publish it on state.input.gearbox and on the bus; we also set the physics
   * module's own `autoGear` switch, which its code already reads, so Manual works
   * today without editing another owner's file.
   */
  #pushGearbox() {
    const auto = this.settings.gearbox === 'auto';
    this.state.input.gearbox = this.settings.gearbox;
    safeEmit(this.ctx.bus, 'input:gearbox', this.settings.gearbox);
    try { const ph = this.ctx.get('physics'); if (ph) ph.autoGear = auto; } catch { /* physics not up yet */ }
  }

  init() { this.#pushGearbox(); }

  /** Learn how much road-wheel angle one unit of steer input buys at this speed. */
  #learnSteerGain() {
    const c = this.state.car, i = this.state.input;
    if (Math.abs(i.steer) > 0.2 && Math.abs(c.steerAngle) > 1e-4) {
      const g = Math.abs(c.steerAngle) / Math.abs(i.steer);
      if (g > 0.01 && g < 1.2) this.steerGain += (g - this.steerGain) * 0.08;
    }
  }

  /**
   * @param {{steer:number, throttle:number, brake:number}} d  driver demand, post-curve
   * @param {number} dt
   * @param {object} guide  racing-line guide from GAME (may be null)
   * @param {number} s      current lap distance in metres
   */
  apply(d, dt, guide, s) {
    const car = this.state.car;
    const v = car.speed || 0;
    this.#learnSteerGain();
    const f = this.flags;
    f.tc = f.abs = f.braking = f.steering = false;

    // ---------- braking assist (before TC/ABS: it is a demand, not a limiter) ----
    const gate = BA_GATE[this.settings.brakingAssist];
    if (gate && guide && v > 12) {
      let demand = 0;
      for (let ahead = 6; ahead <= 420; ahead += 6) {
        const vT = guide.speedAt(s + ahead);
        if (vT >= v) continue;
        demand = Math.max(demand, (v * v - vT * vT) / (2 * ahead) / A_BRAKE_MAX);
      }
      const [thr, k] = gate;
      const want = clamp((demand - thr) * k, 0, 1);
      if (want > 0.02) {
        d.brake = Math.max(d.brake, want);
        f.braking = true;
        if (this.settings.brakingAssist === 'high' && want > 0.05) d.throttle = Math.min(d.throttle, 1 - want);
      }
    }

    // ---------- steering assist -------------------------------------------------
    if (this.settings.steeringAssist === 'on' && guide && v > 6) {
      const want = guide.pursuitSteer(car, v, this.steerGain, s);
      if (want != null && isFinite(want)) {
        // the driver always out-votes the assist; it only fills the gaps
        const w = 0.5 * (1 - clamp(Math.abs(d.steer) * 1.15, 0, 1));
        if (w > 0.01) { d.steer = d.steer * (1 - w) + clamp(want, -1, 1) * w; f.steering = true; }
      }
    }

    // ---------- traction control ------------------------------------------------
    const target = TC_TARGET[this.settings.tc];
    if (isFinite(target)) {
      let slip = 0;
      for (const i of [2, 3]) {
        const w = car.wheel[i]; if (!w) continue;
        slip = Math.max(slip, Math.max(0, w.slipRatio ?? 0), Math.max(0, ((w.gripUse ?? 0) - 1) * 0.5));
      }
      // low-speed launch limiter — a standing start is where TC earns its keep
      if (v < 14 && d.throttle > 0.5) slip = Math.max(slip, (car.wheel[2]?.gripUse ?? 0) > 0.98 ? 0.10 : 0);
      const err = slip - target;
      const rise = this.settings.tc === 'full' ? 14 : 9;
      this.tcCut = clamp(this.tcCut + (err > 0 ? err * rise : -1.9) * dt, 0, 0.9);
      if (this.tcCut > 0.005) {
        d.throttle *= 1 - this.tcCut;
        f.tc = true;
      }
    } else this.tcCut = 0;

    // ---------- ABS -------------------------------------------------------------
    if (this.settings.abs === 'on' && d.brake > 0.02 && v > 3) {
      let lock = 0;
      for (let i = 0; i < 4; i++) {
        const w = car.wheel[i]; if (!w) continue;
        if (w.locked) lock = Math.max(lock, 0.55);
        lock = Math.max(lock, clamp(((w.gripUse ?? 0) - 1.0) * 1.6, 0, 1));
        if ((w.slipRatio ?? 0) < -0.12) lock = Math.max(lock, clamp(-w.slipRatio - 0.12, 0, 1));
      }
      if (lock > 0) {
        this.absCut = clamp(this.absCut + lock * 16 * dt, 0, 0.62);
        this.absPhase += dt * 2 * Math.PI * 13;         // ~13 Hz modulation, the ABS "buzz"
        f.abs = true;
      } else {
        this.absCut = clamp(this.absCut - 3.2 * dt, 0, 1);
        if (this.absCut < 1e-3) this.absPhase = 0;
      }
      if (this.absCut > 1e-3) {
        const pulse = 0.5 + 0.5 * Math.sin(this.absPhase);
        d.brake *= 1 - this.absCut * (0.55 + 0.45 * pulse);
        f.abs = true;
      }
    } else { this.absCut = 0; this.absPhase = 0; }

    // ---------- gear suggestion -------------------------------------------------
    // Useful band is 7,000-12,500 rpm (peak power ~10,500-12,000). Shifting at the
    // 15,000 limiter is wrong, so the suggestion fires well before it.
    const rpm = car.rpm ?? 0, gear = car.gear ?? 1, gearCount = car.gearCount ?? 8;
    this.shiftSuggest = 0;
    if (this.settings.gearbox !== 'auto') {
      if (rpm > 12300 && gear < gearCount) this.shiftSuggest = 1;
      else if (rpm < 7200 && gear > 1 && v > 2) this.shiftSuggest = -1;
    }
    this.suggestedGear = clamp(gear + this.shiftSuggest, 1, gearCount);

    d.steer = clamp(d.steer, -1, 1);
    d.throttle = clamp(d.throttle, 0, 1);
    d.brake = clamp(d.brake, 0, 1);
    return d;
  }

  publish() {
    const i = this.state.input;
    i.assists = { ...this.settings };
    i.tcActive = this.flags.tc; i.tcCut = +this.tcCut.toFixed(3);
    i.absActive = this.flags.abs; i.absCut = +this.absCut.toFixed(3);
    i.brakeAssistActive = this.flags.braking;
    i.steerAssistActive = this.flags.steering;
    i.gearbox = this.settings.gearbox;
    i.shiftSuggest = this.settings.gearbox === 'manualSuggested' ? this.shiftSuggest : 0;
    i.suggestedGear = this.suggestedGear;
  }
}

/**
 * The shared Bus is synchronous and does not isolate listeners: a throw inside any
 * subscriber propagates back into the emitter and would take this module's frame with
 * it. Every emit from here goes through this guard. (See docs/REQUESTS.md — the fix
 * belongs in core/bus.js, which GAME/INPUT do not own.)
 */
function safeEmit(bus, event, payload) {
  try { bus.emit(event, payload); }
  catch (e) { if (!safeEmit.seen?.has(event)) { (safeEmit.seen ??= new Set()).add(event); console.warn(`[bus] a listener for "${event}" threw:`, e?.message); } }
}
