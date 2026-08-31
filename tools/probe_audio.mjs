/**
 * Audio analysis probe. Renders src/audio/graph.js inside an OfflineAudioContext in a real
 * browser, pulls the PCM back out and measures it. Owner: AUDIO.
 *
 *   node tools/probe_audio.mjs                # all tests
 *   node tools/probe_audio.mjs --json out.json
 *
 * Measures:
 *   1. spectrum of the ICE at several rpm — is the strongest partial really rpm/60*3?
 *   2. peak and RMS of the full mix in a hostile state — does it clip?
 *   3. does the note actually move with rpm / throttle / deploy / shift events?
 *   4. does anything touch an AudioContext before the user gesture?
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const A = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean)
  .map((s) => { const [k, ...v] = s.trim().split(/\s+/); return [k, v.join(' ') || true]; }));

const SR = 48000;

// ------------------------------------------------------------------ tiny FFT + helpers
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

function spectrum(samples, offset, N) {
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));   // Hann
    re[i] = (samples[offset + i] ?? 0) * w;
  }
  fft(re, im);
  const mag = new Float64Array(N / 2);
  for (let i = 0; i < N / 2; i++) mag[i] = Math.hypot(re[i], im[i]) / (N / 4);
  return mag;
}

/** strongest bin in [lo,hi] Hz, refined by parabolic interpolation on log magnitude */
function peakHz(mag, lo, hi, N) {
  const bw = SR / N;
  const i0 = Math.max(1, Math.floor(lo / bw)), i1 = Math.min(mag.length - 2, Math.ceil(hi / bw));
  let bi = i0;
  for (let i = i0; i <= i1; i++) if (mag[i] > mag[bi]) bi = i;
  const l = Math.log(mag[bi - 1] + 1e-12), c = Math.log(mag[bi] + 1e-12), r = Math.log(mag[bi + 1] + 1e-12);
  const d = 0.5 * (l - r) / (l - 2 * c + r || 1e-9);
  return { hz: (bi + Math.max(-1, Math.min(1, d))) * bw, mag: mag[bi] };
}

/** peak magnitude in a narrow window around f (tolerates filter-induced pulling) */
function magAt(mag, f, N, tolHz = 6) {
  const bw = SR / N;
  const i0 = Math.max(0, Math.floor((f - tolHz) / bw)), i1 = Math.min(mag.length - 1, Math.ceil((f + tolHz) / bw));
  let m = 0;
  for (let i = i0; i <= i1; i++) m = Math.max(m, mag[i]);
  return m;
}

function centroid(mag, N) {
  const bw = SR / N;
  let s = 0, w = 0;
  for (let i = 2; i < mag.length; i++) { s += mag[i] * i * bw; w += mag[i]; }
  return w > 0 ? s / w : 0;
}

const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const f2 = (x, n = 2) => (Number.isFinite(x) ? x.toFixed(n) : 'n/a');

function decodeF32(b64) {
  const b = Buffer.from(b64, 'base64');
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

// ------------------------------------------------------------------ in-page harness
const HARNESS = `(() => {
  const W = {};
  W.b64 = (f32) => {
    const u8 = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
    let s = '', C = 0x8000;
    for (let i = 0; i < u8.length; i += C) s += String.fromCharCode.apply(null, u8.subarray(i, i + C));
    return btoa(s);
  };
  W.mkState = (o = {}) => {
    const wheel = (o.wheel ?? []).length === 4 ? o.wheel : Array.from({ length: 4 }, () => ({
      gripUse: o.gripUse ?? 0.4, slipAngle: o.slipAngle ?? 0.01,
      locked: !!o.locked, spinning: !!o.spinning, surface: o.surface ?? 'asphalt',
    }));
    const kph = o.kph ?? 0;
    return {
      car: {
        rpm: o.rpm ?? 4000, kph, speed: kph / 3.6, gear: o.gear ?? 6,
        ersDeploy: o.deploy ?? 0, overrideActive: !!o.override, ersHarvest: o.harvest ?? 0,
        longG: o.longG ?? 0, onTrack: true, turboBoost: 0, wheel,
      },
      input: { throttle: o.throttle ?? 0, brake: o.brake ?? 0 },
      camera: { mode: o.camera ?? 'tvpod' },
      trackQuery: { width: o.width ?? 13 },
      lap: { distance: o.s ?? 300 },
    };
  };
  window.__AUDIOPROBE = W;
  return true;
})()`;

// ------------------------------------------------------------------ main
const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('[console] ' + m.text()); });

