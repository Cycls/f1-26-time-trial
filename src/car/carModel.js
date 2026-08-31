/**
 * 2026-regulation Formula 1 car. Owner: CAR.
 *
 * Everything is generated in code: lofted monocoque and sidepods, swept aerofoil
 * wings, a partially flat floor with de-emphasised venturi tunnels, revolved tyres
 * with Pirelli sidewalls, procedural carbon weave and a canvas livery.
 *
 * Public API (do not break):
 *   .root                 THREE.Object3D added to the scene
 *   .wheels[4]            wheel groups, userData.front tells you the axle
 *   async init()
 *   lateUpdate(dt)        reads state.car.{position,quaternion,steerAngle,wheel[],aeroMode}
 */
import * as THREE from 'three';
import { createMaterials } from './materials.js';
import { D } from './dims.js';
import { buildBodywork } from './bodywork.js';
import { buildFrontWing, buildRearWing, buildFloor } from './aero.js';
import { buildWheel } from './wheels.js';
import { buildSuspension } from './suspension.js';
import { buildDriver } from './driver.js';

const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;

/** Active-aero full-travel time, seconds. Regulation ceiling is 400 ms. */
const AERO_TRAVEL = 0.35;

export class CarModel {
  constructor(ctx) {
    this.ctx = ctx;
    this.state = ctx.state;
    this.aero = 0;            // 0 = Cornering Mode, 1 = Straight Line Mode
    this._roll = 0; this._pitch = 0; this._heave = 0;
    this._steerVis = 0;
  }

  async init() {
    const M = this.mat = createMaterials({
      primary: 0xc8102e,
      envIntensity: 1.15,
    });

    const root = this.root = new THREE.Group();
    root.name = 'car';

    // sprung mass: everything that rolls, pitches and heaves on the suspension
    const sprung = this.sprung = new THREE.Group();
    sprung.name = 'sprung';
    root.add(sprung);

    const body = buildBodywork(M);
    sprung.add(body.group);

    const fw = buildFrontWing(M);
    const rw = buildRearWing(M);
    const floor = buildFloor(M);
    this.fwFlaps = fw.flaps;
    this.rwFlap = rw.flap;
    this.frontWing = fw.group;
    this.rearWing = rw.group;
    sprung.add(fw.group, rw.group, floor.group);

    // FIA rain light on the rear crash structure
    const rain = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.048, 0.016), M.rainLight);
    rain.position.set(0, 0.095, -2.30);
    sprung.add(rain);

    const driver = buildDriver(M);
    this.driver = driver;
    sprung.add(driver.group);

    // suspension rides with the chassis but stays attached to the wheels
    root.add(buildSuspension(M));

    // ---- wheels ------------------------------------------------------------
    // 0 = FL, 1 = FR, 2 = RL, 3 = RR (state.car.wheel ordering)
    this.wheels = [];
    const layout = [
      { front: true, side: -1, x: -D.trackF, z: D.axleF },
      { front: true, side: 1, x: D.trackF, z: D.axleF },
      { front: false, side: -1, x: -D.trackR, z: D.axleR },
      { front: false, side: 1, x: D.trackR, z: D.axleR },
    ];
    for (const L of layout) {
      const w = buildWheel(M, L.front, L.side);
      const r = L.front ? D.tyreRf : D.tyreRr;
      w.position.set(L.x, D.GROUND + r + 0.005, L.z);
      w.rotation.z = L.side * (L.front ? D.camberF : D.camberR);   // static camber
      w.userData.baseCamber = w.rotation.z;
      root.add(w);
      this.wheels.push(w);
    }

    this.ctx.scene.add(root);

    // report the real cost of the car once everything exists
    let meshes = 0, tris = 0;
    root.traverse(o => {
      if (!o.isMesh) return;
      meshes++;
      const g = o.geometry;
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    });
    this.stats = { meshes, triangles: Math.round(tris) };
    console.log(`[car] ${meshes} meshes, ${Math.round(tris)} triangles`);

    this.ctx.bus.emit('car:ready', this);
  }

  lateUpdate(dt = 1 / 60) {
    const c = this.state.car;
    const inp = this.state.input;
    if (!this.root) return;
    const k = 1 - Math.exp(-dt * 9);

    this.root.position.copy(c.position);
    this.root.quaternion.copy(c.quaternion);

    // ---- sprung-mass attitude: dive, squat, roll, aero heave ---------------
    const speedN = clamp(c.kph / 320, 0, 1);
    this._pitch = lerp(this._pitch, clamp(-c.longG * 0.0092, -0.040, 0.030), k);
    this._roll = lerp(this._roll, clamp(c.lateralG * 0.0060, -0.032, 0.032), k);
    this._heave = lerp(this._heave, -0.016 * speedN * speedN, k * 0.6);
    this.sprung.rotation.x = this._pitch;
    this.sprung.rotation.z = this._roll;
    this.sprung.position.y = this._heave;

    // ---- wheels ------------------------------------------------------------
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i], cw = c.wheel[i];
      const u = w.userData;
      u.spin.rotation.x = cw.spin;
      if (u.front) w.rotation.y = c.steerAngle;

      // load-dependent sidewall deflection: squash vertically, bulge axially
      const defl = clamp((cw.load ?? 0) / 240000, 0, 0.032);
      const s = 1 - defl;
      u.squash.scale.set(1 + defl * 0.7, s, 1);
      u.squash.position.y = -u.radius * defl;

      // ---- brakes: carbon discs run 400-1000 C ---------------------------
      const temp = c.brakeTemp?.[i] ?? 400;
      const heat = clamp((temp - 380) / 620, 0, 1);
      const bite = clamp(inp.brake * 1.35 - 0.08, 0, 1);
      const glow = clamp(heat * 0.55 + bite * 0.85, 0, 1.15);
      const dm = u.disc.material;
      dm.emissiveIntensity = glow * glow * 3.4;
      dm.emissive.setRGB(1.0, 0.16 + glow * 0.42, 0.02 + glow * 0.16);
      const gm = u.glow.material;
      gm.emissiveIntensity = glow * glow * 1.1;
      gm.emissive.setRGB(1.0, 0.13 + glow * 0.30, 0.02);
    }

    // ---- 2026 active aero: both wings move -------------------------------
    // Exactly TWO positions, no intermediates, and the transition must complete
    // in <= 400 ms. An exponential ease never actually arrives, so this is a
    // rate-limited ramp with a hard clamp: full travel takes AERO_TRAVEL seconds.
    // Anything that is not an explicit Straight Line Mode request fails safe to
    // Cornering Mode, which is what the regulation requires of the real system.
    const target = c.aeroMode === 'X' ? 1 : 0;
    const step = dt / AERO_TRAVEL;
    this.aero = target > this.aero
      ? Math.min(target, this.aero + step)
      : Math.max(target, this.aero - step);
    const a = this.aero * this.aero * (3 - 2 * this.aero);
    this.fwFlaps.rotation.x = -0.30 * a;   // FW Primary + Secondary Flap
    this.rwFlap.rotation.x = -0.62 * a;    // rear elements 2 + 3

    // ---- driver: hands follow the steering -------------------------------
    this._steerVis = lerp(this._steerVis, c.steerAngle, 1 - Math.exp(-dt * 18));
    const wheelAngle = clamp(this._steerVis / 0.35, -1, 1) * Math.PI;   // 360 deg total lock
    if (this.driver) {
      this.driver.steer.rotation.z = -wheelAngle;
      this.driver.arms.rotation.z = -wheelAngle * 0.10;
      this.driver.arms.position.y = Math.abs(wheelAngle) * 0.006;
    }
  }
}
