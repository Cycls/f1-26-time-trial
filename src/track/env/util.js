/**
 * Shared helpers for the ENVIRONMENT kit. Owner: ENVIRONMENT.
 * Geometry construction, merging, seeded RNG, instancing and track-space placement.
 * Everything here is build-time only — nothing in this file runs per frame.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* ---------------------------------------------------------------- random */

/** Deterministic 32-bit PRNG. Same seed -> same circuit dressing every load. */
export function makeRng(seed = 0x5eed) {
  let a = seed >>> 0;
  return function rnd() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const rr = (r, a, b) => a + (b - a) * r();
export const ri = (r, a, b) => Math.floor(a + (b - a + 1) * r());
export const pick = (r, arr) => arr[Math.min(arr.length - 1, Math.floor(r() * arr.length))];
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t);
};
export const lerp = (a, b, t) => a + (b - a) * t;

/* --------------------------------------------------------------- geometry */

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();

/** Place a geometry: position [x,y,z], euler rotation [x,y,z], scale [x,y,z]. Mutates + returns. */
export function place(g, p, rot, scl) {
  _e.set(rot ? rot[0] : 0, rot ? rot[1] : 0, rot ? rot[2] : 0);
  _q.setFromEuler(_e);
  _m4.compose(
    _v.set(p ? p[0] : 0, p ? p[1] : 0, p ? p[2] : 0),
    _q,
    new THREE.Vector3(scl ? scl[0] : 1, scl ? scl[1] : 1, scl ? scl[2] : 1),
  );
  g.applyMatrix4(_m4);
  return g;
}

export const box = (w, h, d, p, rot, scl) => place(new THREE.BoxGeometry(w, h, d), p, rot, scl);
export const cyl = (rt, rb, h, seg, p, rot) =>
  place(new THREE.CylinderGeometry(rt, rb, h, seg, 1, false), p, rot);
export const tube = (rt, rb, h, seg, p, rot) =>
  place(new THREE.CylinderGeometry(rt, rb, h, seg, 1, true), p, rot);
export const quad = (w, h, p, rot) => place(new THREE.PlaneGeometry(w, h), p, rot);

/** A thin strut between two local points — used for lattice / truss work. */
export function strut(a, b, t = 0.12) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz) || 1e-4;
  const g = new THREE.BoxGeometry(t, len, t);
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / len, dy / len, dz / len));
  g.applyMatrix4(new THREE.Matrix4().compose(
    new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), q, new THREE.Vector3(1, 1, 1)));
  return g;
}

