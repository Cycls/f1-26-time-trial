/**
 * Trackside furniture. Owner: ENVIRONMENT.
 * Armco, TecPro, catch fencing, tyre stacks, marshal posts, advertising
 * hoardings, braking-distance boards and pedestrian bridges.
 *
 * TRACK owns everything from the white line out to the end of its sand verge,
 * so nothing here draws ground: every object is placed on the verge using
 * env.lift(), and the barrier line sits just outside TRACK's run-off bands.
 *
 * Repeated dressing is bucketed into lap-distance chunks so the far side of the
 * circuit frustum- and distance-culls as whole groups.
 */
import * as THREE from 'three';
import {
  box, cyl, strut, quad, tint, merge, litMat, glowMat, Batch,
  facing, rr, lerp,
} from './util.js';
import { fenceTexture, sponsorAtlas, SPONSOR_COUNT, markerTexture } from './textures.js';

const STEEL = 0xa8adb4;

/* ------------------------------------------------------------------- kits */

function armcoKit(len = 4.0) {
  return merge([
    tint(box(len, 0.30, 0.10, [0, 1.02, 0]), STEEL, 1.0),
    tint(box(len, 0.30, 0.10, [0, 0.66, 0]), STEEL, 0.94),
    tint(box(len, 0.26, 0.09, [0, 0.32, 0]), STEEL, 0.88),
    tint(box(len, 0.06, 0.16, [0, 1.20, -0.02]), STEEL, 0.7),
    tint(box(0.16, 1.32, 0.16, [-len / 2 + 0.1, 0.66, -0.11]), 0x6e7379),
    tint(box(len, 0.26, 0.55, [0, 0.13, -0.1]), 0x6b6862),
  ]);
}

function tecproKit(blocks = 4, w = 1.02) {
  const lit = [];
  for (let i = 0; i < blocks; i++) {
    const x = (i - (blocks - 1) / 2) * (w + 0.04);
    lit.push(tint(box(w, 0.86, 1.15, [x, 0.47, 0]), 0x1c4c9c));            // blue block
    lit.push(tint(box(w, 0.17, 1.19, [x, 0.98, 0]), 0xe8ecf0));            // white cap
    lit.push(tint(box(w * 1.03, 0.10, 1.21, [x, 0.62, 0]), 0xdfe4ea, 0.9)); // strap
  }
  lit.push(tint(box(blocks * (w + 0.04), 0.16, 1.3, [0, 0.08, 0]), 0x3a3d42));
  return merge(lit);
}

function tyreKit() {
  const lit = [];
  for (let i = 0; i < 4; i++) lit.push(tint(cyl(0.36, 0.36, 0.24, 10, [0, 0.13 + i * 0.25, 0]), 0x131316));
  lit.push(tint(cyl(0.37, 0.37, 0.06, 10, [0, 1.15, 0]), 0xd8dade));
  return merge(lit);
}

/** Catch-fence post: raked back over the barrier with a stay, plus rails. */
function fencePostKit(h = 5.4, len = 4.0) {
  const lean = -0.13;
  return merge([
    tint(box(0.16, h, 0.16, [-len / 2, 1.3 + h / 2, 0.15], [lean, 0, 0]), 0x7f858c),
    tint(box(len, 0.09, 0.09, [0, 1.3 + h - 0.12, 0.15 + h * 0.13]), 0x7f858c),
    tint(box(len, 0.09, 0.09, [0, 1.35, 0.15]), 0x7f858c),
    tint(strut([-len / 2, 1.35, 0.12], [-len / 2 - 0.05, 1.3 + h * 0.6, -1.7], 0.10), 0x7f858c),
  ]);
}

function marshalKit() {
  const lit = [], glow = [];
  lit.push(tint(box(2.6, 2.4, 2.0, [0, 1.2, 0]), 0xd9dbdd, 0.9));
  lit.push(tint(box(2.9, 0.22, 2.3, [0, 2.5, 0]), 0x3c4046));
  lit.push(tint(box(2.2, 1.2, 0.12, [0, 1.5, 1.02]), 0x15181c));
  lit.push(tint(box(0.12, 1.4, 0.12, [1.1, 3.2, 0]), 0x6e7379));
  glow.push(tint(box(0.34, 0.30, 0.34, [1.1, 3.95, 0]), [9.0, 4.2, 0.7]));   // orange beacon
  glow.push(tint(box(2.0, 0.10, 0.10, [0, 2.35, 1.05]), [3.0, 2.8, 2.2]));
  glow.push(tint(quad(1.9, 0.9, [0, 1.5, 1.09]), [0.8, 1.3, 2.2]));          // monitor
  return { lit: merge(lit), glow: merge(glow) };
}

/* -------------------------------------------------------- textured panels */

function boardGeo(cell, w = 6.0, h = 1.05) {
  const g = new THREE.PlaneGeometry(w, h);
  g.translate(0, h / 2, 0);
  const uv = g.attributes.uv;
  const cx = cell % 4, cy = Math.floor(cell / 4);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) + cx) / 4, (uv.getY(i) + (1 - cy)) / 2);
  uv.needsUpdate = true;
  return g;
}

