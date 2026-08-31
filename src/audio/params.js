/**
 * State -> synthesis parameters. Owner: AUDIO.
 * Pure-ish: PowerUnitModel holds only its own integrators (turbo shaft speed, pop scheduler,
 * smoothed mix), reads state.car / state.input / state.camera and NEVER writes shared state.
 * Kept out of engine.js so tools/probe_audio.mjs can drive it headlessly.
 */

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const num = (x, d = 0) => (Number.isFinite(x) ? x : d);
/** frame-rate independent smoothing towards `to` with time constant tau */
const smooth = (from, to, dt, tau) => (tau <= 0 ? to : from + (to - from) * (1 - Math.exp(-dt / tau)));

/** Useful band per docs/reference-physics.md — the sound is built AROUND 7k-12.5k. */
export const BAND = { lo: 7000, hi: 12500, peak: 11200, idle: 4000, limit: 15000 };

/**
 * Camera mixes. Cockpit/halo/nose sit on top of the intake and the MGU-K with a helmet over
 * your ears and 300 km/h of air; tvpod/chase hear the exhaust and the environment instead.
 */
export const CAMERA_MIX = {
  cockpit:  { ice: 0.86, body: 0.72, intake: 1.75, turbo: 1.30, ers: 1.28, tyre: 1.05, wind: 2.30, wet: 0.50, slap: 0.55, lp: 0.82 },
  halo:     { ice: 0.92, body: 0.78, intake: 1.55, turbo: 1.22, ers: 1.22, tyre: 1.05, wind: 2.00, wet: 0.60, slap: 0.62, lp: 0.90 },
  nose:     { ice: 0.78, body: 0.62, intake: 1.20, turbo: 1.00, ers: 1.10, tyre: 1.55, wind: 2.35, wet: 0.55, slap: 0.50, lp: 0.95 },
  tvpod:    { ice: 1.25, body: 1.12, intake: 0.85, turbo: 1.00, ers: 0.95, tyre: 0.95, wind: 0.35, wet: 1.00, slap: 1.00, lp: 1.10 },
  chase:    { ice: 1.15, body: 1.25, intake: 0.80, turbo: 0.95, ers: 0.92, tyre: 1.00, wind: 0.55, wet: 1.25, slap: 1.20, lp: 0.92 },
  chaseFar: { ice: 0.92, body: 1.35, intake: 0.45, turbo: 0.70, ers: 0.60, tyre: 0.80, wind: 0.35, wet: 1.85, slap: 1.45, lp: 0.55 },
};

/**
 * How enclosed the car is at a given point of the Bahrain lap. Drives reverb wetness:
 * pit straight is walled on both sides and grandstanded, the back straight is open desert.
 */
export function enclosure(s, lapLength = 5412) {
  const x = ((s % lapLength) + lapLength) % lapLength;
  if (x > 5050 || x < 430) return 1.0;    // main straight: pit wall + grandstands
  if (x < 1750) return 0.78;              // T1-T4 grandstands
  if (x < 2550) return 0.55;
  if (x < 3050) return 0.62;
  if (x < 3950) return 0.34;              // back straight, open desert
  if (x < 4600) return 0.45;
  return 0.7;                             // final complex back towards the paddock
}

export class PowerUnitModel {
  constructor() {
    this.spool = 0;          // 0..1 turbo shaft speed (lags throttle)
    this.boost = 0;
    this.thr = 0;            // smoothed throttle
    this.prevThr = 0;
    this.load = 0;
    this.rpm = BAND.idle;
    this.popT = -1;
    this.blowLock = 0;
    this.mix = null;         // smoothed camera mix
    this.wall = 6;
    this.encl = 0.6;
    this.tyreS = { scrub: 0, squeal: 0, lock: 0, spin: 0, kerb: 0, gravel: 0, slip: 0 };
    this.menuDuck = 1;
    this.t = 0;
  }