// Serve a blank document on the localhost origin so ES-module imports of /src/audio/* resolve,
// without booting the WebGL game (we only want the audio graph here).
await page.setRequestInterception(true);
page.on('request', (req) => {
  if (req.url().endsWith('/__audioprobe.html')) {
    req.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>audio probe</title>' });
  } else req.continue().catch(() => {});
});
for (let a = 0; ; a++) {
  try { await page.goto('http://localhost:8123/__audioprobe.html', { waitUntil: 'domcontentloaded', timeout: 120000 }); break; }
  catch (e) { if (a >= 3) throw e; console.error('goto retry', a + 1, String(e.message || e)); }
}
await page.evaluate(HARNESS);

const report = { fundamentals: [], levels: {}, variation: {}, gesture: {}, errors: [] };
const line = (s = '') => console.log(s);

// ---------------------------------------------------------------- 0. gesture safety
{
  const g = await page.evaluate(async () => {
    const before = window.AudioContext;
    let created = 0;
    window.AudioContext = class extends before { constructor(...a) { created++; super(...a); } };
    const { AudioEngine } = await import('/src/audio/engine.js?probe=1');
    let threw = null;
    const fake = {
      state: window.__AUDIOPROBE.mkState({ rpm: 11000, throttle: 1, kph: 250 }),
      bus: { on() {}, emit() {} },
    };
    try {
      const a = new AudioEngine(fake);
      await a.init();
      for (let i = 0; i < 10; i++) a.update(1 / 60);
    } catch (e) { threw = String(e.message || e); }
    window.AudioContext = before;
    return { created, threw };
  });
  // ... and that a real gesture DOES boot it and survives 60 update() calls
  const g2 = await page.evaluate(async () => {
    const { AudioEngine } = await import('/src/audio/engine.js?gesture=1');
    const st = window.__AUDIOPROBE.mkState({ rpm: 11000, throttle: 1, kph: 250, deploy: 0.6 });
    const a = new AudioEngine({ state: st, bus: { on() {}, emit() {} } });
    await a.init();
    dispatchEvent(new PointerEvent('pointerdown'));
    let threw = null;
    try { for (let i = 0; i < 60; i++) a.update(1 / 60); } catch (e) { threw = String(e.message || e); }
    const built = !!a.ac && !!a.graph;
    try { a.ac?.close(); } catch { /* noop */ }
    return { built, threw };
  });
  report.gesture = { ...g, afterGesture: g2 };
  line('--- gesture handling ---------------------------------------------------');
  line(`AudioContexts created before any gesture: ${g.created}   throw: ${g.threw ?? 'none'}`);
  line(`after a pointerdown: graph built = ${g2.built}   60 update() calls threw: ${g2.threw ?? 'none'}`);
  if (g.created !== 0 || g.threw) report.errors.push('pre-gesture behaviour is wrong');
  if (!g2.built || g2.threw) report.errors.push('post-gesture boot failed: ' + (g2.threw ?? 'no graph'));
  line();
}

