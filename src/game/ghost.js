/**
 * Personal-best ghost. Owner: GAME.
 *
 * The ghost is a REPLAY, not a simulation: a lap is recorded as a trace of
 * time / position / rotation (plus the telemetry the overlay needs) and played back.
 * It never touches the physics module and has no collision — nothing reads its pose
 * except its own visual and the delta calculation.
 *
 *   GhostLap      the recorded trace + time<->distance lookups
 *   GhostRecorder samples the live car into a GhostLap at 30 Hz
 *   GhostCar      the visual: the real CarModel geometry, merged and re-shaded
 *
 * Trace layout (Float32, stride 14):
 *   t, x, y, z, qx, qy, qz, qw, s, kph, throttle, brake, steerAngle, gear
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const STRIDE = 14;
const F = { t: 0, x: 1, y: 2, z: 3, qx: 4, qy: 5, qz: 6, qw: 7, s: 8, kph: 9, thr: 10, brk: 11, steer: 12, gear: 13 };
const SAMPLE_HZ = 30;
export const GHOST_FORMAT = 2;

// ---------------------------------------------------------------- GhostLap ----
export class GhostLap {
  constructor(data, count, meta = {}) {
    this.data = data; this.count = count;
    this.time = meta.time ?? (count ? data[(count - 1) * STRIDE] : 0);
    this.sectors = meta.sectors ?? [0, 0, 0];
    this.length = meta.length ?? (count ? data[(count - 1) * STRIDE + F.s] : 0);
    this.date = meta.date ?? Date.now();
  }

  get(i, f) { return this.data[i * STRIDE + f]; }

  /** Index of the last sample at or before value `v` in column `f` (monotonic). */
  #search(v, f) {
    let lo = 0, hi = this.count - 1;
    if (hi < 0) return 0;
    if (v <= this.get(0, f)) return 0;
    if (v >= this.get(hi, f)) return hi;
    while (lo + 1 < hi) { const m = (lo + hi) >> 1; if (this.get(m, f) <= v) lo = m; else hi = m; }
    return lo;
  }

  /**
   * The whole point of a live continuous delta: the ghost's elapsed time at OUR
   * exact track distance, linearly interpolated between recorded samples.
   */
  timeAtDistance(s) {
    if (this.count < 2) return null;
    if (s <= this.get(0, F.s)) return this.get(0, F.t);
    if (s >= this.get(this.count - 1, F.s)) return this.time;
    const i = this.#search(s, F.s), j = Math.min(this.count - 1, i + 1);
    const s0 = this.get(i, F.s), s1 = this.get(j, F.s);
    const u = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
    return this.get(i, F.t) + (this.get(j, F.t) - this.get(i, F.t)) * u;
  }

  speedAtDistance(s) {
    if (this.count < 2) return null;
    const i = this.#search(s, F.s), j = Math.min(this.count - 1, i + 1);
    const s0 = this.get(i, F.s), s1 = this.get(j, F.s);
    const u = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
    return this.get(i, F.kph) * (1 - u) + this.get(j, F.kph) * u;
  }

  /** Interpolated pose + telemetry at elapsed time t. Returns false past the end. */
  poseAtTime(t, out) {
    if (this.count < 2) return false;
    if (t > this.time + 0.001) return false;
    const i = this.#search(Math.max(0, t), F.t), j = Math.min(this.count - 1, i + 1);
    const t0 = this.get(i, F.t), t1 = this.get(j, F.t);
    const u = t1 > t0 ? THREE.MathUtils.clamp((t - t0) / (t1 - t0), 0, 1) : 0;
    const d = this.data, a = i * STRIDE, b = j * STRIDE;
    out.position.set(
      d[a + F.x] + (d[b + F.x] - d[a + F.x]) * u,
      d[a + F.y] + (d[b + F.y] - d[a + F.y]) * u,
      d[a + F.z] + (d[b + F.z] - d[a + F.z]) * u,
    );
    _qa.set(d[a + F.qx], d[a + F.qy], d[a + F.qz], d[a + F.qw]);
    _qb.set(d[b + F.qx], d[b + F.qy], d[b + F.qz], d[b + F.qw]);
    out.quaternion.copy(_qa).slerp(_qb, u);
    out.s = d[a + F.s] + (d[b + F.s] - d[a + F.s]) * u;
    out.kph = d[a + F.kph] + (d[b + F.kph] - d[a + F.kph]) * u;
    out.throttle = d[a + F.thr] + (d[b + F.thr] - d[a + F.thr]) * u;
    out.brake = d[a + F.brk] + (d[b + F.brk] - d[a + F.brk]) * u;
    out.steerAngle = d[a + F.steer] + (d[b + F.steer] - d[a + F.steer]) * u;
    out.gear = d[a + F.gear];
    return true;
  }

  encode() {
    const view = this.data.subarray(0, this.count * STRIDE);
    return {
      v: GHOST_FORMAT, n: this.count, time: this.time, sectors: this.sectors,
      length: this.length, date: this.date, d: toB64(view),
    };
  }

  static decode(obj) {
    try {
      if (!obj || obj.v !== GHOST_FORMAT || !obj.d) return null;
      const f32 = fromB64(obj.d);
      const n = Math.min(obj.n | 0, Math.floor(f32.length / STRIDE));
      if (n < 8) return null;
      return new GhostLap(f32, n, obj);
    } catch { return null; }
  }
}

