/**
 * The Sakhir desert. Owner: ENVIRONMENT.
 * A single vertex-coloured terrain mesh that carries the track's own elevation
 * near the circuit and rolls into dunes beyond it, plus date palms, scrub,
 * access roads and lit structures out on the horizon.
 *
 * The terrain is deliberately DARK in albedo away from the circuit: RENDER's
 * baked illuminance field supplies the "lit corridor, black desert" falloff and
 * we must not fight it, so the vertex colours only carry surface identity and
 * mottling, with a gentle distance darkening on top.
 */
import * as THREE from 'three';
import {
  box, cyl, quad, tint, merge, litMat, glowMat, Batch,
  makeRng, rr, ri, clamp, smoothstep, lerp,
} from './util.js';
import { sandTexture, palmFrond, windowTexture, glowSprite } from './textures.js';

/* ------------------------------------------------------------------ noise */

function hash2(ix, iy) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
}
function fbm(x, y, oct = 4, lac = 2.07, gain = 0.5) {
  let a = 1, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) { sum += a * vnoise(x * f, y * f); norm += a; a *= gain; f *= lac; }
  return sum / norm;
}

/* --------------------------------------------------------------- terrain */

export function createDesert(env) {
  const field = env.field;

  /**
   * Analytic terrain height.
   *
   * TRACK owns the ground from the white line out to the end of its sand verge
   * (~90 m past the run-off, bottoming at y = -1.6) and a flat sand plane at
   * y = -1.66 beyond that. So this surface is deliberately parked at -1.78 —
   * under both — anywhere near the circuit, and only climbs into dunes once it is
   * far enough out to emerge cleanly from the flat plain. Never blend the two:
   * a terrain that tries to meet the verge pokes through the racing surface.
   */
  function heightAt(x, z) {
    const d = field.distance(x, z);
    const dune =
      fbm(x * 0.0016, z * 0.0016, 4) * 15.5 +
      fbm(x * 0.0075, z * 0.0075, 3) * 2.6 +
      vnoise(x * 0.030, z * 0.030) * 0.55;
    return -1.78 + smoothstep(140, 400, d) * (dune + 1.4);
  }

  function build(opts = {}) {
    const rng = makeRng(20260331);
    const g = new THREE.Group();
    g.name = 'desert';

    // ---- terrain -----------------------------------------------------------
    const SEG = opts.segments ?? 190;
    const SIZE = opts.size ?? 6200;
    const cx = opts.cx ?? 0, cz = opts.cz ?? 0;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    geo.translate(cx, 0, cz);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const uv = geo.attributes.uv;
    const c = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, heightAt(x, z));
      const d = field.distance(x, z);
      // sand albedo: warm close in where the floodlights actually reach, colder
      // and much darker out in the desert
      const mott = 0.78 + 0.34 * fbm(x * 0.011, z * 0.011, 3);
      const near = 1 - smoothstep(150, 620, d);
      const far = 1 - smoothstep(700, 2100, d) * 0.72;
      const gravel = smoothstep(120, 190, d) * (1 - smoothstep(230, 340, d));
      const r0 = lerp(0.28, 0.50, near) * mott * far;
      const g0 = lerp(0.235, 0.40, near) * mott * far;
      const b0 = lerp(0.175, 0.26, near) * mott * far;
      c.setRGB(lerp(r0, r0 * 0.72, gravel), lerp(g0, g0 * 0.74, gravel), lerp(b0, b0 * 0.80, gravel));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      uv.setXY(i, x / 60, z / 60);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    const sand = sandTexture();
    sand.repeat.set(1, 1);
    const terrainMat = new THREE.MeshStandardMaterial({
      vertexColors: true, color: 0xffffff, map: sand,
      roughness: 1.0, metalness: 0.0,
    });
    const terrain = new THREE.Mesh(geo, terrainMat);
    terrain.name = 'desertTerrain';
    terrain.receiveShadow = true;
    g.add(terrain);

    // ---- date palms --------------------------------------------------------
    const trunkParts = [];
    for (let i = 0; i < 5; i++) {
      const y0 = i * 1.5, y1 = y0 + 1.5;
      const bend = Math.pow(i / 5, 1.7) * 0.9;
      trunkParts.push(tint(cyl(0.20 - i * 0.018, 0.24 - i * 0.018, 1.55, 6,
        [bend, (y0 + y1) / 2, 0], [0, 0, -0.10]), 0x5a4a34, 0.9));
    }
    trunkParts.push(tint(cyl(0.34, 0.22, 0.7, 6, [0.95, 7.7, 0]), 0x6a5738));
    const trunkGeo = merge(trunkParts);

    const frondParts = [];
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2 + 0.3;
      const droop = -0.35 - (i % 3) * 0.22;
      const len = 3.1 + (i % 4) * 0.35;
      const q = new THREE.PlaneGeometry(len, 1.0);
      q.translate(len / 2, 0, 0);
      q.rotateZ(droop);
      q.rotateY(a);
      q.translate(0.95, 7.9, 0);
      frondParts.push(q);
    }
    const frondGeo = merge(frondParts, true);

    const trunkMat = litMat({ roughness: 0.95 });
    const frondMat = new THREE.MeshStandardMaterial({
      map: palmFrond(), alphaTest: 0.4, side: THREE.DoubleSide,
      color: 0x6d7f45, roughness: 0.9, metalness: 0,
    });
    const bTrunk = new Batch(trunkGeo, trunkMat, 'palmTrunk');
    const bFrond = new Batch(frondGeo, frondMat, 'palmFronds');

    // scrub
    const scrubGeo = merge([
      tint(new THREE.IcosahedronGeometry(1, 0).scale(1.0, 0.42, 1.0), 0x4c4a2c),
    ]);
    const bScrub = new Batch(scrubGeo, litMat({ roughness: 1 }), 'scrub');

    const m = new THREE.Matrix4();
    const qq = new THREE.Quaternion();
    const sv = new THREE.Vector3();
    const pv = new THREE.Vector3();

    // Vegetation only where ground is actually visible — inside ~135 m TRACK's
    // verge and ground plane own the surface and anything planted there sinks.
    const GROUND = -1.66;
    const R = SIZE * 0.5;
    for (let i = 0; i < 5200; i++) {
      const x = cx + rr(rng, -R, R), z = cz + rr(rng, -R, R);
      const d = field.distance(x, z);
      if (d < 135 || d > 760) continue;
      const y = Math.max(heightAt(x, z), GROUND);
      const near = 1 - smoothstep(160, 560, d);
      if (rng() < 0.10 * near + 0.012) {
        // palm: clusters near the paddock and the access roads
        const s = rr(rng, 0.78, 1.24);
        qq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 6.283);
        sv.set(s, s * rr(rng, 0.9, 1.15), s);
        m.compose(pv.set(x, y - 0.15, z), qq, sv);
        bTrunk.add(m); bFrond.add(m);
      } else if (rng() < 0.42) {
        const s = rr(rng, 0.5, 1.9);
        qq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 6.283);
        sv.set(s, s * rr(rng, 0.5, 1.0), s * rr(rng, 0.8, 1.2));
        m.compose(pv.set(x, y + s * 0.12, z), qq, sv);
        bScrub.add(m);
      }
    }
    for (const b of [bTrunk, bFrond, bScrub]) {
      const im = b.build({});
      if (im) g.add(im);
    }

    // ---- access roads ------------------------------------------------------
    const roadG = [];
    for (let i = 0; i < 7; i++) {
      // start out in the dunes: a road drawn across TRACK's ground plane would
      // z-fight it at distance
      const a = (i / 7) * Math.PI * 2 + 0.6;
      const x0 = cx + Math.cos(a) * 780, z0 = cz + Math.sin(a) * 780;
      const x1 = cx + Math.cos(a + rr(rng, -0.3, 0.3)) * rr(rng, 1500, 2600);
      const z1 = cz + Math.sin(a + rr(rng, -0.3, 0.3)) * rr(rng, 1500, 2600);
      const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
      const nx = -dz / len * 4.5, nz = dx / len * 4.5;
      const N = 26;
      const pts = [], idx = [];
      for (let k = 0; k <= N; k++) {
        const t = k / N;
        const px = lerp(x0, x1, t), pz = lerp(z0, z1, t);
        const wob = Math.sin(t * 4.2) * 26 * t;
        const ox = px + nx / 4.5 * wob, oz = pz + nz / 4.5 * wob;
        pts.push(ox - nx, heightAt(ox - nx, oz - nz) + 0.09, oz - nz,
          ox + nx, heightAt(ox + nx, oz + nz) + 0.09, oz + nz);
      }
      for (let k = 0; k < N; k++) {
        const a0 = k * 2; idx.push(a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2);
      }
      const rg = new THREE.BufferGeometry();
      rg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      rg.setIndex(idx);
      rg.computeVertexNormals();
      roadG.push(tint(rg, 0x2b2a29));
    }
    const roads = merge(roadG);
    if (roads) {
      const rm = new THREE.Mesh(roads, litMat({ roughness: 0.95 }));
      rm.name = 'accessRoads';
      g.add(rm);
    }

    // ---- distant lit structures on the horizon ------------------------------
    const farLit = [], farGlow = [], farWin = [];
    for (let i = 0; i < 46; i++) {
      const a = rng() * 6.283;
      const rad = rr(rng, 1250, 2750);
      const x = cx + Math.cos(a) * rad, z = cz + Math.sin(a) * rad;
      const y = heightAt(x, z);
      const w = rr(rng, 20, 90), h = rr(rng, 8, 34), dep = rr(rng, 18, 70);
      const mm = new THREE.Matrix4().makeRotationY(rng() * 6.283).setPosition(x, y, z);
      farLit.push(tint(box(w, h, dep, [0, h / 2, 0]), 0x2a2823).applyMatrix4(mm));
      farWin.push(quad(w * 0.9, h * 0.5, [0, h * 0.55, dep / 2 + 0.05]).applyMatrix4(mm.clone()));
      if (rng() < 0.5) {
        const th = rr(rng, 20, 55);
        farLit.push(tint(cyl(0.7, 1.6, th, 6, [w * 0.3, th / 2, 0]), 0x2f2c26).applyMatrix4(mm.clone()));
        farGlow.push(tint(box(1.2, 1.2, 1.2, [w * 0.3, th + 0.9, 0]), [3.0, 0.5, 0.4]).applyMatrix4(mm.clone()));
      }
    }
    const fl = merge(farLit); if (fl) g.add(new THREE.Mesh(fl, litMat({ roughness: 1 })));
    const fg = merge(farGlow); if (fg) g.add(new THREE.Mesh(fg, glowMat()));
    const fw = merge(farWin, true);
    if (fw) {
      g.add(new THREE.Mesh(fw, new THREE.MeshBasicMaterial({
        map: windowTexture(21, 26, 5, true), fog: true, toneMapped: true, side: THREE.DoubleSide,
      })));
    }

    // scattered pinpoints of habitation right out on the horizon
    const hp = [], hc = [];
    for (let i = 0; i < 900; i++) {
      const a = rng() * 6.283, rad = rr(rng, 1400, 3000);
      const x = cx + Math.cos(a) * rad, z = cz + Math.sin(a) * rad;
      hp.push(x, heightAt(x, z) + rr(rng, 1, 14), z);
      const warm = rng() < 0.78;
      hc.push(warm ? 1.0 : 0.66, warm ? 0.72 : 0.80, warm ? 0.36 : 1.0);
    }
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.Float32BufferAttribute(hp, 3));
    hg.setAttribute('color', new THREE.Float32BufferAttribute(hc, 3));
    const hm = new THREE.PointsMaterial({
      size: 3.4, sizeAttenuation: true, map: glowSprite('rgba(255,240,215,1)', 'rgba(255,210,150,0.35)'),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexColors: true, fog: false, opacity: 0.85,
    });
    const horizon = new THREE.Points(hg, hm);
    horizon.name = 'horizonLights';
    g.add(horizon);

    env.group.add(g);
    return g;
  }

  return { heightAt, build };
}