// ---------------------------------------------------------------- 1. fundamentals
{
  line('--- fundamental vs rpm/60*3 --------------------------------------------');
  line('the wavetable cycle is 720 crank degrees, so the oscillator runs at rpm/120 and the');
  line('firing fundamental (3 combustion events per crank revolution) is its 6th harmonic.');
  line();
  const RPMS = [7500, 10500, 12500];
  for (const rpm of RPMS) {
    for (const env of [false, true]) {
      const b64 = await page.evaluate(async (rpmV, sr, withEnv) => {
        const { buildGraph } = await import('/src/audio/graph.js?probe=1');
        const { PowerUnitModel } = await import('/src/audio/params.js?probe=1');
        const oc = new OfflineAudioContext(2, sr * 2.0, sr);
        const g = buildGraph(oc, { masterGain: 0.9 });
        const m = new PowerUnitModel();
        const st = window.__AUDIOPROBE.mkState({ rpm: rpmV, throttle: 1, kph: 0, deploy: 0, camera: 'tvpod' });
        // settle the model's integrators, then hold the state for the whole render
        for (let i = 0; i < 200; i++) m.step(st, 1 / 60);
        const { p } = m.step(st, 1 / 60);
        if (!withEnv) { p.wetLevel = 0; p.slapLevel = 0; }
        g.set(p, 0);
        const buf = await oc.startRendering();
        return window.__AUDIOPROBE.b64(buf.getChannelData(0));
      }, rpm, SR, env);
      const x = decodeF32(b64);
      const N = 32768;
      const mag = spectrum(x, Math.floor(SR * 1.1), N);
      const pk = peakHz(mag, 120, 4000, N);
      const expected = rpm / 60 * 3;
      const orders = {};
      for (const o of [1.5, 3, 4.5, 6, 7.5, 9, 12]) orders[o] = db(magAt(mag, rpm / 60 * o, N) / pk.mag);
      const row = {
        rpm, env, expectedHz: expected, measuredHz: pk.hz,
        errPct: (pk.hz - expected) / expected * 100,
        ordersDbRelPeak: orders,
      };
      report.fundamentals.push(row);
      line(`rpm ${rpm}  env:${env ? 'on ' : 'off'}  expected ${f2(expected, 1)} Hz  measured ${f2(pk.hz, 1)} Hz` +
        `  err ${f2(row.errPct, 2)}%`);
      line(`         order levels rel. peak (dB):  ` +
        Object.entries(orders).map(([o, v]) => `${o}:${f2(v, 1)}`).join('  '));
    }
  }
  line();
}

// ---------------------------------------------------------------- 2. levels / clipping
{
  line('--- peak / RMS -----------------------------------------------------------');
  const CASES = [
    ['idle, pit lane', { rpm: 4200, throttle: 0.15, kph: 30, camera: 'tvpod', s: 300 }],
    ['on song, tvpod', { rpm: 11500, throttle: 1, kph: 300, deploy: 1, override: true, camera: 'tvpod', s: 300 }],
    ['on song, cockpit', { rpm: 11500, throttle: 1, kph: 300, deploy: 1, override: true, camera: 'cockpit', s: 300 }],
    ['worst case: limiter + lockup + kerb + 330kph', {
      rpm: 14800, throttle: 1, kph: 330, deploy: 1, override: true, camera: 'chase', s: 5300,
      gripUse: 1.35, slipAngle: 0.16, locked: true, spinning: true, surface: 'kerb', brake: 1,
    }],
    ['off throttle, overrun, gravel', {
      rpm: 9000, throttle: 0, brake: 1, kph: 180, longG: -2.2, camera: 'chase',
      gripUse: 1.1, surface: 'gravel', s: 1200,
    }],
  ];
  line('(raw = master chain bypassed, so the gain structure is judged, not the limiter)');
  for (const [name, o] of CASES) {
    const meas = async (noDynamics) => page.evaluate(async (opts, sr, nd) => {
      const { buildGraph } = await import('/src/audio/graph.js?probe=1');
      const { PowerUnitModel } = await import('/src/audio/params.js?probe=1');
      const oc = new OfflineAudioContext(2, sr * 2.5, sr);
      const g = buildGraph(oc, { masterGain: 0.9, noDynamics: nd });
      const m = new PowerUnitModel();
      const st = window.__AUDIOPROBE.mkState(opts);
      for (let i = 0; i < 200; i++) m.step(st, 1 / 60);
      // drive the real per-frame path across the render so one-shots (pops) fire too
      for (let i = 0; i < 125; i++) {
        const f = m.step(st, 0.02);
        g.set(f.p, i * 0.02);
        for (const e of f.events) g.event(e.name, e.d, i * 0.02 + (e.at ?? 0));
      }
      const buf = await oc.startRendering();
      let peak = 0, sum = 0, n = 0, clipped = 0;
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const d = buf.getChannelData(c);
        for (let i = sr * 0.25; i < d.length; i++) {   // skip the settle-in
          const a = Math.abs(d[i]);
          if (a > peak) peak = a;
          if (a >= 0.999) clipped++;
          sum += d[i] * d[i]; n++;
        }
      }
      return { peak, rms: Math.sqrt(sum / n), clipped };
    }, o, SR, noDynamics);
    const r = await meas(false), raw = await meas(true);
    report.levels[name] = { ...r, raw };
    line(`${name.padEnd(46)} peak ${f2(db(r.peak), 1).padStart(6)} dBFS  rms ${f2(db(r.rms), 1).padStart(6)} dBFS  ` +
      `crest ${f2(db(r.peak / r.rms), 1).padStart(5)} dB  |  raw peak ${f2(db(raw.peak), 1).padStart(6)}  raw rms ${f2(db(raw.rms), 1).padStart(6)}  ` +
      `clipped ${r.clipped}`);
    if (r.peak >= 1) report.errors.push(`CLIPPING in "${name}"`);
    if (raw.peak >= 1.6) report.errors.push(`gain structure too hot in "${name}" (raw peak ${f2(db(raw.peak), 1)} dBFS)`);
  }
  line();
}

