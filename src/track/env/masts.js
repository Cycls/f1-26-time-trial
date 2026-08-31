/**
 * Floodlight masts. Owner: ENVIRONMENT.
 * Bahrain runs 495 poles from 10 m to 45 m carrying ~4,500 luminaires. We model a
 * believable subset as three instanced kits (tall lattice / mid tapered / short
 * paddock pole).
 *
 * NO PointLights are created here — the 8-dynamic-light budget belongs to RENDER.
 * Instead the luminaires are a separate InstancedMesh whose *instance origin sits
 * at the lamp cluster*, carrying a MeshStandardMaterial with a strong emissive.
 * That is exactly the contract render/atmosphere.js#findLuminaires reads
 * ("hang volumetric cones off whatever luminaires ENVIRONMENT placed"), so the
 * shafts, halos and haze come from RENDER and we do not double them up.
 */
import * as THREE from 'three';
import {
  box, cyl, strut, tint, merge, litMat, Batch, facing, facingS, rr,
} from './util.js';

const STEEL = 0x8f9298;
const DARK = 0x3b3e44;

/** Tapered square lattice tower, +Y up, footprint centred on the origin. */
function lattice(h, r0, r1, bays, t) {
  const parts = [];
  const R = (i) => r0 + (r1 - r0) * (i / bays);
  const Y = (i) => (h * i) / bays;
  const corners = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
  for (let i = 0; i < bays; i++) {
    const ra = R(i), rb = R(i + 1), ya = Y(i), yb = Y(i + 1);
    for (let k = 0; k < 4; k++) {
      const [sx, sz] = corners[k];
      const [nx, nz] = corners[(k + 1) % 4];
      parts.push(strut([sx * ra, ya, sz * ra], [sx * rb, yb, sz * rb], t));         // leg
      parts.push(strut([sx * rb, yb, sz * rb], [nx * rb, yb, nz * rb], t * 0.7));   // ring
      parts.push(strut([sx * ra, ya, sz * ra], [nx * rb, yb, nz * rb], t * 0.55));  // diagonal
    }
  }
  return parts;
}

/**
 * One mast kit.
 *   tower : structure, origin at the base, +Z toward the racing line
 *   head  : boom + luminaire housings, origin AT the lamp cluster
 *   lens  : emissive lenses, same origin as `head`
 */
function mastKit(o) {
  const tower = [], head = [], lens = [];
  const h = o.height;

  if (o.lattice) {
    for (const g of lattice(h, o.base, o.top, o.bays, o.member)) tower.push(tint(g, STEEL, 0.8));
    for (let y = 1.2; y < h - 2; y += 2.8) tower.push(tint(box(0.5, 0.07, 0.07, [0, y, -o.base * 0.8]), STEEL, 0.55));
    tower.push(tint(strut([0.22, 0.6, -o.base * 0.85], [0.22, h - 1.5, -o.top * 0.85], 0.06), STEEL, 0.55));
    tower.push(tint(strut([-0.22, 0.6, -o.base * 0.85], [-0.22, h - 1.5, -o.top * 0.85], 0.06), STEEL, 0.55));
    tower.push(tint(box(o.base * 2.6, 0.9, o.base * 2.6, [0, 0.35, 0]), 0x6d6a63));
  } else {
    tower.push(tint(cyl(o.top, o.base, h, 8, [0, h / 2, 0]), STEEL, 0.75));
    tower.push(tint(cyl(o.base * 1.9, o.base * 2.3, 0.7, 8, [0, 0.3, 0]), 0x6d6a63));
  }

  // ---- head (local origin = lamp cluster centre) --------------------------
  const bw = o.boomW, tilt = o.tilt;
  head.push(tint(box(bw, 0.40, 0.42, [0, 0.34, 0.10]), STEEL, 0.85));
  head.push(tint(box(bw * 0.96, 0.26, 0.28, [0, -o.rows * 0.62 - 0.1, 0.55]), STEEL, 0.7));
  head.push(tint(box(0.40, 0.40, 1.9, [0, 0.34, 0.70]), STEEL, 0.85));
  for (let k = -1; k <= 1; k += 2) {
    head.push(tint(strut([k * bw * 0.42, 0.3, 0.1], [k * bw * 0.16, -o.rows * 0.62 - 0.1, 0.5], 0.10), STEEL, 0.6));
  }
  head.push(tint(strut([-bw / 2 + 0.2, 0.2, 0.1], [0, -1.9, -0.1], 0.10), STEEL, 0.65));
  head.push(tint(strut([bw / 2 - 0.2, 0.2, 0.1], [0, -1.9, -0.1], 0.10), STEEL, 0.65));
  head.push(tint(box(bw * 0.55, 0.08, 1.1, [0, -0.55, -0.40]), DARK));
  head.push(tint(box(bw * 0.55, 0.05, 0.05, [0, -0.05, -0.95]), STEEL, 0.6));
  head.push(tint(box(0.05, 0.5, 0.05, [-bw * 0.27, -0.30, -0.95]), STEEL, 0.6));
  head.push(tint(box(0.05, 0.5, 0.05, [bw * 0.27, -0.30, -0.95]), STEEL, 0.6));

  const per = o.perRow, sp = bw / Math.max(1, per);
  for (let j = 0; j < o.rows; j++) {
    for (let i = 0; i < per; i++) {
      const lx = (i - (per - 1) / 2) * sp;
      const ly = 0.05 - j * 0.62;
      const lz = 0.44 + j * 0.30;
      const rot = [tilt + j * 0.10, 0, 0];
      head.push(tint(box(sp * 0.90, 0.34, 0.60, [lx, ly, lz], rot), DARK));
      head.push(tint(box(sp * 0.94, 0.12, 0.15, [lx, ly + 0.20, lz - 0.24], rot), STEEL, 0.6));
      lens.push(box(sp * 0.80, 0.09, 0.46, [lx, ly - 0.19, lz + 0.04], rot));
    }
  }
  if (o.beacon) lens.push(box(0.3, 0.3, 0.3, [0, 1.1, 0]));

  return {
    tower: merge(tower), head: merge(head), lens: merge(lens),
    height: h, lamps: o.rows * per,
  };
}

