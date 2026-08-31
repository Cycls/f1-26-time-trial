/**
 * Procedural geometry helpers for the car. Owner: CAR.
 * Everything here returns plain THREE.BufferGeometry — no external models.
 *
 * The workhorses:
 *   loft(rings)          — skin a stack of closed cross-sections (monocoque, sidepods, ...)
 *   sweepAirfoil(...)    — sweep a NACA section along a span with chord/twist/dihedral
 *                          (wings, wishbones, strakes, floor edges)
 *   sweepProfile(curve)  — sweep an arbitrary 2D profile along a 3D curve (halo, roll hoop)
 *   revolve(profile)     — lathe with arc-length V coordinates (tyres, rims, discs)
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export { mergeGeometries };

const TAU = Math.PI * 2;

/* ------------------------------------------------------------------ winding */
/** Signed volume test; flips triangle winding if the solid is inside-out. */
export function fixWinding(geo) {
  const p = geo.attributes.position, idx = geo.index;
  if (!idx) return geo;
  let vol = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < idx.count; i += 3) {
    a.fromBufferAttribute(p, idx.getX(i));
    b.fromBufferAttribute(p, idx.getX(i + 1));
    c.fromBufferAttribute(p, idx.getX(i + 2));
    vol += a.dot(b.clone().cross(c));
  }
  if (vol < 0) {
    const arr = idx.array;
    for (let i = 0; i < arr.length; i += 3) { const t = arr[i + 1]; arr[i + 1] = arr[i + 2]; arr[i + 2] = t; }
    idx.needsUpdate = true;
  }
  return geo;
}

/* --------------------------------------------------------------------- loft */
/**
 * Skin a stack of rings. Every ring must have the same number of points.
 *
 * UV modes:
 *   default          U = ring arc length / that ring's perimeter, V = 0..1 along the spine.
 *                    Topologically stable, but it throws the physical scale away — a ring
 *                    whose perimeter collapses (airbox, nose) squeezes the map with it.
 *   metricUV: <m>    U and V are real metres divided by <m>. Use it for anything textured
 *                    with a physically-sized pattern (carbon weave), or for two separate
 *                    meshes that must share one livery sheet.
 *   vOffset: <v>     added to V after scaling, so a second mesh can start part-way down
 *                    the same sheet (sidepods against the monocoque livery).
 *
 * @param {THREE.Vector3[][]} rings   ordered nose→tail (or root→tip)
 * @param {object} o  {closedSection, capStart, capEnd, metricUV, vOffset, uOffset}
 */
export function loft(rings, o = {}) {
  const closed = o.closedSection !== false;
  const M = rings.length, N = rings[0].length;
  const cols = closed ? N + 1 : N;
  const pos = [], uv = [], idx = [];
  const metric = o.metricUV ?? 0;
  const vOff = o.vOffset ?? 0, uOff = o.uOffset ?? 0;

  // V coordinate: distance travelled along the spine (metres, or normalised 0..1)
  const cen = rings.map(r => r.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / r.length));
  const vs = [0];
  for (let j = 1; j < M; j++) vs.push(vs[j - 1] + cen[j].distanceTo(cen[j - 1]));
  const vTot = vs[M - 1] || 1;
  for (let j = 0; j < M; j++) vs[j] = metric ? vs[j] / metric + vOff : vs[j] / vTot;

  for (let j = 0; j < M; j++) {
    const ring = rings[j];
    const us = [0];
    let per = 0;
    for (let i = 1; i < cols; i++) { per += ring[i % N].distanceTo(ring[i - 1]); us.push(per); }
    for (let i = 0; i < cols; i++) {
      const p = ring[i % N];
      pos.push(p.x, p.y, p.z);
      const u = metric ? us[i] / metric + uOff : (per > 1e-9 ? us[i] / per : i / (cols - 1));
      uv.push(u, vs[j]);
    }
  }
  for (let j = 0; j < M - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i, b = j * cols + i + 1, c = (j + 1) * cols + i, d = (j + 1) * cols + i + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const capRing = (j, flip) => {
    const base = pos.length / 3;
    const ring = rings[j];
    const c = cen[j];
    pos.push(c.x, c.y, c.z); uv.push(0.5, vs[j]);
    for (let i = 0; i < N; i++) { const p = ring[i]; pos.push(p.x, p.y, p.z); uv.push(i / N, vs[j]); }
    for (let i = 0; i < N; i++) {
      const a = base, b = base + 1 + i, d = base + 1 + ((i + 1) % N);
      if (flip) idx.push(a, d, b); else idx.push(a, b, d);
    }
  };
  if (o.capStart) capRing(0, true);
  if (o.capEnd) capRing(M - 1, false);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  fixWinding(g);
  g.computeVertexNormals();
  // weld the UV seam normals so the wrap is invisible
  if (closed) {
    const n = g.attributes.normal;
    for (let j = 0; j < M; j++) {
      const a = j * cols, b = j * cols + N;
      const nx = (n.getX(a) + n.getX(b)) / 2, ny = (n.getY(a) + n.getY(b)) / 2, nz = (n.getZ(a) + n.getZ(b)) / 2;
      const l = Math.hypot(nx, ny, nz) || 1;
      n.setXYZ(a, nx / l, ny / l, nz / l); n.setXYZ(b, nx / l, ny / l, nz / l);
    }
    n.needsUpdate = true;
  }
  return g;
}

