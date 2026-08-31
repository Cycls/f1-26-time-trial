/**
 * Procedural surface textures for the circuit. Owner: TRACK.
 * Everything here is generated into a canvas at load — no external assets (shared brief rule 5).
 *
 * Bahrain's surface is graywacke aggregate shipped from Bayston Hill, Shropshire: a hard,
 * angular, high-grip stone that reads as a coarse blue-grey speckle over a dark bitumen
 * matrix, not as flat grey. That is what `asphaltSet()` builds — a height field first,
 * then albedo / normal / roughness all derived from the same field so the lighting and
 * the colour agree.
 */
import * as THREE from 'three';

/* ------------------------------------------------------------------ noise */

function hash2i(x, y, seed) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const fade = (t) => t * t * (3 - 2 * t);

/** Tileable value noise on a `period`-cell lattice. */
function valueNoise(x, y, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const w = (a, b) => hash2i(((a % period) + period) % period, ((b % period) + period) % period, seed);
  const a = w(xi, yi), b = w(xi + 1, yi), c = w(xi, yi + 1), d = w(xi + 1, yi + 1);
  const u = fade(xf), v = fade(yf);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** Tileable fBm over a `size`-px tile; `base` lattice cells across the tile. */
function fbm(px, py, size, base, octaves, gain, seed) {
  let amp = 1, sum = 0, norm = 0, f = base;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(px / size * f, py / size * f, f, seed + o * 101);
    norm += amp; amp *= gain; f *= 2;
  }
  return sum / norm;
}

function newCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function toTexture(canvas, { srgb = false, repeat = 1, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = aniso;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Sobel a height field (Float32Array, size x size, wrapping) into an RGB normal map. */
function normalFromHeight(height, size, strength) {
  const c = newCanvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const at = (x, y) => height[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1))
        - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1))
        - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      let nx = -dx * strength, ny = -dy * strength, nz = 1;
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      const i = (y * size + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255; d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/* --------------------------------------------------------------- asphalt */

/**
 * Graywacke race asphalt. Returns { map, normalMap, roughnessMap }, tileable,
 * meant to be sampled in METRES by the road shader (one tile = `metres` across).
 */
export function asphaltSet(size = 512, metres = 2.0) {
  const n = size * size;
  const height = new Float32Array(n);
  const albedo = new Float32Array(n * 3);
  const rough = new Float32Array(n);
  const pxPerM = size / metres;

  // 1. bitumen matrix: fine grain + medium mottle
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const grain = fbm(x, y, size, 64, 3, 0.55, 11);
      const mottle = fbm(x, y, size, 6, 3, 0.6, 29);
      const macro = fbm(x, y, size, 2, 2, 0.6, 71);
      height[i] = grain * 0.32 + mottle * 0.5 + macro * 0.18;
      // dark blue-grey bitumen, drifting a little warmer where the mottle is high
      const v = 0.058 + mottle * 0.052 + macro * 0.028 + grain * 0.030;
      albedo[i * 3] = v * 1.02;
      albedo[i * 3 + 1] = v * 1.00;
      albedo[i * 3 + 2] = v * 1.06;
      rough[i] = 0.90 + grain * 0.08;
    }
  }

  // 2. exposed aggregate: angular graywacke chips, 4-16 mm, proud of the matrix
  const chipArea = 0.55 * metres * metres;          // m^2 of chip per tile
  const count = Math.round(chipArea / (0.010 * 0.010));
  let seed = 1337;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let k = 0; k < count; k++) {
    const cx = rnd() * size, cy = rnd() * size;
    const rM = 0.0022 + rnd() * rnd() * 0.0065;      // 2.2-8.7 mm radius
    const r = Math.max(0.8, rM * pxPerM);
    const ecc = 0.62 + rnd() * 0.7, rot = rnd() * Math.PI;
    const cs = Math.cos(rot), sn = Math.sin(rot);
    // graywacke chips read pale blue-grey; a few are warm/quartzy
    const warm = rnd() < 0.16;
    const lum = 0.16 + rnd() * 0.30;
    const cr = warm ? lum * 1.14 : lum * 0.95;
    const cg = warm ? lum * 1.03 : lum * 0.99;
    const cb = warm ? lum * 0.86 : lum * 1.10;
    const hh = 0.35 + rnd() * 0.55;
    const R = Math.ceil(r * Math.max(1, ecc)) + 1;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const lx = (dx * cs + dy * sn) / r, ly = (-dx * sn + dy * cs) / (r * ecc);
        const q = lx * lx + ly * ly;
        if (q > 1) continue;
        const x = ((Math.round(cx) + dx) % size + size) % size;
        const y = ((Math.round(cy) + dy) % size + size) % size;
        const i = y * size + x;
        const edge = Math.min(1, (1 - q) * 3.2);      // angular, not domed
        const a = edge;
        height[i] = height[i] * (1 - a) + (0.55 + hh * 0.45) * a;
        albedo[i * 3] = albedo[i * 3] * (1 - a) + cr * a;
        albedo[i * 3 + 1] = albedo[i * 3 + 1] * (1 - a) + cg * a;
        albedo[i * 3 + 2] = albedo[i * 3 + 2] * (1 - a) + cb * a;
        rough[i] = rough[i] * (1 - a) + (0.72 + rnd() * 0.16) * a;
      }
    }
  }

  // 3. write out
  const ca = newCanvas(size, size), ctxA = ca.getContext('2d');
  const cr2 = newCanvas(size, size), ctxR = cr2.getContext('2d');
  const ia = ctxA.createImageData(size, size), ir = ctxR.createImageData(size, size);
  let mean = 0;
  for (let i = 0; i < n; i++) mean += (albedo[i * 3] + albedo[i * 3 + 1] + albedo[i * 3 + 2]) / 3;
  mean /= n;
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    // canvas is sRGB; approximate the encode so the albedo lands where we want it
    ia.data[j] = Math.min(255, Math.pow(albedo[i * 3], 1 / 2.2) * 255);
    ia.data[j + 1] = Math.min(255, Math.pow(albedo[i * 3 + 1], 1 / 2.2) * 255);
    ia.data[j + 2] = Math.min(255, Math.pow(albedo[i * 3 + 2], 1 / 2.2) * 255);
    ia.data[j + 3] = 255;
    const rv = Math.max(0, Math.min(1, rough[i])) * 255;
    ir.data[j] = ir.data[j + 1] = ir.data[j + 2] = rv; ir.data[j + 3] = 255;
  }
  ctxA.putImageData(ia, 0, 0); ctxR.putImageData(ir, 0, 0);

  return {
    map: toTexture(ca, { srgb: true }),
    normalMap: toTexture(normalFromHeight(height, size, 2.6)),
    roughnessMap: toTexture(cr2),
    metres,
    // mean LINEAR albedo of the tile, so the shader can cross-fade a second
    // decorrelating sample of itself without darkening the surface
    mean,
  };
}

