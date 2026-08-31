/**
 * Procedural 2026 F1 power unit. Owner: AUDIO. WebAudio only, no assets, no network.
 *
 * Module contract: class AudioEngine, constructor(ctx), async init(), update(dt).
 * WebAudio needs a user gesture, so init() only installs listeners — the AudioContext and
 * the whole synthesis graph are built on the first pointerdown/keydown. Nothing here
 * touches an AudioContext before that, and every entry point is a no-op until it exists.
 *
 * The synthesis itself lives in ./graph.js (buildGraph takes any BaseAudioContext) and the
 * state -> parameter mapping in ./params.js, so tools/probe_audio.mjs can render the exact
 * same graph inside an OfflineAudioContext and measure it.
 */
import { buildGraph } from './graph.js';
import { PowerUnitModel } from './params.js';

export class AudioEngine {
  constructor(ctx) {
    this.ctx = ctx;
    this.state = ctx.state;
    this.on = false;
    this.ac = null;
    this.graph = null;
    this.model = new PowerUnitModel();
    this.queued = [];        // events raised before the graph exists
    this.muted = false;
    this._warned = false;
  }

  async init() {
    const start = () => {
      removeEventListener('pointerdown', start);
      removeEventListener('keydown', start);
      if (!this.on) { this.on = true; this.#boot(); }
    };
    addEventListener('pointerdown', start);
    addEventListener('keydown', start);

    const bus = this.ctx.bus;
    bus.on('car:shift', (d) => this.#emit(this.model.shift(d ?? {})));
    bus.on('car:impact', (d) => this.#emit([{
      name: 'impact',
      d: { strength: Math.min(1, (d?.speed ?? 20) / 55) },
      at: 0,
    }]));
    bus.on('game:reset', () => this.#silence());

    // N mutes. C/H/M/V and the driving keys are owned by other modules — do not take those.
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyN' && !e.repeat) this.setMuted(!this.muted);
    });
    addEventListener('visibilitychange', () => {
      if (!this.ac) return;
      try { document.hidden ? this.ac.suspend() : this.ac.resume(); } catch { /* noop */ }
    });
  }

  #boot() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ac = new AC({ latencyHint: 'interactive' });
      this.graph = buildGraph(this.ac, { masterGain: 0.9 });
      this.graph.set(this.model.step(this.state, 1 / 60).p, this.ac.currentTime);
      if (this.ac.state === 'suspended') this.ac.resume?.();
      for (const e of this.queued) this.graph.event(e.name, e.d, this.ac.currentTime + (e.at ?? 0));
      this.queued.length = 0;
    } catch (err) {
      console.error('[audio] boot failed', err);
      this.ac = null; this.graph = null;
    }
  }

  #emit(list) {
    if (!Array.isArray(list) || !list.length) return;
    if (!this.graph) {
      if (this.queued.length < 8) this.queued.push(...list);
      return;
    }
    const now = this.ac.currentTime;
    for (const e of list) {
      try { this.graph.event(e.name, e.d ?? {}, now + (e.at ?? 0)); } catch { /* noop */ }
    }
  }

  /** game:reset — dump the turbo/tyre integrators so the car does not restart mid-spool. */
  #silence() {
    this.model = new PowerUnitModel();
    if (!this.graph) return;
    try {
      const { p } = this.model.step(this.state, 1 / 60);
      this.graph.set({ ...p, iceLevel: 0, bodyLevel: 0, intakeLevel: 0, turboLevel: 0, turboAirLevel: 0 }, this.ac.currentTime);
    } catch { /* noop */ }
  }

  setMuted(m) {
    this.muted = !!m;
    if (this.ac) {
      try { this.muted ? this.ac.suspend() : this.ac.resume(); } catch { /* noop */ }
    }
  }

  update(dt) {
    if (!this.graph || this.muted) return;
    if (this.ac.state === 'suspended') return;   // resumes on the next gesture
    let frame;
    try {
      frame = this.model.step(this.state, dt);
    } catch (err) {
      if (!this._warned) { this._warned = true; console.error('[audio] param step failed', err); }
      return;
    }
    const now = this.ac.currentTime;
    this.graph.set(frame.p, now);
    for (const e of frame.events) {
      try { this.graph.event(e.name, e.d ?? {}, now + (e.at ?? 0)); } catch { /* noop */ }
    }
  }
}
