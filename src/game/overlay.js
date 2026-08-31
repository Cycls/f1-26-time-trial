/**
 * Ghost telemetry overlay. Owner: GAME.
 *
 * Three modes, exactly as the reference lists them:
 *   'off'     nothing drawn
 *   'brakes'  ONLY the ghost's braking phases plus a gate at every braking point.
 *             This is the teaching mode: it answers "where did the fast lap brake?"
 *             and nothing else, so it does not clutter the corner you are taking.
 *   'full'    the whole trace, coloured red (brake) / amber (coast, off throttle) /
 *             green (full throttle), with the same braking gates.  DEFAULT.
 *
 * Two draw calls: one ribbon, one merged gate mesh. Rebuilt only when the PB changes.
 */
import * as THREE from 'three';
import { STRIDE } from './ghost.js';

export const OVERLAY_MODES = ['off', 'brakes', 'full'];
export const OVERLAY_LABELS = { off: 'Off', brakes: 'Brakes only', full: 'Full' };

const F = { t: 0, x: 1, y: 2, z: 3, s: 8, kph: 9, thr: 10, brk: 11 };
const HALF = 0.42;          // ribbon half width, m
const LIFT = 0.10;          // above the track surface, m
const BRAKE_ON = 0.06;

const RIBBON_VS = `
  attribute float brake;
  varying vec3 vC; varying float vB; varying float vD;
  uniform vec3 uCam;
  void main(){
    vC = color; vB = brake;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vD = distance(wp.xyz, uCam);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const RIBBON_FS = `
  varying vec3 vC; varying float vB; varying float vD;
  uniform float uOpacity; uniform float uBrakesOnly;
  void main(){
    if (uBrakesOnly > 0.5 && vB < 0.5) discard;
    float near = smoothstep(1.5, 7.0, vD);
    float far  = 1.0 - smoothstep(180.0, 380.0, vD);
    float a = uOpacity * near * far;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vC, a);
  }`;

export class GhostOverlay {
  constructor(ctx) {
    this.ctx = ctx;
    this.mode = 'full';
    this.group = new THREE.Group();
    this.group.name = 'ghostOverlay';
    this.group.renderOrder = 5;
    ctx.scene.add(this.group);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0.62 }, uBrakesOnly: { value: 0 }, uCam: { value: new THREE.Vector3() } },
      vertexShader: RIBBON_VS, fragmentShader: RIBBON_FS,
      transparent: true, depthWrite: false, vertexColors: true,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
    });
    this.gateMaterial = new THREE.MeshBasicMaterial({
      color: 0xff2a20, transparent: true, opacity: 0.42, depthWrite: false,
    });
    this.ribbon = null; this.gates = null;
    this.brakePoints = [];
    this.setMode(this.mode);
  }

  setMode(m) {
    this.mode = OVERLAY_MODES.includes(m) ? m : 'off';
    this.group.visible = this.mode !== 'off';
    this.material.uniforms.uBrakesOnly.value = this.mode === 'brakes' ? 1 : 0;
    safeEmit(this.ctx.bus, 'game:ghostOverlay', this.mode);
  }

  clear() {
    for (const c of this.group.children.slice()) { this.group.remove(c); c.geometry?.dispose?.(); }
    this.ribbon = this.gates = null; this.brakePoints = [];
  }

  /** @param {import('./ghost.js').GhostLap|null} lap */
  build(lap) {
    this.clear();
    if (!lap || lap.count < 8) return;
    const n = lap.count, d = lap.data;

    const pos = new Float32Array(n * 2 * 3);
    const col = new Float32Array(n * 2 * 3);
    const brk = new Float32Array(n * 2);
    const idx = new Uint32Array((n - 1) * 6);
    const rightX = new Float32Array(n), rightZ = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      const a = i * STRIDE;
      const p = Math.min(n - 1, i + 1) * STRIDE, m = Math.max(0, i - 1) * STRIDE;
      let tx = d[p + F.x] - d[m + F.x], tz = d[p + F.z] - d[m + F.z];
      const len = Math.hypot(tx, tz) || 1; tx /= len; tz /= len;
      rightX[i] = tz; rightZ[i] = -tx;                       // tangent x up
    }
    for (let i = 0; i < n; i++) {
      const a = i * STRIDE;
      const isBrake = d[a + F.brk] > BRAKE_ON;
      const c = isBrake ? [1.0, 0.16, 0.12]
        : d[a + F.thr] > 0.9 ? [0.12, 0.92, 0.34]
          : [1.0, 0.72, 0.10];
      for (let sgn = 0; sgn < 2; sgn++) {
        const o = (sgn ? 1 : -1) * HALF, b = (i * 2 + sgn) * 3;
        pos[b] = d[a + F.x] + rightX[i] * o;
        pos[b + 1] = d[a + F.y] + LIFT;
        pos[b + 2] = d[a + F.z] + rightZ[i] * o;
        col[b] = c[0]; col[b + 1] = c[1]; col[b + 2] = c[2];
        brk[i * 2 + sgn] = isBrake ? 1 : 0;
      }
    }
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2, b = a + 2, o = i * 6;
      idx[o] = a; idx[o + 1] = b; idx[o + 2] = a + 1;
      idx[o + 3] = a + 1; idx[o + 4] = b; idx[o + 5] = b + 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('brake', new THREE.BufferAttribute(brk, 1));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    this.ribbon = new THREE.Mesh(g, this.material);
    this.ribbon.frustumCulled = false;
    this.ribbon.name = 'ghostTrace';
    this.group.add(this.ribbon);

    // --- braking gates: one band across the track at each braking onset ---------
    const track = this.ctx.get('track');
    const gp = [], gi = [];
    let base = 0;
    for (let i = 1; i < n; i++) {
      const on = d[i * STRIDE + F.brk] > BRAKE_ON, was = d[(i - 1) * STRIDE + F.brk] > BRAKE_ON;
      if (!on || was) continue;
      const a = i * STRIDE;
      this.brakePoints.push({ s: d[a + F.s], kph: d[a + F.kph], t: d[a + F.t] });
      let hw = 9, rxv = rightX[i], rzv = rightZ[i];
      try {
        const loc = track?.locate?.(_v.set(d[a + F.x], d[a + F.y], d[a + F.z]), d[a + F.s]);
        if (loc) { hw = loc.halfWidth + 0.4; rxv = loc.right.x; rzv = loc.right.z; }
      } catch { /* fall back to the trace tangent */ }
      const cx = d[a + F.x], cy = d[a + F.y], cz = d[a + F.z];
      const tx = -rzv, tz = rxv;                              // along the track
      // a 0.55 m deep band, and a 0.85 m post at each end
      quad(gp, gi, base, cx, cy, cz, rxv, rzv, tx, tz, hw, 0.55, 0.055); base = gp.length / 3;
      for (const sgn of [-1, 1]) {
        post(gp, gi, base, cx + rxv * hw * sgn, cy, cz + rzv * hw * sgn, tx, tz, 0.85); base = gp.length / 3;
      }
    }
    if (gp.length) {
      const gg = new THREE.BufferGeometry();
      gg.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3));
      gg.setIndex(gi);
      gg.computeVertexNormals(); gg.computeBoundingSphere();
      this.gates = new THREE.Mesh(gg, this.gateMaterial);
      this.gates.frustumCulled = false;
      this.gates.name = 'ghostBrakeGates';
      this.group.add(this.gates);
    }
    this.setMode(this.mode);
  }

  update() { this.material.uniforms.uCam.value.copy(this.ctx.camera.position); }

  dispose() { this.clear(); this.ctx.scene.remove(this.group); this.material.dispose(); this.gateMaterial.dispose(); }
}

const _v = new THREE.Vector3();

/** Flat band across the track, centred on (cx,cy,cz). */
function quad(p, ix, base, cx, cy, cz, rx, rz, tx, tz, half, depth, lift) {
  const d2 = depth / 2;
  for (const [hs, ds] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    p.push(cx + rx * half * hs + tx * d2 * ds, cy + lift, cz + rz * half * hs + tz * d2 * ds);
  }
  ix.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/** Small vertical post at the edge of the track. */
function post(p, ix, base, cx, cy, cz, tx, tz, h) {
  const w = 0.22;
  for (const [ds, dy] of [[-1, 0], [1, 0], [1, 1], [-1, 1]]) {
    p.push(cx + tx * w * ds, cy + 0.03 + h * dy, cz + tz * w * ds);
  }
  ix.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/**
 * The shared Bus is synchronous and does not isolate listeners: a throw inside any
 * subscriber propagates back into the emitter and would take this module's frame with
 * it. Every emit from here goes through this guard. (See docs/REQUESTS.md — the fix
 * belongs in core/bus.js, which GAME/INPUT do not own.)
 */
function safeEmit(bus, event, payload) {
  try { bus.emit(event, payload); }
  catch (e) { if (!safeEmit.seen?.has(event)) { (safeEmit.seen ??= new Set()).add(event); console.warn(`[bus] a listener for "${event}" threw:`, e?.message); } }
}
