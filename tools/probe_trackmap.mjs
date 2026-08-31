/**
 * Top-down plan view of the track centreline, straight out of src/track/trackData.js,
 * rebuilt with the exact same CatmullRomCurve3 that src/track/track.js uses. Compare it
 * against a real Bahrain circuit map — it is the fastest way to know whether the layout
 * is actually right.
 *
 *   node tools/probe_trackmap.mjs [--out shots/trackmap.png] [--w 1100]
 *
 * Also prints measured length, bbox, elevation range, straight lengths and the
 * arc-length position + measured radius of every turn.
 */
import * as THREE from 'three';
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { BAHRAIN: D } = await import(path.join(ROOT, 'src/track/trackData.js'));

const A = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean)
  .map(s => { const [k, ...v] = s.trim().split(/\s+/); return [k, v.join(' ')]; }));
const OUT = path.resolve(ROOT, A.out ?? 'shots/trackmap.png');
const W = +(A.w ?? 1100);

/* ---- rebuild the curve exactly as track.js does ---- */
const pts = D.points.map(p => new THREE.Vector3(p[0], 0, p[1]));
let curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);
curve.arcLengthDivisions = 12000;
const k = D.length / curve.getLength();
curve = new THREE.CatmullRomCurve3(pts.map(p => p.multiplyScalar(k)), true, 'centripetal', 0.5);
curve.arcLengthDivisions = 12000;
const L = curve.getLength();

const N = 4096;
const P = [], T = [];
for (let i = 0; i < N; i++) {
  const p = curve.getPointAt(i / N), t = curve.getTangentAt(i / N).normalize();
  P.push([p.x, p.z]); T.push([t.x, t.z]);
}

/* ---- keyframe helper (same smoothstep as track.js) ---- */
const kf = (table, s) => {
  const n = table.length; s = ((s % L) + L) % L;
  let lo; if (s < table[0][0]) lo = n - 1;
  else { let a = 0, b = n - 1; while (a < b) { const m = (a + b + 1) >> 1; if (table[m][0] <= s) a = m; else b = m - 1; } lo = a; }
  const hi = (lo + 1) % n, s0 = table[lo][0], s1 = hi === 0 ? table[0][0] + L : table[hi][0];
  const sx = s < s0 ? s + L : s, span = s1 - s0;
  const tt = span <= 1e-6 ? 0 : Math.max(0, Math.min(1, (sx - s0) / span));
  const w = tt * tt * (3 - 2 * tt);
  return table[lo][1] * (1 - w) + table[hi][1] * w;
};

/* ---- measurements ---- */
const ds = L / N;
const curv = new Float64Array(N);
for (let i = 0; i < N; i++) {
  const a = (i - 1 + N) % N, c = (i + 1) % N;
  const rx = -T[i][1], rz = T[i][0];                        // right = t x up  (x,z components)
  curv[i] = ((T[c][0] - T[a][0]) * rx + (T[c][1] - T[a][1]) * rz) / (2 * ds);
}
// smooth over 12 m so single-sample noise does not dominate the reported radius
const cs = new Float64Array(N), win = Math.round(6 / ds);
for (let i = 0; i < N; i++) { let a = 0; for (let q = -win; q <= win; q++) a += curv[((i + q) % N + N) % N]; cs[i] = a / (2 * win + 1); }

const xs = P.map(p => p[0]), zs = P.map(p => p[1]);
const bbox = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
let yMin = Infinity, yMax = -Infinity, wMin = Infinity, wMax = -Infinity;
for (let s = 0; s < L; s += 2) {
  const y = kf(D.elevation, s); yMin = Math.min(yMin, y); yMax = Math.max(yMax, y);
  const w = kf(D.width, s); wMin = Math.min(wMin, w); wMax = Math.max(wMax, w);
}

// straights: runs where |radius| > 400 m
const straights = []; let run = null;
for (let i = 0; i < N * 2; i++) {
  const j = i % N, straight = Math.abs(cs[j]) < 1 / 400;
  if (straight) { run ??= i; }
  else if (run != null) { if (i - run > 4) straights.push([run % N, (i - 1) % N, (i - run) * ds]); run = null; }
}
straights.sort((a, b) => b[2] - a[2]);

