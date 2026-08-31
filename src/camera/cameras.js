/**
 * Camera rig. Owner: CAMERA. Drives ctx.camera each frame.
 *
 * The set, and the behaviour, follow docs/reference-visual.md:
 *
 *   TV Pod (default) - TV Pod Offset - Near Chase - Far Chase - Cockpit -
 *   Nose Offset - Nose - Wing            [+ Helmet as a clearly-labelled extra,
 *                                          + Trackside / Cinematic replay cameras]
 *
 * What that reference actually says, and what this file therefore does:
 *
 *  - NO HORIZON LOCK. The onboards are mounted in CAR SPACE: the rig composes
 *    car.quaternion (which already carries the sprung platform's dive, squat and roll,
 *    plus the road slope) with a small local offset. Roll coupling is 1:1, deliberately.
 *    Only the chase rigs, which are not bolted to the car, take a fraction (rollFollow).
 *
 *  - LOOK TO APEX **YAWS**, it does not roll. track.sampleS(lap.distance + v*1.05 s)
 *    gives the point the car is heading for; the rig yaws a clamped amount toward it,
 *    where the clamp is the reference's "Look to Apex Limit" (0-15, default 4) scaled by
 *    the rig's apexMax. A small yaw-rate lead rides inside the same clamp.
 *
 *  - CAMERA SHAKE AND CAMERA MOVEMENT SHIP AT MAXIMUM. Shake is five independently
 *    triggered channels (see shake.js: speed, wheel-slip, wheel-lockup, wheel-spin,
 *    surface) on top of the genuine suspension motion the car-space mount inherits.
 *    Camera Movement is the g-force response: extra pitch under braking, extra roll
 *    under lateral load, and a positional lag so the car leads the camera on the exit.
 *    Both are exposed as 0..1 scales (setShake / setMovement), defaulting to 1.0 = 20/20.
 *
 *  - NO SPEED-BASED FOV WIDENING exists in the reference, so fovGain is a token ~2 deg
 *    across the entire speed range and setFovGain(0) removes it completely.
 *
 *  - The HALO COLUMN CAN BE HIDDEN in cockpit view (H). The halo is otherwise left
 *    exactly as the car module built it: fully lit and shadow-casting.
 *
 * Everything time-dependent is filtered with damp(a, b, retainPerSecond, dt) =
 * 1 - Math.pow(k, dt). There is not one raw per-frame lerp constant in this module.
 *
 * Writes state.camera.{mode,label,group,fov,shake,shakeScale,moveScale,lookToApex,modes}.
 */
import * as THREE from 'three';
import {
  MODES, MODE_LIST, DRIVE_CYCLE, REPLAY_CYCLE, resolveMode,
  damp, dampAngle, wrapPi, clamp, smoothstep, K, DEG,
  LOOK_TO_APEX_DEFAULT, LOOK_TO_APEX_MAX,
} from './rigs.js';
import { CameraShake } from './shake.js';
import { Director } from './cinematic.js';
import { CONFIG } from '../core/config.js';

const AXIS_Y = new THREE.Vector3(0, 1, 0);
/** three.js cameras look down -Z; the car's forward is +Z. */
const Q_FLIP = new THREE.Quaternion().setFromAxisAngle(AXIS_Y, Math.PI);
/** Car-model local height of the road, if the car module cannot be measured. */
const DEFAULT_GROUND_Y = -0.32;