const _c = new THREE.Color();
/** Attach a flat vertex colour so many differently-coloured parts can share one material. */
export function tint(g, col, mul = 1) {
  let r, gr, b;
  if (Array.isArray(col)) { r = col[0]; gr = col[1]; b = col[2]; }
  else { _c.set(col); r = _c.r; gr = _c.g; b = _c.b; }
  r *= mul; gr *= mul; b *= mul;
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = r; a[i * 3 + 1] = gr; a[i * 3 + 2] = b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

/** Merge a list of tinted geometries into one. Drops UVs unless keepUv. */
export function merge(list, keepUv = false) {
  const clean = list.filter(Boolean);
  if (!clean.length) return null;
  for (const g of clean) {
    if (!keepUv && g.attributes.uv) g.deleteAttribute('uv');
    if (g.attributes.uv1) g.deleteAttribute('uv1');
    if (!g.index) { /* keep merge homogeneous */ }
  }
  const out = mergeGeometries(clean, false);
  for (const g of clean) g.dispose();
  return out;
}

/* -------------------------------------------------------------- materials */

export function litMat(opts = {}) {
  return new THREE.MeshStandardMaterial(Object.assign({
    vertexColors: true, color: 0xffffff, roughness: 0.85, metalness: 0.05,
  }, opts));
}
/**
 * Global radiance scale for unlit self-illuminated surfaces. Geometry is authored
 * in "stops" (1 = a lit panel you can look at, 8 = a lamp lens); this maps that
 * onto the linear values RENDER's exposure expects. One knob for the whole kit.
 */
export const EMIT = 0.16;

/** Unlit, bloom-catching material for soffits, garage interiors, screens, signage. */
export function glowMat(opts = {}) {
  return new THREE.MeshBasicMaterial(Object.assign({
    vertexColors: true, color: new THREE.Color(EMIT, EMIT, EMIT),
    fog: true, toneMapped: false,
  }, opts));
}

/* ------------------------------------------------------------- instancing */

/** Collects Matrix4s, then bakes an InstancedMesh. */
export class Batch {
  constructor(geometry, material, name = '') {
    this.g = geometry; this.m = material; this.name = name;
    this.mats = []; this.cols = null;
  }
  add(matrix, colour) {
    this.mats.push(matrix.clone());
    if (colour) {
      if (!this.cols) this.cols = [];
      this.cols[this.mats.length - 1] = colour;
    }
    return this;
  }
  build(opts = {}) {
    if (!this.g || !this.mats.length) return null;
    const im = new THREE.InstancedMesh(this.g, this.m, this.mats.length);
    for (let i = 0; i < this.mats.length; i++) im.setMatrixAt(i, this.mats[i]);
    if (this.cols) {
      const white = new THREE.Color(1, 1, 1);
      for (let i = 0; i < this.mats.length; i++) im.setColorAt(i, this.cols[i] || white);
      im.instanceColor.needsUpdate = true;
    }
    im.instanceMatrix.needsUpdate = true;
    im.name = this.name;
    im.castShadow = !!opts.castShadow;
    im.receiveShadow = !!opts.receiveShadow;
    im.computeBoundingSphere();
    return im;
  }
}

/* ------------------------------------------------------------ track space */

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Local frame for something standing beside the track and facing it.
 * side = -1 (on -right) or +1 (on +right). Returns a Matrix4 whose
 * +X runs along the track, +Y is up, +Z points at the racing line.
 */
export function facing(sample, side, lateral, lift = 0, yaw = 0, scale = 1) {
  const p = sample.point.clone().addScaledVector(sample.right, side * lateral);
  p.y += lift;
  const x = sample.tangent.clone().multiplyScalar(-side);
  const z = sample.right.clone().multiplyScalar(-side);
  const m = new THREE.Matrix4().makeBasis(x, UP, z);
  if (yaw) m.multiply(new THREE.Matrix4().makeRotationY(yaw));
  if (scale !== 1) m.scale(new THREE.Vector3(scale, scale, scale));
  m.setPosition(p);
  return m;
}

/** Same, but you supply an explicit non-uniform scale. */
export function facingS(sample, side, lateral, lift, sx, sy, sz, yaw = 0) {
  const p = sample.point.clone().addScaledVector(sample.right, side * lateral);
  p.y += lift;
  const x = sample.tangent.clone().multiplyScalar(-side);
  const z = sample.right.clone().multiplyScalar(-side);
  const m = new THREE.Matrix4().makeBasis(x, UP, z);
  if (yaw) m.multiply(new THREE.Matrix4().makeRotationY(yaw));
  m.scale(new THREE.Vector3(sx, sy, sz));
  m.setPosition(p);
  return m;
}

/**
 * Coarse scalar fields over the circuit region: distance to the centreline and
 * the track elevation of the nearest centreline point. Built by splatting the
 * centreline into a grid, so it costs ~1 ms rather than a brute-force sweep.
 */
export class TrackField {
  constructor(track, opts = {}) {
    const step = opts.step ?? 7;
    const cell = this.cell = opts.cell ?? 20;
    const reach = opts.reach ?? 420;

    const pts = [];
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let s = 0; s < track.length; s += step) {
      const t = track.sampleS(s);
      pts.push(t.point.x, t.point.z, t.point.y, t.halfWidth, s);
      minX = Math.min(minX, t.point.x); maxX = Math.max(maxX, t.point.x);
      minZ = Math.min(minZ, t.point.z); maxZ = Math.max(maxZ, t.point.z);
    }
    this.pts = pts;
    this.minX = minX - reach; this.minZ = minZ - reach;
    this.nx = Math.ceil((maxX - minX + reach * 2) / cell) + 1;
    this.nz = Math.ceil((maxZ - minZ + reach * 2) / cell) + 1;
    this.cx = (minX + maxX) / 2; this.cz = (minZ + maxZ) / 2;
    this.far = reach;
    const n = this.nx * this.nz;
    this.dist = new Float32Array(n).fill(reach);
    this.elev = new Float32Array(n);
    this.hw = new Float32Array(n).fill(9);
    this.at = new Float32Array(n);

    const R = Math.ceil(reach / cell);
    for (let i = 0; i < pts.length; i += 5) {
      const px = pts[i], pz = pts[i + 1], py = pts[i + 2], phw = pts[i + 3], ps = pts[i + 4];
      const cx = Math.floor((px - this.minX) / cell), cz = Math.floor((pz - this.minZ) / cell);
      for (let a = -R; a <= R; a++) {
        const gx = cx + a; if (gx < 0 || gx >= this.nx) continue;
        for (let b = -R; b <= R; b++) {
          const gz = cz + b; if (gz < 0 || gz >= this.nz) continue;
          const wx = this.minX + gx * cell, wz = this.minZ + gz * cell;
          const d = Math.hypot(wx - px, wz - pz);
          const k = gz * this.nx + gx;
          if (d < this.dist[k]) { this.dist[k] = d; this.elev[k] = py; this.hw[k] = phw; this.at[k] = ps; }
        }
      }
    }
  }
  #idx(x, z) {
    const fx = clamp((x - this.minX) / this.cell, 0, this.nx - 1.001);
    const fz = clamp((z - this.minZ) / this.cell, 0, this.nz - 1.001);
    return [Math.floor(fx), Math.floor(fz), fx - Math.floor(fx), fz - Math.floor(fz)];
  }
  #bil(arr, x, z) {
    const [ix, iz, tx, tz] = this.#idx(x, z);
    const k = iz * this.nx + ix;
    const a = arr[k], b = arr[k + 1], c = arr[k + this.nx], d = arr[k + this.nx + 1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
  }
  /** Distance from (x,z) to the track centreline, saturating at `reach`. */
  distance(x, z) { return this.#bil(this.dist, x, z); }
  /** Elevation of the nearest centreline point (smoothed). */
  elevation(x, z) { return this.#bil(this.elev, x, z); }
  /** Half-width of the nearest centreline point. */
  halfWidth(x, z) { return this.#bil(this.hw, x, z); }
}

/** Exact (not gridded) distance to the centreline — for rejecting placements. */
export function nearestDist(field, x, z) {
  const pts = field.pts;
  let best = Infinity;
  for (let i = 0; i < pts.length; i += 5) {
    const dx = x - pts[i], dz = z - pts[i + 1];
    const d = dx * dx + dz * dz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

