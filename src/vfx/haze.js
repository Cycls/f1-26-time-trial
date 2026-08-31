/**
 * Screen-space refraction: exhaust plume + brake-duct heat haze, and the kerb-strike jolt.
 * Owner: VFX.
 *
 * Implemented as a composer pass inserted straight after the scene RenderPass (the render
 * module publishes `.composer` as public API; we only insert our own pass and never touch
 * theirs). Sources are world-space points projected to screen each frame, so the haze sits
 * on the exhaust and the brake ducts and shrinks with distance like real refraction.
 * If there is no composer (post off) the effect disables itself silently.
 */
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const MAX_SRC = 6;

const SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uRes: { value: new THREE.Vector2(1600, 900) },
    uAspect: { value: 1.78 },
    uTime: { value: 0 },
    uJolt: { value: 0 },
    uAmount: { value: 6.5 },
    uSrc: { value: Array.from({ length: MAX_SRC }, () => new THREE.Vector4(0, 0, 0.1, 0)) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 uRes;
    uniform float uTime, uJolt, uAspect, uAmount;
    uniform vec4 uSrc[${MAX_SRC}];
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vnoise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                 mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
    }
    void main() {
      vec2 q = vec2(vUv.x * uAspect, vUv.y);
      float mask = 0.0;
      for (int i = 0; i < ${MAX_SRC}; i++) {
        vec4 s = uSrc[i];
        if (s.w <= 0.001) continue;
        float rise = (q.y - s.y) / max(s.z * 2.2, 1e-4);
        float w = 1.0 + max(rise, 0.0) * 1.35;              // the plume widens as it rises
        vec2 d = (q - vec2(s.x * uAspect, s.y)) / max(s.z, 1e-4);
        d.x /= w; d.y *= 0.72;
        mask += exp(-dot(d, d) * 2.0) * s.w * (1.0 - smoothstep(0.6, 2.6, rise));
      }
      mask = min(mask, 1.6);
      vec2 off = vec2(0.0);
      if (mask > 0.002) {
        float t = uTime;
        vec2 w1 = vec2(vnoise(q * 34.0 + vec2(0.0, -t * 2.6)), vnoise(q * 29.0 + vec2(5.3, -t * 3.3))) - 0.5;
        vec2 w2 = vec2(vnoise(q * 78.0 + vec2(1.7, -t * 4.4)), vnoise(q * 84.0 + vec2(9.1, -t * 5.2))) - 0.5;
        off = (w1 + w2 * 0.55) * mask * (uAmount / uRes.y);
      }
      if (uJolt > 0.001) {
        off += vec2(sin((vUv.y + uTime * 8.0) * 52.0), cos((vUv.x - uTime * 7.0) * 44.0))
             * uJolt * (3.5 / uRes.y);
      }
      gl_FragColor = texture2D(tDiffuse, clamp(vUv + off, vec2(0.0009), vec2(0.9991)));
    }`,
};

export class HeatHaze {
  constructor(ctx) {
    this.ctx = ctx;
    this.pass = null;
    this.enabled = false;
    this.jolt = 0;
    this._n = 0;
    this._check = 0;
    this._p = new THREE.Vector3();
  }

  attach() {
    const render = this.ctx.get('render');
    const composer = render?.composer;
    if (!composer?.passes) return false;
    if (!this.pass) this.pass = new ShaderPass(SHADER);
    if (composer.passes.includes(this.pass)) return true;
    let at = 1;
    for (let i = 0; i < composer.passes.length; i++) {
      const p = composer.passes[i];
      if (p?.constructor?.name === 'RenderPass' || p?.scene) { at = i + 1; break; }
    }
    composer.insertPass(this.pass, Math.min(at, composer.passes.length));
    this.enabled = true;
    const r = this.ctx.renderer ?? render.renderer;
    if (r) { const s = r.getSize(new THREE.Vector2()); this.resize(s.x, s.y); }
    return true;
  }

  begin(dt) {
    this._n = 0;
    this.jolt = Math.max(0, this.jolt - dt * 5.5);
    if (!this.pass) return;
    const u = this.pass.uniforms;
    u.uTime.value += dt;
    u.uJolt.value = this.jolt * this.jolt;
    // re-attach if the render module rebuilt its composer
    this._check += dt;
    if (this._check > 1.5) { this._check = 0; this.attach(); }
  }

  /** Add a world-space haze source. radius in metres, strength 0..1 */
  add(camera, x, y, z, radius, strength) {
    if (!this.pass || this._n >= MAX_SRC || strength <= 0.005) return;
    const p = this._p.set(x, y, z);
    const dist = p.distanceTo(camera.position);
    if (dist < 0.5) return;
    p.applyMatrix4(camera.matrixWorldInverse);
    if (p.z > -0.5) return;                      // behind the camera
    p.applyMatrix4(camera.projectionMatrix);     // perspective divide included
    const fovScale = 1 / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5) * dist);
    const r = Math.max(0.02, Math.min(0.9, radius * fovScale));
    const s = this.pass.uniforms.uSrc.value[this._n++];
    s.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5, r, strength);
  }

  end() {
    if (!this.pass) return;
    const arr = this.pass.uniforms.uSrc.value;
    for (let i = this._n; i < MAX_SRC; i++) arr[i].w = 0;
  }

  kick(a) { this.jolt = Math.min(1, this.jolt + a); }

  resize(w, h) {
    if (!this.pass) return;
    this.pass.uniforms.uRes.value.set(w, h);
    this.pass.uniforms.uAspect.value = w / Math.max(1, h);
  }
}
