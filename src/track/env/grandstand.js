/**
 * Grandstands + crowd. Owner: ENVIRONMENT.
 * A stand is built from repeated 23 m structural bays (instanced), each with
 * raked tiering, a cantilevered roof on visible trusses, rear columns, stair
 * towers and floodlit soffits. The crowd is instanced silhouette cards with
 * per-spectator colour, sitting on the actual tier positions.
 */
import * as THREE from 'three';
import {
  box, strut, tint, merge, litMat, glowMat, Batch, facing, rr, lerp,
} from './util.js';
import { crowdAtlas, glowSprite, faciaTexture } from './textures.js';

const CONCRETE = 0x8d8a83;
const DARKSTEEL = 0x4a4d54;
const ROOF = 0x6f7379;

const BAY_W = 23;          // metres along the track
const ROWS = 18;
const RISE = 0.52;
const TREAD = 0.95;
const DECK_Y = 2.4;        // first row height above ground
const DECK_Z = -2.6;       // first row depth behind the front edge

export const tierY = (i) => DECK_Y + i * RISE;
export const tierZ = (i) => DECK_Z - i * TREAD;

const SEAT_PAL = [
  [0.36, 0.09, 0.12], [0.42, 0.11, 0.13], [0.30, 0.07, 0.10],
  [0.20, 0.22, 0.26], [0.44, 0.16, 0.09],
];

/** One structural bay. Local: +X along the track, +Y up, +Z toward the racing line. */
function bayKit(o) {
  const lit = [], glow = [];
  const W = BAY_W, half = W / 2;
  const backZ = tierZ(ROWS - 1) - 2.2;
  const topY = tierY(ROWS - 1);

  // ---- tiering -----------------------------------------------------------
  for (let i = 0; i < ROWS; i++) {
    const y = tierY(i), z = tierZ(i);
    lit.push(tint(box(W, 0.14, TREAD, [0, y, z]), 0x76736c));                    // tread
    const seat = SEAT_PAL[(i + o.seatPhase) % SEAT_PAL.length];
    lit.push(tint(box(W, RISE, 0.14, [0, y + RISE / 2, z - TREAD / 2]), seat));  // riser = seat backs
  }
  // raked soffit under the tiers
  const rake = Math.atan2(tierY(ROWS - 1) - DECK_Y, -(tierZ(ROWS - 1) - DECK_Z));
  const rakeLen = Math.hypot(tierY(ROWS - 1) - DECK_Y, tierZ(ROWS - 1) - DECK_Z);
  lit.push(tint(box(W, 0.35, rakeLen, [0, (DECK_Y + topY) / 2 - 0.5,
    (DECK_Z + tierZ(ROWS - 1)) / 2], [-rake, 0, 0]), 0x53565c));

  // ---- front wall / vomitory ---------------------------------------------
  lit.push(tint(box(W, DECK_Y + 0.4, 0.5, [0, (DECK_Y + 0.4) / 2, DECK_Z + 0.9]), CONCRETE, 0.8));
  lit.push(tint(box(W, 0.30, 1.4, [0, DECK_Y + 0.5, DECK_Z + 0.6]), 0x2a2c31));  // front rail
  for (let i = 0; i < 8; i++) {
    lit.push(tint(box(0.07, 1.0, 0.07, [-half + 1.4 + i * (W - 2.8) / 7, DECK_Y + 0.05, DECK_Z + 0.6]), 0x9aa0a8));
  }

  // ---- support columns ---------------------------------------------------
  for (let k = 0; k < 3; k++) {
    const x = (k - 1) * (W / 3);
    lit.push(tint(box(0.7, DECK_Y + 3.5, 0.7, [x, (DECK_Y + 3.5) / 2, DECK_Z - 4]), CONCRETE, 0.7));
    lit.push(tint(box(0.7, topY - 3, 0.7, [x, (topY - 3) / 2, backZ + 1.2]), CONCRETE, 0.7));
  }

  // ---- roof --------------------------------------------------------------
  const rfFront = 3.0, rfBack = backZ - 2.5;
  const rfYf = topY + 4.2, rfYb = topY + 8.4;
  const rlen = Math.hypot(rfYb - rfYf, rfBack - rfFront);
  const rang = Math.atan2(rfYb - rfYf, rfFront - rfBack);
  lit.push(tint(box(W, 0.42, rlen, [0, (rfYf + rfYb) / 2, (rfFront + rfBack) / 2], [rang, 0, 0]), ROOF, 0.85));
  // fascia along the front lip
  lit.push(tint(box(W, 1.1, 0.35, [0, rfYf - 0.4, rfFront]), 0x2f3238));
  glow.push(tint(box(W * 0.94, 0.18, 0.12, [0, rfYf - 0.95, rfFront - 0.05]), [1.6, 1.75, 2.4]));

  // trusses
  for (let k = 0; k < 4; k++) {
    const x = -half + 2.5 + k * (W - 5) / 3;
    lit.push(tint(strut([x, rfYf - 0.3, rfFront], [x, rfYb - 0.3, rfBack], 0.16), DARKSTEEL));
    lit.push(tint(strut([x, rfYf - 2.1, rfFront + 0.4], [x, rfYb - 2.0, rfBack], 0.14), DARKSTEEL));
    for (let d = 0; d < 6; d++) {
      const t0 = d / 6, t1 = (d + 1) / 6;
      const z0 = lerp(rfFront, rfBack, t0), z1 = lerp(rfFront, rfBack, t1);
      const y0 = lerp(rfYf, rfYb, t0), y1 = lerp(rfYf, rfYb, t1);
      lit.push(tint(strut([x, y0 - 0.35, z0], [x, y1 - 2.0, z1], 0.09), DARKSTEEL, 0.9));
    }
  }
  // rear columns holding the roof
  for (let k = 0; k < 3; k++) {
    const x = (k - 1) * (W / 3);
    lit.push(tint(box(0.55, rfYb, 0.55, [x, rfYb / 2, rfBack + 0.6]), DARKSTEEL, 0.8));
  }
  // raking front props off the top of the tiers
  lit.push(tint(strut([-half + 3, topY, tierZ(ROWS - 1)], [-half + 3, rfYf - 0.6, rfFront - 1.5], 0.22), DARKSTEEL));
  lit.push(tint(strut([half - 3, topY, tierZ(ROWS - 1)], [half - 3, rfYf - 0.6, rfFront - 1.5], 0.22), DARKSTEEL));

  // ---- soffit lighting: the thing that makes a night grandstand read ------
  for (let k = 0; k < 5; k++) {
    const t = (k + 0.5) / 5;
    const z = lerp(rfFront - 1.0, rfBack + 1.5, t);
    const y = lerp(rfYf, rfYb, t) - 0.45;
    glow.push(tint(box(W * 0.8, 0.10, 0.34, [0, y, z]), [1.5, 1.5, 1.55]));
  }
  // back-of-house strip lights
  glow.push(tint(box(W * 0.9, 0.12, 0.10, [0, 2.6, backZ + 0.4]), [1.4, 1.1, 0.65]));

  // ---- lit banner across the roof lip: the stand's face from the track ----
  const banner = new THREE.PlaneGeometry(W * 0.98, 1.5);
  banner.translate(0, rfYf - 0.42, rfFront + 0.2);
  const bu = banner.attributes.uv;
  const u0 = o.seatPhase / 3;
  for (let i = 0; i < bu.count; i++) bu.setX(i, u0 + bu.getX(i) / 3);
  bu.needsUpdate = true;

  return { lit: merge(lit), glow: merge(glow), banner };
}