/* ------------------------------------------------------------------ kerb */

/**
 * Kerb albedo + normal. u runs across the kerb (0 inner .. 1 outer),
 * v runs along the track with ONE stripe per 0.5 m — the texture holds exactly
 * one red + one white stripe, so v is (s / 1.0).
 */
export function kerbSet(size = 256) {
  const w = size, h = size;
  const c = newCanvas(w, h), ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h), d = img.data;
  const height = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const v = y / h;                                   // along track, 1.0 m of kerb
    const white = v < 0.5;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const i = y * w + x;
      const grain = fbm(x, y, size, 48, 3, 0.55, 5);
      const wear = fbm(x, y, size, 5, 3, 0.6, 17);
      // paint, sun-bleached and rubber-streaked toward the inner edge
      let r, g, b;
      if (white) { r = 0.80; g = 0.80; b = 0.79; }
      else { r = 0.66; g = 0.088; b = 0.075; }
      const dirt = Math.max(0, 0.55 - u) * (0.35 + wear * 0.5);   // rubber pickup on the road side
      r *= (1 - dirt * 0.62); g *= (1 - dirt * 0.70); b *= (1 - dirt * 0.68);
      const scuff = wear * 0.20 + grain * 0.12 - 0.10;
      r = Math.max(0.02, r + scuff * 0.28); g = Math.max(0.02, g + scuff * 0.28); b = Math.max(0.02, b + scuff * 0.28);
      // fine corrugation on top of the modelled sawtooth (period 0.1 m)
      height[i] = grain * 0.5 + 0.5 * (0.5 + 0.5 * Math.cos(v * Math.PI * 20)) * 0.5;
      const j = i * 4;
      d[j] = Math.pow(Math.min(1, r), 1 / 2.2) * 255;
      d[j + 1] = Math.pow(Math.min(1, g), 1 / 2.2) * 255;
      d[j + 2] = Math.pow(Math.min(1, b), 1 / 2.2) * 255;
      d[j + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { map: toTexture(c, { srgb: true }), normalMap: toTexture(normalFromHeight(height, size, 1.1)) };
}

/* -------------------------------------------------------- gravel / astro */

