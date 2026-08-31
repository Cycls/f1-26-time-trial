/**
 * Gamepad haptics. Owner: INPUT.
 *
 * The reference fixes the four cues AND their priority order:
 *   1. rising, SLIP-PROPORTIONAL rumble as the tyres approach the traction limit
 *   2. discrete kerb impulses
 *   3. sustained off-track texture
 *   4. speed/load steering damper
 *
 * They are mixed, not switched: (1) owns the sustained strong channel, (2) punches
 * through it as a transient, (3) sits underneath as a noise bed, (4) is the floor.
 * The dominant cue is published on state.input.rumble.cue so it is inspectable.
 *
 * Uses the Gamepad Haptics API (`vibrationActuator.playEffect('dual-rumble')`) with a
 * fallback to the older `hapticActuators[]`/`pulse()` shape.
 */
import { clamp } from './curves.js';

const PLAY_MS = 140;       // effect length, slightly longer than the refresh interval
const REFRESH_MS = 100;    // do not spam playEffect: it queues and stutters

export class Haptics {
  constructor(ctx) {
    this.ctx = ctx; this.state = ctx.state;
    this.enabled = true;
    this.strength = 1.0;
    this.lastPlay = 0;
    this.kerbT = 0;              // remaining impulse time
    this.kerbAcc = 0;            // rib phase accumulator
    this.noise = 0;
    this.prevKerb = [false, false, false, false];
    this.out = { weak: 0, strong: 0, cue: 'none' };
  }

  /** Slip cue: how close the worst tyre is to the friction circle limit. */
  #slip(car) {
    let use = 0, slipA = 0;
    for (const w of car.wheel || []) {
      use = Math.max(use, w.gripUse ?? 0);
      slipA = Math.max(slipA, Math.abs(w.slipAngle ?? 0));
    }
    // nothing below 0.78 of the limit; full by 1.06. Add a slip-angle term so a
    // four-wheel drift buzzes even when the friction circle reads saturated flat.
    const a = clamp((use - 0.78) / 0.28, 0, 1);
    const b = clamp((slipA - 0.10) / 0.14, 0, 1);          // ~6 deg -> starts, ~14 deg -> full
    return clamp(Math.max(a, b * 0.85), 0, 1);
  }

  update(dt, gamepad) {
    const car = this.state.car, inp = this.state.input;
    const v = car.speed || 0;
    const sp = clamp(v / 60, 0, 1);

    // --- cue 1: slip -----------------------------------------------------------
    const slip = this.#slip(car);
    let strong = Math.pow(slip, 1.35) * 0.85;
    let weak = slip * 0.35;
    let cue = slip > 0.06 ? 'slip' : 'none';

    // --- cue 2: kerb impulses ---------------------------------------------------
    let onKerb = false;
    for (let i = 0; i < 4; i++) {
      const s = car.wheel?.[i]?.surface;
      const k = s === 'kerb';
      if (k && !this.prevKerb[i]) this.kerbT = Math.max(this.kerbT, 0.055);   // first strike
      this.prevKerb[i] = k;
      onKerb = onKerb || k;
    }
    if (onKerb && v > 4) {
      // ribbed kerbs: one impulse per ~0.55 m of travel, capped at 26 Hz
      this.kerbAcc += Math.min(v / 0.55, 26) * dt;
      if (this.kerbAcc >= 1) { this.kerbAcc -= Math.floor(this.kerbAcc); this.kerbT = Math.max(this.kerbT, 0.045); }
    } else this.kerbAcc = 0;
    this.kerbT = Math.max(0, this.kerbT - dt);
    if (this.kerbT > 0) {
      const m = 0.55 + 0.45 * sp;
      strong = Math.max(strong, 0.95 * m); weak = Math.max(weak, 0.75 * m);
      cue = 'kerb';
    }

    // --- cue 3: off-track texture ----------------------------------------------
    const off = (car.wheelsOff ?? 0) > 0 || ['gravel', 'grass', 'astro'].includes(car.wheel?.[0]?.surface);
    if (off && v > 2) {
      this.noise = this.noise * 0.72 + (Math.random() - 0.5) * 0.9;
      const base = (0.28 + 0.34 * sp) * clamp((car.wheelsOff ?? 0) / 4, 0.35, 1);
      const tex = clamp(base * (1 + this.noise * 0.5), 0, 0.8);
      weak = Math.max(weak, tex);
      strong = Math.max(strong, tex * 0.55);
      if (cue !== 'kerb' && tex > slip * 0.6) cue = 'offtrack';
    }

    // --- cue 4: speed / load steering damper ------------------------------------
    const load = clamp(Math.abs(car.lateralG ?? 0) / 4.2, 0, 1);
    const damper = clamp((0.05 + 0.16 * load) * sp * (0.4 + 0.6 * Math.abs(inp.steer ?? 0)), 0, 0.3);
    weak = Math.max(weak, damper);
    if (cue === 'none' && damper > 0.03) cue = 'damper';

    strong = clamp(strong * this.strength, 0, 1);
    weak = clamp(weak * this.strength, 0, 1);
    this.out.strong = +strong.toFixed(3); this.out.weak = +weak.toFixed(3); this.out.cue = cue;
    inp.rumble = this.out;

    if (!this.enabled || !gamepad) return;
    const now = performance.now();
    if (now - this.lastPlay < REFRESH_MS) return;
    this.lastPlay = now;
    const act = gamepad.vibrationActuator;
    try {
      if (act && typeof act.playEffect === 'function') {
        if (strong < 0.004 && weak < 0.004) { act.reset?.(); return; }
        act.playEffect('dual-rumble', {
          startDelay: 0, duration: PLAY_MS, weakMagnitude: weak, strongMagnitude: strong,
        }).catch(() => {});
      } else if (gamepad.hapticActuators?.length) {
        for (const a of gamepad.hapticActuators) a.pulse?.(Math.max(strong, weak), PLAY_MS)?.catch?.(() => {});
      }
    } catch { /* browser without haptics; state.input.rumble still describes the cue */ }
  }

  stop(gamepad) {
    this.out.strong = this.out.weak = 0; this.out.cue = 'none';
    try { gamepad?.vibrationActuator?.reset?.(); } catch { /* ignore */ }
  }
}
