/**
 * Camera shake. Owner: CAMERA.
 *
 * docs/reference-visual.md: "Camera Shake and Camera Movement both ship at MAXIMUM
 * (-20..20, default 20). Stock shake is five separately-triggered procedural effects
 * layered on real suspension/bump motion: speed-based, wheel-slip, wheel-lockup,
 * wheel-spin, and surface-based (kerbs/bumps)."
 *
 * So this file is five INDEPENDENT channels, each with its own trigger, its own
 * frequency content and its own level, summed at the end:
 *
 *   1 speed    rises with road speed; the always-on airframe buzz. Tiny.
 *   2 slip     driven by wheel[i].gripUse crossing the tyre's peak — the camera starts
 *              to fizz as the car approaches the limit, before anything is lost.
 *   3 lockup   wheel[i].locked: a hard impulse on the leading edge plus a low-frequency
 *              judder while it persists.
 *   4 spin     wheel[i].spinning: higher-frequency, lighter than a lock-up.
 *   5 surface  wheel[i].surface transitions (kerb strikes, gravel, astro) plus a
 *              sustained rattle, scaled by the REAL suspension velocity the physics
 *              module publishes in wheel[i].susVel. This is the layer that must be
 *              violent over a Bahrain kerb and silent on clean asphalt.
 *
 * The genuine suspension and bump motion the reference talks about is already in the
 * picture for free: physics folds the sprung-platform pitch/roll into car.quaternion and
 * the heave into car.position.y, and every onboard rig is mounted in car space, so the
 * camera inherits it 1:1. These five channels sit ON TOP of that.
 *
 * Impulses go into damped harmonic oscillators rather than being written straight to the
 * transform, so an event has a real attack and ring-down; sustained levels drive
 * band-limited value noise, which is smooth at any frame rate and never aliases.
 */

const TAU = Math.PI * 2;

/** Damped harmonic oscillator. kick(a) produces a ring-down peaking at about a. */
class Osc {
  constructor(freq, zeta) { this.w = TAU * freq; this.z = zeta; this.x = 0; this.v = 0; }
  kick(a) { this.v += a * this.w; }
  reset() { this.x = 0; this.v = 0; }
  step(dt) {
    const n = Math.min(10, Math.max(1, Math.ceil(dt / 0.0045)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v += (-this.w * this.w * this.x - 2 * this.z * this.w * this.v) * h;
      this.x += this.v * h;
    }
    if (Math.abs(this.x) < 1e-7 && Math.abs(this.v) < 1e-6) { this.x = 0; this.v = 0; }
  }
}

/** Smooth (band-limited) value noise in [-1,1], deterministic per seed. */
class Noise {
  constructor(freq, seed) {
    this.f = freq; this.t = 0; this.s = ((seed * 2654435761) >>> 0) || 1;
    this.a = this.#next(); this.b = this.#next();
  }
  #next() { this.s = (this.s * 1664525 + 1013904223) >>> 0; return (this.s / 2147483648) - 1; }
  step(dt) {
    this.t += dt * this.f;
    let guard = 0;
    while (this.t >= 1 && guard++ < 64) { this.t -= 1; this.a = this.b; this.b = this.#next(); }
  }
  get value() { const u = this.t * this.t * (3 - 2 * this.t); return this.a + (this.b - this.a) * u; }
}

/** Sustained roughness per surface, and how hard first contact hits. */
const SURFACE = {
  asphalt: { rough: 0.05, strike: 0.00 },
  kerb: { rough: 1.00, strike: 1.00 },
  astro: { rough: 0.38, strike: 0.30 },
  gravel: { rough: 0.90, strike: 0.62 },
  grass: { rough: 0.46, strike: 0.26 },
  wall: { rough: 0.00, strike: 0.00 },
};

/** Peak angular amplitude, in radians, that a channel level of 1.0 is worth. */
const ROT_UNIT = 0.0130;   // 0.75 deg
const POS_UNIT = 0.0090;   // 9 mm

export class CameraShake {
  constructor(bus) {
    // impulse oscillators — pitch / yaw / roll and lateral / vertical
    this.rp = new Osc(13.5, 0.26);
    this.ry = new Osc(11.0, 0.30);
    this.rr = new Osc(15.5, 0.24);
    this.px = new Osc(9.5, 0.34);
    this.py = new Osc(8.2, 0.30);

    // one noise trio per continuous channel so they are genuinely independent
    this.n = {
      speed: [new Noise(9.5, 11), new Noise(8.2, 12), new Noise(10.4, 13)],
      slip: [new Noise(6.4, 21), new Noise(5.6, 22), new Noise(7.1, 23)],
      lockup: [new Noise(4.6, 31), new Noise(3.9, 32), new Noise(5.2, 33)],
      spin: [new Noise(14.5, 41), new Noise(13.1, 42), new Noise(16.0, 43)],
      surface: [new Noise(11.5, 51), new Noise(9.8, 52), new Noise(12.6, 53)],
    };

    this.prevSurface = ['asphalt', 'asphalt', 'asphalt', 'asphalt'];
    this.prevLocked = [false, false, false, false];
    this.prevSpin = [false, false, false, false];

    /** per-channel level, 0..~1.5 — inspectable, and what makes the five visible. */
    this.levels = { speed: 0, slip: 0, lockup: 0, spin: 0, surface: 0 };
    this.intensity = 0;

    this.rot = { x: 0, y: 0, z: 0 };   // radians (pitchDown, yaw, roll)
    this.pos = { x: 0, y: 0 };         // metres, camera-local (right, up)

    this._off = [];
    if (bus) {
      this._off.push(bus.on('car:impact', (e) => this.impact(e?.speed ?? 20)));
      this._off.push(bus.on('car:shift', () => this.shift()));
    }
  }