const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();

function toB64(f32) {
  const u8 = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return btoa(s);
}
function fromB64(b) {
  const bin = atob(b), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Float32Array(u8.buffer, 0, Math.floor(u8.length / 4));
}

// ------------------------------------------------------------ GhostRecorder ----
export class GhostRecorder {
  constructor(cap = 12000) { this.data = new Float32Array(cap * STRIDE); this.cap = cap; this.reset(); }

  reset() { this.count = 0; this.acc = 1e9; this.lastS = -1; }

  /** @param force write this sample even if the 30 Hz slot is not due (lap edges). */
  push(dt, t, car, input, s, force = false) {
    this.acc += dt;
    if (!force && this.acc < 1 / SAMPLE_HZ) return;
    if (this.count >= this.cap) return;
    this.acc = 0;
    // s must be monotonic for the delta lookup to be a clean binary search
    const sm = this.count === 0 ? s : Math.max(s, this.lastS + 1e-4);
    this.lastS = sm;
    const d = this.data, o = this.count * STRIDE;
    d[o + F.t] = t;
    d[o + F.x] = car.position.x; d[o + F.y] = car.position.y; d[o + F.z] = car.position.z;
    d[o + F.qx] = car.quaternion.x; d[o + F.qy] = car.quaternion.y;
    d[o + F.qz] = car.quaternion.z; d[o + F.qw] = car.quaternion.w;
    d[o + F.s] = sm; d[o + F.kph] = car.kph;
    d[o + F.thr] = car.throttle ?? input?.throttle ?? 0;
    d[o + F.brk] = car.brake ?? input?.brake ?? 0;
    d[o + F.steer] = car.steerAngle ?? 0; d[o + F.gear] = car.gear ?? 1;
    this.count++;
  }

  /** Drop every sample recorded after time t (used by flashback). */
  rewind(t) {
    while (this.count > 0 && this.data[(this.count - 1) * STRIDE] > t) this.count--;
    this.lastS = this.count ? this.data[(this.count - 1) * STRIDE + F.s] : -1;
    this.acc = 1e9;
  }

  finalise(time, sectors, length) {
    if (this.count < 8) return null;
    return new GhostLap(this.data.slice(0, this.count * STRIDE), this.count, { time, sectors, length });
  }
}

// ----------------------------------------------------------------- GhostCar ----
const GHOST_VS = `
  varying vec3 vN; varying vec3 vV; varying vec3 vW;
  void main(){
    vN = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vV = -mv.xyz;
    vW = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * mv;
  }`;
const GHOST_FS = `
  uniform vec3 uBase; uniform vec3 uRim; uniform float uOpacity; uniform float uTime;
  varying vec3 vN; varying vec3 vV; varying vec3 vW;
  void main(){
    float f = pow(1.0 - clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0), 2.0);
    float band = 0.80 + 0.20 * sin(vW.y * 26.0 - uTime * 4.0);
    vec3 c = mix(uBase, uRim, f);
    float a = uOpacity * (0.20 + 0.80 * f) * band;
    if (a < 0.008) discard;
    gl_FragColor = vec4(c * (0.55 + 1.05 * f), a);
  }`;

