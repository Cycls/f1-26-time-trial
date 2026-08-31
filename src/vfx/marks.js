/**
 * Rubber laid into the track: persistent skid / lock-up marks. Owner: VFX.
 *
 * A ribbon decal system, not a particle system. Every emission welds a quad onto that
 * wheel's previous contact edge so the trail is continuous, sits at the road height
 * reported by track.locate(), and stays there for the rest of the session. One shared
 * ring buffer of quads across all four wheels => one draw call, bounded triangles.
 *
 * Darkness is driven by how hard the tyre is sliding, so a locked front leaves a black
 * stripe while a mild slide only stains the asphalt.
 */
import * as THREE from 'three';

const V = /* glsl */`
attribute float aAlpha;
varying vec2 vUv;
varying float vAlpha, vDist;
void main() {
  vUv = uv; vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const F = /* glsl */`
uniform sampler2D uMap;
uniform vec3 uColor, uFogColor;
uniform float uFogDensity;
varying vec2 vUv;
varying float vAlpha, vDist;
void main() {
  float a = texture2D(uMap, vUv).a * vAlpha;
  if (a <= 0.004) discard;
  a *= 1.0 - smoothstep(110.0, 260.0, vDist);   // stop distant marks aliasing into grey
  vec3 col = uColor;
  float f = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
  gl_FragColor = vec4(mix(col, uFogColor, clamp(f, 0.0, 1.0)), a);
}`;

const QUADS = 3200;             // ~0.3 m each, shared by 4 wheels => ~240 m of four-wheel trail
const LANES = 4;

export class SkidMarks {
  constructor(scene, map) {
    this.quads = QUADS;
    this.pos = new Float32Array(QUADS * 4 * 3);
    this.uv = new Float32Array(QUADS * 4 * 2);
    this.alpha = new Float32Array(QUADS * 4);
    const idx = new Uint32Array(QUADS * 6);
    for (let q = 0; q < QUADS; q++) {
      const v = q * 4, o = q * 6;
      idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2;
      idx[o + 3] = v; idx[o + 4] = v + 2; idx[o + 5] = v + 3;
    }
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aUv = new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('uv', this.aUv);
    g.setAttribute('aAlpha', this.aAlpha);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    g.setDrawRange(0, 0);
    this.geometry = g;

    this.material = new THREE.ShaderMaterial({
      vertexShader: V, fragmentShader: F,
      transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8,
      uniforms: {
        uMap: { value: map },
        uColor: { value: new THREE.Color(0.05, 0.047, 0.047) },
        uFogColor: { value: new THREE.Color(0x05070c) },
        uFogDensity: { value: 0.0016 },
      },
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 2;
    this.mesh.name = 'vfx.skidmarks';
    scene.add(this.mesh);

    this.head = 0; this.written = 0;
    this.hasPrev = new Uint8Array(LANES);
    this.prevA = new Float32Array(LANES * 3);
    this.prevB = new Float32Array(LANES * 3);
    this.prevV = new Float32Array(LANES);
    this.prevAlpha = new Float32Array(LANES);
    this._lo = Infinity; this._hi = -Infinity;
  }

  /** Break the ribbon (wheel stopped sliding). */
  lift(lane) { this.hasPrev[lane] = 0; }

  /**
   * @param lane 0..3  @param x,y,z contact point  @param rx,rz unit right vector of the wheel
   * @param halfW half tyre width  @param intensity 0..1 darkness
   */
  add(lane, x, y, z, rx, rz, halfW, intensity) {
    const b = lane * 3;
    const ax = x - rx * halfW, az = z - rz * halfW;
    const bx = x + rx * halfW, bz = z + rz * halfW;
    if (!this.hasPrev[lane]) {
      this.prevA[b] = ax; this.prevA[b + 1] = y; this.prevA[b + 2] = az;
      this.prevB[b] = bx; this.prevB[b + 1] = y; this.prevB[b + 2] = bz;
      this.prevV[lane] = 0; this.prevAlpha[lane] = 0; this.hasPrev[lane] = 1;
      return;
    }
    const q = this.head;
    this.head = (this.head + 1) % QUADS;
    if (this.written < QUADS) this.written++;
    const v0 = q * 12, u0 = q * 8, a0 = q * 4;
    const p = this.pos, u = this.uv, al = this.alpha;
    p[v0] = this.prevA[b]; p[v0 + 1] = this.prevA[b + 1]; p[v0 + 2] = this.prevA[b + 2];
    p[v0 + 3] = this.prevB[b]; p[v0 + 4] = this.prevB[b + 1]; p[v0 + 5] = this.prevB[b + 2];
    p[v0 + 6] = bx; p[v0 + 7] = y; p[v0 + 8] = bz;
    p[v0 + 9] = ax; p[v0 + 10] = y; p[v0 + 11] = az;
    const mx = (this.prevA[b] + this.prevB[b]) * 0.5, mz = (this.prevA[b + 2] + this.prevB[b + 2]) * 0.5;
    const seg = Math.hypot(x - mx, z - mz);
    const v1 = this.prevV[lane], v2 = v1 + seg * 0.5;
    u[u0] = 0; u[u0 + 1] = v1; u[u0 + 2] = 1; u[u0 + 3] = v1;
    u[u0 + 4] = 1; u[u0 + 5] = v2; u[u0 + 6] = 0; u[u0 + 7] = v2;
    const a = Math.min(1, intensity);
    al[a0] = al[a0 + 1] = this.prevAlpha[lane];
    al[a0 + 2] = al[a0 + 3] = a;
    this.prevAlpha[lane] = a;
    this.prevA[b] = ax; this.prevA[b + 1] = y; this.prevA[b + 2] = az;
    this.prevB[b] = bx; this.prevB[b + 1] = y; this.prevB[b + 2] = bz;
    this.prevV[lane] = v2;
    if (q < this._lo) this._lo = q;
    if (q > this._hi) this._hi = q;
  }

  flush() {
    this.geometry.setDrawRange(0, this.written * 6);
    if (this._hi < this._lo) return;
    const lo = this._lo, n = this._hi - lo + 1;
    range(this.aPos, lo * 12, n * 12);
    range(this.aUv, lo * 8, n * 8);
    range(this.aAlpha, lo * 4, n * 4);
    this._lo = Infinity; this._hi = -Infinity;
  }

  setFog(fog) {
    if (!fog) return;
    this.material.uniforms.uFogColor.value.copy(fog.color);
    this.material.uniforms.uFogDensity.value = fog.density ?? 0.0016;
  }
}

function range(attr, start, count) {
  attr.clearUpdateRanges();
  attr.addUpdateRange(start, count);
  attr.needsUpdate = true;
}