  dispose() { for (const f of this._off) { try { f(); } catch { /* ignore */ } } this._off = []; }

  reset() {
    for (const o of [this.rp, this.ry, this.rr, this.px, this.py]) o.reset();
    for (const k in this.levels) this.levels[k] = 0;
    this.intensity = 0;
    this.rot.x = this.rot.y = this.rot.z = 0;
    this.pos.x = this.pos.y = 0;
  }

  /** A wheel found a kerb/gravel edge. side: -1 = geometric right, +1 = geometric left. */
  strike(strength, side) {
    this.rp.kick(0.0180 * strength);
    this.rr.kick(0.0230 * strength * side);
    this.ry.kick(0.0070 * strength * side);
    this.py.kick(0.0260 * strength);
    this.px.kick(0.0070 * strength * side);
  }

  lockup(strength, side) {
    this.rp.kick(0.0070 * strength);
    this.ry.kick(0.0045 * strength * side);
  }

  impact(speed) {
    const s = Math.min(1.6, 0.25 + speed / 55);
    this.rp.kick(0.055 * s); this.rr.kick(0.070 * s); this.ry.kick(0.045 * s);
    this.py.kick(0.075 * s); this.px.kick(0.060 * s);
  }

  shift() { this.rp.kick(0.0032); this.py.kick(0.0035); }