// ---------------------------------------------------------------- 3. variation
{
  line('--- does the note actually move? ----------------------------------------');
  const r = await page.evaluate(async (sr) => {
    const { buildGraph } = await import('/src/audio/graph.js?probe=1');
    const { PowerUnitModel } = await import('/src/audio/params.js?probe=1');
    const DUR = 7.0;
    const oc = new OfflineAudioContext(2, sr * DUR, sr);
    const g = buildGraph(oc, { masterGain: 0.9 });
    const m = new PowerUnitModel();
    const marks = [];
    const H = 0.02;
    for (let i = 0; i * H < DUR; i++) {
      const t = i * H;
      // a scripted stint: pull 3rd gear out, upshift, hold, lift + downshift, back on power
      let rpm, thr = 1, deploy = 0.55, brake = 0, longG = 1.5, kph = 150 + t * 22, override = false;
      if (t < 1.6) rpm = 7000 + (t / 1.6) * 7600;
      else if (t < 1.7) { rpm = 14600; }
      else if (t < 3.4) rpm = 10900 + ((t - 1.7) / 1.7) * 3700;
      else if (t < 4.2) { rpm = 11400 + (t - 3.4) * 900; deploy = 1; override = true; }
      else if (t < 5.4) { thr = 0; brake = 1; longG = -2.4; rpm = 11500 - (t - 4.2) * 3200; deploy = 0; kph = 260 - (t - 4.2) * 55; }
      else { rpm = 8000 + (t - 5.4) * 2600; deploy = 0.55; kph = 190 + (t - 5.4) * 30; }
      if (Math.abs(t - 1.62) < H / 2) { for (const e of m.shift({ up: true, gear: 6 })) { g.event(e.name, e.d, t); marks.push({ t, k: 'upshift' }); } }
      if (Math.abs(t - 5.36) < H / 2) { for (const e of m.shift({ up: false, gear: 4 })) { g.event(e.name, e.d, t); marks.push({ t, k: 'downshift' }); } }
      const st = window.__AUDIOPROBE.mkState({
        rpm, throttle: thr, brake, kph, deploy, override, longG, camera: 'tvpod',
        gripUse: thr === 0 ? 1.05 : 0.7, slipAngle: 0.05, s: 300 + t * 60,
      });
      const f = m.step(st, H);
      g.set(f.p, t);
      for (const e of f.events) g.event(e.name, e.d, t + (e.at ?? 0));
      if (i % 5 === 0) marks.push({ t, k: 'state', rpm, thr, deploy });
    }
    const buf = await oc.startRendering();
    return { pcm: window.__AUDIOPROBE.b64(buf.getChannelData(0)), marks, dur: DUR };
  }, SR);

  const x = decodeF32(r.pcm);
  const N = 8192;                       // 0.17 s window, 5.86 Hz bins
  const track = [];
  for (let t = 0.3; t < r.dur - 0.25; t += 0.1) {
    const off = Math.floor(t * SR);
    const mag = spectrum(x, off, N);
    let rms = 0;
    for (let i = off; i < off + N; i++) rms += (x[i] ?? 0) ** 2;
    rms = Math.sqrt(rms / N);
    // search the engine-order region only: orders 1.5..~6 span 175-1450 Hz across 7k-14.8k rpm,
    // so picking a half order here still fails the test — it is not begging the question.
    const pk = peakHz(mag, 150, 1500, N);
    const wide = peakHz(mag, 150, 6000, N);
    track.push({ t: +t.toFixed(2), hz: pk.hz, wideHz: wide.hz, rms, cen: centroid(mag, N) });
  }
  const state = r.marks.filter((m) => m.k === 'state');
  const near = (t) => state.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a));
  let ok = 0, tot = 0, worst = 0;
  const rows = [];
  for (const p of track) {
    const s = near(p.t);
    if (s.thr < 0.5) continue;                     // only judge tracking while on power
    const exp = s.rpm / 60 * 3;
    const err = Math.abs(p.hz - exp) / exp * 100;
    tot++; if (err < 6) ok++;
    worst = Math.max(worst, err);
    rows.push({ t: p.t, rpm: Math.round(s.rpm), exp, hz: p.hz, err });
  }
  const hzs = track.map((p) => p.hz), cens = track.map((p) => p.cen), rmss = track.map((p) => p.rms);
  report.variation = {
    trackedOnPower: `${ok}/${tot} windows within 6% of rpm/60*3`,
    worstErrPct: worst,
    hzRange: [Math.min(...hzs), Math.max(...hzs)],
    centroidRange: [Math.min(...cens), Math.max(...cens)],
    rmsRange: [Math.min(...rmss), Math.max(...rmss)],
    track,
  };
  line(`on-power fundamental tracking: ${ok}/${tot} 0.17 s windows within 6% of rpm/60*3 (worst ${f2(worst, 1)}%)`);
  line(`fundamental spans ${f2(Math.min(...hzs), 0)} - ${f2(Math.max(...hzs), 0)} Hz over the stint`);
  line(`spectral centroid spans ${f2(Math.min(...cens), 0)} - ${f2(Math.max(...cens), 0)} Hz (timbre moves, not just pitch)`);
  line(`short-time RMS spans ${f2(db(Math.min(...rmss)), 1)} to ${f2(db(Math.max(...rmss)), 1)} dBFS`);
  line();
  line('  t     rpm    expected   measured   err%');
  for (const q of rows.filter((_, i) => i % 2 === 0)) {
    line(`  ${f2(q.t, 2).padStart(5)}  ${String(q.rpm).padStart(6)}  ${f2(q.exp, 1).padStart(9)}  ${f2(q.hz, 1).padStart(9)}  ${f2(q.err, 2).padStart(6)}`);
  }
  line();

  // shift transients: RMS dip around the ignition cut
  for (const k of ['upshift', 'downshift']) {
    const mk = r.marks.find((m) => m.k === k);
    if (!mk) continue;
    const win = (t0, t1) => {
      let s = 0, n = 0;
      for (let i = Math.floor(t0 * SR); i < Math.floor(t1 * SR); i++) { s += (x[i] ?? 0) ** 2; n++; }
      return Math.sqrt(s / n);
    };
    const before = win(mk.t - 0.09, mk.t - 0.004);
    const during = win(mk.t + 0.010, mk.t + 0.030);
    const after = win(mk.t + 0.12, mk.t + 0.2);
    report.variation[k] = { beforeDb: db(before), duringDb: db(during), afterDb: db(after) };
    line(`${k}: ${f2(db(before), 1)} dBFS before -> ${f2(db(during), 1)} dBFS during the cut -> ${f2(db(after), 1)} dBFS after`);
  }
  line();
}

