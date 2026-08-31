/**
 * Bahrain International Circuit — geometry, spatial query and road surface. Owner: TRACK.
 *
 * PUBLIC API (frozen — physics / vfx / env / game depend on these exact signatures):
 *   .length                                  centreline length (m)
 *   .sampleS(s)   -> {s,point,tangent,right,up,halfWidth,curvature,banking}
 *   .locate(worldPos, hintS) -> {s, lateral, halfWidth, onTrack, surface, height, tangent, right}
 *   .surfaceAt(worldPos)     -> 'asphalt'|'kerb'|'astro'|'gravel'|'grass'|'wall'
 *   .sectorS[3]
 *   .startLine {point, tangent}
 *   .curve                                   THREE.Curve (read by env for dressing)
 * Additions (read-only for other modules):
 *   .slmZones[3]   {i, detect, start, end, name}   Straight-Line-Mode zones as lap distances
 *   .turns[15]     {n, dir, s, in, out, gear, kph}
 *   .racingLineAt(s) -> lateral offset (m) of the rubbered-in line
 *
 * locate() runs at 120 Hz, so the whole circuit is baked into flat Float32Arrays at
 * init and every query is a bounded scan around a hint index — no curve evaluation,
 * no allocation beyond the two vectors the caller is handed.
 */
import * as THREE from 'three';
import { BAHRAIN } from './trackData.js';
import { CONFIG } from '../core/config.js';
import { asphaltSet, kerbSet, gravelSet, astroSet, sandSet, boardAtlas } from './surfaceTextures.js';
import { makeRoadMaterial } from './roadMaterial.js';

const TABLE_N = 4096;      // lookup-table resolution (~1.32 m)
const ROAD_SEG = 3072;     // road mesh sections (~1.76 m)
const APRON_SEG = 1536;    // run-off / astro / gravel sections (~3.5 m)
const VERGE_SEG = 512;     // desert verge sections (~10.6 m)

const SURF = ['asphalt', 'kerb', 'astro', 'gravel', 'grass', 'wall'];
const S_ASPHALT = 0, S_KERB = 1, S_ASTRO = 2, S_GRAVEL = 3;
const SURF_CODE = { asphalt: S_ASPHALT, kerb: S_KERB, astro: S_ASTRO, gravel: S_GRAVEL, grass: 4 };

/** kerb profiles: [width, height at the outer edge, sawtooth amplitude] */
const KERB_KIND = {
  std: { w: 1.30, h: 0.058, amp: 0.024 },
  high: { w: 1.50, h: 0.092, amp: 0.032 },
  flat: { w: 2.60, h: 0.032, amp: 0.009 },
};
const KERB_ID = { none: 0, std: 1, high: 2, flat: 3 };
const KERB_BY_ID = [null, KERB_KIND.std, KERB_KIND.high, KERB_KIND.flat];

const BOARD_LABELS = ['300', '200', '150', '100', '50', ''];

export class Track {
  constructor(ctx) {
    this.ctx = ctx;
    this.scene = ctx.scene;
    this.data = BAHRAIN;
    this.N = TABLE_N;
    this._v0 = new THREE.Vector3();
  }

  async init() {
    this.#buildCurve();
    this.#buildTable();
    this.#buildRacingLine();
    this.#buildBands();

    this.startLine = { point: this.sampleS(0).point, tangent: this.sampleS(0).tangent };
    this.sectorS = this.data.sectors.map(v => Math.min(v, this.length));
    this.slmZones = this.data.slmZones;
    this.turns = this.data.turns;

    this.group = new THREE.Group();
    this.group.name = 'track';
    this.scene.add(this.group);

    this.#buildTextures();
    this.#buildRoad();
    this.#buildKerbs();
    this.#buildAprons();
    this.#buildVerge();
    this.#buildBoards();

    console.log(`[track] Bahrain GP: ${this.length.toFixed(1)} m, ${this.data.turnCount} turns, `
      + `elevation ${this._yMin.toFixed(2)}..${this._yMax.toFixed(2)} m, `
      + `sectors ${this.sectorS.map(v => v.toFixed(0)).join('/')}`);
    this.ctx.bus.emit('track:ready', this);
  }

  /* ------------------------------------------------------------ geometry --- */

