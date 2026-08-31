/**
 * Racing line + speed profile ("the guide"). Owner: GAME.
 *
 * Two jobs:
 *  1. The RACING LINE ASSIST visual — Full / Corners only / Off, coloured the way the
 *     F1 games colour it: green = flat, yellow = off throttle / at the cornering limit,
 *     red = braking. One draw call, vertex-coloured ribbon, distance faded.
 *  2. The reference data the BRAKING ASSIST and STEERING ASSIST shape input against,
 *     and a clean reference lap time used to judge whether an off-track excursion
 *     conferred a benefit.
 *
 * The speed profile is built from the reference envelope, not invented:
 *     max lateral g(v_kph) = 1.603 + 4.634e-5 * v^2      (fits 1.9/2.65/3.5/4.5 g
 *                                                         at 80/150/200/250 km/h)
 *     max braking  g(v_kph) = min(3.3, 1.7 + 4.0e-5 * v^2)   (2026 peak is 3.3 g)
 *     top speed 335 km/h, ~750 kW, traction limit 1.5 g
 */
import * as THREE from 'three';

const V_TOP = 335 / 3.6;                 // m/s
const G = 9.81;
const LAT_A = 1.603, LAT_B = 4.634e-5;   // lateral g = LAT_A + LAT_B * kph^2
const LAT_CAP = 4.7;                     // g
const EDGE_MARGIN = 0.95;                // keep the outer wheel on the white line

export const LINE_MODES = ['full', 'corners', 'off'];

export class RacingLine {
  constructor(ctx, track) {
    this.ctx = ctx; this.track = track;
    this.mode = 'corners';
    this.ready = false;
    this.mesh = null;
  }

  build() {
    const track = this.track;
    if (!track?.length) return false;
    const L = this.L = track.length;
    const M = this.M = Math.max(240, Math.round(L / 3));
    const ds = this.ds = L / M;

    const cx = new Float64Array(M), cy = new Float64Array(M), cz = new Float64Array(M);
    const rx = new Float64Array(M), ry = new Float64Array(M), rz = new Float64Array(M);
    const hw = new Float64Array(M);
    for (let i = 0; i < M; i++) {
      const t = track.sampleS(i * ds);
      cx[i] = t.point.x; cy[i] = t.point.y; cz[i] = t.point.z;
      rx[i] = t.right.x; ry[i] = t.right.y; rz[i] = t.right.z;
      hw[i] = t.halfWidth;
    }

    // --- minimum-curvature relaxation, constrained to the track width -----------
    const lat = new Float64Array(M);
    const px = new Float64Array(M), py = new Float64Array(M), pz = new Float64Array(M);
    const put = (i) => { px[i] = cx[i] + rx[i] * lat[i]; py[i] = cy[i] + ry[i] * lat[i]; pz[i] = cz[i] + rz[i] * lat[i]; };
    for (let i = 0; i < M; i++) put(i);
    const W = 0.42;
    for (let it = 0; it < 420; it++) {
      for (let i = 0; i < M; i++) {
        const a = (i - 1 + M) % M, b = (i + 1) % M;
        const mx = (px[a] + px[b]) * 0.5 - cx[i];
        const my = (py[a] + py[b]) * 0.5 - cy[i];
        const mz = (pz[a] + pz[b]) * 0.5 - cz[i];
        const want = mx * rx[i] + my * ry[i] + mz * rz[i];
        const lim = Math.max(0, hw[i] - EDGE_MARGIN);
        lat[i] = Math.max(-lim, Math.min(lim, lat[i] + W * (want - lat[i])));
        put(i);
      }
    }
    this.lat = lat; this.px = px; this.py = py; this.pz = pz;
    this.rx = rx; this.ry = ry; this.rz = rz;

    // --- curvature (Menger, in the horizontal plane) ----------------------------
    const kap = new Float64Array(M);
    for (let i = 0; i < M; i++) {
      const a = (i - 2 + M) % M, b = (i + 2) % M;
      const ax = px[a], az = pz[a], bx = px[i], bz = pz[i], ccx = px[b], ccz = pz[b];
      const v1x = bx - ax, v1z = bz - az, v2x = ccx - bx, v2z = ccz - bz;
      const cross = v1x * v2z - v1z * v2x;
      const d1 = Math.hypot(v1x, v1z), d2 = Math.hypot(v2x, v2z), d3 = Math.hypot(ccx - ax, ccz - az);
      kap[i] = (d1 * d2 * d3 < 1e-6) ? 0 : (2 * cross) / (d1 * d2 * d3);
    }
    // box smooth so a noisy centreline does not produce phantom braking zones
    const ks = new Float64Array(M);
    for (let i = 0; i < M; i++) {
      let sum = 0; for (let k = -3; k <= 3; k++) sum += kap[(i + k + M) % M];
      ks[i] = sum / 7;
    }
    this.kappa = ks;

    // --- speed profile ----------------------------------------------------------
    const v = new Float64Array(M);
    for (let i = 0; i < M; i++) v[i] = Math.min(V_TOP, cornerSpeed(Math.abs(ks[i])));
    for (let pass = 0; pass < 3; pass++) {
      for (let n = M - 1; n >= 0; n--) {                 // backward: braking
        const i = n, j = (i + 1) % M;
        const kph = v[j] * 3.6;
        const a = Math.min(3.3, 1.7 + 4.0e-5 * kph * kph) * G;
        const cap = Math.sqrt(v[j] * v[j] + 2 * a * ds);
        if (cap < v[i]) v[i] = cap;
      }
      for (let n = 0; n < M; n++) {                      // forward: acceleration
        const i = n, j = (i - 1 + M) % M;
        const cap = Math.sqrt(v[j] * v[j] + 2 * accel(v[j]) * ds);
        if (cap < v[i]) v[i] = cap;
      }
    }
    this.v = v;

    // --- advisory mode + reference lap time ------------------------------------
    const mode = new Uint8Array(M);
    const tRef = new Float64Array(M + 1);
    for (let i = 0; i < M; i++) {
      const j = (i + 1) % M;
      const aReq = (v[j] * v[j] - v[i] * v[i]) / (2 * ds);
      if (aReq < -1.2) mode[i] = 2;
      else if (v[i] < V_TOP * 0.985 && aReq < 0.7) mode[i] = 1;
      else mode[i] = 0;
      tRef[i + 1] = tRef[i] + ds / Math.max(4, (v[i] + v[j]) * 0.5);
    }
    // widen braking zones by one sample so the ribbon reads as a block, not a dash
    const m2 = mode.slice();
    for (let i = 0; i < M; i++) if (mode[i] === 2) { m2[(i + 1) % M] = Math.max(m2[(i + 1) % M], 2); m2[(i - 1 + M) % M] = 2; }
    this.mode2 = m2;
    this.tRef = tRef;
    this.refLap = tRef[M];

    // --- "corners only" mask: hide the line on the straights --------------------
    const mask = new Float32Array(M);
    for (let i = 0; i < M; i++) mask[i] = (m2[i] !== 0 || Math.abs(ks[i]) > 0.0035) ? 1 : 0;
    for (let pad = 0; pad < 30; pad++) {                 // show it ~90 m before a zone
      const src = mask.slice();
      for (let i = 0; i < M; i++) if (src[(i + 1) % M] > 0.5) mask[i] = 1;
    }
    this.mask = mask;

    this.brakePoints = [];
    for (let i = 0; i < M; i++) if (m2[i] === 2 && m2[(i - 1 + M) % M] !== 2) this.brakePoints.push(i * ds);

    this.#buildMesh();
    this.ready = true;
    return true;
  }