export class CameraRig {
  constructor(ctx) {
    this.ctx = ctx;
    this.cam = ctx.camera;
    this.state = ctx.state;

    // `mode` is a plain property on purpose: tools/shoot.mjs assigns to it directly.
    // update() re-resolves it every frame, so aliases and typos degrade gracefully.
    this.mode = 'tvpod';
    this._resolved = 'tvpod';
    this._lastDrive = 'tvpod';

    // reference settings, on their reference scales
    this.lookToApex = LOOK_TO_APEX_DEFAULT;   // 0..15, reference default 4
    this.shakeScale = 1.0;                    // 1.0 == the reference's 20/20
    this.moveScale = 1.0;                     // ditto for Camera Movement
    this.fovOffset = 0;                       // reference "FOV" slider, degrees
    this.hideHaloColumn = false;

    // filtered dynamics
    this.longG = 0; this.latG = 0; this.yawRate = 0; this.apexRaw = 0;
    this.apexYaw = 0;
    this.fov = MODES.tvpod.fov;
    this.shakeLevel = 0;

    // chase springs
    this.chaseYaw = 0;
    this.chaseOff = new THREE.Vector3();      // damped rig offset from the car
    this.chaseAimOff = new THREE.Vector3();   // damped aim offset from the car
    this.chasePos = new THREE.Vector3();
    this.chaseAim = new THREE.Vector3();
    this._hasChase = false;

    this._prevCar = new THREE.Vector3();
    this._hasPrev = false;
    this._wasReplay = false;
    this.groundY = DEFAULT_GROUND_Y;

    this.shake = new CameraShake(ctx.bus);
    this.director = new Director(ctx);

    // scratch
    this._v = new THREE.Vector3(); this._w = new THREE.Vector3();
    this._fwd = new THREE.Vector3(); this._off = new THREE.Vector3();
    this._qa = new THREE.Quaternion(); this._qb = new THREE.Quaternion();
    this._qYaw = new THREE.Quaternion(); this._qAtt = new THREE.Quaternion();
    this._eul = new THREE.Euler(0, 0, 0, 'YXZ');
    this._eulAtt = new THREE.Euler(0, 0, 0, 'ZYX');

    const c = this.state.camera;
    c.modes = MODE_LIST.slice();
    c.mode = this.mode;
    c.label = MODES.tvpod.label;
    c.group = MODES.tvpod.group;
    c.fov = this.fov;
    c.shake = 0;
    c.shakeScale = this.shakeScale;
    c.moveScale = this.moveScale;
    c.lookToApex = this.lookToApex;
  }

