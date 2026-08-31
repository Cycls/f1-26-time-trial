/**
 * Headless check of the frozen Track API — no browser, no GL. Stubs just enough of
 * `document` for the canvas texture generators, builds the real Track, and asserts:
 *   - length / sector / SLM zone bookkeeping
 *   - sampleS() elevation, frame orthonormality and gradient
 *   - locate() round-trips (s and lateral) from world positions, with and without a hint
 *   - surfaceAt() returns the right surface for every band of every run-off recipe
 *   - draw-call and triangle budget of the meshes TRACK adds to the scene
 *
 *   node tools/probe_trackapi.mjs
 */
import * as THREE from 'three';

/* ---- minimal canvas stub ---- */
const ctx2d = (w, h) => ({
  canvas: { width: w, height: h },
  createImageData: (a, b) => ({ width: a, height: b, data: new Uint8ClampedArray(a * b * 4) }),
  getImageData: (x, y, a, b) => ({ width: a, height: b, data: new Uint8ClampedArray(a * b * 4) }),
  putImageData() {}, fillRect() {}, strokeRect() {}, fillText() {}, beginPath() {}, closePath() {},
  moveTo() {}, lineTo() {}, arc() {}, fill() {}, stroke() {}, save() {}, restore() {}, translate() {},
  rotate() {}, scale() {}, clearRect() {}, drawImage() {}, createLinearGradient: () => ({ addColorStop() {} }),
  set fillStyle(v) {}, set strokeStyle(v) {}, set lineWidth(v) {}, set font(v) {},
  set textAlign(v) {}, set textBaseline(v) {}, set globalAlpha(v) {},
});
globalThis.document = {
  createElement(tag) {
    if (tag !== 'canvas') return {};
    const c = { width: 1, height: 1, nodeType: 1, style: {} };
    c.getContext = () => ctx2d(c.width, c.height);
    return c;
  },
};
globalThis.performance ??= { now: () => Date.now() };

const { Track } = await import('../src/track/track.js');

const scene = new THREE.Group();
const bus = { emit() {} };
const track = new Track({ scene, bus, state: { lap: { distance: 0 } } });
await track.init();

let fails = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) { fails++; console.log(`  FAIL  ${label}  ${detail}`); }
  else console.log(`  ok    ${label}  ${detail}`);
};

console.log('\n=== geometry ===');
ok(Math.abs(track.length - 5412) < 0.5, 'length == 5412 m', track.length.toFixed(2));
ok(track.sectorS.length === 3 && Math.abs(track.sectorS[2] - track.length) < 1e-3, 'sectorS', track.sectorS.map(v => v.toFixed(0)).join('/'));
ok(track.slmZones.length === 3, 'slmZones exported', track.slmZones.map(z => `Z${z.i}:${z.start}-${z.end}`).join(' '));
ok(track.turns.length === 15, 'turns exported');
ok(!!track.curve && !!track.startLine?.point, 'curve + startLine present');

let yMin = Infinity, yMax = -Infinity, maxGrade = 0, badFrame = 0;
for (let s = 0; s < track.length; s += 1) {
  const t = track.sampleS(s);
  yMin = Math.min(yMin, t.point.y); yMax = Math.max(yMax, t.point.y);
  maxGrade = Math.max(maxGrade, Math.abs(t.tangent.y));
  const dotTR = Math.abs(t.tangent.dot(t.right));
  const dotTU = Math.abs(t.tangent.dot(t.up));
  const dotRU = Math.abs(t.right.dot(t.up));
  if (dotTR > 1e-3 || dotTU > 1e-3 || dotRU > 1e-3) badFrame++;
  if (!Number.isFinite(t.point.x + t.point.y + t.point.z + t.halfWidth + t.curvature + t.banking)) badFrame++;
}
ok(yMax - yMin > 14 && yMax - yMin < 20, 'elevation range 14-20 m', `${yMin.toFixed(2)}..${yMax.toFixed(2)}`);
ok(maxGrade > 0.02, 'tangent follows the gradient', `max |tangent.y| = ${(maxGrade * 100).toFixed(1)}%`);
ok(badFrame === 0, 'frame is orthonormal + finite at every metre', `${badFrame} bad`);