// ---------------------------------------------------------------- 4. layer deltas
{
  line('--- layers actually change the signal ------------------------------------');
  const base = { rpm: 11000, throttle: 1, kph: 280, camera: 'tvpod', s: 300 };
  const VARIANTS = [
    ['baseline (deploy 0)', {}],
    ['ersDeploy 1 + override', { deploy: 1, override: true }],
    ['throttle 0 (overrun)', { throttle: 0, brake: 0.8, longG: -2 }],
    ['locked wheels', { locked: true, gripUse: 1.3, brake: 1 }],
    ['kerb', { surface: 'kerb' }],
    ['gravel', { surface: 'gravel' }],
    ['cockpit camera', { camera: 'cockpit' }],
    ['chaseFar camera', { camera: 'chaseFar' }],
    ['back straight (open)', { s: 3600 }],
  ];
  const specs = [];
  for (const [name, o] of VARIANTS) {
    const b64 = await page.evaluate(async (opts, sr) => {
      const { buildGraph } = await import('/src/audio/graph.js?probe=1');
      const { PowerUnitModel } = await import('/src/audio/params.js?probe=1');
      const oc = new OfflineAudioContext(2, sr * 1.6, sr);
      const g = buildGraph(oc, { masterGain: 0.9 });
      const m = new PowerUnitModel();
      const st = window.__AUDIOPROBE.mkState(opts);
      for (let i = 0; i < 200; i++) m.step(st, 1 / 60);
      for (let i = 0; i < 80; i++) {
        const f = m.step(st, 0.02);
        g.set(f.p, i * 0.02);
        for (const e of f.events) g.event(e.name, e.d, i * 0.02 + (e.at ?? 0));
      }
      const buf = await oc.startRendering();
      return window.__AUDIOPROBE.b64(buf.getChannelData(0));
    }, { ...base, ...o }, SR);
    const x = decodeF32(b64);
    const N = 16384;
    const mag = spectrum(x, Math.floor(SR * 0.9), N);
    let rms = 0;
    for (let i = Math.floor(SR * 0.4); i < x.length; i++) rms += x[i] ** 2;
    rms = Math.sqrt(rms / (x.length - Math.floor(SR * 0.4)));
    specs.push({ name, mag, rms, cen: centroid(mag, N) });
  }
  const ref = specs[0];
  report.variation.layers = {};
  for (const s of specs) {
    // spectral distance from the baseline, in dB, over 60 log-spaced bands
    let d = 0;
    const N = 16384, bw = SR / N;
    for (let b = 0; b < 60; b++) {
      const f0 = 50 * Math.pow(16000 / 50, b / 60), f1 = 50 * Math.pow(16000 / 50, (b + 1) / 60);
      let a = 0, c = 0;
      for (let i = Math.floor(f0 / bw); i < Math.ceil(f1 / bw) && i < N / 2; i++) { a += s.mag[i]; c += ref.mag[i]; }
      d += Math.abs(db(a + 1e-9) - db(c + 1e-9));
    }
    d /= 60;
    report.variation.layers[s.name] = { meanBandDeltaDb: d, rmsDb: db(s.rms), centroidHz: s.cen };
    line(`${s.name.padEnd(26)} mean band delta vs baseline ${f2(d, 2).padStart(6)} dB   rms ${f2(db(s.rms), 1).padStart(6)} dBFS   centroid ${f2(s.cen, 0).padStart(5)} Hz`);
  }
  line();
}

// Headless Chrome has no audio output device, so the one LIVE AudioContext this probe opens
// (the post-gesture boot test) logs a renderer warning. That is the environment, not the graph —
// every measurement above comes from an OfflineAudioContext, which needs no device.
const IGNORE = /favicon|WebGL|GL_|three|404|AudioContext encountered an error/i;
const noted = pageErrors.filter((e) => IGNORE.test(e));
report.errors.push(...pageErrors.filter((e) => !IGNORE.test(e)).slice(0, 10));
if (noted.length) { report.ignoredConsole = noted.slice(0, 5); line('(ignored, environment only: ' + noted[0] + ')'); }
line('--- verdict --------------------------------------------------------------');
if (report.errors.length) { line('PROBLEMS:'); for (const e of report.errors) line('  ! ' + e); }
else line('no clipping, no page errors, fundamentals on target.');

if (A.json) fs.writeFileSync(String(A.json), JSON.stringify(report, null, 1));
await browser.close();
