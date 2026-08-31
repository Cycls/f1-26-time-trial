/**
 * Pit complex, paddock and the Sakhir Tower. Owner: ENVIRONMENT.
 * These are one-off structures rather than repeated dressing, so each is merged
 * into a handful of world-space geometries (1-4 draw calls per structure)
 * instead of being instanced.
 */
import * as THREE from 'three';
import {
  box, cyl, strut, quad, tint, merge, litMat, glowMat, facing, rr, lerp,
} from './util.js';
import { windowTexture, faciaTexture, sponsorAtlas } from './textures.js';

const CONCRETE = 0x8f8c85;
const PANEL = 0xb4b6ba;          // building cladding
const STEEL = 0x767a80;

/** Apply a matrix and collect. */
const at = (arr, g, m) => { arr.push(m ? g.applyMatrix4(m) : g); };

/**
 * Textured ribbon that follows the circuit: banners, facias, pit lane surface.
 * yA/yB are heights ABOVE the local ground, so the ribbon drapes over the verge.
 */
function ribbon(env, s0, s1, side, latA, latB, yA, yB, uRepeat, step = 12) {
  const track = env.track;
  const pos = [], uv = [], idx = [], nrm = [];
  const n = Math.max(2, Math.ceil((s1 - s0) / step));
  for (let i = 0; i <= n; i++) {
    const s = s0 + (s1 - s0) * (i / n);
    const t = track.sampleS(s);
    const u = (i / n) * uRepeat;
    const pA = t.point.clone().addScaledVector(t.right, side * latA);
    pA.y += yA + env.lift(t, side, latA);
    const pB = t.point.clone().addScaledVector(t.right, side * latB);
    pB.y += yB + env.lift(t, side, latB);
    pos.push(pA.x, pA.y, pA.z, pB.x, pB.y, pB.z);
    uv.push(u, 0, u, 1);
    nrm.push(0, 1, 0, 0, 1, 0);
  }
  for (let i = 0; i < n; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ------------------------------------------------------------ pit building */

function pitBuilding(env, o) {
  const { track } = env;
  const lit = [], glow = [], win = [];
  const BAY = 13.0;
  const n = o.bays;
  const H1 = 5.2, H2 = 10.6, H3 = 13.4;

  for (let i = 0; i < n; i++) {
    const s = o.s0 + (i + 0.5) * BAY;
    const t = track.sampleS(s);
    const m = facing(t, o.side, o.lat, env.lift(t, o.side, o.lat));

    // garage box: back wall, side walls, ceiling
    at(lit, tint(box(BAY, H1, 0.5, [0, H1 / 2, -8.0]), 0x2f3238), m.clone());
    at(lit, tint(box(0.9, H1, 8.2, [-BAY / 2, H1 / 2, -4.0]), CONCRETE, 0.8), m.clone());
    at(lit, tint(box(BAY, 0.7, 8.4, [0, H1 + 0.3, -4.0]), CONCRETE, 0.75), m.clone());
    at(lit, tint(box(BAY - 1.2, 0.1, 8.2, [0, 0.06, -4.0]), 0x9c9a94), m.clone());       // garage floor
    // lit interior: back wall wash + ceiling strips
    at(glow, tint(quad(BAY - 2.4, H1 - 1.4, [0, H1 / 2 - 0.3, -7.7]), [1.25, 1.22, 1.15]), m.clone());
    at(glow, tint(box(BAY - 3.5, 0.10, 0.5, [0, H1 - 0.35, -5.6]), [2.4, 2.4, 2.5]), m.clone());
    at(glow, tint(box(BAY - 3.5, 0.10, 0.5, [0, H1 - 0.35, -2.2]), [2.4, 2.4, 2.5]), m.clone());
    // team number panel over the door
    at(glow, tint(box(2.2, 0.5, 0.12, [0, H1 + 0.9, 0.28]), i % 2 ? [1.7, 0.4, 0.35] : [0.4, 1.0, 1.7]), m.clone());

    // first floor + glazing
    at(lit, tint(box(BAY, H2 - H1 - 0.6, 9.0, [0, (H1 + H2) / 2, -4.2]), PANEL, 0.72), m.clone());
    const wq = quad(BAY - 1.0, 2.5, [0, H1 + 2.4, 0.32]);
    at(win, wq, m.clone());
    // roof terrace
    at(lit, tint(box(BAY, 0.4, 9.4, [0, H2, -4.2]), 0x5c5f65), m.clone());
    at(lit, tint(box(BAY, 0.9, 0.18, [0, H2 + 0.5, 0.42]), 0x2e3136), m.clone());
    for (let k = 0; k < 7; k++) {
      at(lit, tint(box(0.06, 0.9, 0.06, [-BAY / 2 + 1 + k * (BAY - 2) / 6, H2 + 0.5, 0.42]), 0x9aa0a8), m.clone());
    }
    // upper technical block, set back
    at(lit, tint(box(BAY, H3 - H2, 5.0, [0, (H2 + H3) / 2, -6.4]), PANEL, 0.62), m.clone());
    at(glow, tint(box(BAY * 0.8, 0.12, 0.12, [0, H2 + 0.35, -4.0]), [1.3, 1.15, 0.8]), m.clone());
    // pillar between garages
    at(lit, tint(box(0.9, H1 + 0.6, 1.0, [BAY / 2, (H1 + 0.6) / 2, 0.1]), CONCRETE, 0.85), m.clone());
  }

  // continuous lit facia band along the front of the building
  const fac = ribbon(env, o.s0, o.s0 + n * BAY, o.side, o.lat - 0.5, o.lat - 0.5,
    H3 + 0.1, H3 + 2.6, n * 0.5, 9);
  const facMesh = new THREE.Mesh(fac, new THREE.MeshBasicMaterial({
    map: faciaTexture(), side: THREE.DoubleSide, fog: true, toneMapped: true,
  }));
  facMesh.name = 'pitFacia';

  // pit lane surface + white line
  const laneG = ribbon(env, o.s0 - 40, o.s0 + n * BAY + 60, o.side, o.lat - 1.0, o.lat - 17.0, 0.10, 0.06, 1, 10);
  const lane = new THREE.Mesh(laneG, new THREE.MeshStandardMaterial({
    color: 0x3a3c40, roughness: 0.95, metalness: 0,
  }));
  lane.name = 'pitLane';
  lane.receiveShadow = true;
  const lineG = ribbon(env, o.s0 - 40, o.s0 + n * BAY + 60, o.side, o.lat - 17.0, o.lat - 17.25, 0.12, 0.12, 1, 10);
  const line = new THREE.Mesh(lineG, new THREE.MeshStandardMaterial({ color: 0xdadada, roughness: 0.9 }));

  // pit wall + team gantry
  const wallLit = [], wallGlow = [];
  const wS = o.s0 - 20, wE = o.s0 + n * BAY + 30;
  for (let s = wS; s < wE; s += 6) {
    const t = track.sampleS(s);
    const m = facing(t, o.side, o.lat - 19.5, env.lift(t, o.side, o.lat - 19.5));
    at(wallLit, tint(box(6.0, 1.05, 0.45, [0, 0.55, 0]), 0xd6d8da), m.clone());
    at(wallLit, tint(box(6.0, 0.16, 0.55, [0, 1.12, 0]), 0xc03a2a), m.clone());
  }
  // pit-wall stand: raised team boxes with monitors
  for (let k = 0; k < 6; k++) {
    const s = o.s0 + 40 + k * 26;
    const t = track.sampleS(s);
    const m = facing(t, o.side, o.lat - 22.5, env.lift(t, o.side, o.lat - 22.5));
    at(wallLit, tint(box(9.0, 0.4, 3.4, [0, 2.3, 0]), 0x3c4046), m.clone());
    at(wallLit, tint(box(9.0, 2.3, 0.3, [0, 1.15, -1.6]), 0x24272c), m.clone());
    at(wallLit, tint(box(0.4, 2.2, 0.4, [-4.2, 1.1, 1.4]), STEEL), m.clone());
    at(wallLit, tint(box(0.4, 2.2, 0.4, [4.2, 1.1, 1.4]), STEEL), m.clone());
    at(wallLit, tint(box(9.2, 1.4, 0.25, [0, 3.3, 1.5]), 0x1b1e22), m.clone());
    for (let j = 0; j < 5; j++) {
      at(wallGlow, tint(quad(1.35, 0.85, [-3.6 + j * 1.8, 3.35, 1.63]), [0.9, 1.15, 1.7]), m.clone());
    }
    at(wallGlow, tint(box(8.4, 0.10, 0.10, [0, 2.55, 1.5]), [1.5, 1.35, 0.9]), m.clone());
  }

  return {
    lit: merge([...lit, ...wallLit]),
    glow: merge([...glow, ...wallGlow]),
    win: merge(win, true),
    facia: facMesh, lane, line,
  };
}

/* ----------------------------------------------------------- Sakhir Tower */

function sakhirTower() {
  const lit = [], glow = [], win = [];
  // podium
  lit.push(tint(box(26, 5.5, 20, [0, 2.75, 0]), CONCRETE, 0.82));
  lit.push(tint(box(28, 0.6, 22, [0, 5.6, 0]), 0x5d6066));
  glow.push(tint(box(25, 0.16, 0.16, [0, 5.05, 10.1]), [1.5, 1.3, 0.85]));
  win.push(quad(24, 3.0, [0, 3.0, 10.05]));

  // shaft: two tapering slabs with a glazed slot between them
  const H = 44;
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const y0 = 5.5 + i * (H - 5.5) / 6, y1 = 5.5 + (i + 1) * (H - 5.5) / 6;
      const w0 = lerp(5.6, 3.9, i / 6), w1 = lerp(5.6, 3.9, (i + 1) / 6);
      const d0 = lerp(11.0, 8.6, i / 6);
      lit.push(tint(box((w0 + w1) / 2, y1 - y0, d0, [sx * 5.2, (y0 + y1) / 2, 0]), PANEL, 0.66));
    }
    // vertical accent light strips up both slabs
    glow.push(tint(box(0.30, H - 7, 0.20, [sx * 7.8, (5.5 + H) / 2, 4.4]), [0.55, 0.95, 1.7]));
    glow.push(tint(box(0.30, H - 7, 0.20, [sx * 7.8, (5.5 + H) / 2, -4.4]), [0.55, 0.95, 1.7]));
  }
  // glazed core between the slabs
  win.push(quad(6.6, H - 7.0, [0, (5.5 + H) / 2, 4.5]));
  win.push(quad(6.6, H - 7.0, [0, (5.5 + H) / 2, -4.5], [0, Math.PI, 0]));
  lit.push(tint(box(6.6, H - 6.5, 8.6, [0, (5.5 + H) / 2, 0]), 0x23262b));

  // head: cantilevered VIP floors
  const HY = H + 0.5;
  for (let f = 0; f < 4; f++) {
    const y = HY + f * 3.6;
    lit.push(tint(box(19 - f * 0.6, 0.55, 15 - f * 0.5, [0, y, 0]), 0x5f6268));
    win.push(quad(18 - f * 0.6, 2.5, [0, y + 1.75, 7.4 - f * 0.25]));
    win.push(quad(18 - f * 0.6, 2.5, [0, y + 1.75, -(7.4 - f * 0.25)], [0, Math.PI, 0]));
    win.push(quad(14 - f * 0.5, 2.5, [9.4 - f * 0.3, y + 1.75, 0], [0, Math.PI / 2, 0]));
    win.push(quad(14 - f * 0.5, 2.5, [-(9.4 - f * 0.3), y + 1.75, 0], [0, -Math.PI / 2, 0]));
    // vertical fins
    for (let k = 0; k < 9; k++) {
      const x = -8.5 + k * 2.1;
      lit.push(tint(box(0.22, 3.3, 0.5, [x, y + 1.8, 7.6 - f * 0.25]), 0x8f9298));
    }
  }
  // roof + crown
  const RY = HY + 4 * 3.6;
  lit.push(tint(box(18, 0.7, 14, [0, RY, 0]), 0x4c4f55));
  glow.push(tint(box(17.2, 0.20, 0.24, [0, RY + 0.55, 6.9]), [1.7, 1.5, 1.0]));
  glow.push(tint(box(17.2, 0.20, 0.24, [0, RY + 0.55, -6.9]), [1.7, 1.5, 1.0]));
  for (let i = 0; i < 4; i++) {
    const y0 = RY + 0.7 + i * 3.2, y1 = y0 + 3.2;
    const r0 = lerp(2.6, 0.5, i / 4), r1 = lerp(2.6, 0.5, (i + 1) / 4);
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
      lit.push(tint(strut([sx * r0, y0, sz * r0], [sx * r1, y1, sz * r1], 0.16), STEEL));
      lit.push(tint(strut([sx * r1, y1, sz * r1], [-sz * r1, y1, sx * r1], 0.10), STEEL, 0.8));
    }
  }
  glow.push(tint(box(0.5, 0.5, 0.5, [0, RY + 14.2, 0]), [5.0, 0.6, 0.5]));
  glow.push(tint(box(1.0, 0.22, 1.0, [0, RY + 1.2, 0]), [1.4, 1.4, 1.6]));

  return { lit: merge(lit), glow: merge(glow), win: merge(win, true) };
}