  /**
   * @param dt    seconds
   * @param car   state.car
   * @param scale 0..1 master shake scale (1.0 = the reference's 20/20 default)
   */
  update(dt, car, scale = 1) {
    const kph = car.kph || 0;
    const speedF = Math.min(1.2, kph / 300);
    const L = this.levels;

    // ---- 1: speed ---------------------------------------------------------
    // always-on, rises with road speed. At 300 km/h this alone is ~0.2 deg.
    L.speed = 0.20 * speedF * speedF + 0.06 * speedF;

    // ---- 2/3/4/5: per-wheel triggers -------------------------------------
    let slip = 0, lock = 0, spin = 0, rough = 0, susBump = 0;
    for (let i = 0; i < 4; i++) {
      const w = car.wheel[i];
      // wheels 0,2 sit at body -x, which is the geometric RIGHT (see rigs.js)
      const side = (i % 2 === 0) ? -1 : 1;

      // 2 — wheel slip: starts fizzing as the tyre passes its peak
      const use = w.gripUse ?? 0;
      slip = Math.max(slip, Math.max(0, use - 0.86) / 0.30);

      // 3 — lock-up
      if (w.locked) {
        lock += 0.30;
        if (!this.prevLocked[i]) this.lockup(0.55 + speedF * 0.85, side);
      }
      this.prevLocked[i] = !!w.locked;

      // 4 — wheel spin
      if (w.spinning) spin += 0.24;
      this.prevSpin[i] = !!w.spinning;

      // 5 — surface: strike on transition, rattle while it lasts, and the REAL
      //     suspension velocity the physics module publishes for bumps.
      const surf = w.surface || 'asphalt';
      const S = SURFACE[surf] ?? SURFACE.asphalt;
      rough = Math.max(rough, S.rough);
      if (surf !== this.prevSurface[i] && S.strike > 0) {
        this.strike(S.strike * (0.45 + speedF * 0.85), side);
      }
      this.prevSurface[i] = surf;
      susBump = Math.max(susBump, Math.min(1.4, Math.abs(w.susVel ?? 0) / 0.55));
    }

    L.slip = Math.min(1, slip) * Math.min(1, 0.30 + speedF);
    L.lockup = Math.min(1.2, lock) * Math.min(1, 0.35 + speedF);
    L.spin = Math.min(1.0, spin) * Math.min(1, 0.30 + speedF * 0.9);
    L.surface = Math.min(1.6, rough * Math.max(0.30, speedF) * 1.15 + susBump * 0.45);

    // ---- integrate --------------------------------------------------------
    for (const o of [this.rp, this.ry, this.rr, this.px, this.py]) o.step(dt);
    for (const k in this.n) for (const nz of this.n[k]) nz.step(dt);

    // ---- sum --------------------------------------------------------------
    // Each channel is weighted per axis so they do not all look like the same wobble:
    // lock-ups are mostly pitch, spin is mostly yaw/roll, kerbs are everything.
    const W = {
      speed: [0.55, 0.45, 0.55, 0.30, 0.45],   // pitch, yaw, roll, x, y
      slip: [0.40, 0.75, 0.85, 0.35, 0.25],
      lockup: [1.00, 0.45, 0.30, 0.20, 0.55],
      spin: [0.35, 0.85, 0.70, 0.25, 0.30],
      surface: [1.00, 0.55, 0.95, 0.45, 1.00],
    };
    let rx = 0, ry = 0, rz = 0, tx = 0, ty = 0;
    for (const k in W) {
      const lv = L[k], w = W[k], n = this.n[k];
      if (lv <= 0.0001) continue;
      rx += n[0].value * lv * w[0];
      ry += n[1].value * lv * w[1];
      rz += n[2].value * lv * w[2];
      tx += n[2].value * lv * w[3];
      ty += n[0].value * lv * w[4];
    }

    this.rot.x = (this.rp.x + rx * ROT_UNIT) * scale;
    this.rot.y = (this.ry.x + ry * ROT_UNIT) * scale;
    this.rot.z = (this.rr.x + rz * ROT_UNIT) * scale;
    this.pos.x = (this.px.x + tx * POS_UNIT) * scale;
    this.pos.y = (this.py.x + ty * POS_UNIT) * scale;

    const ring = Math.abs(this.rp.x) + Math.abs(this.rr.x) + Math.abs(this.py.x) * 0.6;
    this.intensity = Math.min(1,
      (L.speed + L.slip + L.lockup + L.spin + L.surface) * 0.30 + ring * 14) * scale;
    return this.intensity;
  }
}
