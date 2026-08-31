/**
 * VFX — transient effects. Owner: VFX.  Interface: constructor(ctx) / init() / update(dt) / lateUpdate(dt).
 *
 * Systems (draw calls in brackets):
 *   [1] SmokeSystem  lit soft billboards: lock-up plumes, wheelspin, slide smoke, brake dust,
 *                    gravel/sand plumes, grass clods, kerb dust, Sakhir sand haze, debris chips
 *   [1] StreakSystem additive stretched billboards: titanium skid sparks (gravity + bounce +
 *                    fragmenting), brake-disc glow wash, air/dust speed streaks, wingtip vortices
 *   [1] SkidMarks    persistent rubber ribbons welded into the road surface
 *   [1] Marbles      instanced rubber marbles off the racing line
 *   [+1 composer pass] HeatHaze  exhaust / diffuser / brake-duct refraction + kerb jolt
 *
 * Everything is pooled and typed-array driven: no per-particle Object3D, no per-frame
 * allocation in the hot path, one shared emit descriptor per system.
 *
 * Exposure: RENDER tone-maps with a large exposure (state.render.exposure), so particle
 * radiance is authored *relative to that* — see this.gain / this.addGain. If the render
 * module re-grades, the smoke follows instead of blowing out.
 */
import * as THREE from 'three';
import { makeSmokeAtlas, makeMarkTexture } from './textures.js';
import { LightProbe } from './lighting.js';
import { SmokeSystem } from './smoke.js';
import { StreakSystem } from './streaks.js';
import { SkidMarks } from './marks.js';
import { Marbles } from './marbles.js';
import { HeatHaze } from './haze.js';

// Local copy of the car geometry (mirrors src/car/dims.js and physics/vehicle.js).
// Deliberately NOT imported: a rename in another module must never break this one.
const GROUND_LOCAL = 0.32;       // car origin height above the road
const WHEELS = [
  { x: -0.815, z: 1.55, front: true, r: 0.330, hw: 0.135 },
  { x: 0.815, z: 1.55, front: true, r: 0.330, hw: 0.135 },
  { x: -0.7625, z: -1.85, front: false, r: 0.360, hw: 0.1875 },
  { x: 0.7625, z: -1.85, front: false, r: 0.360, hw: 0.1875 },
];

