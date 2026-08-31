/**
 * 2026 power unit + 8-speed gearbox + ERS energy manager. Owner: PHYSICS.
 *
 * ICE ~400 kW + MGU-K 350 kW, split ~50:50, MGU-H removed.
 * The ICE torque curve is not a hand-drawn hump: below ~10,700 rpm it is BMEP limited,
 * above it the ENERGY-BASED FUEL FLOW LIMIT (3000 MJ/h) takes over, so the engine runs
 * at constant power and torque falls as 1/rpm. That is what puts peak power at
 * 10,700-12,000 rpm and makes 7,000-12,500 the useful band even though the limiter is
 * at 15,000 — shifting at 15,000 sounds (and is) wrong.
 *
 * Deployment taper is the 2026 signature. Art. C5.2.8 verbatim (see deployCap):
 *   baseline  P[kW] = 1800 - 5v  -> 350 kW held to 290 km/h, ZERO AT 345
 *   override  P[kW] = 7100 - 20v -> 350 kW held to 337.5 km/h, zero at 355
 * Combined with a finite store this makes speed PEAK MID-STRAIGHT AND THEN DIP.
 */

export const PU = {
  // --- ICE ---
  fuelFlowJph: 3000e6,      // 3000 MJ/h energy-based fuel flow limit
  peakEff: 0.480,           // -> 833.3 kW fuel power * 0.48 = 400 kW
  torquePeak: 360,          // Nm, BMEP-limited plateau
  torquePeakRpm: 9500,
  torqueFall: 0.55,
  idleRpm: 3800,
  revLimit: 15000,
  limiterBand: 350,         // rpm of soft cut before the limiter

  // --- MGU-K --- (the taper itself is Art. C5.2.8, coded verbatim in deployCap)
  mgukMax: 350e3,           // ERS-K absolute power cap, C5.2.7
  mgukMinKph: 50,           // C5.2.12: unusable below 50 km/h from a standing start
  harvestBrakeMax: 350e3,
  harvestLiftMax: 90e3,
  superClipMax: 250e3,      // of the ICE's 400 kW, up to this is diverted to the store

  // --- energy store (2026: 4 MJ store, <=9 MJ/lap deploy, <=8.5 MJ/lap harvest) ---
  storeJ: 4.0e6,
  lapDeployJ: 9.0e6,
  lapHarvestJ: 8.5e6,
  overrideJ: 0.5e6,

  // --- transmission ---
  gears: [4.350, 3.152, 2.485, 2.051, 1.754, 1.541, 1.385, 1.261],
  final: 3.90,
  efficiency: 0.93,
  inertia: 0.075,           // engine + primary shaft, kg m^2 referred to the crank
  shiftUpRpm: 11900,        // never 15,000 — lands the next gear at ~8,600-10,800
  shiftDownRpm: 8000,
  shiftTimeUp: 0.045,
  shiftTimeDown: 0.055,
};

export const GEAR_COUNT = PU.gears.length;

/** Overall crank->wheel ratio for a 1-based gear index. */
export function ratioOf(gear) {
  return PU.gears[Math.max(0, Math.min(GEAR_COUNT - 1, gear - 1))] * PU.final;
}

/** Indicated thermal efficiency vs rpm — this is what shapes the top end of the curve. */
function thermalEff(rpm) {
  if (rpm <= 6000) return 0.435;
  if (rpm < 10000) return 0.435 + (0.480 - 0.435) * (rpm - 6000) / 4000;
  if (rpm <= 12000) return 0.480;
  return Math.max(0.440, 0.480 - (rpm - 12000) * (0.480 - 0.445) / 3000);
}

/** BMEP-limited crank torque (Nm) before the fuel-flow ceiling is applied. */
function bmepTorque(rpm) {
  const d = (rpm - PU.torquePeakRpm) / PU.torquePeakRpm;
  let t = PU.torquePeak * (1 - PU.torqueFall * d * d);
  if (rpm < 5200) t *= 0.55 + 0.45 * Math.max(0, (rpm - 2200) / 3000);
  return Math.max(0, t);
}

/** Peak ICE power (W) at a given rpm: min(BMEP limit, fuel-flow limit). */
export function icePower(rpm) {
  const w = rpm * Math.PI / 30;
  const flow = (PU.fuelFlowJph / 3600) * thermalEff(rpm);
  const bmep = bmepTorque(rpm) * w;
  // NOTE: the rev limiter is applied by the vehicle to the TOTAL crank torque
  // (ICE + MGU-K), so this stays the clean power curve.
  return Math.max(0, Math.min(flow, bmep));
}

/** Peak ICE crank torque (Nm) at a given rpm. */
export function iceTorque(rpm) {
  const w = Math.max(1, rpm) * Math.PI / 30;
  return icePower(rpm) / w;
}

/**
 * MGU-K propulsive power ceiling at this road speed. FIA 2026 Technical Regulations
 * Section C, Art. C5.2.8 (Issue 18, 7 May 2026), coded VERBATIM.
 * v = km/h, P = propulsive DC power in kW, capped at the 350 kW ERS-K limit (C5.2.7):
 *
 *   Overtake NOT active:  P = 1800 - 5v    for v < 340        350 kW holds to 290 km/h
 *                         P = 6900 - 20v   for 340 <= v < 345
 *                         P = 0            for v >= 345
 *   Overtake ACTIVE:      P = 7100 - 20v   for v < 355        350 kW holds to 337.5 km/h
 *                         P = 0            for v >= 355
 *   Race/Sprint safety sectors: P = 250 below 310 km/h, then the non-Overtake curve.
 *
 * The non-Overtake curve reaches ZERO AT 345 km/h. The widely-repeated 355 km/h zero
 * point is a stale 2024 figure and belongs to the Overtake curve only. Because the
 * ceiling starts falling at 290 km/h, the car's speed PEAKS MID-STRAIGHT AND THEN DIPS —
 * the clearest 2026 signature, and the reason a monotonic rise reads as a 2025 car.
 */
