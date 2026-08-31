/**
 * Stretched additive billboards. Owner: VFX.
 * ONE draw call for: titanium skid sparks, brake-disc glow wash, air/dust speed streaks
 * and wingtip vortex threads.
 *
 * Each instance is a quad anchored at its head and stretched backwards along a velocity
 * vector *in view space*, so a spark leaves a real motion streak instead of a round dot.
 * `rel` blends in the camera-relative velocity so static air motes streak past the car.
 * `round` collapses the streak into a soft disc for the brake-duct glow.
 */
import * as THREE from 'three';

const V = /* glsl */`
attribute vec3 iPos;
attribute vec3 iVel;
attribute vec4 iData;   // x halfWidth, y stretch, z brightness, w relFactor
attribute vec3 iColor;
attribute vec2 iShape;  // x roundness, y hotCore
uniform vec3 uRelVel;
uniform float uMaxLen;
varying vec2 vUv;
varying vec3 vColor;
varying float vBright, vRound, vHot, vDist;
void main() {
  vec3 rel = iVel - uRelVel * iData.w;
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  vec3 dv = (modelViewMatrix * vec4(rel, 0.0)).xyz;
  vec2 d = dv.xy;
  float dl = length(d);
  vec2 dir = dl > 1e-4 ? d / dl : vec2(0.0, 1.0);
  vec2 perp = vec2(-dir.y, dir.x);
  float w = iData.x;
  float len = min(dl * iData.y, uMaxLen);
  float t = position.y + 0.5;
  vec2 streakOff = -dir * (t * len) + perp * (position.x * 2.0 * w);
  vec2 roundOff = position.xy * 2.0 * w;
  mv.xy += mix(streakOff, roundOff, iShape.x);
  vUv = vec2(position.x + 0.5, t);
  vColor = iColor; vBright = iData.z; vRound = iShape.x; vHot = iShape.y;
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const F = /* glsl */`
uniform float uFogDensity;
varying vec2 vUv;
varying vec3 vColor;
varying float vBright, vRound, vHot, vDist;
void main() {
  float x = vUv.x * 2.0 - 1.0;
  float core = max(0.0, 1.0 - abs(x));
  float streak = pow(core, 1.7) * pow(max(0.0, 1.0 - vUv.y), 0.75);
  float r = length(vec2(x, vUv.y * 2.0 - 1.0));
  float disc = pow(max(0.0, 1.0 - r), 2.2);
  float a = mix(streak, disc, vRound) * vBright;
  if (a <= 0.002) discard;
  vec3 col = mix(vColor, vec3(1.0, 0.95, 0.86), pow(core, 5.0) * vHot);
  col *= 1.0 + vHot * 1.7;
  float f = exp(-uFogDensity * uFogDensity * vDist * vDist);
  gl_FragColor = vec4(col * f, clamp(a, 0.0, 1.0));
}`;

export class StreakSystem {
  constructor(scene, max = 1600) {
    this.max = max; this.count = 0; this.time = 0;
    const n = max;
    this.px = new Float32Array(n); this.py = new Float32Array(n); this.pz = new Float32Array(n);
    this.vx = new Float32Array(n); this.vy = new Float32Array(n); this.vz = new Float32Array(n);
    this.life = new Float32Array(n); this.ttl = new Float32Array(n);
    this.w = new Float32Array(n); this.stretch = new Float32Array(n); this.b0 = new Float32Array(n);
    this.rel = new Float32Array(n); this.round = new Float32Array(n); this.hot = new Float32Array(n);
    this.cr = new Float32Array(n); this.cg = new Float32Array(n); this.cb = new Float32Array(n);
    this.kind = new Float32Array(n); this.gy = new Float32Array(n); this.dragK = new Float32Array(n);
    this.bounce = new Float32Array(n); this.seed = new Float32Array(n); this.grav = new Float32Array(n);

    this.iPos = new Float32Array(n * 3);
    this.iVel = new Float32Array(n * 3);
    this.iData = new Float32Array(n * 4);
    this.iColor = new Float32Array(n * 3);
    this.iShape = new Float32Array(n * 2);

    const g = new THREE.InstancedBufferGeometry();
    const plane = new THREE.PlaneGeometry(1, 1);
    g.setAttribute('position', plane.getAttribute('position'));
    g.setIndex(plane.getIndex());
    const D = THREE.DynamicDrawUsage;
    this.aPos = new THREE.InstancedBufferAttribute(this.iPos, 3).setUsage(D);
    this.aVel = new THREE.InstancedBufferAttribute(this.iVel, 3).setUsage(D);
    this.aData = new THREE.InstancedBufferAttribute(this.iData, 4).setUsage(D);
    this.aColor = new THREE.InstancedBufferAttribute(this.iColor, 3).setUsage(D);
    this.aShape = new THREE.InstancedBufferAttribute(this.iShape, 2).setUsage(D);
    g.setAttribute('iPos', this.aPos); g.setAttribute('iVel', this.aVel);
    g.setAttribute('iData', this.aData); g.setAttribute('iColor', this.aColor);
    g.setAttribute('iShape', this.aShape);
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.material = new THREE.ShaderMaterial({
      vertexShader: V, fragmentShader: F,
      transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uRelVel: { value: new THREE.Vector3() },
        uMaxLen: { value: 7.0 },
        uFogDensity: { value: 0.0016 },
      },
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 8;
    this.mesh.name = 'vfx.streaks';
    scene.add(this.mesh);
    this.geometry = g;

    this._arrays = [this.px, this.py, this.pz, this.vx, this.vy, this.vz, this.life, this.ttl,
      this.w, this.stretch, this.b0, this.rel, this.round, this.hot, this.cr, this.cg, this.cb,
      this.kind, this.gy, this.dragK, this.bounce, this.seed, this.grav];

    this.d = {
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, ttl: 0.5, w: 0.02, stretch: 0.03, bright: 1,
      rel: 0, round: 0, hot: 1, r: 1, g: 0.6, b: 0.2, kind: 0, gy: 0, drag: 1.0,
      bounce: 0.34, grav: 1,
    };
  }

  emit() {
    const d = this.d;
    let i;
    if (this.count < this.max) i = this.count++;
    else i = (this._rr = ((this._rr | 0) + 1) % this.max);
    this.px[i] = d.x; this.py[i] = d.y; this.pz[i] = d.z;
    this.vx[i] = d.vx; this.vy[i] = d.vy; this.vz[i] = d.vz;
    this.life[i] = d.ttl; this.ttl[i] = d.ttl;
    this.w[i] = d.w; this.stretch[i] = d.stretch; this.b0[i] = d.bright;
    this.rel[i] = d.rel; this.round[i] = d.round; this.hot[i] = d.hot;
    this.cr[i] = d.r; this.cg[i] = d.g; this.cb[i] = d.b;
    this.kind[i] = d.kind; this.gy[i] = d.gy; this.dragK[i] = d.drag;
    this.bounce[i] = d.bounce; this.grav[i] = d.grav;
    this.seed[i] = Math.random() * 100;
    return i;
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    let n = this.count;
    for (let i = 0; i < n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { n--; if (i !== n) this.#copy(n, i); i--; continue; }
      const kind = this.kind[i];
      let vx = this.vx[i], vy = this.vy[i], vz = this.vz[i];
      const k = Math.exp(-this.dragK[i] * dt);
      if (kind === 0) {                       // spark: hot metal, gravity + bounce + skitter
        vy -= 9.81 * this.grav[i] * dt;
        vx *= k; vy *= k; vz *= k;
      } else if (kind === 2) {                // glow wash: buoyant, no gravity
        vy += 0.8 * dt; vx *= k; vy *= k; vz *= k;
      } else {                                // air motes / vortex
        vx *= k; vy *= k; vz *= k;
      }
      let px = this.px[i] + vx * dt, py = this.py[i] + vy * dt, pz = this.pz[i] + vz * dt;
      if (kind === 0 && py < this.gy[i] + 0.012) {
        py = this.gy[i] + 0.012;
        if (vy < -0.25) {
          vy = -vy * this.bounce[i];
          vx = vx * 0.7 + (Math.random() - 0.5) * 1.6;   // skitter along the asphalt
          vz = vz * 0.7 + (Math.random() - 0.5) * 1.6;
          // real sparks shatter on impact
          if (this.life[i] > 0.16 && n < this.max - 2 && Math.random() < 0.30) {
            const d = this.d;
            d.x = px; d.y = py + 0.02; d.z = pz;
            d.vx = vx * 0.7 + (Math.random() - 0.5) * 3; d.vy = Math.abs(vy) * 0.9 + Math.random() * 1.6;
            d.vz = vz * 0.7 + (Math.random() - 0.5) * 3;
            d.ttl = this.life[i] * 0.55; d.w = this.w[i] * 0.8; d.stretch = this.stretch[i];
            d.bright = this.b0[i] * 0.8; d.rel = 0; d.round = 0; d.hot = 1;
            d.r = 1; d.g = 0.55; d.b = 0.14; d.kind = 0; d.gy = this.gy[i];
            d.drag = this.dragK[i]; d.bounce = 0.3; d.grav = 1;
            this.count = n; this.emit(); n = this.count;
          }
        } else { vy = 0; vx *= Math.exp(-5 * dt); vz *= Math.exp(-5 * dt); }
      }
      this.px[i] = px; this.py[i] = py; this.pz[i] = pz;
      this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;

      const lf = this.life[i] / this.ttl[i];
      let br = this.b0[i], cr = this.cr[i], cg = this.cg[i], cb = this.cb[i], hot = this.hot[i];
      if (kind === 0) {
        // cooling: white-hot -> yellow -> orange -> deep red, with a fast flicker
        const flick = 0.78 + 0.22 * Math.sin(t * 47 + this.seed[i]);
        br = this.b0[i] * (0.25 + 0.75 * lf) * flick;
        cg = 0.30 + 0.55 * lf; cb = 0.04 + 0.22 * lf * lf; cr = 1.0;
        hot = lf;
      } else {
        br = this.b0[i] * Math.min(1, (1 - lf) * 6) * lf * lf * (3 - 2 * lf);
      }

      const i3 = i * 3, i4 = i * 4, i2 = i * 2;
      this.iPos[i3] = px; this.iPos[i3 + 1] = py; this.iPos[i3 + 2] = pz;
      this.iVel[i3] = vx; this.iVel[i3 + 1] = vy; this.iVel[i3 + 2] = vz;
      this.iData[i4] = this.w[i]; this.iData[i4 + 1] = this.stretch[i];
      this.iData[i4 + 2] = br; this.iData[i4 + 3] = this.rel[i];
      this.iColor[i3] = cr; this.iColor[i3 + 1] = cg; this.iColor[i3 + 2] = cb;
      this.iShape[i2] = this.round[i]; this.iShape[i2 + 1] = hot;
    }
    this.count = n;
    this.geometry.instanceCount = n;
    if (n > 0) {
      up(this.aPos, n * 3); up(this.aVel, n * 3); up(this.aData, n * 4);
      up(this.aColor, n * 3); up(this.aShape, n * 2);
    }
  }

  setRelVel(v) { this.material.uniforms.uRelVel.value.copy(v); }
  setFog(fog) { if (fog) this.material.uniforms.uFogDensity.value = fog.density ?? 0.0016; }

  #copy(from, to) {
    const A = this._arrays;
    for (let k = 0; k < A.length; k++) A[k][to] = A[k][from];
  }
}

function up(attr, len) {
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, len);
  attr.needsUpdate = true;
}