/* ------------------------------------------------------- smooth 2D outlines */
/** Resample a closed control polygon into N points with a Catmull-Rom curve. */
export function smoothLoop(ctrl, N = 64, tension = 0.5, type = 'catmullrom') {
  const pts = ctrl.map(p => new THREE.Vector3(p[0], p[1], 0));
  const curve = new THREE.CatmullRomCurve3(pts, true, type, tension);
  const out = [];
  for (let i = 0; i < N; i++) out.push(curve.getPoint(i / N));
  return out;
}

/**
 * Cross-section of the monocoque / engine cover family.
 * All sections share the same control-point topology so the loft never twists.
 */
export function bodySection(p, N = 72) {
  const hw = p.hw, yT = p.yTop, yB = p.yBot, h = Math.max(yT - yB, 1e-3);
  const bw = (p.bottomHW ?? 0.72) * hw;
  const deck = (p.deck ?? 0.72) * hw;
  const chw = Math.max(p.cockpitHW ?? 0, hw * 0.10);
  const yTub = Math.min(p.yTub ?? (yT - 0.004), yT - 0.004);
  const waist = p.waist ?? 0.42;
  const shoulder = p.shoulder ?? 0.95;
  const half = [
    [0, yB],
    [bw * 0.62, yB + h * 0.012],
    [bw, yB + h * 0.06],
    [hw, yB + h * waist],
    [hw * shoulder, yT - h * 0.10],
    [deck, yT],
    [Math.max(chw + hw * 0.06, deck * 0.55), yT - h * 0.01],
    [chw, yTub + (yT - yTub) * 0.5],
    [chw * 0.78, yTub],
    [0, yTub - (p.tubDish ?? 0)],
  ];
  const ctrl = [];
  for (const q of half) ctrl.push(q);
  for (let i = half.length - 2; i >= 1; i--) ctrl.push([-half[i][0], half[i][1]]);
  return smoothLoop(ctrl, N, p.tension ?? 0.5);
}

/** Rounded pod cross-section (sidepods, engine cover shoulders, ducts). */
export function podSection(p, N = 56) {
  const xi = p.xIn, xo = p.xOut, yT = p.yTop, yB = p.yBot;
  const h = Math.max(yT - yB, 1e-3);
  const uc = p.undercut ?? 0.16;   // 0 = square bottom, 1 = deep undercut
  const ctrl = [
    [xi, yT - h * 0.02],
    [xi + (xo - xi) * 0.45, yT],
    [xo - (xo - xi) * 0.12, yT - h * 0.10],
    [xo, yT - h * 0.38],
    [xo - (xo - xi) * uc * 0.55, yB + h * 0.30],
    [xo - (xo - xi) * uc, yB + h * 0.07],
    [xo - (xo - xi) * (uc + 0.14), yB],
    [xi + (xo - xi) * 0.30, yB - (p.bellyDrop ?? 0)],
    [xi, yB + h * 0.06],
  ];
  return smoothLoop(ctrl, N, 0.5);
}

/* ------------------------------------------------------------------ airfoil */
/** NACA 4-digit closed section, points ordered TE→upper→LE→lower→TE. x in [-0.5,0.5]. */
export function nacaSection(N = 34, thickness = 0.12, camber = 0.06, camberPos = 0.42) {
  const t = thickness, m = camber, p = camberPos;
  const up = [], lo = [];
  const half = Math.max(6, Math.floor(N / 2));
  for (let i = 0; i <= half; i++) {
    const beta = (i / half) * Math.PI;
    const x = 0.5 * (1 - Math.cos(beta));           // cosine spacing, 0..1
    const yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.1260 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    let yc = 0, dyc = 0;
    if (m > 0) {
      if (x < p) { yc = m / (p * p) * (2 * p * x - x * x); dyc = 2 * m / (p * p) * (p - x); }
      else { yc = m / ((1 - p) ** 2) * ((1 - 2 * p) + 2 * p * x - x * x); dyc = 2 * m / ((1 - p) ** 2) * (p - x); }
    }
    const th = Math.atan(dyc);
    up.push(new THREE.Vector2(x - yt * Math.sin(th) - 0.5, yc + yt * Math.cos(th)));
    lo.push(new THREE.Vector2(x + yt * Math.sin(th) - 0.5, yc - yt * Math.cos(th)));
  }
  const pts = [];
  for (let i = up.length - 1; i >= 0; i--) pts.push(up[i]);   // TE → LE over the top
  for (let i = 1; i < lo.length; i++) pts.push(lo[i]);        // LE → TE under
  pts.pop();                                                  // close (TE shared)
  return pts;
}