export function deployCap(kph, override, safety = false) {
  let kW;
  if (override) kW = kph < 355 ? 7100 - 20 * kph : 0;
  else if (kph < 340) kW = 1800 - 5 * kph;
  else if (kph < 345) kW = 6900 - 20 * kph;
  else kW = 0;
  if (safety && kph < 310) kW = Math.min(kW, 250);
  return Math.max(0, Math.min(350, kW)) * 1000;
}

/**
 * Automatic ERS manager (Time Trial: "ERS is fixed/automatic for the lap").
 * Owns the store, the per-lap budgets, clipping and super-clipping.
 */
export class ErsManager {
  constructor() { this.reset(); }

  reset() {
    this.energy = PU.storeJ;
    this.lapDeployed = 0;
    this.lapHarvested = 0;
    this.overrideEnergy = PU.overrideJ;
    this.superClip = 0;     // seconds of super-clip remaining
    this.scCooldown = 0;
    this.launched = true;   // C5.2.12 gate, see update()
    this.deployW = 0;
    this.harvestW = 0;
    this.clipping = false;
  }

  newLap() { this.lapDeployed = 0; this.lapHarvested = 0; this.overrideEnergy = PU.overrideJ; }

  get soc() { return this.energy / PU.storeJ; }

  /**
   * @returns {{ deployW, harvestW, diverted, clipping, superClipping, overrideActive }}
   *  deployW    MGU-K power added at the crank
   *  harvestW   power taken out of the braking event (rear axle) into the store
   *  diverted   ICE power stolen for the store while at full throttle (super-clipping)
   */
  update(h, { throttle, brake, kph, override, rearBrakePowerAvail }) {
    const soc = this.soc;
    let deployW = 0, harvestW = 0, diverted = 0;
    let overrideActive = false;

    // C5.2.12: the MGU-K may not drive the car below 50 km/h FROM A STANDING START.
    // It is a launch-control rule, not a blanket low-speed cut — deployment out of a
    // 65 km/h hairpin is legal, and gating that too costs a second a lap.
    if (kph < 2) this.launched = false;
    else if (kph > PU.mgukMinKph) this.launched = true;
    const mgukLegal = this.launched || kph > PU.mgukMinKph;

    // ---- super-clipping: the car SLOWS at full throttle while the MGU-K rebuilds charge
    this.scCooldown = Math.max(0, this.scCooldown - h);
    if (this.superClip > 0) {
      this.superClip -= h;
      if (this.superClip <= 0 || soc > 0.16) { this.superClip = 0; this.scCooldown = 6.0; }
    } else if (soc < 0.045 && throttle > 0.95 && kph > 150 && this.scCooldown <= 0) {
      this.superClip = 2.2;
    }
    const superClipping = this.superClip > 0 && throttle > 0.9 && kph > 120;
    if (superClipping) {
      diverted = PU.superClipMax;
      this.energy = Math.min(PU.storeJ, this.energy + diverted * h * 0.92);
      this.lapHarvested += diverted * h * 0.92;
    }

    // ---- deployment. Fades out as the store empties: that IS clipping.
    if (throttle > 0.06 && mgukLegal && !superClipping && this.lapDeployed < PU.lapDeployJ) {
      const useOverride = override && this.overrideEnergy > 0 && soc > 0.05;
      // Clipping is not a gentle fade: the store hits its floor and deployment DROPS.
      const fade = smooth01((soc - 0.020) / 0.055);
      deployW = deployCap(kph, useOverride) * fade * Math.min(1, throttle * 1.15);
      const draw = deployW * h / 0.96;
      if (draw > this.energy) { deployW *= this.energy / Math.max(draw, 1e-6); }
      this.energy = Math.max(0, this.energy - deployW * h / 0.96);
      this.lapDeployed += deployW * h;
      if (useOverride && deployW > 0) {
        this.overrideEnergy = Math.max(0, this.overrideEnergy - deployW * h * 0.25);
        overrideActive = true;
      }
    }

    // ---- harvesting
    if (this.lapHarvested < PU.lapHarvestJ) {
      const room = PU.storeJ - this.energy;
      if (brake > 0.04 && kph > 25) {
        harvestW = Math.min(PU.harvestBrakeMax, Math.max(0, rearBrakePowerAvail));
      } else if (throttle < 0.04 && kph > 40) {
        harvestW = PU.harvestLiftMax;
      }
      if (harvestW * h * 0.92 > room) harvestW = room / Math.max(h * 0.92, 1e-6);
      this.energy = Math.min(PU.storeJ, this.energy + harvestW * h * 0.92);
      this.lapHarvested += harvestW * h * 0.92;
    }

    this.deployW = deployW; this.harvestW = harvestW;
    this.clipping = throttle > 0.5 && kph > 100 && deployW < PU.mgukMax * 0.25;
    return { deployW, harvestW, diverted, clipping: this.clipping, superClipping, overrideActive };
  }
}

function smooth01(x) {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
}