/* ------------------------------------------------------------------- stars */

/** Star field. RENDER owns the sky gradient; this is the layer it does not have. */
export function buildStars(env) {
  const rng = makeRng(0xC0FFEE);
  const N = 1700;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), sz = new Float32Array(N);
  const R = 3600;
  for (let i = 0; i < N; i++) {
    // cosine-ish bias to the upper hemisphere, nothing below the horizon
    const u = rng() * 2 - 1, th = rng() * 6.283;
    const y = Math.abs(u) * 0.98 + 0.02;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    pos[i * 3] = Math.cos(th) * r * R;
    pos[i * 3 + 1] = y * R;
    pos[i * 3 + 2] = Math.sin(th) * r * R;
    const b = Math.pow(rng(), 2.6);
    // horizon haze eats the low stars
    const fade = smoothstep(0.02, 0.28, y);
    const t = rng();
    const tintR = t < 0.18 ? 1.0 : t < 0.4 ? 0.86 : 1.0;
    const tintB = t < 0.18 ? 0.72 : t < 0.4 ? 1.0 : 0.97;
    const v = (0.25 + b * 1.5) * fade;
    col[i * 3] = v * tintR; col[i * 3 + 1] = v * 0.95; col[i * 3 + 2] = v * tintB;
    sz[i] = 1.6 + b * 5.5;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('gsize', new THREE.BufferAttribute(sz, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { map: { value: glowSprite('rgba(255,255,255,1)', 'rgba(190,205,255,0.30)') } },
    transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.AdditiveBlending, fog: false,
    vertexShader: `attribute float gsize; attribute vec3 color; varying vec3 vC;
      void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0);
        gl_PointSize = gsize; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D map; varying vec3 vC;
      void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC, 1.0) * t.a; }`,
  });
  const p = new THREE.Points(g, m);
  p.name = 'envStars';
  p.frustumCulled = false;
  p.renderOrder = -900;
  p.matrixAutoUpdate = true;
  env.group.add(p);
  return p;
}
