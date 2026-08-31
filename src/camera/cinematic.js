/**
 * Replay / beauty cameras. Owner: CAMERA.
 *
 * Two modes:
 *   trackside  a ring of fixed broadcast positions around the lap. The one the car is
 *              approaching picks it up, pans with it on a long lens, holds until the car
 *              is ~70 m past, then cuts to the next. Focal length tracks range so the car
 *              stays the same size in frame, which is what makes it read as broadcast
 *              rather than as a chase cam that happens to be far away.
 *   cinematic  the same station ring, but the operator moves: a director cycles through
 *              four shot types (locked-off with a creeping push-in, a parallel dolly, a
 *              low ground cam, and a high circling crane). This is the hot-lap camera.
 *
 * Both return a solved {pos, aim, fov, roll} which the rig then applies, so shake and
 * FOV smoothing stay in one place.
 */
import * as THREE from 'three';
import { damp, clamp, K, RAD } from './rigs.js';

const STATIONS = 26;
const HOLD_BEHIND = 70;    // metres past the camera before we look for the next one
const MIN_SHOT = 2.2;      // seconds — never cut faster than this
const MAX_SHOT = 11.0;

export class Director {
  constructor(ctx) {
    this.ctx = ctx;
    this.state = ctx.state;
    this.stations = [];
    this.cur = null;
    this.shotT = 0;
    this.shotType = 0;
    this.pos = new THREE.Vector3();
    this.aim = new THREE.Vector3();
    this.out = new THREE.Vector3();
    this.fov = 30;
    this.dolly = new THREE.Vector3();
    this.wobble = 0;
    this.ready = false;
    this._v = new THREE.Vector3();
    this._w = new THREE.Vector3();
  }

  build(track) {
    if (!track?.length) return false;
    this.track = track;
    const L = track.length;
    this.stations.length = 0;
    for (let i = 0; i < STATIONS; i++) {
      const s = ((i + 0.5) / STATIONS) * L;
      const t = track.sampleS(s);
      const side = (i % 2 === 0) ? 1 : -1;
      const lateral = t.halfWidth + 15 + (i % 3) * 9;
      const height = 3.4 + ((i * 7) % 5) * 2.3;
      const pos = t.point.clone().addScaledVector(t.right, side * lateral);
      pos.y += height;
      // tangent of the track where this camera is aimed by default
      this.stations.push({ s, pos, side, tangent: t.tangent.clone(), i });
    }
    this.ready = true;
    return true;
  }

  /** Signed distance from the car to a station, in the direction of travel. */
  #lead(sCar, sStation, L) {
    let d = sStation - sCar;
    d = ((d % L) + L) % L;
    if (d > L * 0.5) d -= L;
    return d;
  }

  #pick(sCar, L) {
    let best = null, bestLead = Infinity;
    for (const st of this.stations) {
      const lead = this.#lead(sCar, st.s, L);
      if (lead > -HOLD_BEHIND && lead < bestLead) { bestLead = lead; best = st; }
    }
    return best ?? this.stations[0];
  }

  reset() { this.cur = null; this.shotT = 0; }

  /**
   * @returns {{pos:THREE.Vector3, aim:THREE.Vector3, fov:number, roll:number}|null}
   */
  solve(dt, cinematic) {
    if (!this.ready) { if (!this.build(this.ctx.get('track'))) return null; }
    const car = this.state.car;
    const L = this.track.length;
    const sCar = this.state.lap?.distance ?? 0;

    this.shotT += dt;
    const lead = this.cur ? this.#lead(sCar, this.cur.s, L) : -1e9;
    const stale = !this.cur || lead < -HOLD_BEHIND || this.shotT > MAX_SHOT;
    if (stale && (this.shotT > MIN_SHOT || !this.cur)) {
      const next = this.#pick(sCar, L);
      if (next !== this.cur) {
        this.cur = next;
        this.shotT = 0;
        this.shotType = (this.shotType + 1) % 4;
        this.dolly.set(0, 0, 0);
        this.snap = true;
      }
    }
    const st = this.cur;
    if (!st) return null;

    // ---- where the operator stands -------------------------------------
    const target = this._v.copy(st.pos);
    if (cinematic) {
      const t = this.shotT;
      const trk = this.track.sampleS(st.s);
      switch (this.shotType) {
        case 1: { // parallel dolly, drifting along the track with the car
          this.dolly.copy(trk.tangent).multiplyScalar(clamp(t * 6.0 - 12, -14, 22));
          target.add(this.dolly);
          break;
        }
        case 2: { // low ground cam right at the trackside, whip-pans as the car passes
          target.copy(trk.point)
            .addScaledVector(trk.right, st.side * (trk.halfWidth + 3.2));
          target.y += 0.55 + Math.min(1.2, t * 0.06);
          break;
        }
        case 3: { // high circling crane
          const a = t * 0.16;
          target.copy(trk.point)
            .addScaledVector(trk.right, st.side * (trk.halfWidth + 26) * Math.cos(a))
            .addScaledVector(trk.tangent, (trk.halfWidth + 26) * Math.sin(a) * 0.6);
          target.y += 17 + Math.sin(t * 0.3) * 2.2;
          break;
        }
        default: { // locked off, slow creeping push toward the track
          target.addScaledVector(trk.right, st.side * -Math.min(6, t * 0.55));
          target.y -= Math.min(1.4, t * 0.12);
        }
      }
    }

    if (this.snap) { this.pos.copy(target); this.snap = false; }
    else this.pos.copy(target);   // stations are fixed / already smooth curves

    // ---- what it is pointed at ------------------------------------------
    // lead the car slightly, the way a real operator does
    const aimTarget = this._w.copy(car.position)
      .addScaledVector(car.velocity, 0.09);
    aimTarget.y += 0.55;

    const dist = this.pos.distanceTo(car.position);
    if (this.aim.lengthSq() === 0 || dist < 0.001) this.aim.copy(aimTarget);
    const panK = K(dist < 30 ? 0.055 : 0.10);   // tighter shots need a faster operator
    this.aim.x = damp(this.aim.x, aimTarget.x, panK, dt);
    this.aim.y = damp(this.aim.y, aimTarget.y, panK, dt);
    this.aim.z = damp(this.aim.z, aimTarget.z, panK, dt);

    // ---- focal length: hold the car at a constant size ------------------
    const wide = (cinematic && this.shotType === 2) ? 5.5
      : (cinematic && this.shotType === 3) ? 14 : 9.0;
    const fovT = clamp(2 * Math.atan(wide / Math.max(dist, 4)) * RAD, 15, 58);
    this.fov = damp(this.fov, fovT, K(0.5), dt);

    // ---- a touch of handheld, scaled down on long lenses -----------------
    // applied to the OUTPUT only, so it never accumulates into the damped pan state
    this.wobble += dt;
    const amp = 0.00035 * (this.fov / 30);
    const roll = Math.sin(this.wobble * 0.7) * 0.004 + Math.sin(this.wobble * 1.9) * 0.002;
    this.out.copy(this.aim);
    this.out.y += Math.sin(this.wobble * 1.3) * amp * dist;
    this.out.x += Math.sin(this.wobble * 0.9 + 1.1) * amp * dist;

    return { pos: this.pos, aim: this.out, fov: this.fov, roll };
  }
}