/* ---------------------------------------------------------- start gantry */

function startGantry(env, s, o = {}) {
  const { track } = env;
  const t = track.sampleS(s);
  const lit = [], glow = [], adv = [];
  const span = t.halfWidth + 4.0;
  const H = o.height ?? 9.4;
  const m = facing(t, -1, 0, env.lift(t, -1, 0));   // straddles the track, local X along it

  // towers
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const y0 = i * H / 4, y1 = (i + 1) * H / 4;
      const r0 = lerp(0.85, 0.5, i / 4), r1 = lerp(0.85, 0.5, (i + 1) / 4);
      for (const [ax, az] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
        at(lit, tint(strut([sx * span + ax * r0, y0, az * r0], [sx * span + ax * r1, y1, az * r1], 0.13), STEEL), m.clone());
        at(lit, tint(strut([sx * span + ax * r1, y1, az * r1], [sx * span - az * r1, y1, ax * r1], 0.09), STEEL, 0.8), m.clone());
      }
    }
    at(lit, tint(box(2.4, 0.7, 2.4, [sx * span, 0.35, 0]), 0x6d6a63), m.clone());
  }
  // main beam
  at(lit, tint(box(span * 2, 1.5, 1.4, [0, H + 0.4, 0]), 0x3f4349), m.clone());
  at(lit, tint(box(span * 2, 0.35, 1.8, [0, H + 1.25, 0]), STEEL, 0.8), m.clone());
  for (let k = 0; k < 14; k++) {
    const x = -span + 0.6 + k * (span * 2 - 1.2) / 13;
    at(lit, tint(strut([x, H - 0.4, 0.7], [x + 1.4, H + 0.35, -0.7], 0.08), STEEL, 0.7), m.clone());
  }

  if (o.startLights !== false) {
    // 5 pairs of red start lights hanging under the beam
    for (let k = 0; k < 5; k++) {
      const x = (k - 2) * 3.2;
      at(lit, tint(box(2.4, 2.0, 0.5, [x, H - 1.2, 0.4]), 0x121417), m.clone());
      for (const sy of [0, 1]) {
        for (const sx2 of [-0.55, 0.55]) {
          at(glow, tint(cyl(0.34, 0.34, 0.12, 10, [x + sx2, H - 0.75 - sy * 0.9, 0.68], [Math.PI / 2, 0, 0]),
            [2.6, 0.16, 0.12]), m.clone());
        }
      }
    }
    // big screen on the beam
    at(lit, tint(box(9.0, 5.2, 0.6, [-span + 7.0, H + 4.6, -0.6]), 0x15181c), m.clone());
  }
  // sponsor banner across the beam face
  const banner = quad(span * 2 - 1, 2.0, [0, H + 2.6, 0.1]);
  const uvb = banner.attributes.uv;
  for (let i = 0; i < uvb.count; i++) uvb.setXY(i, (uvb.getX(i) * 1 + 1) / 4, uvb.getY(i) / 2 + 0.5);
  uvb.needsUpdate = true;
  at(adv, banner, m.clone());

  return { lit: merge(lit), glow: merge(glow), adv: merge(adv, true) };
}