export function gravelSet(size = 256, metres = 3.0) {
  const n = size * size;
  const height = new Float32Array(n);
  const c = newCanvas(size, size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size), d = img.data;
  let seed = 99;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = i % size, y = (i / size) | 0;
    const base = fbm(x, y, size, 8, 3, 0.6, 3);
    height[i] = base * 0.35;
    const v = 0.30 + base * 0.14;
    col[i * 3] = v * 1.10; col[i * 3 + 1] = v * 1.02; col[i * 3 + 2] = v * 0.84;
  }
  const pxPerM = size / metres;
  const count = Math.round(1.9 * metres * metres / (0.020 * 0.020));
  for (let k = 0; k < count; k++) {
    const cx = rnd() * size, cy = rnd() * size;
    const r = Math.max(1, (0.008 + rnd() * rnd() * 0.020) * pxPerM);
    const lum = 0.30 + rnd() * 0.34;
    const R = Math.ceil(r) + 1;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const q = (dx * dx + dy * dy) / (r * r); if (q > 1) continue;
      const x = ((Math.round(cx) + dx) % size + size) % size;
      const y = ((Math.round(cy) + dy) % size + size) % size;
      const i = y * size + x, a = Math.min(1, (1 - q) * 2.6);
      height[i] = height[i] * (1 - a) + (0.5 + Math.sqrt(1 - q) * 0.5) * a;
      col[i * 3] = col[i * 3] * (1 - a) + lum * 1.08 * a;
      col[i * 3 + 1] = col[i * 3 + 1] * (1 - a) + lum * 1.00 * a;
      col[i * 3 + 2] = col[i * 3 + 2] * (1 - a) + lum * 0.80 * a;
    }
  }
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    d[j] = Math.pow(Math.min(1, col[i * 3]), 1 / 2.2) * 255;
    d[j + 1] = Math.pow(Math.min(1, col[i * 3 + 1]), 1 / 2.2) * 255;
    d[j + 2] = Math.pow(Math.min(1, col[i * 3 + 2]), 1 / 2.2) * 255;
    d[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return { map: toTexture(c, { srgb: true }), normalMap: toTexture(normalFromHeight(height, size, 3.2)), metres };
}

export function astroSet(size = 128, metres = 1.0) {
  const n = size * size;
  const height = new Float32Array(n);
  const c = newCanvas(size, size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size), d = img.data;
  for (let i = 0; i < n; i++) {
    const x = i % size, y = (i / size) | 0;
    const fib = fbm(x * 3, y, size, 48, 2, 0.5, 61);
    const patch = fbm(x, y, size, 5, 2, 0.6, 13);
    height[i] = fib * 0.8 + patch * 0.2;
    const v = 0.055 + patch * 0.045 + fib * 0.035;
    const j = i * 4;
    d[j] = Math.pow(v * 0.62, 1 / 2.2) * 255;
    d[j + 1] = Math.pow(v * 1.35, 1 / 2.2) * 255;
    d[j + 2] = Math.pow(v * 0.58, 1 / 2.2) * 255;
    d[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return { map: toTexture(c, { srgb: true }), normalMap: toTexture(normalFromHeight(height, size, 1.6)), metres };
}

export function sandSet(size = 256, metres = 12.0) {
  const n = size * size;
  const height = new Float32Array(n);
  const c = newCanvas(size, size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size), d = img.data;
  for (let i = 0; i < n; i++) {
    const x = i % size, y = (i / size) | 0;
    const dune = fbm(x, y, size, 4, 4, 0.55, 7);
    const grit = fbm(x, y, size, 40, 2, 0.5, 23);
    height[i] = dune * 0.75 + grit * 0.25;
    const v = 0.085 + dune * 0.075 + grit * 0.022;
    const j = i * 4;
    d[j] = Math.pow(v * 1.16, 1 / 2.2) * 255;
    d[j + 1] = Math.pow(v * 0.99, 1 / 2.2) * 255;
    d[j + 2] = Math.pow(v * 0.74, 1 / 2.2) * 255;
    d[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return { map: toTexture(c, { srgb: true }), normalMap: toTexture(normalFromHeight(height, size, 1.4)), metres };
}

/* ----------------------------------------------------------- board atlas */

/** Braking-board atlas: one column of `labels` cells, white digits on black. */
export function boardAtlas(labels, cellW = 128, cellH = 128) {
  const c = newCanvas(cellW, cellH * labels.length);
  const ctx = c.getContext('2d');
  labels.forEach((lab, i) => {
    const y = i * cellH;
    ctx.fillStyle = '#0d0d0f'; ctx.fillRect(0, y, cellW, cellH);
    ctx.strokeStyle = '#e8e8e8'; ctx.lineWidth = 5;
    ctx.strokeRect(6, y + 6, cellW - 12, cellH - 12);
    ctx.fillStyle = '#f2f2f2';
    ctx.font = `bold ${Math.round(cellH * 0.62)}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(lab, cellW / 2, y + cellH / 2 + 2);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}