function fencePanel(w = 4.0, h = 5.4) {
  const g = new THREE.PlaneGeometry(w, h);
  g.translate(0, 1.3 + h / 2, 0);
  g.rotateX(-0.13);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / 2.2), uv.getY(i) * (h / 2.2));
  uv.needsUpdate = true;
  return g;
}

function markerGeo(cell, w = 1.6, h = 1.2) {
  const g = new THREE.PlaneGeometry(w, h);
  g.translate(0, 0.8 + h / 2, 0);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) + cell) / 4, uv.getY(i));
  uv.needsUpdate = true;
  return g;
}

/* ------------------------------------------------------------------ build */

export function buildTrackside(env) {
  const { track, rng } = env;
  const L = track.length;
  const CH = env.chunkCount;

  const structMat = litMat({ roughness: 0.55, metalness: 0.45 });
  const emitMat = glowMat();
  const fenceMat = new THREE.MeshBasicMaterial({
    map: fenceTexture(), alphaTest: 0.34, side: THREE.DoubleSide,
    color: 0x585d64, fog: true,
  });
  const atlas = sponsorAtlas();
  const advMat = new THREE.MeshStandardMaterial({
    map: atlas, emissiveMap: atlas, emissive: 0xffffff, emissiveIntensity: 0.85,
    roughness: 0.75, metalness: 0.0, side: THREE.DoubleSide,
  });
  const mark = markerTexture();
  const markMat = new THREE.MeshStandardMaterial({
    map: mark, emissiveMap: mark, emissive: 0xffffff, emissiveIntensity: 0.55,
    roughness: 0.8, side: THREE.DoubleSide,
  });

  const kArmco = armcoKit();
  const kTec = tecproKit();
  const kTyre = tyreKit();
  const kPost = fencePostKit();
  const kMarshal = marshalKit();
  const gFence = fencePanel();
  const gBoards = [];
  for (let i = 0; i < SPONSOR_COUNT; i++) gBoards.push(boardGeo(i));

  const chunks = [];
  for (let i = 0; i < CH; i++) {
    chunks.push({
      armco: new Batch(kArmco, structMat, 'armco'),
      tec: new Batch(kTec, structMat, 'tecpro'),
      tyre: new Batch(kTyre, structMat, 'tyres'),
      post: new Batch(kPost, structMat, 'fencePost'),
      fence: [], boards: [], markers: [],
    });
  }
  const marshalLit = new Batch(kMarshal.lit, structMat, 'marshal');
  const marshalGlow = new Batch(kMarshal.glow, emitMat, 'marshalGlow');

  const chunkOf = (s) => Math.min(CH - 1, Math.floor(((s % L) + L) % L / L * CH));
  const push = (arr, g, m) => arr.push(g.clone().applyMatrix4(m));

  const counts = { armco: 0, tec: 0, fence: 0, boards: 0, tyres: 0 };

  // ---- continuous barrier line -------------------------------------------
  let boardPhase = 0;
  for (let s = 0; s < L; s += 4.0) {
    const t = track.sampleS(s);
    const corner = env.cornerAt(s);
    const ci = chunkOf(s);
    for (const side of [-1, 1]) {
      const lat = env.barrierLat(s, side);
      const p = t.point.clone().addScaledVector(t.right, side * lat);
      if (env.tooClose(p.x, p.z, Math.min(lat - 3, 14))) continue;
      const m = facing(t, side, lat, env.lift(t, side, lat));
      chunks[ci].armco.add(m); counts.armco++;

      if (corner > 0.22 || env.grandstandAt(s)) {
        chunks[ci].post.add(m);
        push(chunks[ci].fence, gFence, m);
        counts.fence++;
      }
      if (corner > 0.30) {
        const tl = lat - 1.4;
        chunks[ci].tec.add(facing(t, side, tl, env.lift(t, side, tl)));
        counts.tec++;
      }
      // advertising: dense, the way a televised circuit actually looks
      if ((s % 8) < 4.0) {
        const bl = lat - (corner > 0.30 ? 2.2 : 0.5);
        push(chunks[ci].boards, gBoards[(boardPhase++) % SPONSOR_COUNT],
          facing(t, side, bl, env.lift(t, side, bl) + 0.02));
        counts.boards++;
      }
    }
  }

  // ---- tyre stacks at the corners -----------------------------------------
  for (let s = 0; s < L; s += 3.0) {
    if (env.cornerAt(s) < 0.5 || rng() > 0.45) continue;
    const t = track.sampleS(s);
    const ci = chunkOf(s);
    for (const side of [-1, 1]) {
      const lat = env.barrierLat(s, side) - 2.5;
      const p = t.point.clone().addScaledVector(t.right, side * lat);
      if (env.tooClose(p.x, p.z, Math.min(lat - 3, 14))) continue;
      const y = env.lift(t, side, lat);
      for (let k = 0; k < 3; k++) {
        chunks[ci].tyre.add(facing(t, side, lat - k * 0.78, y, rr(rng, 0, 3)));
        counts.tyres++;
      }
    }
  }

  // ---- marshal posts ------------------------------------------------------
  for (let s = 40; s < L; s += 300) {
    const t = track.sampleS(s);
    const side = (Math.floor(s / 300) % 2) ? 1 : -1;
    const lat = env.barrierLat(s, side) + 3.6;
    const p = t.point.clone().addScaledVector(t.right, side * lat);
    if (env.tooClose(p.x, p.z, 16)) continue;
    const m = facing(t, side, lat, env.lift(t, side, lat));
    marshalLit.add(m); marshalGlow.add(m);
  }

  // ---- braking-distance boards before the heavy stops ---------------------
  for (const bz of env.brakingZones) {
    for (let k = 0; k < 4; k++) {
      const s = bz - [300, 200, 100, 50][k];
      const t = track.sampleS(s);
      const ci = chunkOf(s);
      for (const side of [-1, 1]) {
        const lat = env.barrierLat(s, side) - 0.9;
        const p = t.point.clone().addScaledVector(t.right, side * lat);
        if (env.tooClose(p.x, p.z, Math.min(lat - 3, 14))) continue;
        push(chunks[ci].markers, markerGeo(k), facing(t, side, lat, env.lift(t, side, lat)));
      }
    }
  }

  // ---- assemble -----------------------------------------------------------
  for (let i = 0; i < CH; i++) {
    const g = env.chunkGroups[i];
    for (const key of ['armco', 'tec', 'tyre', 'post']) {
      const im = chunks[i][key].build({ castShadow: key === 'tec' || key === 'tyre' });
      if (im) g.add(im);
    }
    const fg = merge(chunks[i].fence, true);
    if (fg) { const m = new THREE.Mesh(fg, fenceMat); m.name = 'catchFence'; g.add(m); }
    const bg = merge(chunks[i].boards, true);
    if (bg) { const m = new THREE.Mesh(bg, advMat); m.name = 'hoardings'; g.add(m); }
    const mg = merge(chunks[i].markers, true);
    if (mg) { const m = new THREE.Mesh(mg, markMat); m.name = 'brakeBoards'; g.add(m); }
  }
  const ml = marshalLit.build({}); if (ml) env.group.add(ml);
  const mgl = marshalGlow.build({}); if (mgl) env.group.add(mgl);

  return counts;
}