/* ------------------------------------------------------------ paddock ---- */

function paddock(env, o) {
  const { track, rng } = env;
  const lit = [], glow = [], win = [];
  for (let i = 0; i < o.count; i++) {
    const s = o.s0 + (i / o.count) * o.len;
    const t = track.sampleS(s);
    const lat = o.lat + ((i % 3) - 1) * 24;
    const p = t.point.clone().addScaledVector(t.right, o.side * lat);
    if (env.tooClose(p.x, p.z, 80)) continue;
    const m = facing(t, o.side, lat, env.lift(t, o.side, lat), rr(rng, -0.15, 0.15));
    const w = rr(rng, 14, 24), h = rr(rng, 6, 12), d = rr(rng, 12, 20);
    at(lit, tint(box(w, h, d, [0, h / 2, 0]), i % 3 ? 0xc9cbcd : 0x9aa0a6, 0.8), m.clone());
    at(lit, tint(box(w + 0.8, 0.5, d + 0.8, [0, h + 0.2, 0]), 0x5d6066), m.clone());
    at(win, quad(w - 2, h * 0.34, [0, h * 0.62, d / 2 + 0.06]), m.clone());
    at(glow, tint(box(w * 0.7, 0.12, 0.12, [0, h * 0.30, d / 2 + 0.08]), [1.3, 1.1, 0.7]), m.clone());
  }
  return { lit: merge(lit), glow: merge(glow), win: merge(win, true) };
}

