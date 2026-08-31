/**
 * 2026-spec Formula 1 vehicle dynamics. Owner: PHYSICS.
 * Writes state.car.*; reads state.input.* and track.locate()/sampleS().
 * Fixed 120 Hz step. Body frame: +x right, +y up, +z forward.
 *
 * WHAT MAKES THIS A 2026 CAR (see docs/reference-physics.md)
 *  - Load-sensitive slick, mu(Fz) = 1.8 - 5e-5*Fz, Magic Formula peak at 7 deg / 10 % slip
 *    with a slick's steep post-peak falloff, and a true combined-slip friction ellipse.
 *    Load sensitivity is what makes grip RISE WITH SPEED instead of being flat: at
 *    80 km/h the car has 1.9 g, at 250 km/h it has 4.4 g, off the same tyre.
 *  - ClA 5.40 cornering / 4.65 straight: downforce equals car weight at ~187 km/h and is
 *    ~1370 kgf at 250 km/h (2025 was ~2000). Two aero states; Cornering Mode is default.
 *  - Brakes are DELIBERATELY WEAKER than 2025: a 20 kN brake-force ceiling caps peak
 *    deceleration near 3.3 g and puts 300->100 km/h at ~110 m. Over 4 g is plain wrong.
 *  - 400 kW ICE shaped by an energy-based fuel-flow limit, plus a 350 kW MGU-K whose
 *    deployment TAPERS with speed out of a finite store, so speed peaks mid-straight
 *    and then dips. A monotonic rise to the braking point would be a 2025 car.
 *  - Per-corner spring / damper / anti-roll platform: real load transfer, ride height
 *    change with downforce, and kerb strikes that unsettle the car.
 *
 * tools/shoot.mjs poses the car by writing ph.pos / ph.quat / ph.vel / ph.hintS directly,
 * so every step re-derives its frame from those fields instead of caching them.
 */
import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { TYRE, SURFACE, muAt, tyreForces, slipStiffnessX, tempGrip } from './tyre.js';
import { PU, GEAR_COUNT, ratioOf, iceTorque, ErsManager } from './powertrain.js';
import { AERO, zoneAt, zonesFrom, aeroCoeffs, ZONES } from './aero.js';

const G = 9.81;
const C = CONFIG.car;

// ---------------------------------------------------------------- chassis geometry
const MASS = C.mass;                     // 768 kg incl. driver (2026 minimum)
const A_FRONT = 1.853;                   // CG -> front axle (front carries 45.5 %)
const B_REAR = 1.547;                    // CG -> rear axle
const WHEELBASE = A_FRONT + B_REAR;      // 3.400 m
const HT_F = 0.825, HT_R = 0.790;        // half track, front / rear
const H_CG = C.cgHeight;                 // 0.28 m
const IZZ = 1050;                        // yaw inertia — "lighter, more agile"
const MODEL_Z = 0.303;                   // rendered body origin sits this far ahead of the CG

const WH = [
  { x: -HT_F, y: +A_FRONT, front: true, r: TYRE.radiusF, I: TYRE.inertiaF, hw: TYRE.halfWidthF },
  { x: +HT_F, y: +A_FRONT, front: true, r: TYRE.radiusF, I: TYRE.inertiaF, hw: TYRE.halfWidthF },
  { x: -HT_R, y: -B_REAR, front: false, r: TYRE.radiusR, I: TYRE.inertiaR, hw: TYRE.halfWidthR },
  { x: +HT_R, y: -B_REAR, front: false, r: TYRE.radiusR, I: TYRE.inertiaR, hw: TYRE.halfWidthR },
];

// ---------------------------------------------------------------- suspension
const SUS = {
  sprung: 680, unsprung: 22,             // kg (4 x 22 unsprung)
  Ipitch: 640, Iroll: 165,
  kF: 150000, kR: 175000,                // N/m at the wheel — ~4.9 Hz heave, F1 stiff
  cF: 5200, cR: 6100,                    // N s/m in bump
  // Vertical carcass rate. The tyre sits IN SERIES with the spring, so a 50 mm kerb
  // does not push 50 mm of spring: it pushes k_tyre/(k_tyre+k_spring) of it. Leaving
  // the tyre out makes a stiff car absurdly violent over kerbs — and, because grip is
  // mu(Fz)*Fz, briefly and wrongly makes riding a kerb the grippiest thing it can do.
  ktF: 290000, ktR: 310000,
  reboundRatio: 1.55,
  arbF: 62000, arbR: 46000,              // anti-roll bars, N/m differential at the wheel
  bumpTravel: 0.062, bumpRate: 1.4e6, bumpMax: 9000,
  visPitch: 2.5, visRoll: 1.6,           // camera-facing amplification of the platform
  visPitchG: 0.0040, visRollG: 0.0025,   // + an inertial term so the car MOVES on the brakes
  rideY: 0.014,                          // static body-origin height above the road
};
const STATIC_F = SUS.sprung * G * (B_REAR / WHEELBASE) / 2;
const STATIC_R = SUS.sprung * G * (A_FRONT / WHEELBASE) / 2;
const UNSPRUNG_N = SUS.unsprung * G;