/**
 * Sweep an airfoil along a span.
 * stations: [{ x, y, z, chord, twist, thickness, camber, scaleY }]
 * The section lies in the local ZY plane, span runs along X.
 */
export function sweepAirfoil(stations, o = {}) {
  const N = o.sections ?? 32;
  const dir = o.flip ? -1 : 1;    // flip = leading edge towards +Z (car forward)
  const rings = stations.map(s => {
    const sec = nacaSection(N, s.thickness ?? o.thickness ?? 0.11, s.camber ?? o.camber ?? 0.07, o.camberPos ?? 0.42);
    const tw = s.twist ?? 0, ct = Math.cos(tw), st = Math.sin(tw);
    return sec.map(pt => {
      const cx = pt.x * s.chord * dir, cy = pt.y * s.chord * (s.scaleY ?? 1);
      const z = cx * ct - cy * st;
      const y = cx * st + cy * ct;
      return new THREE.Vector3(s.x, s.y + y, s.z + z);
    });
  });
  return loft(rings, { capStart: o.cap !== false, capEnd: o.cap !== false });
}

/** Sweep an arbitrary closed 2D profile along a 3D curve (Frenet framed). */
export function sweepProfile(curve, profile, steps = 48, o = {}) {
  const frames = curve.computeFrenetFrames(steps, false);
  const rings = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const c = curve.getPointAt(t);
    const nrm = frames.normals[i], bin = frames.binormals[i];
    const prof = typeof profile === 'function' ? profile(t) : profile;
    rings.push(prof.map(p => new THREE.Vector3(
      c.x + nrm.x * p.x + bin.x * p.y,
      c.y + nrm.y * p.x + bin.y * p.y,
      c.z + nrm.z * p.x + bin.z * p.y,
    )));
  }
  return loft(rings, { capStart: o.cap !== false, capEnd: o.cap !== false });
}

/** Simple ellipse profile for sweeps. */
export function ellipseProfile(rx, ry, n = 14) {
  const p = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * TAU; p.push(new THREE.Vector2(Math.cos(a) * rx, Math.sin(a) * ry)); }
  return p;
}

/** Teardrop / streamlined tube profile (halo, roll hoop, suspension fairings). */
export function teardropProfile(w, h, n = 18) {
  const p = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const c = Math.cos(a), s = Math.sin(a);
    const taper = 0.55 + 0.45 * (0.5 + 0.5 * c);   // fatter at the leading edge
    p.push(new THREE.Vector2(c * w, s * h * taper));
  }
  return p;
}

/* ------------------------------------------------------------------ revolve */
/**
 * Lathe around +Y with arc-length V coordinates.
 * profile: [{r, y}] from one end of the section to the other.
 * Returns { geometry, v: number[] } so textures can be authored against the profile.
 */