/* --------------------------------------------------------------- assemble */

export function buildPitComplex(env, opts) {
  const g = new THREE.Group();
  g.name = 'pitComplex';
  const structMat = litMat({ roughness: 0.8, metalness: 0.1 });
  const emitMat = glowMat();
  const winMat = new THREE.MeshBasicMaterial({
    map: windowTexture(3, 18, 6, true), fog: true, toneMapped: true, side: THREE.DoubleSide,
  });
  const winMatCool = new THREE.MeshBasicMaterial({
    map: windowTexture(9, 14, 4, false), fog: true, toneMapped: true, side: THREE.DoubleSide,
  });
  const advMat = new THREE.MeshStandardMaterial({
    map: sponsorAtlas(), emissiveMap: sponsorAtlas(), emissive: 0xffffff,
    emissiveIntensity: 0.55, roughness: 0.8, side: THREE.DoubleSide,
  });

  const add = (geo, mat, name) => {
    if (!geo) return;
    const m = new THREE.Mesh(geo, mat); m.name = name; g.add(m); return m;
  };

  const pit = pitBuilding(env, opts.pit);
  add(pit.lit, structMat, 'pitLit');
  add(pit.glow, emitMat, 'pitGlow');
  add(pit.win, winMat, 'pitWindows');
  g.add(pit.facia); g.add(pit.lane); g.add(pit.line);

  // Sakhir Tower
  const tw = sakhirTower();
  const tSample = env.track.sampleS(opts.tower.s);
  const tm = facing(tSample, opts.tower.side, opts.tower.lat,
    env.lift(tSample, opts.tower.side, opts.tower.lat), opts.tower.yaw ?? 0);
  const tg = new THREE.Group(); tg.name = 'sakhirTower';
  tg.applyMatrix4(tm);
  if (tw.lit) tg.add(new THREE.Mesh(tw.lit, structMat));
  if (tw.glow) tg.add(new THREE.Mesh(tw.glow, emitMat));
  if (tw.win) tg.add(new THREE.Mesh(tw.win, winMatCool));
  g.add(tg);

  // gantries
  for (const gy of opts.gantries) {
    const gg = startGantry(env, gy.s, gy);
    add(gg.lit, structMat, 'gantryLit');
    add(gg.glow, emitMat, 'gantryGlow');
    add(gg.adv, advMat, 'gantryAdv');
  }

  // paddock buildings + motorhomes
  const pd = paddock(env, opts.paddock);
  add(pd.lit, structMat, 'paddockLit');
  add(pd.glow, emitMat, 'paddockGlow');
  add(pd.win, winMat, 'paddockWindows');

  env.group.add(g);
  return g;
}
