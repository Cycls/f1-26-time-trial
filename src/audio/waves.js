/**
 * Procedural wavetables, noise and impulse responses. Owner: AUDIO.
 * Pure DSP helpers — every function takes a BaseAudioContext so the whole synthesis
 * graph can be rendered inside an OfflineAudioContext for measurement.
 * No assets, no network.
 */

/** xorshift32 — deterministic RNG so the engine sounds the same every run. */
export function rng(seed = 1) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const _trig = new Map();
function trigTable(M) {
  let t = _trig.get(M);
  if (!t) {
    t = new Float64Array(M);
    for (let i = 0; i < M; i++) t[i] = Math.cos(2 * Math.PI * i / M);
    _trig.set(M, t);
  }
  return t;
}

/**
 * Firing layout of a 90-degree V6, four-stroke.
 * One wavetable cycle = 720 crank degrees = 2 crank revolutions = 6 combustion events,
 * so the *firing* frequency (3 per crank revolution) is harmonic 6 of the table.
 *
 * The two banks sit `120 - uneven` degrees apart instead of a clean 120, which is what
 * gives a 90-degree V6 its lopsided beat: energy appears at the half orders
 * (1.5, 4.5, 7.5 per revolution) underneath the order-3 firing fundamental.
 * Per-cylinder amplitude / duration scatter breaks the remaining symmetry — real
 * cylinders never make identical pulses.
 */
export function v6Layout({ uneven = 10, scatter = 0.09, widthScatter = 0.2, seed = 11 } = {}) {
  const r = rng(seed);
  const jit = (k) => 1 + (r() * 2 - 1) * k;
  const off = (120 - uneven) / 720;
  const A = [], B = [];
  for (let i = 0; i < 3; i++) {
    const base = i * (240 / 720);
    A.push({ phase: base, amp: jit(scatter), wf: jit(widthScatter) });
    B.push({ phase: (base + off) % 1, amp: jit(scatter), wf: jit(widthScatter) });
  }
  return { A, B };
}

/**
 * Build a band-limited pulse train as a PeriodicWave.
 * Each pulse is a gaussian of width `width` (fraction of the 720-degree cycle), whose
 * spectrum is exp(-(pi*n*w)^2); `tilt` adds the low-frequency emphasis of a real
 * blowdown pulse (which has a long tail, not a symmetric spike).
 * Returns the wave plus its crest factor so callers can gain-match tables of different
 * sharpness (the browser normalises PeriodicWaves to peak 1, not to equal loudness).
 */
export function pulseWave(ctx, pulses, { width = 0.008, tilt = 0.5, harmonics = 200 } = {}) {
  const N = harmonics + 1;
  const real = new Float32Array(N), imag = new Float32Array(N);
  for (let n = 1; n < N; n++) {
    let re = 0, im = 0;
    for (const p of pulses) {
      const w = width * (p.wf ?? 1);
      const P = (p.amp ?? 1) * Math.exp(-Math.pow(Math.PI * n * w, 2));
      const a = 2 * Math.PI * n * p.phase;
      re += P * Math.cos(a);
      im += P * Math.sin(a);
    }
    const g = Math.pow(n, -tilt);
    real[n] = re * g; imag[n] = im * g;
  }
  // Synthesise one cycle to measure the crest factor of the (normalised) table.
  // Table-driven: this runs on the first user gesture, so it must not stall the frame.
  const M = 2048;
  const COS = trigTable(M);
  let peak = 0, sum = 0;
  for (let i = 0; i < M; i++) {
    let x = 0;
    for (let n = 1; n < N; n++) {
      const j = (n * i) % M;
      x += real[n] * COS[j] + imag[n] * COS[(j + (M >> 2)) % M];
    }
    if (Math.abs(x) > peak) peak = Math.abs(x);
    sum += x * x;
  }
  const r = Math.sqrt(sum / M);
  const wave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  return { wave, crest: r > 1e-9 ? peak / r : 1, real, imag };
}

/** A few-harmonic wave for turbine / motor whines — brighter than a sine, no aliasing mess. */
export function partialWave(ctx, amps) {
  const N = amps.length + 1;
  const real = new Float32Array(N), imag = new Float32Array(N);
  for (let i = 0; i < amps.length; i++) imag[i + 1] = amps[i];
  return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
}

/** Stereo noise. 'pink' for wind / tyre beds, 'white' for transients. */
export function noiseBuffer(ctx, seconds = 3, kind = 'pink', seed = 3) {
  const n = Math.max(256, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    const r = rng(seed + c * 7919);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) {
      const w = r() * 2 - 1;
      if (kind === 'pink') {
        b0 = 0.99765 * b0 + w * 0.0990460;
        b1 = 0.96300 * b1 + w * 0.2965164;
        b2 = 0.57000 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.24;
      } else d[i] = w * 0.5;
    }
  }
  return buf;
}

/**
 * Procedural impulse response: a handful of discrete early reflections (pit wall,
 * grandstand face, the opposite barrier) over a short, air-damped diffuse tail.
 * This is what makes the engine note "slap" off the surroundings instead of sitting dry.
 */
export function makeIR(ctx, {
  seconds = 0.85, decay = 0.34, damp = 0.62, seed = 5,
  taps = [[0.0105, 0.68], [0.0186, -0.52], [0.0293, 0.40], [0.0461, -0.30], [0.0672, 0.22], [0.0955, -0.15]],
} = {}) {
  const sr = ctx.sampleRate;
  const n = Math.max(512, Math.floor(sr * seconds));
  const buf = ctx.createBuffer(2, n, sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    const r = rng(seed + c * 104729);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr, u = i / n;
      const env = Math.exp(-t / decay) * (1 - Math.exp(-t / 0.006));
      const a = Math.max(0.05, 0.6 - 0.55 * u * damp);       // air absorption over time
      lp += a * ((r() * 2 - 1) - lp);
      d[i] = lp * env;
    }
    // early reflections: short filtered bursts, channel-skewed so the walls are not centred
    for (const [tt, amp] of taps) {
      const skew = 1 + (c === 0 ? -0.055 : 0.055) * (1 + tt * 8);
      const i0 = Math.floor(tt * skew * sr);
      let s = 0;
      for (let k = 0; k < 96 && i0 + k < n; k++) {
        s += 0.42 * ((r() * 2 - 1) - s);
        d[i0 + k] += amp * s * Math.exp(-k / 26);
      }
    }
  }
  return buf;
}

/**
 * tanh saturator curve, hard-bounded to `ceil` so a WaveShaper can act as a true limiter.
 * NOTE the small-signal slope is k/tanh(k), i.e. large — a WaveShaper's domain is fixed at
 * [-1,1], so callers MUST feed it through a 1/k pre-gain to keep unity gain below the knee
 * (and to give the curve k units of headroom before it clamps). See SAT_K in graph.js.
 */
export function satCurve(k = 3, ceil = 1, n = 2049) {
  const c = new Float32Array(n);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = ceil * Math.tanh(k * x) / norm;
  }
  return c;
}