// ---------------------------------------------------------------- brakes / steering
/**
 * A tyre cannot transmit an unbounded vertical load: the carcass squashes flat, the
 * suspension runs out of travel and the contact patch saturates. Cap each corner at
 * this multiple of its quasi-static share (weight bias + aero balance), which still
 * allows the car to stand on two wheels over a kerb.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS: grip is mu(Fz)*Fz, so an uncapped load spike is
 * a grip spike. A kerb strike that briefly triples a wheel load is exactly how a car
 * that corners at 1.9 g reports a 4 g "peak lateral G" — the number the acceptance
 * band actually tests. The cap is what keeps the measured grip curve honest.
 */
const FZ_CAP = 1.58;

const BRAKE_FORCE_MAX = 22600;           // N at the contact patches -> peak 3.3 g, 300-100 in ~105 m
const BRAKE_BIAS_LOW = 0.605, BRAKE_BIAS_HIGH = 0.545;
const ENGINE_BRAKE_NM = 46;
const STEER_LOCK_LOW = 0.420;            // 24.1 deg road-wheel angle at low speed
const STEER_LOCK_HIGH = 0.105;
const STEER_LOCK_V0 = 18, STEER_LOCK_V1 = 72;   // full lock stays available for hairpins
const STEER_TAU = 0.045;
const MGUK_TORQUE_MAX = 520;             // Nm at the crank — the MGU-K is torque limited too

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

export class VehiclePhysics {
  constructor(ctx) {
    this.ctx = ctx; this.state = ctx.state;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();       // world m/s, of the CG
    this.quat = new THREE.Quaternion();
    this.omega = new THREE.Vector3();     // planar: only .y is integrated
    this.hintS = 0; this.lastS = 0;
    this.gear = 1; this.rpm = PU.idleRpm; this.shiftT = 0; this.shiftHold = 0;
    this.ers = new ErsManager();

    // Driver assists. ABS is OFF by default (reference). The gearbox is driver-shiftable
    // at any time; the automatic assist only fills in when the driver is not shifting.
    this.assists = { tc: 0.92, abs: 0, autoGear: true, autoAero: true, stability: 1 };

    this.spin = [0, 0, 0, 0];             // wheel angular velocity, rad/s
    this.spinAngle = [0, 0, 0, 0];
    this.alpha = [0, 0, 0, 0];            // relaxed slip angle, rad
    this.kappa = [0, 0, 0, 0];
    this.latUse = [0, 0, 0, 0];           // |Fy| / (mu*Fz): share of the circle spent sideways
    this.Fz = [STATIC_F + UNSPRUNG_N, STATIC_F + UNSPRUNG_N, STATIC_R + UNSPRUNG_N, STATIC_R + UNSPRUNG_N];
    this.zRoad = [0, 0, 0, 0];
    this.contact = [true, true, true, true];
    this.travel = [0, 0, 0, 0]; this.travelV = [0, 0, 0, 0];
    this.surface = ['asphalt', 'asphalt', 'asphalt', 'asphalt'];
    this.wheelOff = [false, false, false, false];
    this.brakeTemp = [380, 380, 380, 380];
    this.tyreTemp = [90, 90, 90, 90];

    // sprung platform DOFs, zero at static equilibrium
    this.zs = 0; this.zsd = 0; this.zsAcc = 0;
    this.pitch = 0; this.pitchd = 0; this.roll = 0; this.rolld = 0;

    this.steer = 0; this.aeroBlend = 0; this.turbo = 0.2;
    this.ax = 0; this.ay = 0; this.axF = 0; this.ayF = 0;
    this.tcInt = 0; this.prevShiftUp = false; this.prevShiftDown = false;
    this.hitCd = 0; this.prevVx = 0; this.prevVz = 0; this.roadInit = true;
    this.prevPos = new THREE.Vector3(); this.posInit = true;
    this._p = new THREE.Vector3();
    this._qy = new THREE.Quaternion(); this._qp = new THREE.Quaternion(); this._qr = new THREE.Quaternion();
    this._ax = new THREE.Vector3(1, 0, 0); this._ay = new THREE.Vector3(0, 1, 0); this._az = new THREE.Vector3(0, 0, 1);
  }

  async init() {
    this.track = this.ctx.get('track');
    this.trackLen = this.track?.length ?? CONFIG.track.length;
    // One source of truth for the Straight Line Mode zones: the track's own table, so
    // the physics can never open the wings somewhere the HUD says it is not a zone.
    this.zones = this.track ? zonesFrom(this.track) : ZONES;
    this.resetToTrack(0);
    this.ctx.bus.on('game:reset', (s) => this.resetToTrack(s ?? 0));
    this.ctx.bus.on('lap:complete', () => this.ers.newLap());
  }

  resetToTrack(s) {
    const t = this.track.sampleS(s);
    this.pos.copy(t.point); this.pos.y += SUS.rideY;
    this.quat.setFromUnitVectors(this._az, t.tangent.clone().setY(0).normalize());
    this.vel.set(0, 0, 0); this.omega.set(0, 0, 0);
    this.gear = 1; this.rpm = PU.idleRpm; this.hintS = s; this.lastS = s;
    this.zs = this.zsd = this.pitch = this.pitchd = this.roll = this.rolld = 0;
    this.spin.fill(0); this.alpha.fill(0); this.kappa.fill(0);
    this.Fz[0] = this.Fz[1] = STATIC_F + UNSPRUNG_N;
    this.Fz[2] = this.Fz[3] = STATIC_R + UNSPRUNG_N;
    this.steer = 0; this.aeroBlend = 0; this.turbo = 0.2;
    this.ax = this.ay = this.axF = this.ayF = 0; this.tcInt = 0;
    this.brakeTemp.fill(380); this.tyreTemp.fill(90);
    this.prevVx = 0; this.prevVz = 0; this.roadInit = true;
    this.prevPos.copy(this.pos); this.posInit = true;
    this.ers.reset(); this.ers.newLap();
    this.state.car.ers = 1;
  }

