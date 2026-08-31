/**
 * Procedural VFX textures. Owner: VFX.
 * No network assets: every map is generated into a DataTexture at init.
 *
 * The smoke atlas is 2x2:
 *   cell 0,1,2 = billowing smoke puffs (different seeds / densities)
 *   cell 3     = hard-edged debris chip (gravel, rubber marble, grass clod)
 * RGB stores a normal baked from the density field so the sprite can be *lit*
 * (this is what stops night smoke reading as a flat grey blob), A stores density.
 */
import * as THREE from 'three';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const ss = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

function hash2(x, y, s) {
  let n = (x * 1619 + y * 31337 + s * 6971) | 0;
  n = (n << 13) ^ n;
  return 1 - ((n * (n * n * 15731 + 789221) + 1376312589) & 0x7fffffff) / 1073741824;
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s);
  const c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
function fbm(x, y, s, oct = 4) {
  let a = 0.5, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) { sum += a * vnoise(x * f, y * f, s + i * 17); norm += a; a *= 0.5; f *= 2.03; }
  return sum / norm;
}

/** 512px RGBA atlas, RGB = normal, A = density. */
export function makeSmokeAtlas(size = 512) {
  const cell = size >> 1;
  const dens = new Float32Array(size * size);
  for (let cy = 0; cy < 2; cy++) {
    for (let cx = 0; cx < 2; cx++) {
      const idx = cy * 2 + cx, seed = 13 + idx * 101;
      for (let y = 0; y < cell; y++) {
        for (let x = 0; x < cell; x++) {
          const u = ((x + 0.5) / cell) * 2 - 1, v = ((y + 0.5) / cell) * 2 - 1;
          let a;
          if (idx === 3) {
            // hard chip: irregular sharp-edged blob
            const ang = Math.atan2(v, u);
            const wob = 0.5 + 0.24 * fbm(Math.cos(ang) * 2.2, Math.sin(ang) * 2.2, seed, 3);
            const r = Math.hypot(u, v);
            a = ss(wob + 0.05, wob - 0.05, r);
          } else {
            // domain-warped fbm masked by a radial falloff -> billowing puff
            const wx = u + fbm(u * 1.5 + 3.1, v * 1.5, seed, 4) * 0.42;
            const wy = v + fbm(u * 1.5, v * 1.5 + 7.7, seed + 41, 4) * 0.42;
            const rr = Math.hypot(wx, wy);
            const mask = ss(1.02, 0.12, rr);
            const d = 0.48 + 0.78 * fbm(u * (2.6 + idx * 0.7), v * (2.6 + idx * 0.7), seed + 5, 5);
            a = clamp(mask * d * 1.22 - 0.05, 0, 1);
            a = a * a * (3 - 2 * a);
          }
          // 3px transparent inset stops mip bleed between atlas cells
          const edge = Math.min(x, y, cell - 1 - x, cell - 1 - y);
          if (edge < 4) a *= edge / 4;
          dens[(cy * cell + y) * size + (cx * cell + x)] = a;
        }
      }
    }
  }
  const data = new Uint8Array(size * size * 4);
  const at = (x, y) => dens[clamp(y, 0, size - 1) * size + clamp(x, 0, size - 1)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const gx = (at(x + 1, y) - at(x - 1, y)) * 2.6;
      const gy = (at(x, y + 1) - at(x, y - 1)) * 2.6;
      let nx = -gx, ny = -gy, nz = 0.55;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      data[i] = (nx * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * 0.5 + 0.5) * 255;
      data[i + 2] = (nz * 0.5 + 0.5) * 255;
      data[i + 3] = dens[y * size + x] * 255;
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.needsUpdate = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  return t;
}

/** Soft elongated dab used for rubber laid into the track (skid marks). */
export function makeMarkTexture(size = 128) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const u = ((x + 0.5) / size) * 2 - 1;       // across the tyre
      const v = (y + 0.5) / size;                 // along the trail
      // tread-ish striations across the contact patch + grain along it
      const tread = 0.72 + 0.28 * Math.sin(u * 15.5 + fbm(u * 6, v * 30, 7, 3) * 2.2);
      const grain = 0.55 + 0.6 * fbm(u * 5, v * 26, 21, 4);
      const across = ss(1.0, 0.62, Math.abs(u));  // soft shoulders
      const a = clamp(across * tread * grain, 0, 1);
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = a * 255;
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.needsUpdate = true;
  t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true; t.anisotropy = 8;
  return t;
}