  #buildCurve() {
    const P = this.data.points;
    const pts = P.map(p => new THREE.Vector3(p[0], 0, p[1]));
    let curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);
    // three's default 200 arc-length divisions is 27 m on a 5.4 km curve, which makes
    // getPointAt() badly non-uniform. 12000 puts it under half a metre.
    curve.arcLengthDivisions = 12000;
    const raw = curve.getLength();
    const k = (CONFIG.track.length ?? this.data.length) / raw;
    curve = new THREE.CatmullRomCurve3(pts.map(p => p.multiplyScalar(k)), true, 'centripetal', 0.5);
    curve.arcLengthDivisions = 12000;
    this.curve = curve;
    this.length = curve.getLength();
  }

  /**
   * Keyframe lookup on a wrapping [s, value] table, smoothstepped between keys so
   * elevation and width changes have no visible crease. Tables must be sorted and
   * span [0, length].
   */
  #kf(table, s) {
    const L = this.length, n = table.length;
    s = ((s % L) + L) % L;
    let lo;
    if (s < table[0][0]) lo = n - 1;
    else {
      let a = 0, b = n - 1;
      while (a < b) { const m = (a + b + 1) >> 1; if (table[m][0] <= s) a = m; else b = m - 1; }
      lo = a;
    }
    const hi = (lo + 1) % n;
    const s0 = table[lo][0];
    const s1 = hi === 0 ? table[0][0] + L : table[hi][0];
    const sx = s < s0 ? s + L : s;
    const span = s1 - s0;
    const t = span <= 1e-6 ? 0 : Math.max(0, Math.min(1, (sx - s0) / span));
    const w = t * t * (3 - 2 * t);
    return table[lo][1] * (1 - w) + table[hi][1] * w;
  }

  #buildTable() {
    const N = this.N, L = this.length;
    const px = new Float32Array(N), py = new Float32Array(N), pz = new Float32Array(N);
    const tx = new Float32Array(N), ty = new Float32Array(N), tz = new Float32Array(N);
    const rx = new Float32Array(N), ry = new Float32Array(N), rz = new Float32Array(N);
    const ux = new Float32Array(N), uy = new Float32Array(N), uz = new Float32Array(N);
    const hw = new Float32Array(N), bank = new Float32Array(N), curv = new Float32Array(N);
    const WORLD_UP = new THREE.Vector3(0, 1, 0);
    const T = new THREE.Vector3(), R = new THREE.Vector3(), U = new THREE.Vector3();

    // pass 1: plan position (the spline is 2D) + the keyframed scalars
    const hx = new Float32Array(N), hz = new Float32Array(N);
    this._yMin = Infinity; this._yMax = -Infinity;
    for (let i = 0; i < N; i++) {
      const s = i / N * L;
      const p = this.curve.getPointAt(i / N);
      const t = this.curve.getTangentAt(i / N).normalize();
      const y = this.#kf(this.data.elevation, s);
      this._yMin = Math.min(this._yMin, y); this._yMax = Math.max(this._yMax, y);
      px[i] = p.x; py[i] = y; pz[i] = p.z;
      hx[i] = t.x; hz[i] = t.z;
      hw[i] = this.#kf(this.data.width, s);
      bank[i] = this.#kf(this.data.banking, s) * Math.PI / 180;
    }
    // pass 2: pitch the tangent onto the elevation profile, then roll the frame by
    // the banking angle. The gradient has to come from the finished y table, which is
    // why this cannot be folded into pass 1.
    const dsq = L / N;
    for (let i = 0; i < N; i++) {
      const a = (i - 1 + N) % N, c = (i + 1) % N;
      const grad = (py[c] - py[a]) / (2 * dsq);
      T.set(hx[i], grad, hz[i]).normalize();
      R.crossVectors(T, WORLD_UP).normalize();
      R.applyAxisAngle(T, bank[i]);                 // +banking drops the right-hand edge
      U.crossVectors(R, T).normalize();
      tx[i] = T.x; ty[i] = T.y; tz[i] = T.z;
      rx[i] = R.x; ry[i] = R.y; rz[i] = R.z;
      ux[i] = U.x; uy[i] = U.y; uz[i] = U.z;
    }
    // signed curvature: + = turning toward the local right vector
    const ds = L / N;
    for (let i = 0; i < N; i++) {
      const a = (i - 1 + N) % N, c = (i + 1) % N;
      curv[i] = ((tx[c] - tx[a]) * rx[i] + (tz[c] - tz[a]) * rz[i]) / (2 * ds);
    }
    this.tbl = { px, py, pz, tx, ty, tz, rx, ry, rz, ux, uy, uz, hw, bank, curv };
  }

  /**
   * The rubbered-in line. Start from "hug the inside in proportion to curvature",
   * smooth it twice at different scales and subtract, which turns each apex into a
   * proper wide-in / apex / wide-out arc instead of a blob glued to the kerb.
   */
  #buildRacingLine() {
    const N = this.N, { curv, hw } = this.tbl;
    const raw = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const k = curv[i];
      const amt = Math.min(hw[i] - 1.15, hw[i] * Math.min(1, Math.abs(k) * 130));
      raw[i] = Math.sign(k) * Math.max(0, amt);
    }
    const ds = this.length / N;
    const blur = (src, sigmaM) => {
      const r = Math.max(1, Math.round(sigmaM * 2.2 / ds)), sg = sigmaM / ds;
      const w = new Float32Array(2 * r + 1); let sw = 0;
      for (let k = -r; k <= r; k++) { w[k + r] = Math.exp(-k * k / (2 * sg * sg)); sw += w[k + r]; }
      const out = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        let a = 0;
        for (let k = -r; k <= r; k++) a += src[((i + k) % N + N) % N] * w[k + r];
        out[i] = a / sw;
      }
      return out;
    };
    const a = blur(raw, 26), b = blur(raw, 92);
    const line = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const lim = hw[i] - 1.05;
      line[i] = Math.max(-lim, Math.min(lim, a[i] * 1.85 - b[i] * 0.95));
    }
    this.tbl.line = blur(line, 7);
  }

  racingLineAt(s) {
    const L = this.length, N = this.N;
    const fi = (((s % L) + L) % L) / L * N, i0 = Math.floor(fi) % N, f = fi - Math.floor(fi);
    return this.tbl.line[i0] * (1 - f) + this.tbl.line[(i0 + 1) % N] * f;
  }

  /* ------------------------------------------------- surface band tables --- */

  #buildBands() {
    const N = this.N, L = this.length, D = this.data;
    const kerbW = { '-1': new Float32Array(N), 1: new Float32Array(N) };
    const kerbId = { '-1': new Uint8Array(N), 1: new Uint8Array(N) };
    const idxOf = s => Math.round((((s % L) + L) % L) / L * N) % N;

    for (const k of D.kerbs) {
      const kind = KERB_KIND[k.type], id = KERB_ID[k.type];
      const side = k.side === 'L' ? -1 : 1;
      const i0 = idxOf(k.from), i1 = idxOf(k.to);
      const span = ((i1 - i0) % N + N) % N;
      const taperI = Math.max(1, Math.round(2.5 / (L / N)));
      for (let d = 0; d <= span; d++) {
        const i = (i0 + d) % N;
        const t = Math.min(1, Math.min(d, span - d) / taperI);
        const w = kind.w * t;
        if (w > kerbW[side][i]) { kerbW[side][i] = w; kerbId[side][i] = id; }
      }
    }

    // outward bands per side: [kerb?] then the run-off recipe
    const bandW = { '-1': new Float32Array(N * 4), 1: new Float32Array(N * 4) };
    const bandS = { '-1': new Uint8Array(N * 4), 1: new Uint8Array(N * 4) };
    const regionAt = (s) => {
      for (const r of D.runoff) if (s >= r.from && s <= r.to) return r;
      return D.runoffDefault;
    };
    for (let i = 0; i < N; i++) {
      const s = i / N * L, reg = regionAt(s);
      for (const side of [-1, 1]) {
        const recipe = (side === -1 ? reg.L : reg.R) || (side === -1 ? D.runoffDefault.L : D.runoffDefault.R);
        let off = 0, k = 0;
        const kw = kerbW[side][i];
        if (kw > 0.01) { off += kw; bandW[side][i * 4] = off; bandS[side][i * 4] = S_KERB; k = 1; }
        for (const [name, w] of recipe) {
          if (k >= 4) break;
          off += w;
          bandW[side][i * 4 + k] = off;
          bandS[side][i * 4 + k] = SURF_CODE[name] ?? S_ASPHALT;
          k++;
        }
        for (; k < 4; k++) { bandW[side][i * 4 + k] = off; bandS[side][i * 4 + k] = S_GRAVEL; }
      }
    }
    this.kerbW = kerbW; this.kerbId = kerbId;
    this.bandW = bandW; this.bandS = bandS;
  }

  /* ------------------------------------------------------------- surface --- */

  /** Road-surface height at (index, lateral offset), including banking, crown and run-off fall. */
  #surfaceY(i, lat) {
    const t = this.tbl, hw = t.hw[i];
    let y = t.py[i] + lat * t.ry[i];                       // banked plane
    const a = Math.abs(lat);
    const crownEdge = 0.014 * hw;
    if (a <= hw) y -= crownEdge * (a / hw) * (a / hw);
    else y -= crownEdge + (a - hw) * 0.014;                // run-off drains away
    return y;
  }

  /* ----------------------------------------------------------------- api --- */

  sampleS(s) {
    const L = this.length, N = this.N, t = this.tbl;
    s = ((s % L) + L) % L;
    const fi = s / L * N, i0 = Math.floor(fi) % N, i1 = (i0 + 1) % N, f = fi - Math.floor(fi), g = 1 - f;
    return {
      s,
      point: new THREE.Vector3(t.px[i0] * g + t.px[i1] * f, t.py[i0] * g + t.py[i1] * f, t.pz[i0] * g + t.pz[i1] * f),
      tangent: new THREE.Vector3(t.tx[i0] * g + t.tx[i1] * f, t.ty[i0] * g + t.ty[i1] * f, t.tz[i0] * g + t.tz[i1] * f).normalize(),
      right: new THREE.Vector3(t.rx[i0] * g + t.rx[i1] * f, t.ry[i0] * g + t.ry[i1] * f, t.rz[i0] * g + t.rz[i1] * f).normalize(),
      up: new THREE.Vector3(t.ux[i0] * g + t.ux[i1] * f, t.uy[i0] * g + t.uy[i1] * f, t.uz[i0] * g + t.uz[i1] * f).normalize(),
      halfWidth: t.hw[i0] * g + t.hw[i1] * f,
      curvature: t.curv[i0] * g + t.curv[i1] * f,
      banking: t.bank[i0] * g + t.bank[i1] * f,
    };
  }

  locate(pos, hintS = null) {
    const N = this.N, L = this.length, t = this.tbl;
    const X = pos.x, Y = pos.y, Z = pos.z;
    let bi = 0, bd = Infinity;
    if (hintS != null) {
      const c = Math.round(hintS / L * N);
      for (let k = -28; k <= 28; k++) {
        const i = ((c + k) % N + N) % N;
        const dx = t.px[i] - X, dz = t.pz[i] - Z;
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; bi = i; }
      }
      if (bd > 4900) hintS = null;                       // > 70 m out: hint is stale
    }
    if (hintS == null) {
      bd = Infinity;
      for (let i = 0; i < N; i += 4) {
        const dx = t.px[i] - X, dz = t.pz[i] - Z;
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; bi = i; }
      }
      for (let k = -4; k <= 4; k++) {
        const i = ((bi + k) % N + N) % N;
        const dx = t.px[i] - X, dz = t.pz[i] - Z;
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; bi = i; }
      }
    }
    const dx = X - t.px[bi], dy = Y - t.py[bi], dz = Z - t.pz[bi];
    const along = dx * t.tx[bi] + dy * t.ty[bi] + dz * t.tz[bi];
    const s = (bi / N * L + along + L) % L;
    const lateral = dx * t.rx[bi] + dy * t.ry[bi] + dz * t.rz[bi];
    const hw = t.hw[bi];
    const a = Math.abs(lateral);

    let surface;
    if (a <= hw) surface = 'asphalt';
    else if (a > hw + 22) surface = 'wall';
    else {
      const off = a - hw, side = lateral < 0 ? -1 : 1;
      const b = bi * 4, W = this.bandW[side], S = this.bandS[side];
      surface = 'gravel';
      for (let k = 0; k < 4; k++) {
        if (off <= W[b + k]) { surface = SURF[S[b + k]]; break; }
      }
    }
    return {
      s, lateral, halfWidth: hw,
      onTrack: a <= hw,
      surface,
      height: this.#surfaceY(bi, Math.max(-hw - 24, Math.min(hw + 24, lateral))),
      tangent: new THREE.Vector3(t.tx[bi], t.ty[bi], t.tz[bi]),
      right: new THREE.Vector3(t.rx[bi], t.ry[bi], t.rz[bi]),
    };
  }

  surfaceAt(pos) { return this.locate(pos, this._lastS ?? null).surface; }

  /* ------------------------------------------------------------ textures --- */

  #buildTextures() {
    this.tex = {
      asphalt: asphaltSet(512, 2.0),
      kerb: kerbSet(256),
      gravel: gravelSet(256, 3.0),
      astro: astroSet(128, 1.0),
      sand: sandSet(256, 14.0),
    };
  }

  /* ----------------------------------------------------------- road mesh --- */

  #buildRoad() {
    const SEG = ROAD_SEG, L = this.length, N = this.N;
    const lanes = [-1, -0.78, -0.5, -0.22, 0, 0.22, 0.5, 0.78, 1];
    const V = lanes.length;
    const nv = (SEG + 1) * V;
    const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
    const aS = new Float32Array(nv), aLat = new Float32Array(nv), aHW = new Float32Array(nv), aLine = new Float32Array(nv);
    const idx = new Uint32Array(SEG * (V - 1) * 6);
    const t = this.tbl;
    const TILE = this.tex?.asphalt?.metres ?? 2.0;

    let vi = 0, ii = 0;
    for (let i = 0; i <= SEG; i++) {
      const s = i / SEG * L;
      const fi = (i / SEG) * N, i0 = Math.floor(fi) % N, i1 = (i0 + 1) % N, f = fi - Math.floor(fi), g = 1 - f;
      const hw = t.hw[i0] * g + t.hw[i1] * f;
      const line = t.line[i0] * g + t.line[i1] * f;
      const cx = t.px[i0] * g + t.px[i1] * f, cz = t.pz[i0] * g + t.pz[i1] * f;
      const rX = t.rx[i0] * g + t.rx[i1] * f, rZ = t.rz[i0] * g + t.rz[i1] * f;
      const uX = t.ux[i0] * g + t.ux[i1] * f, uY = t.uy[i0] * g + t.uy[i1] * f, uZ = t.uz[i0] * g + t.uz[i1] * f;
      for (let k = 0; k < V; k++) {
        const lat = lanes[k] * hw;
        const y = this.#surfaceY(i0, lat) * g + this.#surfaceY(i1, lat) * f;
        pos[vi * 3] = cx + rX * lat; pos[vi * 3 + 1] = y; pos[vi * 3 + 2] = cz + rZ * lat;
        nrm[vi * 3] = uX; nrm[vi * 3 + 1] = uY; nrm[vi * 3 + 2] = uZ;
        uv[vi * 2] = lat / TILE; uv[vi * 2 + 1] = s / TILE;
        aS[vi] = s; aLat[vi] = lat; aHW[vi] = hw; aLine[vi] = line;
        vi++;
      }
      if (i < SEG) {
        const base = i * V;
        for (let k = 0; k < V - 1; k++) {
          const a = base + k, b = a + V;
          idx[ii++] = a; idx[ii++] = b; idx[ii++] = a + 1;
          idx[ii++] = a + 1; idx[ii++] = b; idx[ii++] = b + 1;
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('aS', new THREE.BufferAttribute(aS, 1));
    g.setAttribute('aLat', new THREE.BufferAttribute(aLat, 1));
    g.setAttribute('aHW', new THREE.BufferAttribute(aHW, 1));
    g.setAttribute('aLine', new THREE.BufferAttribute(aLine, 1));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();

    this.roadMaterial = makeRoadMaterial(this.tex.asphalt, this.data, { runoff: false });
    const m = new THREE.Mesh(g, this.roadMaterial);
    m.name = 'trackSurface';
    m.receiveShadow = true; m.castShadow = false;
    m.matrixAutoUpdate = false;
    this.mesh = m;
    this.group.add(m);
  }

  /* ---------------------------------------------------------------- kerbs --- */

  #buildKerbs() {
    const L = this.length, N = this.N, t = this.tbl;
    const STEP = 0.25;                       // 2 samples per 0.5 m sawtooth ridge
    const pos = [], nrm = [], uv = [], idx = [];
    const runs = [];                         // contiguous [side, i0, i1] spans of kerb

    for (const side of [-1, 1]) {
      const kw = this.kerbW[side];
      let start = -1;
      for (let i = 0; i <= N; i++) {
        const on = i < N && kw[i] > 0.005;
        if (on && start < 0) start = i;
        else if (!on && start >= 0) { runs.push([side, start, i - 1]); start = -1; }
      }
      if (start >= 0) runs.push([side, start, N - 1]);
    }

    let vbase = 0;
    for (const [side, i0, i1] of runs) {
      // snap to the sawtooth grid so every sample lands on a ridge peak or trough
      const s0 = Math.floor(i0 / N * L / STEP) * STEP;
      const s1 = Math.ceil((i1 + 1) / N * L / STEP) * STEP;
      const steps = Math.max(2, Math.round((s1 - s0) / STEP));
      const rows = [];
      for (let q = 0; q <= steps; q++) {
        const s = s0 + q * STEP;
        const fi = (s / L) * N, a = Math.floor(fi) % N, b = (a + 1) % N, f = fi - Math.floor(fi), g = 1 - f;
        const kwid = this.kerbW[side][a] * g + this.kerbW[side][b] * f;
        const kind = KERB_BY_ID[this.kerbId[side][a] || this.kerbId[side][b]] || KERB_KIND.std;
        const hw = t.hw[a] * g + t.hw[b] * f;
        const cx = t.px[a] * g + t.px[b] * f, cz = t.pz[a] * g + t.pz[b] * f;
        const rX = t.rx[a] * g + t.rx[b] * f, rZ = t.rz[a] * g + t.rz[b] * f;
        const uX = t.ux[a] * g + t.ux[b] * f, uY = t.uy[a] * g + t.uy[b] * f, uZ = t.uz[a] * g + t.uz[b] * f;
        // triangular sawtooth, 0.5 m pitch, tied to the red/white stripe phase
        const saw = 1 - Math.abs((s / 0.25) % 2 - 1);
        const heightScale = kwid / kind.w;
        const inner = side * hw;
        const y0 = this.#surfaceY(a, inner) * g + this.#surfaceY(b, inner) * f;
        // 4 cross-track stations: flush, ramp, crown, outer lip
        const stations = [
          [0.00, 0.006],
          [0.22, kind.h * 0.62],
          [0.62, kind.h * 0.94],
          [1.00, kind.h],
        ];
        const row = [];
        for (const [u, h] of stations) {
          const lat = inner + side * u * kwid;
          const rise = (h + kind.amp * saw * u) * heightScale;
          row.push([cx + rX * lat, y0 + rise, cz + rZ * lat, u]);
        }
        // outer drop face
        const latO = inner + side * kwid;
        row.push([cx + rX * latO, y0 - 0.035, cz + rZ * latO, 1.001]);
        rows.push({ row, s, uX, uY, uZ });
      }
      for (let q = 0; q < rows.length; q++) {
        const { row, s, uX, uY, uZ } = rows[q];
        for (const [x, y, z, u] of row) {
          pos.push(x, y, z);
          nrm.push(uX, uY, uZ);
          uv.push(Math.min(u, 1) * 0.98 + 0.01, s);      // v = metres -> 1 stripe pair / m
        }
      }
      const V = 5;
      for (let q = 0; q < rows.length - 1; q++) {
        for (let k = 0; k < V - 1; k++) {
          const a = vbase + q * V + k, b = a + V;
          if (side > 0) idx.push(a, b, a + 1, a + 1, b, b + 1);
          else idx.push(a, a + 1, b, a + 1, b + 1, b);
        }
      }
      vbase += rows.length * V;
    }

    if (!idx.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(pos.length / 3 > 65000 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({
      map: this.tex.kerb.map, normalMap: this.tex.kerb.normalMap,
      roughness: 0.72, metalness: 0.0, normalScale: new THREE.Vector2(0.7, 0.7),
    });
    const m = new THREE.Mesh(g, mat);
    m.name = 'trackKerbs';
    m.receiveShadow = true; m.castShadow = false;
    m.matrixAutoUpdate = false;
    this.group.add(m);
    this._kerbTris = idx.length / 3;
  }

  /* -------------------------------------------------------------- aprons --- */

  /**
   * Astro strip, paved run-off and gravel traps: one merged mesh per surface.
   * Every section contributes exactly two vertices per surface per side, collapsing
   * to a degenerate quad where that surface is absent, so the strips stitch without
   * any special-casing. The astro band deliberately starts at the white line rather
   * than at the outer edge of the kerb, so there is always ground under the kerb.
   */
  #buildAprons() {
    const SEG = APRON_SEG, L = this.length, N = this.N, t = this.tbl;
    const mk = (tile, drop) => ({ pos: [], nrm: [], uv: [], idx: [], tile, drop, aS: [], aLat: [], aHW: [] });
    const builders = {
      [S_ASTRO]: mk(this.tex.astro.metres, 0.008),
      [S_ASPHALT]: mk(this.tex.asphalt.metres, 0.010),
      [S_GRAVEL]: mk(this.tex.gravel.metres, 0.06),
    };
    const ORDER = [S_ASTRO, S_ASPHALT, S_GRAVEL];

    for (let i = 0; i <= SEG; i++) {
      const s = i / SEG * L;
      const a = Math.round(i / SEG * N) % N;
      const hw = t.hw[a];
      const cx = t.px[a], cz = t.pz[a];
      const rX = t.rx[a], rZ = t.rz[a];
      const uX = t.ux[a], uY = t.uy[a], uZ = t.uz[a];
      for (const side of [-1, 1]) {
        const W = this.bandW[side], S = this.bandS[side], b = a * 4;
        // outer radius of each surface; kerb counts as astro so the kerb has a base
        let rA = 0, rP = 0, rG = 0;
        for (let k = 0; k < 4; k++) {
          const c = S[b + k], w = W[b + k];
          if (c === S_KERB || c === S_ASTRO) rA = Math.max(rA, w);
          else if (c === S_ASPHALT) rP = Math.max(rP, w);
          else if (c === S_GRAVEL) rG = Math.max(rG, w);
        }
        rP = Math.max(rP, rA); rG = Math.max(rG, rP);
        const span = { [S_ASTRO]: [0, rA], [S_ASPHALT]: [rA, rP], [S_GRAVEL]: [rP, rG] };
        for (const code of ORDER) {
          const bld = builders[code];
          const [inner, outer] = span[code];
          for (const off of [inner, outer]) {
            const lat = side * (hw + off);
            // every band dishes away from its inner edge, so consecutive bands meet
            // flush and there is never a vertical crack to see through
            const drop = bld.drop * (outer > inner ? (off - inner) / Math.max(0.001, outer - inner) : 0);
            bld.pos.push(cx + rX * lat, this.#surfaceY(a, lat) - drop, cz + rZ * lat);
            bld.nrm.push(uX, uY, uZ);
            bld.uv.push(lat / bld.tile, s / bld.tile);
            bld.aS.push(s); bld.aLat.push(lat); bld.aHW.push(hw);
          }
        }
      }
    }
    // stitch: layout per section is [side -1: astro,asphalt,gravel][side +1: ...]
    for (const code of ORDER) {
      const bld = builders[code];
      const perSection = 4;                       // 2 sides x 2 verts
      for (let i = 0; i < SEG; i++) {
        for (let sIdx = 0; sIdx < 2; sIdx++) {
          const A = i * perSection + sIdx * 2, B = A + perSection;
          if (sIdx === 1) bld.idx.push(A, B, A + 1, A + 1, B, B + 1);
          else bld.idx.push(A, A + 1, B, A + 1, B + 1, B);
        }
      }
    }

    const mkMat = (code) => {
      if (code === S_ASTRO) return new THREE.MeshStandardMaterial({
        map: this.tex.astro.map, normalMap: this.tex.astro.normalMap, color: 0x9fd48c,
        roughness: 0.95, metalness: 0,
      });
      if (code === S_GRAVEL) return new THREE.MeshStandardMaterial({
        map: this.tex.gravel.map, normalMap: this.tex.gravel.normalMap, color: 0xcfc3a6,
        roughness: 1.0, metalness: 0, normalScale: new THREE.Vector2(1.3, 1.3),
      });
      return makeRoadMaterial(this.tex.asphalt, this.data, { runoff: true });
    };

    for (const key of ORDER) {
      const bld = builders[key];
      if (!bld.idx.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(bld.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(bld.nrm, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(bld.uv, 2));
      if (key === S_ASPHALT) {
        g.setAttribute('aS', new THREE.Float32BufferAttribute(bld.aS, 1));
        g.setAttribute('aLat', new THREE.Float32BufferAttribute(bld.aLat, 1));
        g.setAttribute('aHW', new THREE.Float32BufferAttribute(bld.aHW, 1));
        g.setAttribute('aLine', new THREE.Float32BufferAttribute(new Float32Array(bld.aS.length), 1));
      }
      g.setIndex(bld.pos.length / 3 > 65000
        ? new THREE.Uint32BufferAttribute(bld.idx, 1) : new THREE.Uint16BufferAttribute(bld.idx, 1));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mkMat(key));
      m.name = 'trackApron_' + SURF[key];
      m.receiveShadow = true; m.castShadow = false;
      m.matrixAutoUpdate = false;
      this.group.add(m);
    }
  }

  /* --------------------------------------------------------------- verge --- */

  /**
   * The desert. A skirt that follows the circuit out to 90 m — so the embankments
   * under the elevated sections read correctly — plus one far plane behind it.
   */
  #buildVerge() {
    const SEG = VERGE_SEG, L = this.length, N = this.N, t = this.tbl;
    const OUT = [0, 12, 34, 90];
    const V = OUT.length * 2;
    const pos = [], nrm = [], uv = [], idx = [];
    const TILE = this.tex.sand.metres;
    const BASE = -1.6;
    const push = (a, side, o, outerBand) => {
      const hw = t.hw[a], cx = t.px[a], cz = t.pz[a], rX = t.rx[a], rZ = t.rz[a];
      const lat = side * (hw + outerBand + o);
      const x = cx + rX * lat, z = cz + rZ * lat;
      // o == 0 meets TRACK's own outermost run-off band exactly; further rings follow
      // the profile env/environment.js mirrors in lift() (VERGE_STEP / VERGE_SLOPE)
      const y = o === 0
        ? Math.max(BASE, this.#surfaceY(a, hw + outerBand) - 0.06)
        : Math.max(BASE, t.py[a] - 0.35 - o * 0.14);
      pos.push(x, y, z);
      nrm.push(0, 1, 0);
      uv.push(x / TILE, z / TILE);
    };
    for (let i = 0; i <= SEG; i++) {
      const a = Math.round(i / SEG * N) % N;
      const outerBand = Math.max(this.bandW[-1][a * 4 + 3], this.bandW[1][a * 4 + 3]);
      for (let k = OUT.length - 1; k >= 0; k--) push(a, -1, OUT[k], outerBand);
      for (let k = 0; k < OUT.length; k++) push(a, 1, OUT[k], outerBand);
      if (i < SEG) {
        const b0 = i * V;
        for (let k = 0; k < V - 1; k++) {
          if (k === OUT.length - 1) continue;     // never bridge across the circuit itself
          const A = b0 + k, B = A + V;
          idx.push(A, B, A + 1, A + 1, B, B + 1);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(new THREE.Uint32BufferAttribute(idx, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const sandMat = new THREE.MeshStandardMaterial({
      map: this.tex.sand.map, normalMap: this.tex.sand.normalMap, color: 0xb8a483,
      roughness: 1.0, metalness: 0,
    });
    const m = new THREE.Mesh(g, sandMat);
    m.name = 'desertVerge';
    m.receiveShadow = true; m.castShadow = false;
    m.matrixAutoUpdate = false;
    this.group.add(m);

    const farTex = this.tex.sand.map.clone();
    farTex.wrapS = farTex.wrapT = THREE.RepeatWrapping;
    farTex.repeat.set(9000 / TILE, 9000 / TILE);
    farTex.needsUpdate = true;
    const gp = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000, 1, 1),
      new THREE.MeshStandardMaterial({ map: farTex, color: 0x8d7c60, roughness: 1 }));
    gp.rotation.x = -Math.PI / 2;
    gp.position.set(0, BASE - 0.06, 0);
    gp.receiveShadow = true;
    gp.name = 'ground';
    this.group.add(gp);
  }

  /* -------------------------------------------------------------- boards --- */

  #buildBoards() {
    const tex = boardAtlas(BOARD_LABELS, 128, 128);
    const cells = BOARD_LABELS.length;
    const pos = [], uv = [], idx = [], nrm = [];
    let v = 0;
    const quad = (p0, p1, p2, p3, cell, n) => {
      const v0 = cell / cells, v1 = (cell + 1) / cells;
      for (const p of [p0, p1, p2, p3]) { pos.push(p.x, p.y, p.z); nrm.push(n.x, n.y, n.z); }
      uv.push(0, 1 - v1, 1, 1 - v1, 0, 1 - v0, 1, 1 - v0);
      idx.push(v, v + 1, v + 2, v + 2, v + 1, v + 3);
      v += 4;
    };
    const W = 0.62, H = 0.62, Y0 = 0.55;
    for (const [cornerS, dists] of this.data.boards) {
      const turn = this.data.turns.find(x => x.s === cornerS);
      const side = turn && turn.dir === 'R' ? -1 : 1;      // boards sit on the outside of the corner
      for (const d of dists) {
        const cell = BOARD_LABELS.indexOf(String(d));
        if (cell < 0) continue;
        const s = ((cornerS - d) % this.length + this.length) % this.length;
        const sm = this.sampleS(s);
        const off = sm.halfWidth + 3.6;
        const base = sm.point.clone().addScaledVector(sm.right, side * off);
        const rgt = sm.right.clone().multiplyScalar(side);
        const fwd = sm.tangent;
        const a = base.clone().addScaledVector(rgt, -W).setY(base.y + Y0);
        const b = base.clone().addScaledVector(rgt, W).setY(base.y + Y0);
        const c = a.clone().setY(a.y + H * 2);
        const dd = b.clone().setY(b.y + H * 2);
        const nml = fwd.clone().multiplyScalar(-1);
        quad(a, b, c, dd, cell, nml);
        // dark stand below the panel
        const a2 = a.clone().setY(base.y + 0.04), b2 = b.clone().setY(base.y + 0.04);
        quad(a2, b2, a, b, cells - 1, nml);
      }
    }
    if (!idx.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.8, metalness: 0, side: THREE.DoubleSide,
    }));
    m.name = 'brakingBoards';
    m.matrixAutoUpdate = false;
    this.group.add(m);
  }

  update() {
    // keep a hint for surfaceAt() callers that do not pass one
    this._lastS = this.ctx.state?.lap?.distance ?? this._lastS;
  }
}

function pushV(b, x, y, z, nx, ny, nz, u, v) {
  b.pos.push(x, y, z); b.nrm.push(nx, ny, nz); b.uv.push(u, v);
}