const KITS = {
  tall: {
    height: 41, base: 1.55, top: 0.55, bays: 6, member: 0.17, lattice: true,
    boomW: 12.4, rows: 3, perRow: 9, tilt: 0.58, warm: false, beacon: true,
  },
  mid: {
    height: 25, base: 0.62, top: 0.26, bays: 5, member: 0.13, lattice: false,
    boomW: 7.0, rows: 2, perRow: 6, tilt: 0.70, warm: false, beacon: false,
  },
  short: {
    height: 11, base: 0.30, top: 0.16, bays: 4, member: 0.10, lattice: false,
    boomW: 2.6, rows: 1, perRow: 3, tilt: 0.86, warm: true, beacon: false,
  },
};

export function buildMasts(env) {
  const { track, rng } = env;
  const L = track.length;

  const kits = {};
  for (const k of Object.keys(KITS)) kits[k] = mastKit(KITS[k]);

  const structMat = litMat({ roughness: 0.6, metalness: 0.55 });
  // The two luminaire materials RENDER discovers. Keep emissiveIntensity >= 1.5
  // and toneMapped false so the value reaching the HDR buffer is a real radiance.
  const coolLamp = new THREE.MeshStandardMaterial({
    color: 0x0e1116, emissive: 0xd6e4ff, emissiveIntensity: 4.2,
    roughness: 0.35, metalness: 0.2, toneMapped: false,
  });
  const warmLamp = new THREE.MeshStandardMaterial({
    color: 0x14100c, emissive: 0xffc078, emissiveIntensity: 2.6,
    roughness: 0.4, metalness: 0.2, toneMapped: false,
  });

  const B = {};
  for (const k of Object.keys(kits)) {
    B[k] = {
      tower: new Batch(kits[k].tower, structMat, 'mastTower_' + k),
      head: new Batch(kits[k].head, structMat, 'mastHead_' + k),
      lens: new Batch(kits[k].lens, KITS[k].warm ? warmLamp : coolLamp, 'luminaire_' + k),
    };
  }

  let poles = 0, lamps = 0;
  const hp = new THREE.Vector3();

  const put = (kind, sample, side, lateral, yaw = 0, scaleY = 1) => {
    const kit = kits[kind];
    const mBase = facingS(sample, side, lateral, 0, 1, scaleY, 1, yaw);
    hp.set(0, kit.height, 0).applyMatrix4(mBase);
    const mHead = facing(sample, side, lateral, 0, yaw);
    mHead.setPosition(hp);
    B[kind].tower.add(mBase);
    B[kind].head.add(mHead);
    B[kind].lens.add(mHead);
    poles++; lamps += kit.lamps;
  };

  // ---- primary array: tall masts alternating sides all the way round -------
  let flip = 0;
  for (let s = 0; s < L; s += 104) {
    const t = track.sampleS(s);
    for (const side of (++flip % 2 ? [-1, 1] : [1, -1])) {
      const lat = env.barrierLat(s, side) + rr(rng, 16, 28);
      const p = t.point.clone().addScaledVector(t.right, side * lat);
      if (env.tooClose(p.x, p.z, Math.min(lat - 4, 26))) continue;
      put('tall', t, side, lat, rr(rng, -0.12, 0.12), rr(rng, 0.86, 1.12));
    }
  }

  // ---- secondary fill: mid masts, denser, closer in ------------------------
  for (let s = 40; s < L; s += 68) {
    const t = track.sampleS(s);
    const side = (Math.floor(s / 68) % 2) ? 1 : -1;
    const lat = env.barrierLat(s, side) + rr(rng, 5, 12);
    const p = t.point.clone().addScaledVector(t.right, side * lat);
    if (env.tooClose(p.x, p.z, Math.min(lat - 3, 20))) continue;
    put('mid', t, side, lat, rr(rng, -0.1, 0.1), rr(rng, 0.88, 1.16));
  }

  // ---- paddock / access-road poles: warm sodium, pit side only ------------
  const pitSide = env.pitSide ?? -1;
  for (let s = env.paddockFrom; s < env.paddockTo; s += 46) {
    const t = track.sampleS(s);
    for (let k = 0; k < 2; k++) {
      const lat = env.barrierLat(s, pitSide) + 46 + k * 34;
      const p = t.point.clone().addScaledVector(t.right, pitSide * lat);
      if (env.tooClose(p.x, p.z, 50)) continue;
      put('short', t, pitSide, lat, rr(rng, -0.3, 0.3), rr(rng, 0.9, 1.18));
    }
  }

  for (const k of Object.keys(B)) {
    for (const which of ['tower', 'head', 'lens']) {
      const im = B[k][which].build();
      if (im) { im.frustumCulled = true; env.group.add(im); }
    }
  }

  return { poles, lamps };
}