  async init() {
    this.track = this.ctx.get('track') ?? null;
    this.carModel = this.ctx.get('car') ?? null;

    // Re-base every mount height onto the car model's actual road plane, so a change to
    // the car model's origin cannot silently bury the cameras inside the bodywork.
    this.groundY = this.#measureGround();

    // The car module owns the cockpit furniture (helmet, hands, steering wheel, mirrors);
    // the cockpit rig is placed against it rather than duplicating it.
    if (!this.carModel?.driver?.steer) {
      console.warn('[camera] car module exposes no driver/steering wheel — cockpit view will be bare');
    }
    this.haloColumn = this.#findHaloColumn();

    if (this.track) { try { this.director.build(this.track); } catch { /* rebuilt lazily */ } }

    this._onKey = (e) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === 'KeyC') this.cycle(e.shiftKey ? -1 : 1);
      else if (e.code === 'KeyV') this.toggleReplay();
      else if (e.code === 'KeyH') this.setHaloColumnHidden(!this.hideHaloColumn);
    };
    addEventListener('keydown', this._onKey);
  }

  /** Road plane in the car model's local frame, measured from a front wheel. */
  #measureGround() {
    const w = this.carModel?.wheels?.[0];
    const r = CONFIG?.car?.tyreRadiusF ?? 0.33;
    if (w && Number.isFinite(w.position?.y)) {
      const g = w.position.y - r;
      if (g > -1.2 && g < 0.4) return g;
    }
    return DEFAULT_GROUND_Y;
  }

  #findHaloColumn() {
    const root = this.carModel?.root;
    if (!root) return null;
    let found = null;
    root.traverse((o) => { if (!found && (o.name === 'haloPylon' || o.name === 'haloColumn')) found = o; });
    return found;
  }

  // ------------------------------------------------------------- settings --
  /** Reference "Look to Apex Limit", 0-15 (default 4). */
  setLookToApex(v) { this.lookToApex = clamp(+v || 0, 0, LOOK_TO_APEX_MAX); this.state.camera.lookToApex = this.lookToApex; }
  /** Reference "Camera Shake", mapped to 0..1. 1.0 is the shipped default (20/20). */
  setShake(v) { this.shakeScale = clamp(+v, 0, 1); this.state.camera.shakeScale = this.shakeScale; }
  /** Reference "Camera Movement", mapped to 0..1. 1.0 is the shipped default. */
  setMovement(v) { this.moveScale = clamp(+v, 0, 1); this.state.camera.moveScale = this.moveScale; }
  /** Reference per-camera FOV offset, in degrees. */
  setFovOffset(v) { this.fovOffset = clamp(+v || 0, -20, 20); }

  setHaloColumnHidden(hide) {
    this.hideHaloColumn = !!hide;
    this.haloColumn ??= this.#findHaloColumn();
  }

  /** Step through the driving cameras (the replay set lives on V). */
  cycle(dir = 1) {
    const cur = resolveMode(this.mode);
    let i = DRIVE_CYCLE.indexOf(cur);
    if (i < 0) { this.setMode(this._lastDrive); return; }
    i = (i + dir + DRIVE_CYCLE.length) % DRIVE_CYCLE.length;
    this.setMode(DRIVE_CYCLE[i]);
  }

  toggleReplay() {
    const cur = resolveMode(this.mode);
    const i = REPLAY_CYCLE.indexOf(cur);
    if (i < 0) this.setMode(REPLAY_CYCLE[0]);
    else if (i + 1 < REPLAY_CYCLE.length) this.setMode(REPLAY_CYCLE[i + 1]);
    else this.setMode(this._lastDrive);
  }

  setMode(m) {
    const k = resolveMode(m);
    if (MODES[k].group !== 'replay') this._lastDrive = k;
    this.mode = k;
    this.state.camera.mode = k;
  }

  // ---------------------------------------------------------------- update --
  update(dt) {
    dt = clamp(Number.isFinite(dt) ? dt : 1 / 60, 1 / 480, 1 / 15);
    const st = this.state, car = st.car, cam = this.cam;

    // GAME can drive the replay cameras by flipping state.flags.replay; we only act on
    // the edge so a manual V/C press afterwards is never fought over.
    const wantReplay = !!st.flags?.replay;
    if (wantReplay !== this._wasReplay) {
      this._wasReplay = wantReplay;
      this.setMode(wantReplay ? REPLAY_CYCLE[0] : this._lastDrive);
    }

    const key = resolveMode(this.mode);
    const cut = key !== this._resolved;
    if (cut && MODES[key].group !== 'replay') this._lastDrive = key;
    this._resolved = key;
    this.mode = key;
    const m = MODES[key];

    // ---- teleport / first-frame detection: never spring across a reset ----
    const p = car.position;
    const speed = car.speed || 0;
    const jump = this._hasPrev ? this._prevCar.distanceTo(p) : 1e9;
    const snap = cut || !this._hasPrev || st.frame < 3 || jump > Math.max(12, speed * dt * 3);
    this._prevCar.copy(p);
    this._hasPrev = true;
    if (snap) { this.shake.reset(); this.director.reset(); }

    const kph = car.kph || 0;

    // ---- chassis frame ----------------------------------------------------
    // Yaw is extracted exactly (roll-immune) so the apex yaw and the chase springs are
    // not polluted by the platform's roll; the mount itself uses the FULL quaternion.
    const q = car.quaternion;
    const carYaw = Math.atan2(
      2 * (q.w * q.y + q.x * q.z),
      1 - 2 * (q.y * q.y + q.x * q.x),
    );
    // attitude = yaw^-1 * full, i.e. what the suspension and the road slope are doing
    this._qYaw.setFromAxisAngle(AXIS_Y, carYaw);
    this._qAtt.copy(this._qYaw).invert().multiply(q);
    this._eulAtt.setFromQuaternion(this._qAtt, 'ZYX');
    const attRoll = this._eulAtt.z;      // + = leaning right

    // ---- filtered dynamics ------------------------------------------------
    // Lateral load is taken geometrically (yawRate * speed) rather than from
    // state.car.lateralG, whose axis labelling belongs to another module.
    const yawRateRaw = clamp(car.yawRate || 0, -3, 3);
    const latRaw = clamp(yawRateRaw * speed / 9.81, -5.5, 5.5);
    const longRaw = clamp(car.longG || 0, -5, 5);
    this.yawRate = snap ? yawRateRaw : damp(this.yawRate, yawRateRaw, K(0.10), dt);
    this.latG = snap ? latRaw : damp(this.latG, latRaw, K(0.11), dt);
    this.longG = snap ? longRaw : damp(this.longG, longRaw, K(0.13), dt);

    // ---- look-ahead point along the track ---------------------------------
    this.track ??= this.ctx.get('track') ?? null;
    let aheadPoint = null;
    if (this.track?.sampleS && this.track.length > 0) {
      const s = st.lap?.distance ?? 0;
      const look = clamp(speed * 1.05, 20, 85);
      try { aheadPoint = this.track.sampleS(s + look).point; } catch { aheadPoint = null; }
    }

    // ---- shake ------------------------------------------------------------
    this.shakeLevel = this.shake.update(dt, car, this.shakeScale);
    const sh = this.shake;
    const shk = m.shake;

    const replay = m.group === 'replay';
    let solved = null;
    if (replay) {
      try { solved = this.director.solve(dt, key === 'cinematic'); } catch { solved = null; }
    }

    // ======================================================== solve the rig ==
    if (solved) {
      // ---- replay: aim-based, world space --------------------------------
      const dx = solved.aim.x - solved.pos.x;
      const dy = solved.aim.y - solved.pos.y;
      const dz = solved.aim.z - solved.pos.z;
      const flat = Math.hypot(dx, dz) || 1e-5;
      this._eul.set(
        -Math.atan2(dy, flat) + sh.rot.x * shk,          // pitchDown
        Math.atan2(dx, dz) + sh.rot.y * shk,             // yaw
        (solved.roll || 0) + sh.rot.z * shk,             // roll
        'YXZ',
      );
      this._qa.setFromEuler(this._eul).multiply(Q_FLIP);
      cam.quaternion.copy(this._qa);
      this.#place(cam, solved.pos.x, solved.pos.y, solved.pos.z, sh, shk);
      this.fov = solved.fov;
    } else if (m.spring) {
      // ---- chase: sprung, world space -------------------------------------
      const targetYaw = carYaw + this.yawRate * m.apexLead;
      this.chaseYaw = (snap || !this._hasChase)
        ? targetYaw : dampAngle(this.chaseYaw, targetYaw, K(m.spring.yaw), dt);
      const qy = this._qb.setFromAxisAngle(AXIS_Y, this.chaseYaw);

      // The springs damp the OFFSET from the car, never the world position: a first-order
      // follower chasing a moving target has a steady-state error of v*tau, which at
      // 320 km/h would drag the rig five metres further back than it is configured to be.
      // Damping the offset keeps the rig exactly where it belongs at constant speed and
      // still lags through yaw changes and acceleration, which is the part you want.
      const ideal = this._w.set(m.pos[0], this.#y(m.pos[1]), m.pos[2]);
      ideal.z -= clamp(this.longG, -3, 3) * m.lag * this.moveScale;
      ideal.applyQuaternion(qy);

      if (snap || !this._hasChase) this.chaseOff.copy(ideal);
      else this.chaseOff.lerp(ideal, 1 - Math.pow(K(m.spring.pos), dt));

      const aim = this._v.set(0, this.#y(m.spring.aimHeight), m.spring.aimAhead)
        .applyQuaternion(qy);
      if (aheadPoint) {
        const w = clamp(this.lookToApex / LOOK_TO_APEX_MAX, 0, 1) * 0.9;
        aim.x += (aheadPoint.x - p.x - aim.x) * w;
        aim.z += (aheadPoint.z - p.z - aim.z) * w;
      }
      if (snap || !this._hasChase) this.chaseAimOff.copy(aim);
      else this.chaseAimOff.lerp(aim, 1 - Math.pow(K(m.spring.aim), dt));
      this._hasChase = true;

      // damped offsets -> world
      this.chasePos.copy(this.chaseOff).add(p);
      this.chaseAim.copy(this.chaseAimOff).add(p);
      this.chasePos.y = Math.max(this.chasePos.y, p.y + 0.5);

      const dx = this.chaseAim.x - this.chasePos.x;
      const dy = this.chaseAim.y - this.chasePos.y;
      const dz = this.chaseAim.z - this.chasePos.z;
      const flat = Math.hypot(dx, dz) || 1e-5;
      const move = this.moveScale;
      this._eul.set(
        -Math.atan2(dy, flat) + m.pitchDown * DEG
          - this.longG * m.movePitch * DEG * move + sh.rot.x * shk,
        Math.atan2(dx, dz) + sh.rot.y * shk,
        attRoll * (m.rollFollow ?? 0) + sh.rot.z * shk,
        'YXZ',
      );
      this._qa.setFromEuler(this._eul).multiply(Q_FLIP);
      cam.quaternion.copy(this._qa);
      this.#place(cam, this.chasePos.x, this.chasePos.y, this.chasePos.z, sh, shk);
    } else {
      // ---- onboard: mounted in CAR SPACE, no horizon lock -----------------
      const move = this.moveScale;
      const off = this._off.set(m.pos[0], this.#y(m.pos[1]), m.pos[2]);
      // Camera Movement, positional half: the car leads the camera under power and
      // backs into it under braking; the rig also slides toward the outside of a corner.
      off.z -= clamp(this.longG, -3, 3) * m.lag * move;
      off.x -= clamp(this.latG, -4, 4) * m.latLag * move;
      // full chassis attitude — this is where dive, squat, roll and road slope come from
      const mount = off.applyQuaternion(q).add(p);

      // Look to Apex: a clamped YAW toward the point the car is heading for.
      let yawOff = this.yawRate * m.apexLead;
      if (aheadPoint) {
        const aimYaw = Math.atan2(aheadPoint.x - mount.x, aheadPoint.z - mount.z);
        const d = wrapPi(aimYaw - carYaw);
        this.apexRaw = snap ? d : damp(this.apexRaw, d, K(0.22), dt);
        yawOff += this.apexRaw;
      }
      const lim = m.apexMax * DEG * (this.lookToApex / LOOK_TO_APEX_MAX);
      yawOff = clamp(yawOff, -lim, lim);
      this.apexYaw = snap ? yawOff : damp(this.apexYaw, yawOff, K(0.09), dt);

      // Camera Movement, angular half — on top of the chassis motion, not instead of it.
      const movePitch = -this.longG * m.movePitch * DEG * move;
      const moveRoll = this.latG * m.moveRoll * DEG * move;
      const leanIn = -this.latG * m.leanIn * DEG;      // Helmet extra only

      this._eul.set(
        m.pitchDown * DEG + movePitch + sh.rot.x * shk,
        this.apexYaw + sh.rot.y * shk,
        moveRoll + leanIn + sh.rot.z * shk,
        'YXZ',
      );
      // car space: chassis attitude * local rig offset * (+Z forward -> -Z forward)
      this._qa.copy(q).multiply(this._qb.setFromEuler(this._eul)).multiply(Q_FLIP);
      cam.quaternion.copy(this._qa);
      this.#place(cam, mount.x, mount.y, mount.z, sh, shk);
    }

    // ---- FOV ---------------------------------------------------------------
    if (!solved) {
      // The reference has no speed-linked FOV; fovGain is a token 2 deg and can be zeroed.
      const fovT = m.fov + m.fovGain * smoothstep((kph - 70) / 230) + this.fovOffset;
      this.fov = snap ? fovT : damp(this.fov, fovT, K(0.30), dt);
    }
    if (Math.abs(cam.fov - this.fov) > 1e-4) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }

    // ---- cockpit extras -----------------------------------------------------
    const inCockpit = key === 'cockpit' || key === 'helmet';
    // "hide halo column" — a shipped concession in the reference. Only ever hidden while
    // actually looking through the halo; restored for every other view.
    this.haloColumn ??= this.#findHaloColumn();
    if (this.haloColumn) {
      const wanted = !(inCockpit && this.hideHaloColumn);
      if (this.haloColumn.visible !== wanted) this.haloColumn.visible = wanted;
    }

    // ---- publish -----------------------------------------------------------
    const c = st.camera;
    c.mode = key;
    c.label = m.label;
    c.group = m.group;
    c.fov = this.fov;
    c.shake = this.shakeLevel * shk;
    c.shakeScale = this.shakeScale;
    c.moveScale = this.moveScale;
    c.lookToApex = this.lookToApex;
    if (!c.modes || c.modes.length !== MODE_LIST.length) c.modes = MODE_LIST.slice();
  }

  /** Car-model local Y for a height quoted against the default road plane. */
  #y(localY) { return localY + (this.groundY - DEFAULT_GROUND_Y); }

  /** Positional shake is a lens shake: applied along the camera's own right/up axes. */
  #place(cam, x, y, z, sh, shk) {
    const sx = sh.pos.x * shk, sy = sh.pos.y * shk;
    if (sx === 0 && sy === 0) { cam.position.set(x, y, z); return; }
    // cam.quaternion is already the final orientation for this frame
    this._v.set(1, 0, 0).applyQuaternion(cam.quaternion);
    this._w.set(0, 1, 0).applyQuaternion(cam.quaternion);
    cam.position.set(
      x + this._v.x * sx + this._w.x * sy,
      y + this._v.y * sx + this._w.y * sy,
      z + this._v.z * sx + this._w.z * sy,
    );
  }

  dispose() {
    if (this._onKey) removeEventListener('keydown', this._onKey);
    this.shake.dispose();
  }
}

// re-exported so the HUD can label the camera without importing the table itself
export { MODES as CAMERA_MODES, MODE_LIST as CAMERA_MODE_LIST };
