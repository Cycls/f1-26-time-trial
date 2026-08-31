/**
 * Straight Line Mode (2026 active-aero) zone derivation. Owner: UI.
 *
 * The 2026 regs replace DRS with two aero states; Straight Line Mode is only permitted in
 * pre-designated zones (max 4 per circuit, Bahrain has 3). Nothing in the shared state
 * publishes those zones, so the HUD derives them from the track geometry it is allowed to
 * read: the three longest low-curvature runs around the lap, trimmed at each end so the
 * zone starts a little after the corner exit and ends before the braking point.
 */

export function deriveZones(track, want = 3) {
  const L = track.length;
  const N = 600, step = L / N;

  const k = new Float32Array(N);
  for (let i = 0; i < N; i++) k[i] = Math.abs(track.sampleS(i * step).curvature);

  // Smooth so a single noisy sample cannot split a straight in two.
  const sm = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let a = 0;
    for (let j = -3; j <= 3; j++) a += k[(i + j + N) % N];
    sm[i] = a / 7;
  }

  const sorted = Array.from(sm).sort((a, b) => a - b);
  const TH = Math.max(0.0012, sorted[Math.floor(N * 0.34)]);

  // Anchor on a corner so a straight spanning s=0 is not cut in half.
  let anchor = 0;
  for (let i = 0; i < N; i++) if (sm[i] >= TH) { anchor = i; break; }

  const runs = [];
  let cur = null;
  for (let n = 0; n < N; n++) {
    const i = (anchor + n) % N;
    if (sm[i] < TH) { if (!cur) cur = { a: i, n: 0 }; cur.n++; }
    else if (cur) { runs.push(cur); cur = null; }
  }
  if (cur) runs.push(cur);

  runs.sort((x, y) => y.n - x.n);

  const zones = runs.slice(0, want).map((r) => {
    const a = r.a * step, len = r.n * step;
    const lead = Math.min(len * 0.20, 110);   // activation sits inside the straight
    const tail = Math.min(len * 0.16, 90);    // closes before the braking zone
    const start = ((a + lead) % L + L) % L;
    const length = Math.max(80, len - lead - tail);
    return { start, length, end: (start + length) % L };
  });

  zones.sort((a, b) => a.start - b.start);
  zones.forEach((z, i) => { z.index = i + 1; });
  return zones;
}

/** Where the car sits relative to the zones. `dist` is metres to the next activation point. */
export function zoneState(zones, s, L) {
  let inZone = null, progress = 0, next = null, dist = Infinity;
  for (const z of zones) {
    const rel = ((s - z.start) % L + L) % L;
    if (rel < z.length) { inZone = z; progress = rel / z.length; }
    const d = ((z.start - s) % L + L) % L;
    if (d < dist) { dist = d; next = z; }
  }
  return { inZone, progress, next, dist };
}