/** Stair / circulation tower dropped in between blocks of bays. */
function stairKit() {
  const lit = [], glow = [];
  const H = tierY(ROWS - 1) + 3.0;
  lit.push(tint(box(5.0, H, 6.0, [0, H / 2, tierZ(ROWS - 1) + 1.0]), CONCRETE, 0.72));
  for (let i = 0; i < 6; i++) {
    const y = 1.6 + i * (H - 2.4) / 6;
    glow.push(tint(box(3.4, 0.5, 0.12, [0, y, tierZ(ROWS - 1) + 4.05]), [1.35, 1.15, 0.72]));
    lit.push(tint(box(4.4, 0.16, 0.5, [0, y - 0.45, tierZ(ROWS - 1) + 4.0]), 0x3a3d42));
  }
  glow.push(tint(box(4.2, 0.7, 0.12, [0, H - 1.2, tierZ(ROWS - 1) + 4.05]), [1.9, 1.6, 0.9]));
  return { lit: merge(lit), glow: merge(glow) };
}

/* ------------------------------------------------------------------ crowd */

function crowdGeoms() {
  const out = [];
  for (let i = 0; i < 4; i++) {
    const g = new THREE.PlaneGeometry(0.66, 1.30);
    g.translate(0, 0.65, 0);
    const uv = g.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setX(k, (uv.getX(k) + i) / 4);
    uv.needsUpdate = true;
    out.push(g);
  }
  return out;
}

/* ------------------------------------------------------------------ build */

/**
 * @param {object} env  { track, rng, group, tooClose, runoffAt }
 * @param {Array}  specs  [{ s0, len, side, lateral, rowsScale, density }]
 */