  // ================================================================= main step
  fixedUpdate(h) {
    if (!this.track) return;
    const st = this.state, inp = st.input, car = st.car;
    if (!Number.isFinite(this.pos.x + this.pos.z + this.vel.x + this.vel.z + this.quat.w)) {
      this.resetToTrack(this.lastS); return;
    }

    // ---- external teleport? -------------------------------------------------
    // The capture rig and the probes pose the car by writing pos/quat/vel directly.
    // A jump of >3 m in one 1/120 s step is not something the car can do (0.93 m at
    // 400 km/h), so it is a teleport: everything that describes the OLD pose — yaw
    // rate, the steering actuator, the sprung platform, the wing state, the lap's
    // energy budget — is stale and must be re-seated, exactly like the wheel speeds.
    // A barrier impact changes velocity, not position, so it does not trigger this.
    if (!this.posInit && this.pos.distanceToSquared(this.prevPos) > 9) this.#teleport();
    this.posInit = false;

    // ---- frame, re-derived from this.quat every step (the capture rig pokes it) ----
    const q = this.quat;
    const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
    const fwX = Math.sin(yaw), fwZ = Math.cos(yaw);      // body forward, world
    const rgX = fwZ, rgZ = -fwX;                          // body right, world

    const cgx = this.pos.x - fwX * MODEL_Z;
    const cgz = this.pos.z - fwZ * MODEL_Z;

    const vx = this.vel.x * rgX + this.vel.z * rgZ;       // lateral, +right
    const vz = this.vel.x * fwX + this.vel.z * fwZ;       // longitudinal, +forward
    const speed = Math.hypot(vx, vz);
    const kph = speed * 3.6;
    const wYaw = this.omega.y;

    // The capture rig teleports the car and rewrites ph.vel. Without re-syncing the
    // rotating masses the wheels arrive stationary under a 300 km/h car and lock solid.
    if (Math.hypot(this.vel.x - this.prevVx, this.vel.z - this.prevVz) > 8) this.#resync(vx, vz);
    this.prevVx = this.vel.x; this.prevVz = this.vel.z;

    // ---- surface query ----------------------------------------------------
    this._p.set(cgx, this.pos.y, cgz);
    const loc = this.track.locate(this._p, this.hintS);
    this.hintS = loc.s; this.lastS = loc.s; this.loc = loc;
    const slope = clamp(loc.tangent.y, -0.25, 0.25);      // +ve = uphill

    // ---- driver inputs ----------------------------------------------------
    const throttle = clamp(inp.throttle ?? 0, 0, 1);
    const brakeRaw = clamp(inp.brake ?? 0, 0, 1);
    const brake = brakeRaw * (0.62 + 0.38 * brakeRaw);    // "brake linearity 35"
    const steerIn = clamp(inp.steer ?? 0, -1, 1);
    const steerShaped = steerIn * (0.55 + 0.45 * steerIn * steerIn);   // "linearity 40"
    const lock = lerp(STEER_LOCK_LOW, STEER_LOCK_HIGH,
      clamp((speed - STEER_LOCK_V0) / (STEER_LOCK_V1 - STEER_LOCK_V0), 0, 1));
    this.steer += (steerShaped * lock - this.steer) * Math.min(1, h / STEER_TAU);
    const delta = this.steer;
    car.steerAngle = delta;

    this.#gearbox(h, inp, throttle, Math.abs(vz));
    const ratio = ratioOf(this.gear);

    // ---- active aero ------------------------------------------------------
    const zone = zoneAt(loc.s, this.trackLen, this.zones);
    const asked = this.assists.autoAero || !!inp.drsRequest || !!inp.override;
    const wantStraight = !!zone && asked && throttle >= 0.98 && brakeRaw < 0.02 &&
      Math.abs(steerIn) < 0.14 && Math.abs(this.ayF) < 12 && speed > 18;
    this.aeroBlend = clamp(this.aeroBlend + (wantStraight ? AERO.openRate : -AERO.closeRate) * h, 0, 1);
    const { ClA, CdA } = aeroCoeffs(this.aeroBlend);
    const qDyn = 0.5 * AERO.rho * speed * speed;
    const downforce = qDyn * ClA;
    const drag = qDyn * CdA;
    const balF = AERO.balanceFront - AERO.balanceShift * clamp((speed - 30) / 55, 0, 1);
    const dfF = downforce * balF, dfR = downforce * (1 - balF);

    // ---- suspension platform -> wheel loads --------------------------------
    this.#suspension(h, loc, dfF, dfR, fwX, fwZ, rgX, rgZ);

    // ---- power unit --------------------------------------------------------
    const wRear = 0.5 * (this.spin[2] + this.spin[3]);
    const wheelRpm = Math.abs(wRear) * ratio * 30 / Math.PI;
    this.rpm = clamp(Math.max(wheelRpm, PU.idleRpm), PU.idleRpm, PU.revLimit);
    const clutch = clamp((wheelRpm + 900) / (PU.idleRpm * 0.9), 0.35, 1);
    const shifting = this.shiftT > 0;
    const thr = shifting ? 0 : throttle;
    const wCrank = Math.max(this.rpm * Math.PI / 30, 1);

    const spoolTarget = clamp(thr * (0.35 + 0.65 * clamp((this.rpm - 5000) / 5000, 0, 1)), 0, 1);
    this.turbo += (spoolTarget - this.turbo) * Math.min(1, h / (spoolTarget > this.turbo ? 0.26 : 0.10));

    const bias = this.#brakeBias(speed);
    const rearBrakePower = brake * BRAKE_FORCE_MAX * (1 - bias) * speed;
    const ersOut = this.ers.update(h, {
      throttle: thr, brake: brakeRaw, kph, override: !!inp.override,
      rearBrakePowerAvail: rearBrakePower,
    });

    let icePw = iceTorque(this.rpm) * wCrank * thr * (0.55 + 0.45 * this.turbo);
    icePw = Math.max(0, icePw - ersOut.diverted);          // super-clipping steals ICE power
    const mgukT = thr > 0.05 ? Math.min(MGUK_TORQUE_MAX, ersOut.deployW / wCrank) : 0;
    const limCut = clamp((PU.revLimit - this.rpm) / PU.limiterBand, 0, 1);   // rev limiter
    const crankT = (icePw / wCrank + mgukT) * limCut;
    let driveT = shifting ? 0 : crankT * ratio * PU.efficiency * clutch;

    // Traction control: a feed-forward torque ceiling from the estimated rear grip plus
    // slip-ratio feedback. It caps gross wheelspin without removing throttle-on
    // oversteer — the rear still runs at ~13 % slip, which costs it lateral capacity.
    const kRear = 0.5 * (Math.abs(this.kappa[2]) + Math.abs(this.kappa[3]));
    let tcCut = 0;
    if (this.assists.tc > 0 && driveT > 0) {
      const sR = 0.5 * ((SURFACE[this.surface[2]] ?? SURFACE.asphalt).mu + (SURFACE[this.surface[3]] ?? SURFACE.asphalt).mu);
      const grip = (this.Fz[2] * muAt(this.Fz[2]) + this.Fz[3] * muAt(this.Fz[3])) * sR;
      // The rear tyres only have ONE friction circle. Whatever they are already spending
      // sideways is not available to push, so the torque ceiling has to shrink with
      // lateral load — otherwise the car happily accelerates out of a corner it is
      // already sliding through, which is both wrong to drive and the reason a "peak
      // lateral G at 80 km/h" measurement quietly turns into one at 100 km/h.
      const lat = clamp(0.5 * (this.latUse[2] + this.latUse[3]), 0, 1);
      const ellipse = Math.sqrt(Math.max(0, 1 - lat * lat));
      this.tcInt = clamp(this.tcInt + (kRear - 0.13) * h * 16, -0.20, 0.95);
      const ceiling = grip * ellipse * TYRE.radiusR * clamp(1.06 - this.tcInt - Math.max(0, kRear - 0.30), 0.08, 1.3);
      if (driveT > ceiling) {
        const raw = driveT;
        driveT = lerp(driveT, ceiling, this.assists.tc);
        tcCut = 1 - driveT / raw;
      }
    } else this.tcInt = 0;
    const engBrakeT = (thr < 0.06 && wheelRpm > PU.idleRpm * 0.8)
      ? ENGINE_BRAKE_NM * ratio * PU.efficiency * clutch : 0;
    const diffT = clamp((this.spin[2] - this.spin[3]) * 75, -900, 900);
    const driveW = [0, 0, 0.5 * driveT - diffT, 0.5 * driveT + diffT];
    const engineI = PU.inertia * ratio * ratio * clutch * 0.5;

    const brakeT = [
      brake * BRAKE_FORCE_MAX * bias * 0.5 * TYRE.radiusF,
      brake * BRAKE_FORCE_MAX * bias * 0.5 * TYRE.radiusF,
      brake * BRAKE_FORCE_MAX * (1 - bias) * 0.5 * TYRE.radiusR,
      brake * BRAKE_FORCE_MAX * (1 - bias) * 0.5 * TYRE.radiusR,
    ];

    // ================================================== per-wheel solve
    let Fx = 0, Fy = 0, Mz = 0, contacts = 0;
    for (let i = 0; i < 4; i++) {
      const w = WH[i], Fz = this.Fz[i], cw = car.wheel[i];
      const surf = this.surface[i];
      const sInfo = SURFACE[surf] ?? SURFACE.asphalt;
      const scale = sInfo.mu * tempGrip(this.tyreTemp[i]);

      const vwx = vx + wYaw * w.y;
      const vwz = vz - wYaw * w.x;
      const d = w.front ? delta : 0;
      const cd = Math.cos(d), sd = Math.sin(d);
      const u = vwz * cd + vwx * sd;                     // along the wheel
      const vlat = -vwz * sd + vwx * cd;

      // slip angle with relaxation length — a tyre cannot build force instantly
      const aRaw = Math.atan2(vlat, Math.abs(u) + 0.8);
      const kRel = this.contact[i] ? Math.min(1, Math.abs(u) * h / TYRE.relaxLength) : 1;
      this.alpha[i] += (aRaw - this.alpha[i]) * kRel;

      // The wheel speed was solved against LAST step's road speed; comparing it with
      // this step's u fabricates a slip of a*h that is negligible at speed but eats
      // hundreds of newtons per wheel off the line. Take the one-step lag back out.
      const uLag = u - this.ax * h;
      const den = Math.max(Math.abs(u), TYRE.kappaVmin);
      const kap = clamp((this.spin[i] * w.r - uLag) / den, -4, 4);

      let f = tyreForces(kap, this.alpha[i], Fz, scale);
      if (this.contact[i]) contacts++; else f = { fx: 0, fy: 0, s: 0, mu: 0, D: 0 };

      // --- wheel spin, semi-implicit in Fx: lock-up and wheelspin stay stable ---
      const Iw = w.I + (w.front ? 0 : engineI);
      const dirRef = Math.sign(this.spin[i] || u || 1);
      let bT = brakeT[i];
      if (this.assists.abs > 0 && kap < -0.16) bT *= 1 - this.assists.abs;
      const bDir = Math.abs(this.spin[i]) > 0.6 ? Math.sign(this.spin[i]) : Math.sign(u || 1);
      let tNet = driveW[i] - bT * bDir - sInfo.roll * Fz * w.r * dirRef;
      if (!w.front) tNet -= engBrakeT * 0.5 * dirRef;   // shared by the two driven wheels
      const Kx = slipStiffnessX(Math.max(f.D, 400)) * w.r / den;
      const wOld = this.spin[i];
      this.spin[i] = wOld + (tNet - f.fx * w.r) / (Iw / h + Kx * w.r);
      if (bT > 0 && wOld * this.spin[i] < 0 && Math.abs(driveW[i]) < 60) this.spin[i] = 0;
      if (!this.contact[i]) this.spin[i] = u / w.r;
      this.spinAngle[i] += this.spin[i] * h;
      // The implicit step solved for a NEW slip; the body must see the force at that
      // slip, not at the stale one, or the tyre delivers ~80 % of what it should.
      const kapN = clamp((this.spin[i] * w.r - uLag) / den, -4, 4);
      this.kappa[i] = kapN;
      if (this.contact[i]) f = tyreForces(kapN, this.alpha[i], Fz, scale);

      const fxB = f.fx * cd - f.fy * sd;
      const fyB = f.fx * sd + f.fy * cd;
      Fx += fxB; Fy += fyB;
      Mz += w.y * fyB - w.x * fxB;

      this.latUse[i] = f.D > 1 ? Math.min(1, Math.abs(f.fy) / f.D) : 0;

      cw.load = Fz; cw.slipAngle = this.alpha[i]; cw.slipRatio = this.kappa[i];
      cw.gripUse = Math.min(2.2, f.s);
      cw.contact = this.contact[i];
      cw.spin = this.spinAngle[i]; cw.angle = d;
      cw.forceLong = fxB; cw.forceLat = fyB;
      cw.surface = surf;
      cw.locked = brakeRaw > 0.05 && this.kappa[i] < -0.30 && Math.abs(u) > 3;
      cw.spinning = !w.front && thr > 0.15 && this.kappa[i] > 0.17;
      cw.susTravel = this.travel[i]; cw.susVel = this.travelV[i];
      cw.pos.set(cgx + rgX * w.x + fwX * w.y, loc.height + this.zRoad[i], cgz + rgZ * w.x + fwZ * w.y);

      const heatT = 88 + Math.min(f.s, 2.0) * 26 + Math.abs(this.kappa[i]) * 40;
      this.tyreTemp[i] += (heatT - this.tyreTemp[i]) * h * 0.55;
      this.brakeTemp[i] = clamp(this.brakeTemp[i] +
        (bT * Math.abs(this.spin[i]) / 4200 - 0.030 * (this.brakeTemp[i] - 45) * (1 + speed / 30)) * h, 45, 1300);
      cw.temp = this.tyreTemp[i];
      cw.wear = Math.min(1, (cw.wear || 0) + Math.max(0, f.s - 0.9) * h * 0.0012);
    }
    car.brakeTemp = this.brakeTemp;

    // ================================================== body dynamics
    Fx -= drag;
    Fx -= MASS * G * slope;                                // gravity along the slope

    const beta = Math.atan2(vx, Math.abs(vz) + 1.0);
    Mz -= qDyn * AERO.sideStiff * beta * this.assists.stability;   // aero directional stability
    Mz -= qDyn * AERO.yawDamp * wYaw * this.assists.stability;     // weathervane damping
    Mz -= wYaw * 400;

    const ax = Fx / MASS, ay = Fy / MASS;
    this.ax = ax; this.ay = ay;
    this.axF += (ax - this.axF) * Math.min(1, h * 22);
    this.ayF += (ay - this.ayF) * Math.min(1, h * 22);

    this.omega.y = clamp(wYaw + (Mz / IZZ) * h, -4.5, 4.5);

    this.vel.x += (fwX * ax + rgX * ay) * h;
    this.vel.z += (fwZ * ax + rgZ * ay) * h;
    this.vel.y = 0;
    if (speed < 0.4 && thr < 0.02 && brakeRaw > 0.02) this.vel.multiplyScalar(0.82);

    const newYaw = yaw + this.omega.y * h;
    let ncgx = cgx + this.vel.x * h, ncgz = cgz + this.vel.z * h;

    // ---- terrain follow, barriers, track limits ----------------------------
    this._p.set(ncgx, this.pos.y, ncgz);
    const loc2 = this.track.locate(this._p, loc.s);
    this.hintS = loc2.s;
    const over = Math.abs(loc2.lateral) - (loc2.halfWidth + 16);
    if (over > 0) {                                        // barrier
      const sgn = Math.sign(loc2.lateral);
      ncgx -= loc2.right.x * sgn * over; ncgz -= loc2.right.z * sgn * over;
      const vn = this.vel.x * loc2.right.x + this.vel.z * loc2.right.z;
      if (vn * sgn > 0) {
        this.vel.x -= loc2.right.x * vn * 1.5; this.vel.z -= loc2.right.z * vn * 1.5;
      }
      this.vel.multiplyScalar(0.94); this.omega.y *= 0.85;
      if (speed > 12 && this.hitCd <= 0) { this.ctx.bus.emit('car:impact', { speed }); this.hitCd = 0.6; }
    }
    this.hitCd = Math.max(0, this.hitCd - h);

    const nfx = Math.sin(newYaw), nfz = Math.cos(newYaw);
    this.pos.set(
      ncgx + nfx * MODEL_Z,
      loc2.height + SUS.rideY + clamp(this.zs, -0.012, 0.030),
      ncgz + nfz * MODEL_Z);
    this.prevPos.copy(this.pos);

    // ---- attitude: yaw + slope + platform pitch/roll (kerbs unsettle the car) ----
    const pitchVis = clamp(-this.pitch * SUS.visPitch - SUS.visPitchG * (this.axF / G)
      - Math.asin(clamp(slope, -0.9, 0.9)), -0.11, 0.11);
    const rollVis = clamp(this.roll * SUS.visRoll + SUS.visRollG * (this.ayF / G), -0.10, 0.10);
    this._qy.setFromAxisAngle(this._ay, newYaw);
    this._qp.setFromAxisAngle(this._ax, pitchVis);
    this._qr.setFromAxisAngle(this._az, rollVis);
    this.quat.copy(this._qy).multiply(this._qp).multiply(this._qr);

    // ================================================== publish
    const vxN = this.vel.x * nfz - this.vel.z * nfx;
    const vzN = this.vel.x * nfx + this.vel.z * nfz;
    car.position.copy(this.pos);
    car.quaternion.copy(this.quat);
    car.velocity.copy(this.vel);
    car.localVel.set(vxN, 0, vzN);
    car.angularVelocity.copy(this.omega);
    car.speed = Math.hypot(vxN, vzN); car.kph = car.speed * 3.6;
    car.rpm = this.rpm; car.gear = this.gear; car.gearCount = GEAR_COUNT;
    car.clutchEngaged = clutch;
    car.engineLoad = clamp(thr * (1 - tcCut), 0, 1);
    car.turboBoost = this.turbo; car.turboSpool = this.turbo;
    car.downforce = downforce; car.drag = drag;
    car.aeroMode = this.aeroBlend > 0.5 ? 'X' : 'Z';
    car.aeroModeName = this.aeroBlend > 0.5 ? 'Straight Line' : 'Cornering';
    car.aeroBlend = this.aeroBlend;
    car.aeroZone = !!zone; car.aeroZoneName = zone ? zone.name : '';
    car.ers = this.ers.soc;
    car.ersDeploy = ersOut.deployW / PU.mgukMax;
    car.ersHarvest = ersOut.harvestW / PU.harvestBrakeMax;
    car.ersClipping = ersOut.clipping;
    car.ersSuperClip = ersOut.superClipping;
    car.overrideActive = ersOut.overrideActive;
    car.overrideAvail = this.ers.overrideEnergy / PU.overrideJ;
    car.lateralG = ay / G; car.longG = ax / G;
    car.verticalG = 1 + this.zsAcc / G;
    car.yawRate = this.omega.y; car.slipAngle = beta;
    car.throttle = thr; car.brake = brakeRaw;
    car.tcCut = tcCut; car.gearAssist = this.assists.autoGear;
    car.airborne = contacts === 0;
    car.fuel = 100; car.fuelMix = 2; car.damage = 0;

    let off = 0;
    for (let i = 0; i < 4; i++) if (this.wheelOff[i]) off++;
    car.wheelsOff = off;                                   // 4 = all wheels FULLY beyond the line
    car.onTrack = off < 4;

    st.trackQuery.s = loc2.s;
    st.trackQuery.u = loc2.lateral / Math.max(loc2.halfWidth, 0.1);
    st.trackQuery.width = loc2.halfWidth * 2;
    st.trackQuery.heading = newYaw;
    st.trackQuery.elevation = loc2.height;
    st.trackQuery.banking = 0;
    st.lap.distance = loc2.s;
    st.lap.progress = loc2.s / this.trackLen;
  }