export function revolve(profile, segments = 48, o = {}) {
  const M = profile.length;
  const lens = [0];
  for (let i = 1; i < M; i++) {
    lens.push(lens[i - 1] + Math.hypot(profile[i].r - profile[i - 1].r, profile[i].y - profile[i - 1].y));
  }
  const tot = lens[M - 1] || 1;
  const v = lens.map(l => l / tot);
  const pos = [], uv = [], idx = [], nrm = [];
  const uRepeat = o.uRepeat ?? 1;
  for (let i = 0; i <= segments; i++) {
    const u = i / segments, a = u * TAU;
    const ca = Math.cos(a), sa = Math.sin(a);
    for (let j = 0; j < M; j++) {
      pos.push(profile[j].r * ca, profile[j].y, profile[j].r * sa);
      uv.push(u * uRepeat, v[j]);
      // analytic normal from the profile tangent
      const j0 = Math.max(0, j - 1), j1 = Math.min(M - 1, j + 1);
      const dr = profile[j1].r - profile[j0].r, dy = profile[j1].y - profile[j0].y;
      const l = Math.hypot(dr, dy) || 1;
      nrm.push((dy / l) * ca, -dr / l, (dy / l) * sa);
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < M - 1; j++) {
      const a = i * M + j, b = a + M, c = a + 1, d = b + 1;
      idx.push(a, b, c, c, b, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  fixWinding(g);
  g.computeVertexNormals();
  return { geometry: g, v };
}

/* --------------------------------------------------------------------- misc */
/** Merge geometries that may be a mix of indexed and non-indexed. */
export function mergeSafe(list) {
  const parts = list.filter(Boolean).map(g => (g.index ? g.toNonIndexed() : g));
  if (!parts.length) return null;
  const attrs = parts.map(g => Object.keys(g.attributes).sort().join(','));
  const common = attrs[0];
  for (let i = 0; i < parts.length; i++) {
    if (attrs[i] === common) continue;
    // drop any attribute the first geometry does not carry
    for (const k of Object.keys(parts[i].attributes)) if (!parts[0].attributes[k]) parts[i].deleteAttribute(k);
  }
  return mergeGeometries(parts, false);
}

/**
 * ExtrudeGeometry writes UVs straight from the shape's own coordinates, i.e. in
 * METRES, so a 0.4 m endplate only ever samples a 0.4 x 0.3 corner of its decal
 * sheet. Remap the UVs onto the geometry's own bounds so a 0..1 sheet fits it.
 */
export function fitUV(geo, flipU = false) {
  const uv = geo.attributes.uv;
  if (!uv) return geo;
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i), v = uv.getY(i);
    if (u < u0) u0 = u; if (u > u1) u1 = u;
    if (v < v0) v0 = v; if (v > v1) v1 = v;
  }
  const du = (u1 - u0) || 1, dv = (v1 - v0) || 1;
  for (let i = 0; i < uv.count; i++) {
    let u = (uv.getX(i) - u0) / du;
    if (flipU) u = 1 - u;
    uv.setXY(i, u, (uv.getY(i) - v0) / dv);
  }
  uv.needsUpdate = true;
  return geo;
}

/**
 * Extrude a ZY outline (shape.x = car Z, shape.y = car Y) into a plate of
 * thickness t centred on X — endplates, fins, pylons, strakes.
 * opts.fitUV normalises the UVs onto the outline's bounding box (decal sheets);
 * leave it off for carbon weave, which wants the metric UVs.
 */
export function plateZY(shape, t, opts = {}) {
  const { fitUV: fit = false, flipU = false, ...ex } = opts;
  const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 8, ...ex });
  if (fit) fitUV(g, flipU);
  g.rotateY(-Math.PI / 2);
  g.translate(t / 2, 0, 0);
  return g;
}

/**
 * Extrude a ZX outline (shape.x = car Z, shape.y = outboard X) into a horizontal
 * plate of thickness t — footplates, floor edges, winglets.
 */
export function plateZX(shape, t, opts = {}) {
  const { fitUV: fit = false, flipU = false, ...ex } = opts;
  const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 8, ...ex });
  if (fit) fitUV(g, flipU);
  g.rotateX(-Math.PI / 2); g.rotateY(-Math.PI / 2);
  g.translate(0, -t / 2, 0);
  return g;
}

/** Rounded-rectangle THREE.Shape (endplates, inlets, wing pylons). */
export function roundedRect(w, h, r, cx = 0, cy = 0) {
  const s = new THREE.Shape();
  const x = cx - w / 2, y = cy - h / 2;
  r = Math.min(r, w / 2, h / 2);
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** Shape from a list of [x,y] points, smoothed with a closed spline. */
export function splineShape(pts, divisions = 8) {
  const s = new THREE.Shape();
  const v = pts.map(p => new THREE.Vector2(p[0], p[1]));
  const curve = new THREE.SplineCurve(v.concat([v[0]]));
  const sampled = curve.getPoints(v.length * divisions);
  s.moveTo(sampled[0].x, sampled[0].y);
  for (let i = 1; i < sampled.length; i++) s.lineTo(sampled[i].x, sampled[i].y);
  s.closePath();
  return s;
}

/**
 * A doubly-curved plate: a plan-form swept along Z with independent top and
 * bottom height fields. Used for the floor, diffuser and floor edge.
 */
export function plate(o) {
  const { z0, z1, nz = 40, nx = 22 } = o;
  const rings = [];
  for (let j = 0; j <= nz; j++) {
    const tz = j / nz, z = z0 + (z1 - z0) * tz;
    const hw = o.halfWidth(tz, z);
    const ring = [];
    for (let i = 0; i <= nx; i++) {                  // bottom surface, +x → -x
      const tx = i / nx, x = hw * (1 - 2 * tx);
      ring.push(new THREE.Vector3(x, o.bottom(tx, tz, x, z), z));
    }
    for (let i = nx; i >= 0; i--) {                  // top surface back the other way
      const tx = i / nx, x = hw * (1 - 2 * tx);
      ring.push(new THREE.Vector3(x, o.top(tx, tz, x, z), z));
    }
    rings.push(ring);
  }
  return loft(rings, { capStart: true, capEnd: true });
}

export function disposeTree(obj) {
  obj.traverse(o => { o.geometry?.dispose?.(); });
}