export function buildGrandstands(env, specs) {
  const { track, rng } = env;
  const bays = [];
  for (let ph = 0; ph < 3; ph++) bays.push(bayKit({ seatPhase: ph }));
  const stair = stairKit();

  const structMat = litMat({ roughness: 0.88, metalness: 0.06 });
  const emitMat = glowMat();
  const facia = faciaTexture();
  const bannerMat = new THREE.MeshStandardMaterial({
    map: facia, emissiveMap: facia, emissive: 0xffffff, emissiveIntensity: 0.9,
    roughness: 0.8, side: THREE.DoubleSide,
  });
  const bLit = bays.map((b, i) => new Batch(b.lit, structMat, 'stand' + i));
  const bGlow = bays.map((b, i) => new Batch(b.glow, emitMat, 'standGlow' + i));
  const bBan = bays.map((b, i) => new Batch(b.banner, bannerMat, 'standBanner' + i));
  const sLit = new Batch(stair.lit, structMat, 'stair');
  const sGlow = new Batch(stair.glow, emitMat, 'stairGlow');

  const crowdMat = new THREE.MeshBasicMaterial({
    map: crowdAtlas(), alphaTest: 0.42, side: THREE.DoubleSide, fog: true,
    color: 0xffffff, toneMapped: true,
  });
  const cg = crowdGeoms();
  const crowd = cg.map((g, i) => new Batch(g, crowdMat, 'crowd' + i));

  const flashPos = [];
  const seatVec = new THREE.Vector3();
  const mtmp = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const col = new THREE.Color();
  let people = 0;
  const PEOPLE_CAP = 15500;

  for (const spec of specs) {
    const n = Math.max(1, Math.round(spec.len / BAY_W));
    for (let i = 0; i < n; i++) {
      const s = spec.s0 + (i + 0.5) * (spec.len / n);
      const t = track.sampleS(s);
      const lat = spec.lateralOf ? spec.lateralOf(s) : (t.halfWidth + 26);
      const p = t.point.clone().addScaledVector(t.right, spec.side * (lat + 14));
      if (env.tooClose(p.x, p.z, 42)) continue;

      const lift = env.lift(t, spec.side, lat);
      const m = facing(t, spec.side, lat, lift);
      const ph = ((i + (spec.phase | 0)) % 3 + 3) % 3;
      bLit[ph].add(m); bGlow[ph].add(m); bBan[ph].add(m);
      if (i % 3 === 1) {
        const sm = facing(t, spec.side, lat + 4.5, env.lift(t, spec.side, lat + 4.5));
        sLit.add(sm); sGlow.add(sm);
      }

      // ---- populate the tiers
      const dens = spec.density ?? 0.86;
      const spacing = 0.72;
      const perRow = Math.floor((BAY_W - 1.6) / spacing);
      for (let row = 0; row < ROWS; row++) {
        if (people >= PEOPLE_CAP) break;
        const y = tierY(row) + 0.16, z = tierZ(row) + 0.12;
        for (let k = 0; k < perRow; k++) {
          if (rng() > dens) continue;
          if (people >= PEOPLE_CAP) break;
          const lx = -BAY_W / 2 + 0.8 + k * spacing + rr(rng, -0.08, 0.08);
          const h = rr(rng, 0.88, 1.08);
          q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rr(rng, -0.30, 0.30));
          sc.set(h, h, h);
          seatVec.set(lx, y, z + rr(rng, -0.10, 0.10));
          mtmp.compose(seatVec, q, sc);
          mtmp.premultiply(m);
          const variant = rng() < 0.55 ? 1 : (rng() < 0.75 ? 0 : (rng() < 0.6 ? 2 : 3));
          const v = rr(rng, 0.26, 0.72);
          const hue = rng();
          col.setRGB(v * (0.85 + hue * 0.3), v * (0.86 + (1 - hue) * 0.22), v * (0.9 + hue * 0.15));
          if (rng() < 0.05) col.setRGB(v * 1.5, v * 0.9, v * 0.55);   // a scatter of team colours
          crowd[variant].add(mtmp, col.clone());
          people++;
          if (rng() < 0.012) {
            const wp = new THREE.Vector3(lx, y + 1.1, z).applyMatrix4(m);
            flashPos.push(wp.x, wp.y, wp.z);
          }
        }
      }
    }
  }

  for (const b of [...bLit, ...bGlow, ...bBan, sLit, sGlow, ...crowd]) {
    const im = b.build({});
    if (im) { im.frustumCulled = true; env.group.add(im); }
  }

  // ---- camera flashes in the crowd ---------------------------------------
  let flashes = null;
  if (flashPos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(flashPos, 3));
    const alpha = new Float32Array(flashPos.length / 3);
    g.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { map: { value: glowSprite('rgba(255,255,255,1)', 'rgba(220,232,255,0.5)') }, pr: { value: Math.min(devicePixelRatio || 1, 2) } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute float alpha; varying float vA; uniform float pr;
        void main(){ vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = clamp(2.2 * pr * 260.0 / max(-mv.z,1.0), 1.0, 40.0);
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying float vA;
        void main(){ if (vA <= 0.001) discard; vec4 t = texture2D(map, gl_PointCoord);
          gl_FragColor = vec4(t.rgb * 2.2, 1.0) * t.a * vA; }`,
    });
    flashes = new THREE.Points(g, m);
    flashes.name = 'crowdFlashes';
    flashes.frustumCulled = false;
    flashes.renderOrder = 5;
    env.group.add(flashes);
  }

  return { people, flashes };
}