  // ================================================================= helpers
  #brakeBias(speed) { return lerp(BRAKE_BIAS_LOW, BRAKE_BIAS_HIGH, clamp(speed / 70, 0, 1)); }

  /**
   * Full re-seat after an external teleport (see fixedUpdate). Everything here describes
   * the pose the car has just been moved AWAY from; carrying it over is what made a
   * teleported car arrive mid-spin with the steering wound on, which quietly cost 50 m
   * of braking distance and manufactured 4 g "lateral" peaks out of a kerb strike.
   */
  #teleport() {
    this.omega.set(0, 0, 0);
    this.steer = 0;
    this.aeroBlend = 0;                 // wings fail safe to Cornering Mode
    this.zs = this.zsd = 0;
    this.pitch = this.pitchd = 0;
    this.roll = this.rolld = 0;
    this.ax = this.ay = this.axF = this.ayF = 0;
    this.tcInt = 0; this.hitCd = 0;
    this.alpha.fill(0); this.kappa.fill(0);
    this.travel.fill(0); this.travelV.fill(0);
    this.roadInit = true;
    this.ers.reset();                   // a new pose is a new lap: store and budgets re-seat
  }

  /** Re-seat the rotating masses, the gear and the platform after an external teleport. */
  #resync(vx, vz) {
    // a gear left over from a standing start would reflect a huge engine inertia
    // through the driven wheels and quietly halve the braking force
    const rr = (g) => Math.abs(vz) / TYRE.radiusR * ratioOf(g) * 30 / Math.PI;
    if (rr(this.gear) > PU.revLimit || rr(this.gear) < PU.idleRpm) {
      let best = 1, err = Infinity;
      for (let g = 1; g <= GEAR_COUNT; g++) {
        const e = Math.abs(rr(g) - 10500);
        if (e < err) { err = e; best = g; }
      }
      this.gear = best;
    }
    for (let i = 0; i < 4; i++) {
      const w = WH[i];
      const u = (vz - this.omega.y * w.x) * Math.cos(w.front ? this.steer : 0)
        + (vx + this.omega.y * w.y) * Math.sin(w.front ? this.steer : 0);
      this.spin[i] = u / w.r;
      this.alpha[i] = 0; this.kappa[i] = 0;
    }
    this.zsd = this.pitchd = this.rolld = 0;
    this.roadInit = true;
  }

  #gearbox(h, inp, throttle, roadSpeed) {
    this.shiftT -= h; this.shiftHold -= h;
    const up = !!inp.shiftUp, dn = !!inp.shiftDown;
    const upEdge = up && !this.prevShiftUp, dnEdge = dn && !this.prevShiftDown;
    this.prevShiftUp = up; this.prevShiftDown = dn;

    if (upEdge && this.gear < GEAR_COUNT && this.shiftT <= 0) {
      this.gear++; this.shiftT = PU.shiftTimeUp; this.shiftHold = 2.5;
      this.ctx.bus.emit('car:shift', { up: true, gear: this.gear });
    } else if (dnEdge && this.gear > 1 && this.shiftT <= 0) {
      this.gear--; this.shiftT = PU.shiftTimeDown; this.shiftHold = 2.5;
      this.ctx.bus.emit('car:shift', { up: false, gear: this.gear });
    } else if (this.assists.autoGear && this.shiftHold <= 0 && this.shiftT <= 0) {
      // shift on ROAD speed, not on wheel speed: wheelspin must not trigger an upshift
      const roadRpm = (g) => roadSpeed / TYRE.radiusR * ratioOf(g) * 30 / Math.PI;
      // never at 15,000 — the useful band is 8,600-11,900 in every gear
      if (this.rpm > PU.shiftUpRpm && roadRpm(this.gear) > PU.shiftUpRpm * 0.8
        && this.gear < GEAR_COUNT && throttle > 0.15) {
        this.gear++; this.shiftT = PU.shiftTimeUp;
        this.ctx.bus.emit('car:shift', { up: true, gear: this.gear });
      } else if (roadRpm(this.gear) < PU.shiftDownRpm && this.gear > 1) {
        this.gear--; this.shiftT = PU.shiftTimeDown;
        this.ctx.bus.emit('car:shift', { up: false, gear: this.gear });
      }
    }
  }

  /** Per-corner spring / damper / anti-roll platform. Produces this.Fz[]. */
  #suspension(h, loc, dfF, dfR, fwX, fwZ, rgX, rgZ) {
    // First step after a teleport: seat the platform where the CURRENT downforce would
    // hold it. Starting from the unloaded ride height instead makes the car fall onto
    // its springs — at 300 km/h that is 22 kN arriving in 50 ms, and the resulting slam
    // shows up as a spurious 0.2 g on the peak-braking figure.
    if (this.roadInit) {
      const a = dfF / (2 * SUS.kF), b = dfR / (2 * SUS.kR);
      this.pitch = (b - a) / WHEELBASE;
      this.zs = -a - A_FRONT * this.pitch;
      this.zsd = this.pitchd = this.rolld = this.roll = 0;
    }

    const hw = loc.halfWidth;
    const rX = loc.right.x, rZ = loc.right.z, tX = loc.tangent.x, tZ = loc.tangent.z;
    const F = [0, 0, 0, 0], def = [0, 0, 0, 0];

    for (let i = 0; i < 4; i++) {
      const w = WH[i];
      const ox = rgX * w.x + fwX * w.y, oz = rgZ * w.x + fwZ * w.y;
      const lat = loc.lateral + ox * rX + oz * rZ;
      const sw = loc.s + ox * tX + oz * tZ;
      const al = Math.abs(lat);

      this.wheelOff[i] = al - w.hw > hw;              // FULLY beyond the white line
      const d = al - hw;
      let surf = 'asphalt';
      if (d > 1.6 + w.hw) surf = d > 14 ? 'gravel' : 'astro';
      else if (d > -w.hw) surf = 'kerb';
      this.surface[i] = surf;

      // Road height under the wheel: kerb profile + asphalt micro-roughness.
      // This is a CONTINUOUS function of how far the wheel is past the white line.
      // It used to be a per-surface lookup, which put a 90 mm cliff at the kerb/run-off
      // boundary; against a 150 kN/m spring with 10 mm of static droop that launched
      // the car, and the wheels came back down at three times their proper load.
      let zRaw = 0.0026 * Math.sin(sw * 0.61 + w.x * 0.45) + 0.0014 * Math.sin(sw * 1.37 - w.x * 0.30);
      const dEdge = d + w.hw;                          // 0 where the tyre first touches the line
      const onKerb = clamp(dEdge / 0.5, 0, 1);         // climbs the kerb
      const offKerb = clamp((dEdge - 1.6) / 1.2, 0, 1);// and back down its far side into the run-off
      const grav = clamp((d - 14) / 3.0, 0, 1);
      const kerb = onKerb * (1 - offKerb);
      zRaw += 0.048 * kerb + 0.017 * kerb * Math.sin(sw * 6.61)
        - 0.030 * offKerb - 0.045 * grav;
      const kt = w.front ? SUS.ktF : SUS.ktR;       // tyre carcass in series with the spring
      zRaw *= kt / (kt + (w.front ? SUS.kF : SUS.kR));
      // The tyre carcass and the unsprung mass swallow high-frequency road content —
      // without this lag a 15 Hz surface texture shakes the wheel loads by +/-25 %
      // and quietly costs a third of the braking performance.
      const zPrev = this.zRoad[i];
      const z = this.roadInit ? zRaw : zPrev + (zRaw - zPrev) * Math.min(1, h / 0.055);
      const zd = this.roadInit ? 0 : clamp((z - zPrev) / h, -2.5, 2.5);
      this.zRoad[i] = z;

      const zBody = this.zs + w.y * this.pitch + w.x * this.roll;
      def[i] = z - zBody;                              // + = compression, 0 at static
      const vel = zd - (this.zsd + w.y * this.pitchd + w.x * this.rolld);
      const k = w.front ? SUS.kF : SUS.kR;
      const c = (w.front ? SUS.cF : SUS.cR) * (vel < 0 ? SUS.reboundRatio : 1);
      let f = (w.front ? STATIC_F : STATIC_R) + k * def[i] + c * vel;
      const overT = def[i] - SUS.bumpTravel;
      if (overT > 0) f += Math.min(SUS.bumpMax, SUS.bumpRate * overT * overT);
      F[i] = f;
      this.travelV[i] = (def[i] - this.travel[i]) / h;
      this.travel[i] = def[i];
    }

    this.roadInit = false;

    const arbF = SUS.arbF * (def[0] - def[1]) * 0.5;
    const arbR = SUS.arbR * (def[2] - def[3]) * 0.5;
    F[0] += arbF; F[1] -= arbF; F[2] += arbR; F[3] -= arbR;

    // unsprung load transfer goes straight through the tyres, not the springs
    const utLong = -SUS.unsprung * 4 * this.axF * TYRE.radiusR / WHEELBASE * 0.5;
    const utLat = SUS.unsprung * 4 * this.ayF * TYRE.radiusR / (HT_F + HT_R) * 0.5;

    // Quasi-static share of the total vertical load (weight bias + aero balance) that
    // each corner carries, and the ceiling a contact patch can actually transmit.
    const capF = FZ_CAP * (0.5 * (SUS.sprung + 2 * SUS.unsprung) * G * (B_REAR / WHEELBASE) + 0.5 * dfF);
    const capR = FZ_CAP * (0.5 * (SUS.sprung + 2 * SUS.unsprung) * G * (A_FRONT / WHEELBASE) + 0.5 * dfR);

    let sumF = 0, sumM = 0, sumR = 0;
    for (let i = 0; i < 4; i++) {
      const w = WH[i];
      sumF += F[i]; sumM += w.y * F[i]; sumR += w.x * F[i];
      const fz = F[i] + UNSPRUNG_N + (w.front ? utLong : -utLong) + (w.x > 0 ? utLat : -utLat);
      const cap = w.front ? capF : capR;
      this.contact[i] = fz > 1;
      this.Fz[i] = fz > cap ? cap : fz > 0 ? fz : 0;
    }

    const zAcc = (sumF - SUS.sprung * G - dfF - dfR) / SUS.sprung;
    const pAcc = (sumM - dfF * A_FRONT + dfR * B_REAR + SUS.sprung * this.axF * H_CG) / SUS.Ipitch;
    const rAcc = (sumR + SUS.sprung * this.ayF * H_CG) / SUS.Iroll;
    this.zsAcc = zAcc;
    // Platform travel limits. An F1 car has ~60 mm of suspension travel, so the body
    // simply cannot pitch 5 deg: letting it try put the wheels 170 mm out of position
    // and slammed them into the bump stops.
    this.zsd = clamp(this.zsd + zAcc * h, -5, 5);
    this.zs = clamp(this.zs + this.zsd * h, -0.055, 0.055);
    this.pitchd = clamp(this.pitchd + pAcc * h, -5, 5);
    this.pitch = clamp(this.pitch + this.pitchd * h, -0.030, 0.030);
    this.rolld = clamp(this.rolld + rAcc * h, -5, 5);
    this.roll = clamp(this.roll + this.rolld * h, -0.038, 0.038);
  }
}