  // ------------------------------------------------------------------ queries --
  #idx(s) { const M = this.M; return ((Math.floor(s / this.ds) % M) + M) % M; }

  /** Target speed of the ideal line at lap distance s, in m/s. */
  speedAt(s) {
    if (!this.ready) return V_TOP;
    const M = this.M, f = s / this.ds, i0 = ((Math.floor(f) % M) + M) % M, i1 = (i0 + 1) % M;
    const t = f - Math.floor(f);
    return this.v[i0] * (1 - t) + this.v[i1] * t;
  }

  modeAt(s) { return this.ready ? this.mode2[this.#idx(s)] : 0; }
  latAt(s) { return this.ready ? this.lat[this.#idx(s)] : 0; }

  pointAt(s, out = new THREE.Vector3()) {
    if (!this.ready) return out.set(0, 0, 0);
    const M = this.M, f = s / this.ds, i0 = ((Math.floor(f) % M) + M) % M, i1 = (i0 + 1) % M;
    const t = f - Math.floor(f);
    return out.set(
      this.px[i0] * (1 - t) + this.px[i1] * t,
      this.py[i0] * (1 - t) + this.py[i1] * t,
      this.pz[i0] * (1 - t) + this.pz[i1] * t,
    );
  }

  /** Reference (ideal-line) elapsed time from the start line to s. */
  refTimeAt(s) {
    if (!this.ready) return 0;
    const M = this.M, f = Math.max(0, s) / this.ds;
    const i0 = Math.min(M, Math.floor(f)), t = f - Math.floor(f);
    return this.tRef[i0] + (this.tRef[Math.min(M, i0 + 1)] - this.tRef[i0]) * t;
  }

  /** Pure-pursuit steering command for the steering assist, in -1..1 input units. */
  pursuitSteer(car, v, gain, s) {
    if (!this.ready) return null;
    const Ld = Math.max(9, Math.min(45, 7 + v * 0.6));
    const p = this.pointAt(s + Ld, _v1);
    _v2.copy(p).sub(car.position).applyQuaternion(_q.copy(car.quaternion).invert());
    if (_v2.z < 1.5) return null;
    const kappa = 2 * _v2.x / (_v2.x * _v2.x + _v2.z * _v2.z);
    const delta = Math.atan(3.4 * kappa);
    return delta / Math.max(0.05, gain);
  }

  // -------------------------------------------------------------------- visual --
  #buildMesh() {
    const M = this.M, HALF = 0.55;
    const n = M + 1;
    const pos = new Float32Array(n * 2 * 3);
    const col = new Float32Array(n * 2 * 3);
    const msk = new Float32Array(n * 2);
    const idx = new Uint32Array(M * 6);
    const COL = [[0.13, 0.88, 0.35], [1.0, 0.80, 0.10], [1.0, 0.16, 0.13]];
    for (let k = 0; k < n; k++) {
      const i = k % M;
      const c = COL[this.mode2[i]];
      for (let sgn = 0; sgn < 2; sgn++) {
        const o = (sgn ? 1 : -1) * HALF;
        const b = (k * 2 + sgn) * 3;
        pos[b] = this.px[i] + this.rx[i] * o;
        pos[b + 1] = this.py[i] + 0.055;
        pos[b + 2] = this.pz[i] + this.rz[i] * o;
        col[b] = c[0]; col[b + 1] = c[1]; col[b + 2] = c[2];
        msk[k * 2 + sgn] = this.mask[i];
      }
    }
    for (let i = 0; i < M; i++) {
      const a = i * 2, b = a + 2, o = i * 6;
      idx[o] = a; idx[o + 1] = b; idx[o + 2] = a + 1;
      idx[o + 3] = a + 1; idx[o + 4] = b; idx[o + 5] = b + 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('mask', new THREE.BufferAttribute(msk, 1));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();

    this.material = new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0.55 }, uCorners: { value: 1 }, uCam: { value: new THREE.Vector3() } },
      vertexShader: `
        attribute float mask; varying vec3 vC; varying float vM; varying float vD;
        uniform vec3 uCam;
        void main(){
          vC = color; vM = mask;
          vec4 wp = modelMatrix * vec4(position,1.0);
          vD = distance(wp.xyz, uCam);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        varying vec3 vC; varying float vM; varying float vD;
        uniform float uOpacity; uniform float uCorners;
        void main(){
          if (uCorners > 0.5 && vM < 0.5) discard;
          float near = smoothstep(2.0, 9.0, vD);
          float far  = 1.0 - smoothstep(150.0, 320.0, vD);
          float a = uOpacity * near * far;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vC, a);
        }`,
      transparent: true, depthWrite: false, vertexColors: true,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.name = 'racingLine';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.setMode(this.mode);
    this.ctx.scene.add(this.mesh);
  }

  setMode(m) {
    this.mode = LINE_MODES.includes(m) ? m : 'off';
    if (!this.mesh) return;
    this.mesh.visible = this.mode !== 'off';
    this.material.uniforms.uCorners.value = this.mode === 'corners' ? 1 : 0;
  }

  update() {
    if (this.material) this.material.uniforms.uCam.value.copy(this.ctx.camera.position);
  }

  dispose() {
    if (!this.mesh) return;
    this.ctx.scene.remove(this.mesh);
    this.mesh.geometry.dispose(); this.material.dispose();
    this.mesh = null;
  }
}

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();

/** Grip-limited corner speed for a given curvature, from the reference envelope. */
function cornerSpeed(k) {
  if (k < 1e-6) return V_TOP;
  // v^2 * k = g * (LAT_A + LAT_B * (3.6 v)^2)  ->  v^2 (k - g*LAT_B*12.96) = g*LAT_A
  const slope = G * LAT_B * 12.96;             // 5.892e-3
  const capped = (LAT_CAP * G) / k;            // never exceed the 4.7 g ceiling
  const df = k > slope ? (G * LAT_A) / (k - slope) : Infinity;
  return Math.min(V_TOP, Math.sqrt(Math.min(capped, df)));
}

/** Longitudinal acceleration available at speed v (m/s^2), power + traction + drag. */
function accel(v) {
  const traction = 1.5 * G;
  const power = 750000 / (Math.max(v, 8) * 768);
  const drag = 0.5 * 1.2 * 0.95 * v * v / 768;
  return Math.max(0.25, Math.min(traction, power) - drag);
}
