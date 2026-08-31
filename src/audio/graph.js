/**
 * The whole 2026 power-unit synthesis graph. Owner: AUDIO.
 *
 * buildGraph(ctx) works with ANY BaseAudioContext — a live AudioContext in the game, or an
 * OfflineAudioContext in tools/probe_audio.mjs. That is deliberate: it is the only way to
 * measure what this thing actually emits.
 *
 * Signal architecture
 * -------------------
 *   ICE      6 PeriodicWave oscillators = 2 banks x 3 pulse-sharpness tables of a 90-deg V6
 *            firing pattern. One table cycle is 720 crank degrees / 6 combustion events, so the
 *            oscillator runs at rpm/120 and the firing order (3 per crank rev) is harmonic 6,
 *            i.e. rpm/60*3. The banks sit 110 crank degrees apart instead of a clean 120, which
 *            is what puts energy on the half orders (1.5, 4.5, 7.5) and gives the lopsided beat;
 *            per-cylinder amplitude and duration scatter break the rest of the symmetry. The
 *            banks then pass through different sub-millisecond delays so they comb-filter
 *            against each other the way two manifolds into one turbine do.
 *            Downstream: an rpm-tracked turbine back-pressure highpass, a FIXED exhaust
 *            resonator bank (the timbre fingerprint), a load-driven saturator, one tracked
 *            tuned-length resonance on the firing order, an rpm/throttle lowpass and the turbo
 *            muffling shelf.
 *   BODY     lowpassed copy of the same pulse train for the sub-200 Hz plenum boom.
 *   INTAKE   pink noise band, pulse-modulated at the firing rate by a 7th oscillator.
 *   TURBO    lagged shaft-speed model -> turbine whine (4 partials) + compressor air noise;
 *            one-shot wastegate/blow-off chirps on lift.
 *   ERS      MGU-K motor whine (slot-passing tone, detuned pair), step-up gear mesh, and a
 *            fixed inverter switching tone. Rises with ersDeploy / overrideActive.
 *   TYRE     six textures: scrub bed, high-Q squeal, lock-up screech, wheelspin warble,
 *            kerb rumble (pulse-gated at rib-passing rate) and gravel.
 *   WIND     pink noise, cutoff and level rise with speed, plus a low buffet band.
 *   ENV      convolver on a procedural IR + two panned, diffused slap-back taps whose delay
 *            time is 2*wallDistance/343 and which warble at the object-passing rate, so the
 *            note really does bounce off whatever is beside the car.
 *   MASTER   pre-master -> compressor -> limiter -> gain -> tanh clipper (hard-bounded).
 */
import { rng, v6Layout, pulseWave, partialWave, noiseBuffer, makeIR, satCurve } from './waves.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const num = (x, d = 0) => (Number.isFinite(x) ? x : d);

/**
 * Exhaust resonator bank — fixed formants, frequencies do NOT move with rpm (a pipe does not
 * change length). Deliberately BROAD below ~1.2 kHz: narrow low resonators would let whichever
 * engine order happens to sit on them win, and the order balance must be set by the combustion
 * pulse train, not by the EQ. The character lives in the 1.5 kHz turbo notch and the 2.7 kHz rasp.
 */
const RESONATORS = [
  ['peaking', 112, 0.9, 4.5],
  ['peaking', 620, 0.45, 2.5],
  ['peaking', 1500, 1.4, -5.0],
  ['peaking', 2900, 1.1, 4.0],
  ['peaking', 5200, 0.8, -6.0],
];
const SAT_K = 3;      // tanh knee; every WaveShaper is fed through a 1/SAT_K pre-gain