console.log('\n=== locate() round-trip ===');
let worstS = 0, worstAt = 0, worstLat = 0, worstH = 0, worstEdge = 0, worstEdgeAt = 0;
for (let s = 0; s < track.length; s += 7) {
  const t = track.sampleS(s);
  for (const lat of [-t.halfWidth * 0.95, -3, 0, 2.5, t.halfWidth * 0.95]) {
    const p = t.point.clone().addScaledVector(t.right, lat);
    const loc = track.locate(p, s);
    let ds = Math.abs(loc.s - s); ds = Math.min(ds, track.length - ds);
    // a point offset toward the centre of curvature of a 9 m apex is genuinely
    // ambiguous in s, so grade the racing corridor separately from the extremes
    if (Math.abs(lat) <= t.halfWidth * 0.75) { if (ds > worstS) { worstS = ds; worstAt = s; } }
    else if (ds > worstEdge) { worstEdge = ds; worstEdgeAt = s; }
    worstLat = Math.max(worstLat, Math.abs(loc.lateral - lat));
    worstH = Math.max(worstH, Math.abs(loc.height - p.y));
  }
}
ok(worstS < 0.6, 'lap distance recovered inside 0.75x halfWidth', `max err ${worstS.toFixed(3)} m at s=${worstAt.toFixed(0)}`);
ok(worstEdge < 2.5, 'lap distance recovered at the white line', `max err ${worstEdge.toFixed(3)} m at s=${worstEdgeAt.toFixed(0)}`);
ok(worstLat < 0.25, 'lateral recovered', `max err ${worstLat.toFixed(3)} m`);
ok(worstH < 0.25, 'height matches the banked/crowned surface', `max err ${worstH.toFixed(3)} m`);

let worstNoHint = 0;
for (let s = 0; s < track.length; s += 137) {
  const t = track.sampleS(s);
  const loc = track.locate(t.point.clone(), null);
  let ds = Math.abs(loc.s - s); ds = Math.min(ds, track.length - ds);
  worstNoHint = Math.max(worstNoHint, ds);
}
ok(worstNoHint < 2.5, 'cold locate() (no hint) finds the right place', `max err ${worstNoHint.toFixed(2)} m`);

console.log('\n=== surfaceAt() ===');
const counts = {};
for (let s = 0; s < track.length; s += 3) {
  const t = track.sampleS(s);
  for (let o = 0.2; o < 26; o += 0.4) {
    for (const side of [-1, 1]) {
      const p = t.point.clone().addScaledVector(t.right, side * (t.halfWidth + o));
      const su = track.surfaceAt(p);
      counts[su] = (counts[su] ?? 0) + 1;
    }
  }
}
console.log('  off-track sample census:', counts);
ok(['kerb', 'astro', 'asphalt', 'gravel', 'wall'].every(k => counts[k] > 0), 'every off-track surface is reachable');
const on = track.locate(track.sampleS(1200).point, 1200);
ok(on.surface === 'asphalt' && on.onTrack, 'centreline is asphalt + onTrack');
// the white line rule: outside halfWidth must never report asphalt-on-track
let leak = 0;
for (let s = 0; s < track.length; s += 11) {
  const t = track.sampleS(s);
  const p = t.point.clone().addScaledVector(t.right, t.halfWidth + 0.05);
  if (track.locate(p, s).onTrack) leak++;
}
ok(leak === 0, 'onTrack is false the instant you pass halfWidth', `${leak} leaks`);

console.log('\n=== kerbs / bands ===');
let kerbLen = 0;
for (const side of [-1, 1]) for (let i = 0; i < track.N; i++) if (track.kerbW[side][i] > 0.005) kerbLen += track.length / track.N;
ok(kerbLen > 1500 && kerbLen < 4500, 'total kerb run', `${kerbLen.toFixed(0)} m`);
let maxBand = 0;
for (const side of [-1, 1]) for (let i = 0; i < track.N; i++) maxBand = Math.max(maxBand, track.bandW[side][i * 4 + 3]);
ok(maxBand < 20, 'run-off stays inside the barrier envelope (halfWidth+20)', `max ${maxBand.toFixed(1)} m`);

console.log('\n=== scene budget ===');
let calls = 0, tris = 0;
const rows = [];
scene.traverse(o => {
  if (!o.isMesh) return;
  calls++;
  const g = o.geometry;
  const n = g.index ? g.index.count / 3 : (g.attributes.position?.count ?? 0) / 3;
  tris += n;
  rows.push(`${o.name}: ${Math.round(n).toLocaleString()} tris`);
});
rows.forEach(r => console.log('  ' + r));
ok(calls <= 10, 'draw calls', String(calls));
ok(tris < 260000, 'triangles', Math.round(tris).toLocaleString());

console.log(fails ? `\n${fails} FAILURES` : '\nall checks passed');
process.exit(fails ? 1 : 0);