console.log(`length            ${L.toFixed(2)} m   (official 5412)`);
console.log(`bbox              ${(bbox[1] - bbox[0]).toFixed(0)} m E-W x ${(bbox[3] - bbox[2]).toFixed(0)} m N-S   (real 809 x 1191)`);
console.log(`elevation         ${yMin.toFixed(2)} .. ${yMax.toFixed(2)} m   (range ${(yMax - yMin).toFixed(2)} m)`);
console.log(`track width       ${(wMin * 2).toFixed(1)} .. ${(wMax * 2).toFixed(1)} m`);
console.log(`sectors           ${D.sectors.join(' / ')}`);
console.log('longest straights ' + straights.slice(0, 5).map(s => `${s[2].toFixed(0)}m @${(s[0] * ds).toFixed(0)}`).join(', '));
console.log('\n turn dir      s   apexR   gear   kph   grade%');
for (const t of D.turns) {
  const i = Math.round(t.s / L * N) % N;
  let peak = 0;
  for (let q = -Math.round(18 / ds); q <= Math.round(18 / ds); q++) {
    const c = cs[((i + q) % N + N) % N];
    if (Math.abs(c) > Math.abs(peak)) peak = c;
  }
  const grade = (kf(D.elevation, t.s + 25) - kf(D.elevation, t.s - 25)) / 50 * 100;
  console.log(`  T${String(t.n).padStart(2)}  ${t.dir}  ${String(t.s).padStart(5)}  ${(1 / Math.abs(peak)).toFixed(0).padStart(5)}m`
    + `  ${String(t.gear).padStart(4)}  ${String(t.kph).padStart(4)}  ${grade.toFixed(1).padStart(6)}`
    + `   ${Math.sign(peak) > 0 ? 'R' : 'L'}${Math.sign(peak) > 0 !== (t.dir === 'R') ? '  <-- HANDEDNESS MISMATCH' : ''}`);
}
console.log('\nSLM zones');
for (const z of D.slmZones) {
  const len = ((z.end - z.start) % L + L) % L;
  console.log(`  Z${z.i} detect ${z.detect}  activate ${z.start}  end ${z.end}   (${len.toFixed(0)} m)  ${z.name}`);
}

/* ---- racing line (mirrors Track#buildRacingLine so the map shows what the road shader paints) ---- */
const hwArr = new Float64Array(N);
for (let i = 0; i < N; i++) hwArr[i] = kf(D.width, i / N * L);
const rawLine = new Float64Array(N);
for (let i = 0; i < N; i++) {
  const c = curv[i];
  const amt = Math.min(hwArr[i] - 1.15, hwArr[i] * Math.min(1, Math.abs(c) * 130));
  rawLine[i] = Math.sign(c) * Math.max(0, amt);
}
const blur = (src, sigmaM) => {
  const r = Math.max(1, Math.round(sigmaM * 2.2 / ds)), sg = sigmaM / ds;
  const w = new Float64Array(2 * r + 1); let sw = 0;
  for (let q = -r; q <= r; q++) { w[q + r] = Math.exp(-q * q / (2 * sg * sg)); sw += w[q + r]; }
  const out = new Float64Array(N);
  for (let i = 0; i < N; i++) { let a = 0; for (let q = -r; q <= r; q++) a += src[((i + q) % N + N) % N] * w[q + r]; out[i] = a / sw; }
  return out;
};
{
  const a1 = blur(rawLine, 26), b1 = blur(rawLine, 92), tmp = new Float64Array(N);
  for (let i = 0; i < N; i++) { const lim = hwArr[i] - 1.05; tmp[i] = Math.max(-lim, Math.min(lim, a1[i] * 1.85 - b1[i] * 0.95)); }
  var racingLine = blur(tmp, 7);
}

{
  let worst = 0, worstS = 0;
  for (let i = 0; i < N; i++) {
    const r = Math.abs(racingLine[i]) / (hwArr[i] - 1.05);
    if (r > worst) { worst = r; worstS = i / N * L; }
  }
  console.log(`racing line       max |offset| = ${(worst * 100).toFixed(1)}% of the usable half-width (at s=${worstS.toFixed(0)})`);
}

/* ---- draw ---- */
const pad = 70, H = Math.round(W * (bbox[3] - bbox[2] + 2 * pad / 1) / (bbox[1] - bbox[0] + 1));
const sc = Math.min((W - 2 * pad) / (bbox[1] - bbox[0]), (H - 2 * pad) / (bbox[3] - bbox[2]));
const X = p => pad + (p[0] - bbox[0]) * sc, Y = p => pad + (p[1] - bbox[2]) * sc;

// one quad per pair of samples: a single offset ring self-intersects inside tight
// corners and any fill rule then punches holes in it
const ribbon = (mult) => {
  const edge = (i, side) => {
    const s = i / N * L, hw = kf(D.width, s) * mult;
    const rx = -T[i][1], rz = T[i][0];
    return [P[i][0] + side * rx * hw, P[i][1] + side * rz * hw];
  };
  let d = '';
  for (let i = 0; i < N; i += 2) {
    const j = (i + 2) % N;
    const q = [edge(i, -1), edge(i, 1), edge(j, 1), edge(j, -1)];
    d += 'M' + q.map(p => X(p).toFixed(1) + ' ' + Y(p).toFixed(1)).join('L') + 'Z';
  }
  return d;
};