export class GhostCar {
  constructor(ctx) {
    this.ctx = ctx;
    this.root = new THREE.Group();
    this.root.name = 'ghostCar';
    this.root.visible = false;
    this.wheels = [];
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uBase: { value: new THREE.Color(0x0d3f5c) },
        uRim: { value: new THREE.Color(0x6ff0ff) },
        uOpacity: { value: 0.62 }, uTime: { value: 0 },
      },
      vertexShader: GHOST_VS, fragmentShader: GHOST_FS,
      transparent: true, depthWrite: false, side: THREE.FrontSide,
    });
    ctx.scene.add(this.root);
  }

  /**
   * Build the ghost body from the real CarModel so it is the same car, then replace
   * every material with the ghost shader and merge to keep the draw-call cost at ~5.
   */
  build() {
    let ok = false;
    try { ok = this.#fromCarModel(); } catch (e) { console.warn('[game] ghost build fell back to a proxy:', e.message); }
    if (!ok) this.#proxy();
    this.root.traverse((o) => { o.castShadow = false; o.receiveShadow = false; o.renderOrder = 4; });
    return this;
  }

  #fromCarModel() {
    const car = this.ctx.get('car');
    const src = car?.root;
    if (!src) return false;
    src.updateMatrixWorld(true);
    const invRoot = new THREE.Matrix4().copy(src.matrixWorld).invert();
    const wheelGroups = Array.isArray(car.wheels) ? car.wheels : [];
    const inWheel = new Set();
    for (const g of wheelGroups) g.traverse((o) => inWheel.add(o));

    const body = [];
    src.traverse((o) => {
      if (!o.isMesh || inWheel.has(o) || !o.geometry) return;
      const g = plainGeometry(o.geometry);
      if (g) { g.applyMatrix4(_m.copy(invRoot).multiply(o.matrixWorld)); body.push(g); }
    });
    if (!body.length) return false;
    const merged = mergeGeometries(body, false);
    body.forEach((g) => g.dispose());
    if (!merged) return false;
    merged.computeBoundingSphere();
    this.root.add(new THREE.Mesh(merged, this.material));

    for (const wg of wheelGroups) {
      const invW = new THREE.Matrix4().copy(wg.matrixWorld).invert();
      const parts = [];
      wg.traverse((o) => {
        if (!o.isMesh || !o.geometry) return;
        const g = plainGeometry(o.geometry);
        if (g) { g.applyMatrix4(_m.copy(invW).multiply(o.matrixWorld)); parts.push(g); }
      });
      if (!parts.length) continue;
      const wm = mergeGeometries(parts, false);
      parts.forEach((g) => g.dispose());
      if (!wm) continue;
      wm.computeBoundingSphere();
      const mesh = new THREE.Mesh(wm, this.material);
      mesh.position.copy(wg.position);
      mesh.userData.front = !!wg.userData?.front;
      mesh.userData.radius = wg.position.y || 0.34;
      this.root.add(mesh);
      this.wheels.push(mesh);
    }
    return true;
  }

  #proxy() {
    const g = mergeGeometries([
      new THREE.BoxGeometry(0.8, 0.5, 3.2).translate(0, 0.45, 0.1),
      new THREE.BoxGeometry(1.85, 0.06, 0.5).translate(0, 0.25, 2.9),
      new THREE.BoxGeometry(1.1, 0.5, 0.35).translate(0, 0.95, -2.35),
      new THREE.BoxGeometry(1.6, 0.06, 4.6).translate(0, 0.12, -0.2),
    ].filter(Boolean), false);
    if (g) this.root.add(new THREE.Mesh(g, this.material));
  }

  setVisible(v) { this.root.visible = !!v; }

  apply(pose, dt) {
    this.root.position.copy(pose.position);
    this.root.quaternion.copy(pose.quaternion);
    const v = (pose.kph || 0) / 3.6;
    for (const w of this.wheels) {
      w.rotation.x -= (v / Math.max(0.2, w.userData.radius)) * dt;
      if (w.userData.front) w.rotation.y = pose.steerAngle || 0;
    }
  }

  update(dt) { this.material.uniforms.uTime.value += dt; }

  dispose() {
    this.ctx.scene.remove(this.root);
    this.root.traverse((o) => o.geometry?.dispose?.());
    this.material.dispose();
  }
}

const _m = new THREE.Matrix4();

/** Strip a geometry down to position/normal/uv so anything can be merged with anything. */
function plainGeometry(src) {
  let g = src.index ? src.toNonIndexed() : src.clone();
  const out = new THREE.BufferGeometry();
  const p = g.getAttribute('position');
  if (!p) { g.dispose?.(); return null; }
  out.setAttribute('position', new THREE.BufferAttribute(new Float32Array(p.array), 3));
  const n = g.getAttribute('normal');
  out.setAttribute('normal', n
    ? new THREE.BufferAttribute(new Float32Array(n.array), 3)
    : new THREE.BufferAttribute(new Float32Array(p.count * 3), 3));
  const uv = g.getAttribute('uv');
  out.setAttribute('uv', uv
    ? new THREE.BufferAttribute(new Float32Array(uv.array), 2)
    : new THREE.BufferAttribute(new Float32Array(p.count * 2), 2));
  if (!n) out.computeVertexNormals();
  if (g !== src) g.dispose?.();
  return out;
}