const rr = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class VFX {
  constructor(ctx) {
    this.ctx = ctx; this.state = ctx.state; this.scene = ctx.scene;
    this.ready = false;
    this.q = new THREE.Quaternion();
    this.fwd = new THREE.Vector3(); this.right = new THREE.Vector3(); this.up = new THREE.Vector3();
    this.tmp = new THREE.Vector3();
    this.wp = [0, 1, 2, 3].map(() => new THREE.Vector3());
    this.wcen = [0, 1, 2, 3].map(() => new THREE.Vector3());
    this.wsurf = ['asphalt', 'asphalt', 'asphalt', 'asphalt'];
    this.wprev = ['asphalt', 'asphalt', 'asphalt', 'asphalt'];
    this.wlat = new Float32Array(4);      // |lateral offset from the racing line|
    this.wgy = new Float32Array(4);       // road height under each contact patch
    this.relVel = new THREE.Vector3();
    this.acc = {
      lock: new Float32Array(4), spin: new Float32Array(4), slide: new Float32Array(4),
      dust: new Float32Array(4), chip: new Float32Array(4), glow: new Float32Array(4),
      bdust: new Float32Array(4), spark: 0, wake: 0, streak: 0, vortex: 0,
    };
    this.hintS = 0; this.prevY = 0; this.prevVY = 0; this.compress = 0; this.bump = 0;
    this.lastPos = new THREE.Vector3(); this.groundY = 0; this.halfWidth = 8;
    this.gain = 0.17; this.addGain = 0.29;
    this.stats = { smoke: 0, streaks: 0, markQuads: 0 };
  }

  async init() {
    this.track = this.ctx.get('track');
    this.atlas = makeSmokeAtlas(512);
    this.markTex = makeMarkTexture(128);
    this.smoke = new SmokeSystem(this.scene, this.atlas, 1400);
    this.streaks = new StreakSystem(this.scene, 1700);
    this.marks = new SkidMarks(this.scene, this.markTex);
    this.marbles = new Marbles(this.scene);
    this.haze = new HeatHaze(this.ctx);
    this.probe = new LightProbe(this.scene);
    this.haze.attach();
    const fog = this.scene.fog;
    this.smoke.setFog(fog); this.streaks.setFog(fog); this.marks.setFog(fog);
    this.lastPos.copy(this.state.car.position);
    this.prevY = this.state.car.position.y;
    this.ctx.bus.on('game:reset', () => { for (let i = 0; i < 4; i++) this.marks.lift(i); });
    console.log('[vfx] 4 draw calls (smoke, streaks, skid marks, marbles) + 1 composer pass');
    this.ready = true;
  }

  // ---------------------------------------------------------------- per frame
  update(dt) {
    if (!this.ready || this.state.flags.paused) return;
    dt = clamp(dt, 0.0001, 0.05);
    const st = this.state, c = st.car, inp = st.input;
    const kph = c.kph;

    const expo = st.render.exposure || 1;
    this.gain = clamp(1.45 / expo, 0.04, 2.5);      // smoke lighting level
    this.addGain = clamp(2.55 / expo, 0.05, 3.5);   // additive (sparks / glow) level

    this.q.copy(c.quaternion);
    this.fwd.set(0, 0, 1).applyQuaternion(this.q);
    this.right.set(1, 0, 0).applyQuaternion(this.q);
    this.up.set(0, 1, 0).applyQuaternion(this.q);

    // teleport guard (capture harness / flashback): never draw a mark across the map
    if (this.lastPos.distanceToSquared(c.position) > 144) {
      for (let i = 0; i < 4; i++) this.marks.lift(i);
    }
    this.lastPos.copy(c.position);

    // --- ground height + per-wheel surface -----------------------------------
    const loc = this.track?.locate ? this.track.locate(c.position, this.hintS) : null;
    if (loc) { this.hintS = loc.s; this.groundY = loc.height; this.halfWidth = loc.halfWidth; }
    else this.groundY = c.position.y - GROUND_LOCAL;
    const gy = this.groundY;

    // the rubbered-in line, so "off the racing line" means the real thing
    let lineLat = 0;
    if (loc && this.track?.racingLineAt) {
      const rl = this.track.racingLineAt(loc.s);
      if (Number.isFinite(rl)) lineLat = rl;
    }
    for (let i = 0; i < 4; i++) {
      const W = WHEELS[i];
      this.tmp.set(W.x, 0, W.z).applyQuaternion(this.q);
      this.wp[i].copy(c.position).add(this.tmp);
      let surf = 'asphalt', h = gy;
      // per-wheel query: the inside wheel can be on the kerb while the rest is on track,
      // and locate() resolves the road height AT that lateral offset (camber, kerb, apron)
      if (this.track?.locate) {
        const wl = this.track.locate(this.wp[i], this.hintS);
        surf = wl.surface === 'wall' ? 'gravel' : wl.surface;
        h = wl.height;
        this.wlat[i] = Math.abs(wl.lateral - lineLat);
      } else this.wlat[i] = 0;
      // PHYSICS owns the contract value; honour it when it is the more severe reading
      const sv = c.wheel[i].surface;
      if (sv === 'gravel' && surf === 'asphalt') surf = 'gravel';
      if (sv === 'grass') surf = 'grass';
      this.wgy[i] = h;
      this.wp[i].setY(h + 0.01);
      this.wcen[i].copy(c.position).add(this.tmp).setY(h + W.r);
      this.wprev[i] = this.wsurf[i];
      this.wsurf[i] = surf;
    }

    // --- plank compression signal, derived from the car's own vertical motion
    const vy = (c.position.y - this.prevY) / dt;
    const ay = (vy - this.prevVY) / dt;
    this.prevY = c.position.y; this.prevVY = vy;
    this.compress = this.compress * 0.86 + clamp(ay / 7, -1, 1) * 0.14;
    this.bump += dt;

    this.#wheelEffects(dt, c, inp, kph, gy);
    this.#sparks(dt, c, inp, kph, gy);
    this.#brakes(dt, c, inp, kph, gy);
    this.#wake(dt, c, kph, gy);
    this.#vortex(dt, c, kph);

    this.smoke.update(dt);
    this.streaks.update(dt);
    this.marks.flush();
    if (loc) this.marbles.update(this.track, loc.s);

    this.probe.update(dt, c.position);
    this.smoke.setLight(this.probe, this.gain);
    this.stats.smoke = this.smoke.count;
    this.stats.streaks = this.streaks.count;
    this.stats.markQuads = this.marks.written;
  }

  lateUpdate(dt) {
    if (!this.ready) return;
    dt = clamp(dt, 0.0001, 0.05);
    const cam = this.ctx.camera, c = this.state.car;
    this.smoke.setCamera(cam);
    this.relVel.copy(c.velocity);
    this.streaks.setRelVel(this.relVel);

    this.#speedStreaks(dt, c, cam);

    // heat haze sources: exhaust, diffuser, brake ducts
    this.haze.begin(dt);
    const thr = this.state.input.throttle, brk = this.state.input.brake, kph = c.kph;
    this.tmp.set(0, 0.24, -2.36).applyQuaternion(this.q).add(c.position);
    this.haze.add(cam, this.tmp.x, this.tmp.y, this.tmp.z, 0.5, 0.34 + 0.5 * thr);
    if (kph > 80) {
      this.tmp.set(0, -0.06, -2.1).applyQuaternion(this.q).add(c.position);
      this.haze.add(cam, this.tmp.x, this.tmp.y, this.tmp.z, 0.85, 0.16 + 0.32 * clamp(kph / 300, 0, 1));
    }
    if (brk > 0.25 && kph > 40) {
      for (let i = 0; i < 4; i += 3) {
        this.haze.add(cam, this.wcen[i].x, this.wcen[i].y, this.wcen[i].z, 0.34, 0.3 * brk);
      }
    }
    this.haze.end();
  }

  resize(w, h) { this.haze?.resize(w, h); }

  // ---------------------------------------------------------------- wheels
  #wheelEffects(dt, c, inp, kph, gyCar) {
    const S = this.smoke, d = S.d, A = this.acc;
    for (let i = 0; i < 4; i++) {
      const W = WHEELS[i], w = c.wheel[i], p = this.wp[i];
      const gy = this.wgy[i];
      const surf = this.wsurf[i];
      const onRoad = surf === 'asphalt' || surf === 'kerb';
      const slip = Math.max(0, w.gripUse - 0.98);
      const locked = (w.locked || (inp.brake > 0.4 && w.gripUse > 1.0)) && kph > 22;
      const spinning = w.spinning && !W.front && kph < 260;
      const sliding = !locked && !spinning && slip > 0.06 && kph > 55 && Math.abs(w.slipAngle) > 0.11;
      const vscale = clamp(kph / 120, 0, 1);

      // ---- lock-up: dense white plume that billows, lifts and hangs
      if (locked && onRoad) {
        const inten = clamp(slip * 3.2 + Math.abs(w.slipRatio) * 1.2, 0.15, 1);
        A.lock[i] += dt * (18 + 48 * inten) * vscale;
        while (A.lock[i] >= 1) {
          A.lock[i] -= 1;
          const side = W.x < 0 ? -1 : 1;
          d.x = p.x + rr(-0.14, 0.14); d.z = p.z + rr(-0.14, 0.14);
          d.y = gy + rr(0.04, 0.14);
          d.vx = c.velocity.x * 0.34 + this.right.x * side * rr(0.2, 1.5) + rr(-0.5, 0.5);
          d.vz = c.velocity.z * 0.34 + this.right.z * side * rr(0.2, 1.5) + rr(-0.5, 0.5);
          d.vy = rr(1.1, 2.9) * (0.5 + 0.5 * inten);
          d.size = rr(0.30, 0.55); d.grow = rr(5.5, 9);
          d.ttl = rr(1.5, 2.9); d.alpha = rr(0.42, 0.72) * (0.5 + 0.5 * inten);
          d.r = 0.97; d.g = 0.955; d.b = 0.93;
          d.gy = gy - 0.14; d.cell = (Math.random() * 3) | 0; d.hard = 0;
          d.drag = 1.05; d.buoy = rr(0.5, 1.05); d.turb = 1.1; d.bounce = 0; d.rotv = 0.8;
          S.emit();
        }
        this.#mark(i, W, p, clamp(0.5 + inten * 0.5, 0, 1) * clamp(kph / 60, 0.35, 1));
      } else if (spinning && onRoad) {
        // ---- wheelspin: rear axle only, thrown backwards off the contact patch
        const inten = clamp(Math.abs(w.slipRatio) * 2.4 + slip * 2, 0.2, 1);
        A.spin[i] += dt * (14 + 34 * inten);
        while (A.spin[i] >= 1) {
          A.spin[i] -= 1;
          d.x = p.x + rr(-0.16, 0.16) - this.fwd.x * 0.25;
          d.z = p.z + rr(-0.16, 0.16) - this.fwd.z * 0.25;
          d.y = gy + rr(0.03, 0.12);
          d.vx = c.velocity.x * 0.28 - this.fwd.x * rr(1.5, 4.5) + rr(-0.7, 0.7);
          d.vz = c.velocity.z * 0.28 - this.fwd.z * rr(1.5, 4.5) + rr(-0.7, 0.7);
          d.vy = rr(0.8, 2.2);
          d.size = rr(0.26, 0.48); d.grow = rr(5, 8);
          d.ttl = rr(1.2, 2.4); d.alpha = rr(0.34, 0.6) * (0.5 + 0.5 * inten);
          d.r = 0.88; d.g = 0.875; d.b = 0.88;
          d.gy = gy - 0.14; d.cell = (Math.random() * 3) | 0; d.hard = 0;
          d.drag = 1.15; d.buoy = rr(0.45, 0.9); d.turb = 1.2; d.bounce = 0; d.rotv = 0.9;
          S.emit();
        }
        this.#mark(i, W, p, clamp(0.35 + inten * 0.5, 0, 1));
      } else if (sliding && onRoad) {
        // ---- big slide: thin smoke off the shoulder + a light stain
        A.slide[i] += dt * (5 + 26 * clamp(slip * 4, 0, 1)) * vscale;
        while (A.slide[i] >= 1) {
          A.slide[i] -= 1;
          d.x = p.x + rr(-0.15, 0.15); d.z = p.z + rr(-0.15, 0.15); d.y = gy + rr(0.03, 0.1);
          d.vx = c.velocity.x * 0.3 + rr(-1, 1); d.vz = c.velocity.z * 0.3 + rr(-1, 1);
          d.vy = rr(0.6, 1.7);
          d.size = rr(0.22, 0.4); d.grow = rr(5, 8); d.ttl = rr(0.9, 1.8);
          d.alpha = rr(0.16, 0.34); d.r = 0.9; d.g = 0.9; d.b = 0.9;
          d.gy = gy - 0.14; d.cell = (Math.random() * 3) | 0; d.hard = 0;
          d.drag = 1.2; d.buoy = 0.6; d.turb = 1.0; d.bounce = 0; d.rotv = 0.8;
          S.emit();
        }
        this.#mark(i, W, p, clamp(slip * 2.2, 0, 0.5));
      } else {
        this.marks.lift(i);
      }

      // ---- off-track: sand / gravel / grass
      if (!onRoad && kph > 12) {
        const heavy = surf === 'gravel';
        const grass = surf === 'grass';
        const f = clamp(kph / 160, 0.15, 1);
        A.dust[i] += dt * (heavy ? 34 : 18) * f;
        while (A.dust[i] >= 1) {
          A.dust[i] -= 1;
          d.x = p.x + rr(-0.2, 0.2); d.z = p.z + rr(-0.2, 0.2); d.y = gy + rr(0.05, 0.3);
          d.vx = c.velocity.x * 0.24 - this.fwd.x * rr(0, 3) + rr(-1.6, 1.6);
          d.vz = c.velocity.z * 0.24 - this.fwd.z * rr(0, 3) + rr(-1.6, 1.6);
          d.vy = rr(1.0, 3.4) * (heavy ? 1.15 : 0.85);
          d.size = rr(0.35, 0.8); d.grow = rr(5, 9);
          d.ttl = rr(2.2, 4.4); d.alpha = rr(0.3, 0.6) * (heavy ? 1 : 0.7);
          if (grass) { d.r = 0.42; d.g = 0.40; d.b = 0.26; }
          else { d.r = 0.80; d.g = 0.665; d.b = 0.46; }       // Sakhir sand
          d.gy = gy - 0.2; d.cell = (Math.random() * 3) | 0; d.hard = 0;
          d.drag = 0.85; d.buoy = rr(0.15, 0.5); d.turb = 0.9; d.bounce = 0; d.rotv = 0.7;
          S.emit();
        }
        A.chip[i] += dt * (heavy ? 26 : 8) * f;
        while (A.chip[i] >= 1) {
          A.chip[i] -= 1;
          d.x = p.x + rr(-0.2, 0.2); d.z = p.z + rr(-0.2, 0.2); d.y = gy + 0.05;
          d.vx = c.velocity.x * 0.18 - this.fwd.x * rr(1, 7) + rr(-3.5, 3.5);
          d.vz = c.velocity.z * 0.18 - this.fwd.z * rr(1, 7) + rr(-3.5, 3.5);
          d.vy = rr(2.5, 7.5);
          d.size = rr(0.035, 0.1); d.grow = 0; d.ttl = rr(1.4, 2.6); d.alpha = 1;
          if (grass) { d.r = 0.2; d.g = 0.3; d.b = 0.12; } else { d.r = 0.5; d.g = 0.42; d.b = 0.31; }
          d.gy = gy; d.cell = 3; d.hard = 1;
          d.drag = 0.25; d.buoy = 0; d.turb = 0; d.bounce = 0.38; d.rotv = 3;
          S.emit();
        }
        // the Sakhir signature: a broad sand haze that hangs in the floodlights
        if (Math.random() < dt * 8 * f) {
          d.x = p.x + rr(-1, 1); d.z = p.z + rr(-1, 1); d.y = gy + rr(0.4, 1.4);
          d.vx = c.velocity.x * 0.12 + rr(-1, 1); d.vz = c.velocity.z * 0.12 + rr(-1, 1);
          d.vy = rr(0.2, 0.9);
          d.size = rr(1.6, 3.4); d.grow = rr(3, 6); d.ttl = rr(3.5, 6.5); d.alpha = rr(0.07, 0.16);
          d.r = 0.76; d.g = 0.64; d.b = 0.47;
          d.gy = gy - 0.8; d.cell = (Math.random() * 3) | 0; d.hard = 0;
          d.drag = 0.3; d.buoy = 0.12; d.turb = 0.5; d.bounce = 0; d.rotv = 0.3;
          S.emit();
        }
      }

      // ---- kerb strike: dust impulse, jolt, and sparks off the plank
      if (surf === 'kerb' && this.wprev[i] !== 'kerb' && kph > 45) this.#kerbStrike(i, p, c, kph, gy);
      if (surf === 'astro' && this.wprev[i] === 'asphalt' && kph > 60) this.haze.kick(0.12);

      // ---- marbles kicked up off the racing line
      if (onRoad && kph > 90 && this.wlat[i] > 2.1 && Math.random() < dt * 9) {
        d.x = p.x + rr(-0.2, 0.2); d.z = p.z + rr(-0.2, 0.2); d.y = gy + 0.04;
        d.vx = c.velocity.x * 0.1 - this.fwd.x * rr(1, 5) + rr(-2.5, 2.5);
        d.vz = c.velocity.z * 0.1 - this.fwd.z * rr(1, 5) + rr(-2.5, 2.5);
        d.vy = rr(1.5, 5);
        d.size = rr(0.03, 0.07); d.grow = 0; d.ttl = rr(2.5, 5); d.alpha = 1;
        d.r = 0.15; d.g = 0.13; d.b = 0.12;
        d.gy = gy; d.cell = 3; d.hard = 1;
        d.drag = 0.35; d.buoy = 0; d.turb = 0; d.bounce = 0.42; d.rotv = 4;
        S.emit();
      }
    }
  }

  #kerbStrike(i, p, c, kph, gy) {
    const S = this.smoke, d = S.d;
    const f = clamp(kph / 220, 0.2, 1);
    const n = 4 + ((f * 7) | 0);
    for (let k = 0; k < n; k++) {
      d.x = p.x + rr(-0.25, 0.25); d.z = p.z + rr(-0.25, 0.25); d.y = gy + rr(0.05, 0.25);
      d.vx = c.velocity.x * 0.2 + rr(-2.2, 2.2); d.vz = c.velocity.z * 0.2 + rr(-2.2, 2.2);
      d.vy = rr(1.2, 3.6);
      d.size = rr(0.25, 0.5); d.grow = rr(4, 7); d.ttl = rr(0.9, 1.8); d.alpha = rr(0.2, 0.42) * f;
      d.r = 0.78; d.g = 0.7; d.b = 0.58;
      d.gy = gy - 0.15; d.cell = (Math.random() * 3) | 0; d.hard = 0;
      d.drag = 0.9; d.buoy = 0.4; d.turb = 0.9; d.bounce = 0; d.rotv = 0.9;
      S.emit();
    }
    this.haze.kick(0.26 + 0.4 * f);
    if (kph > 130) for (let k = 0, m = 6 + ((f * 14) | 0); k < m; k++) {
      this.#spark1(p.x + rr(-0.2, 0.2), gy + 0.03, p.z + rr(-0.2, 0.2), gy, c, 1);
    }
  }

  #mark(lane, W, p, intensity) {
    if (intensity < 0.06) { this.marks.lift(lane); return; }
    const rx = this.right.x, rz = this.right.z;
    const n = Math.hypot(rx, rz) || 1;
    this.marks.add(lane, p.x, this.wgy[lane] + 0.015, p.z, rx / n, rz / n, W.hw * 1.06, intensity);
  }

  // ---------------------------------------------------------------- sparks
  #sparks(dt, c, inp, kph, gy) {
    if (kph < 120) return;
    const A = this.acc;
    // ride height falls with speed (downforce) and under vertical compression
    const speedTerm = clamp((kph - 120) / 190, 0, 1);
    const bumpNoise = 0.5 + 0.5 * Math.sin(this.bump * 3.1) * Math.sin(this.bump * 1.37 + 1.2);
    const compression = clamp(this.compress * 2.2, 0, 1.4);
    const brakeDive = inp.brake > 0.55 && kph > 190 ? 0.5 : 0;
    let rate = 210 * speedTerm * speedTerm * (0.45 + 0.55 * bumpNoise);
    rate *= 1 + compression * 1.6 + brakeDive;
    if (c.onTrack === false) rate *= 0.3;
    A.spark += dt * rate;
    let burst = Math.min(60, A.spark | 0);
    A.spark -= burst;
    while (burst-- > 0) {
      // the plank runs down the centreline; the titanium skid blocks sit either side of it
      const lane = Math.random() < 0.55 ? 0 : (Math.random() < 0.5 ? -1 : 1);
      const lx = lane === 0 ? rr(-0.1, 0.1) : lane * rr(0.22, 0.34);
      const lz = lane === 0 ? rr(-1.9, 0.4) : rr(-2.1, -1.5);
      this.tmp.set(lx, 0, lz).applyQuaternion(this.q).add(c.position);
      this.#spark1(this.tmp.x, gy + 0.02, this.tmp.z, gy, c, 1);
    }
  }

  #spark1(x, y, z, gy, c, scale) {
    const T = this.streaks, d = T.d;
    d.x = x; d.y = y; d.z = z;
    const back = rr(0.18, 0.45);
    d.vx = c.velocity.x * back + rr(-2.6, 2.6);
    d.vz = c.velocity.z * back + rr(-2.6, 2.6);
    d.vy = rr(0.3, 3.2);
    d.ttl = rr(0.32, 0.85) * scale;
    d.w = rr(0.010, 0.021); d.stretch = rr(0.020, 0.034);
    d.bright = rr(1.5, 2.9) * scale * this.addGain;
    d.rel = 0; d.round = 0; d.hot = 1;
    d.r = 1; d.g = 0.62; d.b = 0.16;
    d.kind = 0; d.gy = gy; d.drag = rr(1.0, 1.9); d.bounce = rr(0.3, 0.5); d.grav = 1;
    T.emit();
  }

  // ---------------------------------------------------------------- brakes
  #brakes(dt, c, inp, kph, gy) {
    const brk = inp.brake;
    if (brk < 0.18 || kph < 35) return;
    const T = this.streaks, td = T.d, S = this.smoke, sd = S.d, A = this.acc;
    const heat = clamp(brk * 1.15 + (kph / 340) * 0.4 - 0.15, 0, 1);
    for (let i = 0; i < 4; i++) {
      const wc = this.wcen[i];
      // glowing disc wash (additive) — the air around a 900 C carbon disc
      A.glow[i] += dt * 26 * heat;
      while (A.glow[i] >= 1) {
        A.glow[i] -= 1;
        td.x = wc.x + rr(-0.06, 0.06); td.y = wc.y + rr(-0.06, 0.06); td.z = wc.z + rr(-0.06, 0.06);
        td.vx = c.velocity.x * 0.9; td.vy = rr(0.2, 0.9); td.vz = c.velocity.z * 0.9;
        td.ttl = rr(0.14, 0.32); td.w = rr(0.10, 0.22); td.stretch = 0.004;
        td.bright = rr(0.5, 1.1) * heat * this.addGain; td.rel = 0; td.round = 1; td.hot = 0.35;
        td.r = 1.0; td.g = 0.30; td.b = 0.07;
        td.kind = 2; td.gy = gy; td.drag = 2.5; td.bounce = 0; td.grav = 0;
        T.emit();
      }
      // fine brake dust out of the duct
      A.bdust[i] += dt * 16 * heat;
      while (A.bdust[i] >= 1) {
        A.bdust[i] -= 1;
        sd.x = wc.x + rr(-0.1, 0.1); sd.y = wc.y - rr(0.0, 0.18); sd.z = wc.z + rr(-0.1, 0.1);
        sd.vx = c.velocity.x * 0.55 - this.fwd.x * rr(0, 2) + rr(-0.6, 0.6);
        sd.vz = c.velocity.z * 0.55 - this.fwd.z * rr(0, 2) + rr(-0.6, 0.6);
        sd.vy = rr(0.1, 0.9);
        sd.size = rr(0.10, 0.24); sd.grow = rr(4, 7); sd.ttl = rr(0.5, 1.1);
        sd.alpha = rr(0.10, 0.22) * heat;
        sd.r = 0.58; sd.g = 0.50; sd.b = 0.46;
        sd.gy = gy - 0.2; sd.cell = (Math.random() * 3) | 0; sd.hard = 0;
        sd.drag = 1.6; sd.buoy = 0.35; sd.turb = 0.8; sd.bounce = 0; sd.rotv = 1;
        S.emit();
      }
    }
  }

  // ------------------------------------------------------ sand wake + speed cues
  #wake(dt, c, kph, gy) {
    if (kph < 110) return;
    const S = this.smoke, d = S.d, A = this.acc;
    const f = clamp((kph - 110) / 200, 0, 1);
    A.wake += dt * (1.2 + 5.5 * f);
    while (A.wake >= 1) {
      A.wake -= 1;
      this.tmp.set(rr(-0.9, 0.9), rr(0.1, 0.5), rr(-3.2, -2.2)).applyQuaternion(this.q).add(c.position);
      d.x = this.tmp.x; d.y = Math.max(gy + 0.15, this.tmp.y); d.z = this.tmp.z;
      d.vx = c.velocity.x * 0.16 + rr(-1.2, 1.2); d.vz = c.velocity.z * 0.16 + rr(-1.2, 1.2);
      d.vy = rr(0.3, 1.1);
      d.size = rr(0.9, 2.0); d.grow = rr(3.5, 7); d.ttl = rr(2.2, 4.2);
      d.alpha = rr(0.035, 0.10) * (0.4 + 0.6 * f);
      d.r = 0.72; d.g = 0.66; d.b = 0.56;
      d.gy = gy - 0.8; d.cell = (Math.random() * 3) | 0; d.hard = 0;
      d.drag = 0.45; d.buoy = 0.25; d.turb = 0.7; d.bounce = 0; d.rotv = 0.4;
      S.emit();
    }
  }

  #speedStreaks(dt, c, cam) {
    const kph = c.kph;
    if (kph < 170) return;
    const T = this.streaks, d = T.d, A = this.acc;
    const f = clamp((kph - 170) / 170, 0, 1);
    A.streak += dt * (10 + 70 * f);
    let n = Math.min(12, A.streak | 0);
    A.streak -= n;
    while (n-- > 0) {
      // dust motes hanging in the air: they streak because *we* are fast
      this.tmp.copy(cam.position)
        .addScaledVector(this.fwd, rr(4, 26))
        .addScaledVector(this.right, rr(-9, 9));
      d.x = this.tmp.x; d.y = this.groundY + rr(0.2, 5.5); d.z = this.tmp.z;
      d.vx = rr(-0.6, 0.6); d.vy = rr(-0.2, 0.3); d.vz = rr(-0.6, 0.6);
      d.ttl = rr(0.35, 0.75);
      d.w = rr(0.006, 0.016); d.stretch = rr(0.012, 0.026);
      d.bright = rr(0.35, 1.0) * (0.35 + 0.65 * f) * this.addGain;
      d.rel = 1; d.round = 0; d.hot = 0;
      d.r = 0.72; d.g = 0.74; d.b = 0.80;
      d.kind = 1; d.gy = this.groundY; d.drag = 0.2; d.bounce = 0; d.grav = 0;
      T.emit();
    }
  }

  #vortex(dt, c, kph) {
    if (kph < 215 || c.aeroMode === 'X') return;
    const T = this.streaks, d = T.d, A = this.acc;
    const f = clamp((kph - 215) / 120, 0, 1);
    A.vortex += dt * (18 + 40 * f);
    let n = Math.min(8, A.vortex | 0);
    A.vortex -= n;
    while (n-- > 0) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const rear = Math.random() < 0.62;
      const ang = Math.random() * 6.283;
      const rad = rr(0.02, 0.12);
      if (rear) this.tmp.set(side * 0.47 + Math.cos(ang) * rad, 0.55 + Math.sin(ang) * rad, -2.1);
      else this.tmp.set(side * 0.85 + Math.cos(ang) * rad, -0.16 + Math.sin(ang) * rad, 2.62);
      this.tmp.applyQuaternion(this.q).add(c.position);
      d.x = this.tmp.x; d.y = this.tmp.y; d.z = this.tmp.z;
      const sw = side * 3.2;                       // swirl about the trailing axis
      d.vx = c.velocity.x * 0.1 + this.right.x * -Math.sin(ang) * sw + this.up.x * Math.cos(ang) * sw;
      d.vy = this.up.y * Math.cos(ang) * sw - Math.sin(ang) * 0.4;
      d.vz = c.velocity.z * 0.1 + this.right.z * -Math.sin(ang) * sw + this.up.z * Math.cos(ang) * sw;
      d.ttl = rr(0.25, 0.5);
      d.w = rr(0.008, 0.020); d.stretch = rr(0.016, 0.03);
      d.bright = rr(0.3, 0.8) * f * this.addGain;
      d.rel = 0.9; d.round = 0; d.hot = 0;
      d.r = 0.78; d.g = 0.84; d.b = 0.95;
      d.kind = 1; d.gy = this.groundY; d.drag = 2.2; d.bounce = 0; d.grav = 0;
      T.emit();
    }
  }
}