let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="system-ui,sans-serif">`;
svg += `<rect width="100%" height="100%" fill="#f7f6f3"/>`;
svg += `<path d="${ribbon(1)}" fill="#25262a" stroke="#25262a" stroke-width="1"/>`;
// elevation ribbon: colour the centreline by height
for (let i = 0; i < N; i += 8) {
  const s = i / N * L, y = kf(D.elevation, s), u = (y - yMin) / Math.max(0.01, yMax - yMin);
  const c = `rgb(${Math.round(40 + u * 215)},${Math.round(90 + u * 60)},${Math.round(230 - u * 200)})`;
  const p0 = P[i], p1 = P[(i + 8) % N];
  svg += `<line x1="${X(p0).toFixed(1)}" y1="${Y(p0).toFixed(1)}" x2="${X(p1).toFixed(1)}" y2="${Y(p1).toFixed(1)}" stroke="${c}" stroke-width="3"/>`;
}
// SLM zones
for (const z of D.slmZones) {
  let s = z.start; const end = z.end;
  const seg = [];
  for (let q = 0; q < N; q++) { seg.push(P[Math.round(s / L * N) % N]); s += 6; if (((end - s) % L + L) % L < 6) break; }
  svg += `<path d="${seg.map((p, i) => (i ? 'L' : 'M') + X(p).toFixed(1) + ' ' + Y(p).toFixed(1)).join(' ')}" fill="none" stroke="#0bd" stroke-width="9" stroke-opacity="0.42"/>`;
}
// racing line
{
  const seg = [];
  for (let i = 0; i < N; i += 2) {
    const rx = -T[i][1], rz = T[i][0], o = racingLine[i];
    seg.push([P[i][0] + rx * o, P[i][1] + rz * o]);
  }
  svg += `<path d="${seg.map((p, i) => (i ? 'L' : 'M') + X(p).toFixed(1) + ' ' + Y(p).toFixed(1)).join(' ')} Z" fill="none" stroke="#111" stroke-width="4" stroke-opacity="0.85"/>`;
}
for (const t of D.turns) {
  const p = P[Math.round(t.s / L * N) % N];
  const col = t.dir === 'R' ? '#c02020' : '#1050d0';
  svg += `<circle cx="${X(p).toFixed(1)}" cy="${Y(p).toFixed(1)}" r="6" fill="${col}"/>`;
  svg += `<text x="${(X(p) + 10).toFixed(1)}" y="${(Y(p) + 6).toFixed(1)}" font-size="20" font-weight="700" fill="${col}">T${t.n}</text>`;
}
for (let s = 0; s < L; s += 500) {
  const p = P[Math.round(s / L * N) % N];
  svg += `<circle cx="${X(p).toFixed(1)}" cy="${Y(p).toFixed(1)}" r="3" fill="#666"/>`;
  svg += `<text x="${(X(p) - 46).toFixed(1)}" y="${(Y(p) - 8).toFixed(1)}" font-size="14" fill="#666">${s}</text>`;
}
const p0 = P[0], p1 = P[Math.round(60 / L * N)];
svg += `<line x1="${X(p0).toFixed(1)}" y1="${Y(p0).toFixed(1)}" x2="${X(p1).toFixed(1)}" y2="${Y(p1).toFixed(1)}" stroke="#0a0" stroke-width="7"/>`;
svg += `<circle cx="${X(p0).toFixed(1)}" cy="${Y(p0).toFixed(1)}" r="9" fill="#0a0"/>`;
svg += `<text x="${(X(p0) - 150).toFixed(1)}" y="${(Y(p0) + 5).toFixed(1)}" font-size="18" fill="#0a0">START/FINISH</text>`;
svg += `<text x="16" y="28" font-size="18" fill="#222">Bahrain GP — NORTH UP, clockwise. red=right blue=left, cyan=SLM zone, thin line=elevation (blue low, orange high), black=racing line</text>`;
svg += `<text x="16" y="52" font-size="16" fill="#222">${L.toFixed(1)} m · ${D.turns.length} turns · elevation ${yMin.toFixed(1)}–${yMax.toFixed(1)} m · width ${(wMin * 2).toFixed(1)}–${(wMax * 2).toFixed(1)} m</text>`;
svg += `</svg>`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT.replace(/\.png$/, '.svg'), svg);
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
await page.setContent(`<body style="margin:0">${svg}</body>`);
await page.screenshot({ path: OUT });
await browser.close();
console.log('\nwrote ' + OUT);