/* ------------------------------------------------------- pedestrian bridge */

export function buildBridges(env, list) {
  const { track } = env;
  const lit = [], glow = [];
  const at = (arr, g, m) => arr.push(g.applyMatrix4(m));
  for (const spec of list) {
    const t = track.sampleS(spec.s);
    const m = facing(t, -1, 0, 0);
    const span = env.barrierLat(spec.s, 1) + 7;
    const drop = env.lift(t, 1, span) - 0.2;
    const H = 9.0;
    at(lit, tint(box(span * 2, 0.6, 4.4, [0, H, 0]), 0x6a6e74), m.clone());
    at(lit, tint(box(span * 2, 1.5, 0.25, [0, H + 1.05, 2.1]), 0x2c2f34), m.clone());
    at(lit, tint(box(span * 2, 1.5, 0.25, [0, H + 1.05, -2.1]), 0x2c2f34), m.clone());
    at(lit, tint(box(span * 2, 0.35, 5.2, [0, H + 3.3, 0]), 0x53575d), m.clone());
    at(glow, tint(box(span * 1.9, 0.14, 0.16, [0, H + 3.0, 1.9]), [2.4, 2.2, 1.7]), m.clone());
    at(glow, tint(box(span * 1.9, 0.14, 0.16, [0, H + 3.0, -1.9]), [2.4, 2.2, 1.7]), m.clone());
    at(glow, tint(box(span * 1.9, 0.10, 0.10, [0, H - 0.36, 0]), [1.4, 1.6, 2.2]), m.clone());
    for (let k = 0; k < 12; k++) {
      const x = -span + 0.8 + k * (span * 2 - 1.6) / 11;
      at(lit, tint(strut([x, H + 0.3, 2.1], [x, H + 3.1, 2.1], 0.12), 0x81868d), m.clone());
      at(lit, tint(strut([x, H + 0.3, -2.1], [x, H + 3.1, -2.1], 0.12), 0x81868d), m.clone());
    }
    for (const sx of [-1, 1]) {
      const hh = H + 1.4 - drop;
      at(lit, tint(box(6.2, hh, 6.2, [sx * (span + 3.6), drop + hh / 2, 0]), 0x8c8981), m.clone());
      for (let k = 0; k < 5; k++) {
        at(glow, tint(box(4.2, 0.35, 0.10, [sx * (span + 3.6), drop + 1.9 + k * 1.6, 3.15]),
          [2.0, 1.7, 1.1]), m.clone());
      }
    }
  }
  const g1 = merge(lit), g2 = merge(glow);
  if (g1) env.group.add(new THREE.Mesh(g1, litMat({ roughness: 0.8 })));
  if (g2) env.group.add(new THREE.Mesh(g2, glowMat()));
}