  /**
   * @returns {{p:object, events:Array<{name:string,d:object,at:number}>}}
   *          `at` is an offset in seconds from now.
   */
  step(state, dt) {
    dt = clamp(num(dt, 1 / 60), 1 / 240, 0.2);
    this.t += dt;
    const events = [];
    const car = state?.car ?? {};
    const inp = state?.input ?? {};
    const wheels = Array.isArray(car.wheel) ? car.wheel : [];

    // ---------------------------------------------------------------- engine core
    const rpm = clamp(num(car.rpm, BAND.idle), 500, BAND.limit + 500);
    this.rpm = smooth(this.rpm, rpm, dt, 0.012);
    const thrIn = clamp(num(inp.throttle, num(car.throttle, 0)), 0, 1);
    const brake = clamp(num(inp.brake, num(car.brake, 0)), 0, 1);
    this.prevThr = this.thr;
    this.thr = smooth(this.thr, thrIn, dt, 0.028);
    const dThr = (this.thr - this.prevThr) / dt;
    const speed = Math.max(0, num(car.speed, num(car.kph, 0) / 3.6));
    const kph = num(car.kph, speed * 3.6);
    const longG = num(car.longG, 0);

    // where we are in the useful band, 0 at 7k, 1 at 12.5k, >1 past it
    const band = (this.rpm - BAND.lo) / (BAND.hi - BAND.lo);
    const bandC = clamp(band, 0, 1);
    const onSong = clamp(1 - Math.abs(this.rpm - BAND.peak) / 4200, 0, 1); // peak-power emphasis
    const strain = clamp((this.rpm - BAND.hi) / (BAND.limit - BAND.hi), 0, 1);

    const loadT = clamp(this.thr * (0.45 + 0.55 * clamp(band + 0.35, 0, 1)), 0, 1);
    this.load = smooth(this.load, loadT, dt, 0.05);

    // ---------------------------------------------------------------- turbo (lagged)
    const shaftT = clamp((this.rpm / 12500) * (0.28 + 0.72 * this.thr), 0, 1.1);
    this.spool = smooth(this.spool, shaftT, dt, shaftT > this.spool ? 0.30 : 0.85);
    const boostT = clamp(this.spool * (0.22 + 0.78 * this.thr), 0, 1);
    this.boost = smooth(this.boost, boostT, dt, boostT > this.boost ? 0.12 : 0.30);

    this.blowLock = Math.max(0, this.blowLock - dt);
    if (dThr < -2.2 && this.boost > 0.22 && this.blowLock <= 0) {
      events.push({ name: 'blowoff', d: { strength: clamp(this.boost * 1.15, 0.2, 1) }, at: 0.012 });
      this.blowLock = 0.22;
    }

    // ---------------------------------------------------------------- overrun crackle
    const overrun = this.thr < 0.09 && this.rpm > 5200 && speed > 8;
    const decel = clamp(-longG / 2.2, 0, 1);
    const popRate = overrun ? clamp(3 + 26 * (this.rpm / 12500) * (0.35 + decel) + 10 * brake, 0, 46) : 0;
    if (popRate > 0) {
      if (this.popT < 0) this.popT = 0;
      while (this.popT < dt) {
        events.push({
          name: 'pop',
          d: { strength: clamp(0.25 + 0.75 * (this.rpm / 12500) * (0.4 + 0.6 * decel), 0, 1) },
          at: this.popT,
        });
        this.popT += -Math.log(1 - Math.random()) / popRate;
      }
      this.popT -= dt;
    } else this.popT = -1;

    // rev limiter stutter (physics upshifts at ~14.8k, so this is an edge case, not the sound)
    if (this.rpm > BAND.limit - 350 && this.thr > 0.5 && Math.random() < dt * 22) {
      events.push({ name: 'limiter', d: {}, at: 0 });
    }

    // ---------------------------------------------------------------- ERS / MGU-K
    const deploy = clamp(num(car.ersDeploy, 0), 0, 1);
    const override = car.overrideActive ? 1 : 0;
    const harvest = clamp(num(car.ersHarvest, brake > 0.15 ? 0.6 : 0), 0, 1);
    const ersAmt = clamp(deploy * (0.72 + 0.28 * override) + harvest * 0.42 + 0.09, 0, 1.25);

    // ---------------------------------------------------------------- tyres
    let scrub = 0, squeal = 0, lock = 0, spin = 0, kerb = 0, gravel = 0, slipMax = 0;
    for (const w of wheels) {
      const g = clamp(num(w.gripUse, 0), 0, 1.5);
      const sa = Math.abs(num(w.slipAngle, 0));
      slipMax = Math.max(slipMax, sa);
      scrub += clamp((g - 0.45) / 0.5, 0, 1);
      squeal += clamp((g - 0.84) / 0.26, 0, 1) * clamp(0.35 + sa / 0.16, 0, 1);
      if (w.locked) lock += 1;
      if (w.spinning) spin += 1;
      if (w.surface === 'kerb') kerb += 1;
      else if (w.surface === 'gravel' || w.surface === 'grass' || w.surface === 'astro') gravel += 1;
    }
    const n = Math.max(1, wheels.length);
    const spGate = clamp(speed / 9, 0, 1);
    const tgt = {
      scrub: (scrub / n) * spGate * clamp(speed / 40, 0.12, 1),
      squeal: (squeal / n) * spGate,
      lock: (lock / n) * spGate,
      spin: (spin / n) * clamp(speed / 4, 0.25, 1),
      kerb: (kerb / n) * spGate,
      gravel: (gravel / n) * spGate,
      slip: slipMax,
    };
    for (const key of Object.keys(tgt)) {
      const fast = tgt[key] > this.tyreS[key];
      this.tyreS[key] = smooth(this.tyreS[key], tgt[key], dt, fast ? 0.03 : 0.09);
    }
    const T = this.tyreS;

    // ---------------------------------------------------------------- camera mix
    // menu / pause: pull the whole power unit back rather than freezing a drone at full level
    const quiet = (state?.flags?.menu || state?.flags?.paused) ? 0.32 : 1;
    this.menuDuck = smooth(this.menuDuck, quiet, dt, 0.22);

    const camName = state?.camera?.mode ?? 'tvpod';
    const cam = CAMERA_MIX[camName] ?? CAMERA_MIX.tvpod;
    if (!this.mix) this.mix = { ...cam };
    for (const key of Object.keys(cam)) this.mix[key] = smooth(this.mix[key], cam[key], dt, 0.25);
    const M = this.mix;

    // ---------------------------------------------------------------- environment
    const width = clamp(num(state?.trackQuery?.width, 12), 6, 26);
    const wallT = width * 0.5 + 2.0;
    this.wall = smooth(this.wall, wallT, dt, 0.4);
    const enclT = enclosure(num(state?.lap?.distance, 0)) * (car.onTrack === false ? 0.6 : 1);
    this.encl = smooth(this.encl, enclT, dt, 0.5);
    const slapTime = clamp((2 * this.wall) / 343, 0.006, 0.25);

    // ---------------------------------------------------------------- assemble
    const bright = clamp(0.22 + 0.55 * this.thr + 0.45 * bandC + 0.18 * onSong, 0, 1.25);
    const firing = this.rpm / 60 * 3;      // 90-deg V6 four-stroke: 3 combustion events per rev
    const p = {
      // ICE: one wavetable cycle is 720 crank degrees -> osc freq = rpm/120,
      // which puts the firing fundamental (3 per crank rev) on harmonic 6 = rpm/60*3.
      freq: this.rpm / 120,
      freqTau: 0.018,
      // turbine back-pressure highpass, parked just under the firing order
      hpFreq: clamp(firing * (0.62 + 0.16 * this.boost), 60, 1300),
      tunedFreq: clamp(firing, 90, 2400),
      tunedGain: 4.5 + 2.5 * this.load,
      hardness: clamp(0.25 + 1.35 * this.load + 0.45 * bandC - 0.35 * (1 - this.thr), 0, 2),
      satDrive: 0.9 + 1.7 * this.load + 0.6 * this.boost,
      lpFreq: clamp((1250 + 5200 * bright + 900 * this.boost) * M.lp, 300, 15000),
      muffleDb: -11 + 5.5 * this.boost + 2.5 * onSong,
      iceLevel: (0.20 + 0.30 * this.load + 0.09 * onSong) * M.ice * (1 - 0.25 * strain),
      bodyLevel: (0.055 + 0.085 * this.load) * M.body,
      intakeLevel: (0.010 + 0.048 * this.thr * (0.35 + 0.65 * bandC)) * M.intake,
      intakeMod: 0.9,
      intakeFreq: clamp(this.rpm / 60 * 6, 200, 5200),

      // TURBO: whine tracks shaft speed, not rpm, so it lags the throttle audibly
      turboFreq: 1500 + 6100 * this.spool,
      turboLevel: (0.006 + 0.042 * this.spool * (0.4 + 0.6 * this.boost)) * M.turbo,
      turboAirLevel: (0.004 + 0.030 * this.boost * this.thr) * M.turbo,

      // ERS: MGU-K slot tone tracks crank speed (it is bolted to the crank)
      ersBase: this.rpm / 60,
      ersLevel: (0.006 + 0.052 * ersAmt) * M.ers,
      ersInvLevel: 0.006 * ersAmt * M.ers,

      // TYRES
      scrubLevel: 0.075 * T.scrub * M.tyre,
      scrubFreq: clamp(300 + speed * 7, 180, 1800),
      squealLevel: 0.155 * Math.pow(T.squeal, 1.25) * M.tyre,
      squealFreq: clamp(790 + 2600 * T.slip + speed * 3.4, 500, 2600),
      lockLevel: 0.24 * T.lock * M.tyre,
      lockFreq: clamp(1650 + 900 * T.lock + speed * 4, 900, 4200),
      spinLevel: 0.135 * T.spin * M.tyre,
      spinFreq: clamp(520 + 260 * T.spin + this.rpm / 40, 200, 2200),
      spinRate: clamp(14 + this.rpm / 420, 8, 60),
      kerbLevel: 0.42 * T.kerb * M.tyre,
      kerbFreq: clamp(speed / 0.42, 4, 150),
      gravelLevel: 0.16 * T.gravel * M.tyre,

      // WIND
      windLevel: clamp(Math.pow(clamp(kph / 320, 0, 1.15), 2.0) * 0.075, 0, 0.11) * M.wind,
      windFreq: clamp(360 + kph * 9.5, 250, 6000),
      buffetLevel: clamp(Math.pow(clamp(kph / 320, 0, 1.15), 2.4) * 0.038, 0, 0.06) * M.wind,

      // ENVIRONMENT
      wetLevel: clamp(0.12 + 0.62 * this.encl, 0, 1) * M.wet * (0.45 + 0.55 * this.load),
      wetFreq: clamp(3200 + 3600 * this.encl, 900, 12000),
      slapLevel: clamp(0.04 + 0.15 * this.encl, 0, 1) * M.slap * (0.3 + 0.7 * this.load),
      slapTime,
      // pit boxes / poles / grandstand columns go past at speed/spacing Hz
      slapFlutterHz: clamp(speed / 9.5, 0.5, 40),
      slapFlutter: clamp(0.00038 * this.encl * clamp(speed / 25, 0, 1), 0, 0.0025),
      master: 0.9 * this.menuDuck,
    };
    return { p, events };
  }

  /** Translate a car:shift payload into graph events. */
  shift(d = {}) {
    const up = d.up !== false;
    const strength = clamp(0.5 + 0.5 * (this.rpm / 12500), 0.3, 1.2) * (0.55 + 0.45 * this.thr);
    return [{ name: up ? 'upshift' : 'downshift', d: { strength }, at: 0 }];
  }
}