export function buildGraph(ctx, opts = {}) {
  const dest = opts.destination ?? ctx.destination;
  const R = rng(1337);

  const gain = (v = 0) => { const n = ctx.createGain(); n.gain.value = v; return n; };
  const filt = (type, f, q = 1, g = 0) => {
    const n = ctx.createBiquadFilter();
    n.type = type; n.frequency.value = f; n.Q.value = q; n.gain.value = g;
    return n;
  };
  const src = (buf, rate = 1) => {
    const n = ctx.createBufferSource();
    n.buffer = buf; n.loop = true; n.playbackRate.value = rate;
    return n;
  };

  // ------------------------------------------------------------------ master chain
  const preMaster = gain(1);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -15; comp.knee.value = 12; comp.ratio.value = 3;
  comp.attack.value = 0.005; comp.release.value = 0.18;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3.5; limiter.knee.value = 0; limiter.ratio.value = 18;
  limiter.attack.value = 0.0012; limiter.release.value = 0.06;
  const master = gain(opts.masterGain ?? 0.9);
  // Final safety net: 1/k pre-gain + tanh curve => unity below the knee, |out| <= 0.94 ALWAYS.
  const clipPre = gain(1 / SAT_K);
  const clip = ctx.createWaveShaper();
  clip.curve = satCurve(SAT_K, 0.94);
  clip.oversample = '2x';
  if (opts.noDynamics) {                  // gain-structure measurement path, see probe_audio
    preMaster.connect(master); master.connect(dest);
  } else {
    preMaster.connect(comp); comp.connect(limiter); limiter.connect(master);
    master.connect(clipPre); clipPre.connect(clip); clip.connect(dest);
  }

  // group buses
  const iceBus = gain(1), turboBus = gain(1), ersBus = gain(1), tyreBus = gain(1), windBus = gain(1);
  for (const b of [iceBus, turboBus, ersBus, tyreBus, windBus]) b.connect(preMaster);

  // ------------------------------------------------------------------ noise beds
  const pink = noiseBuffer(ctx, 3.1, 'pink', 3);
  const white = noiseBuffer(ctx, 1.7, 'white', 17);
  const started = [];

  // ------------------------------------------------------------------ ICE
  const layout = v6Layout({ uneven: 10, scatter: 0.09, widthScatter: 0.2, seed: 11 });
  const HARDNESS = [0.0165, 0.0082, 0.0043];   // pulse width, cycle fraction (soft -> cracking)
  const TILT = [0.62, 0.52, 0.44];
  const iceRaw = gain(1);
  const banks = [];
  for (const [bi, pulses] of [layout.A, layout.B].entries()) {
    const sum = gain(1);
    const oscs = [];
    for (let h = 0; h < HARDNESS.length; h++) {
      const pw = pulseWave(ctx, pulses, { width: HARDNESS[h], tilt: TILT[h], harmonics: 200 });
      const o = ctx.createOscillator();
      o.setPeriodicWave(pw.wave);
      o.frequency.value = 60;
      const g = gain(0);
      o.connect(g); g.connect(sum);
      oscs.push({ o, g, crest: pw.crest });
      started.push(o);
    }
    // manifold path length -> sub-millisecond inter-bank delay -> comb colouration
    const d = ctx.createDelay(0.02);
    d.delayTime.value = bi === 0 ? 0.00021 : 0.00072;
    const tone = filt('peaking', bi === 0 ? 1750 : 2450, 1.1, bi === 0 ? 1.6 : -1.6);
    sum.connect(d); d.connect(tone); tone.connect(iceRaw);
    banks.push({ oscs, sum });
  }
  const iceOscs = banks.flatMap((b) => b.oscs);

  // One control source feeding every ICE oscillator's detune, so events (the downshift
  // throttle blip, the rev-limiter flutter) can bend the whole engine without fighting the
  // per-frame frequency automation.
  const detuneCtl = ctx.createConstantSource ? ctx.createConstantSource() : null;
  if (detuneCtl) {
    detuneCtl.offset.value = 0;
    for (const o of iceOscs) detuneCtl.connect(o.o.detune);
  }

  // Turbine back-pressure highpass. A turbo swallows the low-frequency pulsation that an
  // NA engine radiates, so this tracks BELOW the firing order and kills the half-orders
  // that live under it — the single biggest "turbo, not V10" cue after the muffling shelf.
  const hp = filt('highpass', 200, 0.95);
  let node = hp;
  iceRaw.connect(hp);
  for (const [t, f, q, g] of RESONATORS) { const n = filt(t, f, q, g); node.connect(n); node = n; }
  const satDrive = gain(1 / SAT_K);
  const sat = ctx.createWaveShaper();
  sat.curve = satCurve(SAT_K, 1); sat.oversample = '4x';
  const satTrim = gain(0.5);
  node.connect(satDrive); satDrive.connect(sat); sat.connect(satTrim);
  // Tuned-length exhaust: the one resonance that DOES track the engine, because that is what
  // a tuned primary/plenum does — it is sized so its quarter-wave lands on the firing order in
  // the power band. Keeps the firing fundamental in front of the half orders at every rpm.
  const tuned = filt('peaking', 500, 1.45, 4.5);
  const iceLP = filt('lowpass', 4200, 0.72);
  const muffle = filt('highshelf', 3300, 0.7, -9);   // turbo eats the top orders
  const iceGain = gain(0);
  satTrim.connect(tuned); tuned.connect(iceLP); iceLP.connect(muffle);
  muffle.connect(iceGain);

  // low-end body, tapped pre-saturation so it stays clean
  const bodyLP = filt('lowpass', 185, 0.9);
  const bodyPk = filt('peaking', 88, 1.2, 6);
  const bodyGain = gain(0);
  iceRaw.connect(bodyLP); bodyLP.connect(bodyPk); bodyPk.connect(bodyGain);

  // Everything the engine makes passes through iceDuck, so an ignition cut / torque
  // interruption silences the whole power unit for a few milliseconds, not just the exhaust.
  const iceSum = gain(1);
  const iceDuck = gain(1);
  iceGain.connect(iceSum); bodyGain.connect(iceSum);
  iceSum.connect(iceDuck); iceDuck.connect(iceBus);

  // firing-rate modulator, drives induction pulsing
  const modWave = pulseWave(ctx, [...layout.A, ...layout.B], { width: 0.028, tilt: 0.8, harmonics: 48 });
  const modOsc = ctx.createOscillator();
  modOsc.setPeriodicWave(modWave.wave); modOsc.frequency.value = 60;
  const modDepth = gain(0);
  modOsc.connect(modDepth); started.push(modOsc);
  if (detuneCtl) { detuneCtl.connect(modOsc.detune); started.push(detuneCtl); }

  // intake / induction
  const intakeSrc = src(pink, 1.0);
  const intakeBP = filt('bandpass', 900, 1.1);
  const intakePk = filt('peaking', 1900, 2.0, 5);
  const intakeGain = gain(0);
  intakeSrc.connect(intakeBP); intakeBP.connect(intakePk); intakePk.connect(intakeGain);
  intakeGain.connect(iceSum);
  modDepth.connect(intakeGain.gain);
  started.push(intakeSrc);

  // ------------------------------------------------------------------ TURBO
  const turbWave = partialWave(ctx, [1, 0.55, 0.28, 0.12, 0.06]);
  const turboOscs = [];
  const turboMix = gain(1);
  for (const [mult, lvl, det] of [[1, 1, 0], [1, 0.5, 9], [1.497, 0.42, 0], [0.5, 0.3, -7]]) {
    const o = ctx.createOscillator();
    o.setPeriodicWave(turbWave); o.frequency.value = 2000; o.detune.value = det;
    const g = gain(lvl);
    o.connect(g); g.connect(turboMix);
    turboOscs.push({ o, mult });
    started.push(o);
  }
  const turboBP = filt('bandpass', 3000, 2.2);
  const turboGain = gain(0);
  turboMix.connect(turboBP); turboBP.connect(turboGain); turboGain.connect(turboBus);
  // compressor air rush
  const airSrc = src(pink, 1.21);
  const airBP = filt('bandpass', 2400, 1.4);
  const airGain = gain(0);
  airSrc.connect(airBP); airBP.connect(airGain); airGain.connect(turboBus);
  started.push(airSrc);

  // ------------------------------------------------------------------ ERS / MGU-K
  const ersWave = partialWave(ctx, [1, 0.4, 0.22, 0.1]);
  const ersMix = gain(1);
  const ersOscs = [];
  for (const [mult, lvl, det] of [[15.6, 1, 6], [15.6, 0.85, -6], [6.85, 0.5, 0], [31.2, 0.22, 0]]) {
    const o = ctx.createOscillator();
    o.setPeriodicWave(ersWave); o.frequency.value = 2000; o.detune.value = det;
    const g = gain(lvl);
    o.connect(g); g.connect(ersMix);
    ersOscs.push({ o, mult });
    started.push(o);
  }
  const ersShape = filt('peaking', 2600, 1.1, 4);
  const ersGain = gain(0);
  ersMix.connect(ersShape); ersShape.connect(ersGain); ersGain.connect(ersBus);
  // inverter switching tone — fixed frequency, pure electronics
  const invOsc = ctx.createOscillator();
  invOsc.type = 'sine'; invOsc.frequency.value = 8700;
  const invGain = gain(0);
  invOsc.connect(invGain); invGain.connect(ersBus);
  started.push(invOsc);

  // ------------------------------------------------------------------ TYRES
  const tyre = {};
  {
    const s = src(pink, 0.93);
    const f1 = filt('bandpass', 380, 0.8), f2 = filt('lowpass', 2200, 0.7);
    const g = gain(0);
    s.connect(f1); f1.connect(f2); f2.connect(g); g.connect(tyreBus);
    tyre.scrub = { g, f: f1 }; started.push(s);
  }
  {
    const s = src(white, 1.0);
    const f1 = filt('bandpass', 1050, 14), f2 = filt('bandpass', 2100, 9);
    const g = gain(0), g2 = gain(0.45);
    s.connect(f1); f1.connect(g);
    s.connect(f2); f2.connect(g2); g2.connect(g);
    g.connect(tyreBus);
    tyre.squeal = { g, f: f1, f2 }; started.push(s);
  }
  {
    const s = src(white, 1.11);
    const f1 = filt('bandpass', 1800, 22), f2 = filt('bandpass', 3050, 16);
    const g = gain(0), g2 = gain(0.6);
    s.connect(f1); f1.connect(g);
    s.connect(f2); f2.connect(g2); g2.connect(g);
    g.connect(tyreBus);
    tyre.lock = { g, f: f1, f2 }; started.push(s);
  }
  {
    const s = src(white, 0.87);
    const f1 = filt('bandpass', 640, 6);
    const g = gain(0);
    const lfo = ctx.createOscillator(); lfo.type = 'triangle'; lfo.frequency.value = 26;
    const lfoG = gain(260);
    lfo.connect(lfoG); lfoG.connect(f1.frequency);
    s.connect(f1); f1.connect(g); g.connect(tyreBus);
    tyre.spin = { g, f: f1, lfo }; started.push(s, lfo);
  }
  {
    // kerb: low rumble + mid clack, both gated by a pulse LFO at rib-passing rate
    const s = src(pink, 1.07);
    const low = filt('lowpass', 190, 1.1), mid = filt('bandpass', 1500, 3);
    const midG = gain(0.35);
    const amp = gain(0);
    const ribWave = pulseWave(ctx, [{ phase: 0, amp: 1, wf: 1 }], { width: 0.11, tilt: 0.4, harmonics: 24 });
    const rib = ctx.createOscillator();
    rib.setPeriodicWave(ribWave.wave); rib.frequency.value = 40;
    const ribG = gain(0);
    rib.connect(ribG); ribG.connect(amp.gain);
    const g = gain(0);
    s.connect(low); low.connect(amp);
    s.connect(mid); mid.connect(midG); midG.connect(amp);
    amp.connect(g); g.connect(tyreBus);
    tyre.kerb = { g, amp, rib, ribG }; started.push(s, rib);
  }
  {
    const s = src(white, 0.79);
    const hp2 = filt('highpass', 620, 0.8), pk = filt('peaking', 2700, 1.4, 6);
    const amp = gain(1);
    const g = gain(0);
    const flutSrc = src(pink, 0.05);
    const flutLP = filt('lowpass', 9, 0.7);
    const flutG = gain(0);
    flutSrc.connect(flutLP); flutLP.connect(flutG); flutG.connect(amp.gain);
    s.connect(hp2); hp2.connect(pk); pk.connect(amp); amp.connect(g); g.connect(tyreBus);
    tyre.gravel = { g, amp, flutG }; started.push(s, flutSrc);
  }

  // ------------------------------------------------------------------ WIND
  const windSrc = src(pink, 1.03);
  const windHP = filt('highpass', 130, 0.7);
  const windLP = filt('lowpass', 1400, 0.6);
  const windPk = filt('peaking', 900, 1.0, 4);
  const windGain = gain(0);
  windSrc.connect(windHP); windHP.connect(windLP); windLP.connect(windPk);
  windPk.connect(windGain); windGain.connect(windBus);
  const buffSrc = src(pink, 0.41);
  const buffLP = filt('lowpass', 110, 0.9);
  const buffGain = gain(0);
  buffSrc.connect(buffLP); buffLP.connect(buffGain); buffGain.connect(windBus);
  started.push(windSrc, buffSrc);

  // ------------------------------------------------------------------ ENVIRONMENT
  const revSend = gain(0.5);
  const conv = ctx.createConvolver();
  conv.normalize = true;
  conv.buffer = makeIR(ctx, { seconds: 0.85, decay: 0.34, damp: 0.62, seed: 5 });
  const wetLP = filt('lowpass', 5200, 0.7);
  const wetGain = gain(0);
  revSend.connect(conv); conv.connect(wetLP); wetLP.connect(wetGain); wetGain.connect(preMaster);

  const slapSend = gain(1);
  const slaps = [];
  // "Picket fencing": you do not pass a smooth wall, you pass pit boxes, poles and grandstand
  // columns. Modulating the tap delay at the object-passing rate is a genuine doppler on the
  // reflected path — the slap warbles as the car goes by, and faster means faster warble.
  const slapMod = ctx.createOscillator();
  slapMod.type = 'sine'; slapMod.frequency.value = 6;
  const slapModD = gain(0);
  slapMod.connect(slapModD); started.push(slapMod);
  for (const [t0, pan, lvl, ap] of [[0.028, -0.75, 1, 640], [0.046, 0.7, 0.72, 1450]]) {
    const d = ctx.createDelay(0.6);
    d.delayTime.value = t0;
    // A real wall is textured and the low end diffracts around it: band-limit the tap to the
    // mids and smear its phase, otherwise a clean delay combs a notch straight through
    // whichever engine order happens to line up with it.
    const f = filt('bandpass', 1750, 0.9);
    const a1 = filt('allpass', ap, 0.6);
    const a2 = filt('allpass', ap * 2.7, 0.5);
    const f2 = filt('lowpass', 4600, 0.7);
    const g = gain(0);
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    slapSend.connect(d); d.connect(f); f.connect(a1); a1.connect(a2); a2.connect(f2); f2.connect(g);
    slapModD.connect(d.delayTime);
    if (p) { p.pan.value = pan; g.connect(p); p.connect(preMaster); } else g.connect(preMaster);
    slaps.push({ d, g, lvl });
  }
  for (const b of [iceBus, turboBus, tyreBus]) b.connect(revSend);
  iceBus.connect(slapSend);

  for (const n of started) { try { n.start(0); } catch { /* already started */ } }

  // ------------------------------------------------------------------ parameter surface
  // ~70 AudioParams x 60 fps is a lot of automation events; skip the ones that have not moved.
  const lastSet = new Map();
  const k = (param, v, t, tau = 0.03) => {
    if (!Number.isFinite(v)) return;
    const prev = lastSet.get(param);
    if (prev !== undefined && Math.abs(v - prev) <= 1e-4 * (1 + Math.abs(prev))) return;
    lastSet.set(param, v);
    try { param.setTargetAtTime(v, Math.max(0, t), tau); } catch { param.value = v; }
  };

  /** Apply a full parameter frame at time `t` (seconds on this context's clock). */
  function set(p, t = ctx.currentTime) {
    const f = clamp(num(p.freq, 33), 4, 400);
    for (const o of iceOscs) k(o.o.frequency, f, t, num(p.freqTau, 0.02));
    k(modOsc.frequency, f, t, num(p.freqTau, 0.02));

    // 3-way crossfade across pulse sharpness; crest-matched so loudness stays put
    const h = clamp(num(p.hardness, 1), 0, 2);
    const w = [clamp(1 - h, 0, 1), clamp(1 - Math.abs(h - 1), 0, 1), clamp(h - 1, 0, 1)];
    const wn = w[0] + w[1] + w[2] || 1;
    for (let b = 0; b < banks.length; b++) {
      for (let i = 0; i < banks[b].oscs.length; i++) {
        const o = banks[b].oscs[i];
        k(o.g.gain, (w[i] / wn) * o.crest * 0.10, t, 0.04);
      }
    }
    k(hp.frequency, clamp(num(p.hpFreq, 200), 40, 1400), t, 0.04);
    k(tuned.frequency, clamp(num(p.tunedFreq, 500), 90, 2400), t, 0.03);
    k(tuned.gain, clamp(num(p.tunedGain, 4.5), 0, 12), t, 0.06);
    const drive = clamp(num(p.satDrive, 1), 0.2, 6);
    k(satDrive.gain, drive / SAT_K, t, 0.06);
    k(satTrim.gain, clamp(0.62 / drive, 0.05, 2), t, 0.06);
    k(iceLP.frequency, clamp(num(p.lpFreq, 3500), 200, 18000), t, 0.05);
    k(muffle.gain, clamp(num(p.muffleDb, -9), -24, 6), t, 0.08);
    k(iceGain.gain, clamp(num(p.iceLevel, 0), 0, 4), t, 0.03);
    k(bodyGain.gain, clamp(num(p.bodyLevel, 0), 0, 4), t, 0.04);

    k(intakeGain.gain, clamp(num(p.intakeLevel, 0), 0, 2), t, 0.04);
    k(modDepth.gain, clamp(num(p.intakeLevel, 0) * num(p.intakeMod, 0.8), 0, 2), t, 0.04);
    k(intakeBP.frequency, clamp(num(p.intakeFreq, 900), 120, 9000), t, 0.05);

    const tf = clamp(num(p.turboFreq, 2000), 200, 14000);
    for (const o of turboOscs) k(o.o.frequency, tf * o.mult, t, 0.09);
    k(turboBP.frequency, clamp(tf * 1.15, 200, 16000), t, 0.09);
    k(turboGain.gain, clamp(num(p.turboLevel, 0), 0, 1), t, 0.07);
    k(airBP.frequency, clamp(tf * 0.72, 200, 14000), t, 0.09);
    k(airGain.gain, clamp(num(p.turboAirLevel, 0), 0, 1), t, 0.07);

    const ef = clamp(num(p.ersBase, 100), 5, 900);
    for (const o of ersOscs) k(o.o.frequency, clamp(ef * o.mult, 20, 18000), t, 0.04);
    k(ersGain.gain, clamp(num(p.ersLevel, 0), 0, 1), t, 0.05);
    k(invGain.gain, clamp(num(p.ersInvLevel, 0), 0, 0.2), t, 0.06);

    k(tyre.scrub.g.gain, clamp(num(p.scrubLevel, 0), 0, 1), t, 0.05);
    k(tyre.scrub.f.frequency, clamp(num(p.scrubFreq, 380), 80, 4000), t, 0.06);
    k(tyre.squeal.g.gain, clamp(num(p.squealLevel, 0), 0, 1), t, 0.03);
    k(tyre.squeal.f.frequency, clamp(num(p.squealFreq, 1050), 300, 5000), t, 0.05);
    k(tyre.squeal.f2.frequency, clamp(num(p.squealFreq, 1050) * 1.97, 300, 9000), t, 0.05);
    k(tyre.lock.g.gain, clamp(num(p.lockLevel, 0), 0, 1), t, 0.02);
    k(tyre.lock.f.frequency, clamp(num(p.lockFreq, 1800), 400, 6000), t, 0.04);
    k(tyre.lock.f2.frequency, clamp(num(p.lockFreq, 1800) * 1.68, 400, 9000), t, 0.04);
    k(tyre.spin.g.gain, clamp(num(p.spinLevel, 0), 0, 1), t, 0.03);
    k(tyre.spin.f.frequency, clamp(num(p.spinFreq, 640), 150, 4000), t, 0.05);
    k(tyre.spin.lfo.frequency, clamp(num(p.spinRate, 26), 4, 90), t, 0.05);
    const kl = clamp(num(p.kerbLevel, 0), 0, 1);
    k(tyre.kerb.g.gain, kl, t, 0.02);
    k(tyre.kerb.amp.gain, 0.12, t, 0.02);
    k(tyre.kerb.ribG.gain, 0.95, t, 0.02);
    k(tyre.kerb.rib.frequency, clamp(num(p.kerbFreq, 40), 3, 160), t, 0.04);
    k(tyre.gravel.g.gain, clamp(num(p.gravelLevel, 0), 0, 1), t, 0.04);
    k(tyre.gravel.flutG.gain, clamp(num(p.gravelLevel, 0) > 0 ? 0.55 : 0, 0, 1), t, 0.05);

    k(windGain.gain, clamp(num(p.windLevel, 0), 0, 1), t, 0.06);
    k(windLP.frequency, clamp(num(p.windFreq, 1400), 200, 12000), t, 0.08);
    k(buffGain.gain, clamp(num(p.buffetLevel, 0), 0, 1), t, 0.08);

    k(wetGain.gain, clamp(num(p.wetLevel, 0), 0, 1.5), t, 0.12);
    k(wetLP.frequency, clamp(num(p.wetFreq, 5200), 500, 16000), t, 0.12);
    const st = clamp(num(p.slapTime, 0.03), 0.004, 0.45);
    for (let i = 0; i < slaps.length; i++) {
      k(slaps[i].d.delayTime, st * (i === 0 ? 1 : 1.62), t, 0.25);
      k(slaps[i].g.gain, clamp(num(p.slapLevel, 0), 0, 1) * slaps[i].lvl, t, 0.12);
    }
    k(slapMod.frequency, clamp(num(p.slapFlutterHz, 6), 0.5, 40), t, 0.15);
    k(slapModD.gain, clamp(num(p.slapFlutter, 0), 0, 0.0025), t, 0.15);
    k(master.gain, clamp(num(p.master, opts.masterGain ?? 0.9), 0, 1), t, 0.08);
  }

  // ------------------------------------------------------------------ one-shots
  // Voice budget by SCHEDULED lifetime, not by onended — an OfflineAudioContext gets the
  // whole programme queued up front, so onended never fires while we are still scheduling.
  let shotEnds = [];
  function burst(t, {
    dur = 0.09, f0 = 1800, f1 = null, q = 3, level = 0.2, type = 'bandpass',
    buf = white, attack = 0.002, target = iceBus, pan = 0,
  }) {
    shotEnds = shotEnds.filter((e) => e > t);
    if (shotEnds.length > 24) return;
    shotEnds.push(t + dur + 0.05);
    const s = ctx.createBufferSource();
    s.buffer = buf; s.loop = true;
    s.playbackRate.value = 0.8 + R() * 0.5;
    const f = filt(type, f0, q);
    const g = gain(0);
    let tail = g;
    if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); tail = p; }
    s.connect(f); f.connect(g); tail.connect(target);
    const t0 = Math.max(0, t);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(level, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    if (f1) { f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(Math.max(60, f1), t0 + dur); }
    const off = R() * (buf.duration - dur - 0.05);
    try { s.start(t0, Math.max(0, off)); } catch { s.start(t0); }
    s.stop(t0 + dur + 0.03);
    s.onended = () => { try { s.disconnect(); f.disconnect(); g.disconnect(); } catch { /* noop */ } };
  }

  /** Ignition-cut / torque-interruption duck on the ICE bus. */
  function duck(t, depth = 0.12, hold = 0.035, back = 0.055) {
    const t0 = Math.max(0, t);
    try {
      iceDuck.gain.cancelScheduledValues(t0);
      iceDuck.gain.setValueAtTime(1, t0);
      iceDuck.gain.linearRampToValueAtTime(depth, t0 + 0.006);
      iceDuck.gain.setValueAtTime(depth, t0 + hold);
      iceDuck.gain.linearRampToValueAtTime(1, t0 + hold + back);
    } catch { /* noop */ }
  }

  /** Bend every ICE oscillator by `cents` for `hold` seconds — the downshift blip. */
  function bend(t, cents, rise = 0.035, hold = 0.07, fall = 0.13) {
    if (!detuneCtl) return;
    const t0 = Math.max(0, t);
    try {
      detuneCtl.offset.cancelScheduledValues(t0);
      detuneCtl.offset.setValueAtTime(0, t0);
      detuneCtl.offset.linearRampToValueAtTime(cents, t0 + rise);
      detuneCtl.offset.setValueAtTime(cents, t0 + rise + hold);
      detuneCtl.offset.linearRampToValueAtTime(0, t0 + rise + hold + fall);
    } catch { /* noop */ }
  }

  function event(name, d = {}, t = ctx.currentTime) {
    const s = clamp(num(d.strength, 1), 0, 1.5);
    switch (name) {
      case 'upshift':
        duck(t, 0.05, 0.030 + 0.012 * s, 0.05);
        burst(t + 0.030, { dur: 0.075, f0: 2600, f1: 700, q: 1.1, level: 0.42 * s, pan: 0.1 });
        burst(t + 0.034, { dur: 0.14, f0: 180, f1: 90, q: 0.9, level: 0.30 * s });
        break;
      case 'downshift':
        duck(t, 0.28, 0.020, 0.045);
        bend(t + 0.02, 200 * s, 0.045, 0.06, 0.17);   // throttle blip to match the lower gear
        burst(t + 0.020, { dur: 0.055, f0: 1500, f1: 620, q: 1.4, level: 0.24 * s, pan: -0.1 });
        burst(t + 0.075, { dur: 0.10, f0: 900, f1: 380, q: 1.0, level: 0.18 * s });
        break;
      case 'blowoff':
        burst(t, { dur: 0.30 + 0.16 * s, f0: 2900, f1: 1150, q: 1.5, level: 0.30 * s, buf: pink, attack: 0.012, target: turboBus, pan: 0.2 });
        burst(t + 0.02, { dur: 0.16, f0: 5200, f1: 3000, q: 2.2, level: 0.13 * s, buf: white, target: turboBus, pan: -0.25 });
        break;
      case 'pop': {
        const f0 = 420 + R() * 1700;
        burst(t, { dur: 0.020 + R() * 0.045, f0, f1: f0 * 0.45, q: 5 + R() * 8, level: 0.16 + 0.34 * s, pan: R() * 1.2 - 0.6 });
        if (R() < 0.35) burst(t + 0.004, { dur: 0.09, f0: 130, f1: 80, q: 0.9, level: 0.10 + 0.16 * s });
        break;
      }
      case 'limiter':
        duck(t, 0.22, 0.012, 0.018);
        break;
      case 'impact':
        burst(t, { dur: 0.34, f0: 150, f1: 60, q: 0.8, level: 0.5 * s });
        burst(t, { dur: 0.11, f0: 2600, f1: 900, q: 1.2, level: 0.34 * s, buf: white });
        break;
      default: break;
    }
  }

  function dispose() {
    for (const n of started) { try { n.stop(); } catch { /* noop */ } }
    try { preMaster.disconnect(); clip.disconnect(); } catch { /* noop */ }
  }

  return {
    ctx, set, event, dispose,
    nodes: { preMaster, comp, limiter, master, clip, iceBus, turboBus, ersBus, tyreBus, windBus, iceGain, wetGain },
  };
}
