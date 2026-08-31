/**
 * Bootstrap + fixed-step loop. Owner: CORE.
 * MODULE CONTRACT — every module is a class:
 *   constructor(ctx)      // ctx = { scene, renderer, camera, state, config, bus, get(name) }
 *   async init()          // build resources; may await
 *   fixedUpdate(h)        // optional, 1/120 s deterministic step (physics only)
 *   update(dt)            // per-frame, after physics
 *   lateUpdate(dt)        // after camera solve
 *   resize(w, h)          // optional
 * Modules are isolated: a throw is caught and logged, the rest of the game keeps running.
 */
import * as THREE from 'three';
import { createState } from './core/state.js';
import { CONFIG } from './core/config.js';
import { Bus } from './core/bus.js';

import { RenderPipeline } from './render/pipeline.js';
import { Track } from './track/track.js';
import { Environment } from './track/environment.js';
import { CarModel } from './car/carModel.js';
import { VehiclePhysics } from './physics/vehicle.js';
import { CameraRig } from './camera/cameras.js';
import { InputManager } from './input/input.js';
import { HUD } from './ui/hud.js';
import { AudioEngine } from './audio/engine.js';
import { VFX } from './vfx/effects.js';
import { TimeTrial } from './game/timetrial.js';

const FIXED = 1 / 120;

class Game {
  constructor() {
    this.state = createState();
    this.config = CONFIG;
    this.bus = new Bus();
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.25, 6000);
    this.modules = new Map();
    this.acc = 0;
    this.clock = new THREE.Clock();
  }

  ctx() {
    return {
      scene: this.scene, camera: this.camera, renderer: this.renderer,
      state: this.state, config: this.config, bus: this.bus,
      get: (n) => this.modules.get(n),
      game: this,
    };
  }

  async init() {
    const canvas = document.getElementById('viewport');
    // Render pipeline owns the WebGLRenderer; it must come first.
    const ctx0 = this.ctx();
    ctx0.canvas = canvas;
    const render = new RenderPipeline(ctx0);
    await render.init();
    this.renderer = render.renderer;
    this.modules.set('render', render);

    const defs = [
      ['track', Track], ['env', Environment], ['car', CarModel],
      ['physics', VehiclePhysics], ['input', InputManager], ['camera', CameraRig],
      ['vfx', VFX], ['audio', AudioEngine], ['hud', HUD], ['game', TimeTrial],
    ];
    for (const [name, Cls] of defs) {
      try {
        const m = new Cls(this.ctx());
        this.modules.set(name, m);
      } catch (e) { console.error(`[${name}] construct failed`, e); }
    }
    for (const [name, m] of this.modules) {
      if (m.init && name !== 'render') {
        try { await m.init(); } catch (e) { console.error(`[${name}] init failed`, e); }
      }
    }
    addEventListener('resize', () => this.resize());
    this.resize();
    this.state.flags.ready = true;
    window.__F1 = this; window.__THREE = THREE;   // capture/telemetry hook
    this.loop();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    for (const [n, m] of this.modules) { try { m.resize?.(w, h); } catch (e) { console.error(n, e); } }
  }

  step(dt) {
    const s = this.state;
    s.dt = dt; s.t += dt; s.frame++;
    this.#call('input', 'update', dt);
    this.acc = Math.min(this.acc + dt, 0.25);
    while (this.acc >= FIXED) { this.#call('physics', 'fixedUpdate', FIXED); this.acc -= FIXED; }
    for (const n of ['track', 'car', 'game', 'vfx', 'env', 'audio']) this.#call(n, 'update', dt);
    this.#call('camera', 'update', dt);
    for (const n of ['car', 'vfx', 'env', 'hud']) this.#call(n, 'lateUpdate', dt);
    this.#call('hud', 'update', dt);
    this.#call('render', 'update', dt);
  }

  #call(n, fn, a) {
    const m = this.modules.get(n); if (!m || !m[fn]) return;
    try { m[fn](a); } catch (e) {
      if (!this._errs) this._errs = new Set();
      const k = n + fn + e.message;
      if (!this._errs.has(k)) { this._errs.add(k); console.error(`[${n}.${fn}]`, e); }
    }
  }

  loop() {
    requestAnimationFrame(() => this.loop());
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.step(dt);
  }
}

const game = new Game();
game.init().catch((e) => { console.error('FATAL', e); document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f44;position:fixed;top:0;left:0;z-index:99;background:#000;padding:1em">${e.stack}</pre>`); });
