/**
 * Lit, soft, ground-aware billboard system. Owner: VFX.
 * One InstancedBufferGeometry (quad + 4 instanced attributes) => ONE draw call for every
 * smoke / dust / haze / debris particle in the game.
 *
 * Why not a point cloud: points cannot be rotated, cannot be stretched, cannot carry a
 * baked normal, and gl_PointSize clamps hard when a puff fills the screen.
 *
 * Shading: the sprite carries a normal baked from its own density field, transformed to
 * world space with the camera basis and lit by a hemispheric flood term + one soft key,
 * both sampled from the real scene rig (see lighting.js). Plus a depth-free "soft particle"
 * trick: every fragment knows its own world Y and the ground height under the particle, so
 * sprites dissolve into the asphalt instead of slicing through it.
 */
import * as THREE from 'three';

const V = /* glsl */`
attribute vec3 iPos;
attribute vec4 iData;    // x size, y rot, z alpha, w atlas cell
attribute vec3 iColor;
attribute vec2 iExtra;   // x groundY, y hardness
uniform mat3 uCamRot;
varying vec2 vUv, vRot;
varying vec3 vColor;
varying float vAlpha, vWorldY, vGY, vDist, vHard;
void main() {
  float size = iData.x, rot = iData.y;
  float c = cos(rot), s = sin(rot);
  vec2 q = position.xy * size;
  vec2 r = vec2(q.x * c - q.y * s, q.x * s + q.y * c);
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  mv.xy += r;
  vDist   = -mv.z;
  vWorldY = iPos.y + uCamRot[0].y * r.x + uCamRot[1].y * r.y;
  vGY = iExtra.x; vHard = iExtra.y;
  vColor = iColor; vAlpha = iData.z; vRot = vec2(c, s);
  vec2 base = vec2(mod(iData.w, 2.0), floor(iData.w * 0.5)) * 0.5;
  vUv = base + (position.xy + 0.5) * 0.5;
  gl_Position = projectionMatrix * mv;
}`;

const F = /* glsl */`
uniform sampler2D uMap;
uniform vec3 uSky, uGround, uKeyCol, uKeyDir, uFogColor;
uniform mat3 uCamRot;
uniform float uFogDensity, uSoft, uNear0, uNear1, uBump;
varying vec2 vUv, vRot;
varying vec3 vColor;
varying float vAlpha, vWorldY, vGY, vDist, vHard;
void main() {
  vec4 tx = texture2D(uMap, vUv);
  float d = tx.a;
  float a = mix(d, smoothstep(0.40, 0.56, d), vHard) * vAlpha;
  if (a <= 0.004) discard;
  vec3 nt = tx.rgb * 2.0 - 1.0;
  vec2 nr = vec2(nt.x * vRot.x - nt.y * vRot.y, nt.x * vRot.y + nt.y * vRot.x);
  vec3 nW = normalize(uCamRot * normalize(vec3(nr * uBump, abs(nt.z) + 0.18)));
  float up = nW.y * 0.5 + 0.5;
  vec3 amb = mix(uGround, uSky, up * up);
  float ndl = max(dot(nW, uKeyDir), 0.0);
  vec3 lit = amb + uKeyCol * (0.12 + 0.88 * ndl);
  lit += uSky * (1.0 - d) * 0.30;                 // light bleeding through thin edges
  lit *= mix(1.0, 0.62, d * (1.0 - vHard));       // dense core self-shadows
  vec3 col = vColor * lit;
  a *= smoothstep(0.0, uSoft, vWorldY - vGY);     // soft against the track
  a *= smoothstep(uNear0, uNear1, vDist);         // do not smear the near plane
  float f = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
  col = mix(col, uFogColor, clamp(f, 0.0, 1.0));
  gl_FragColor = vec4(col, a);
}`;

export class SmokeSystem {
  constructor(scene, map, max = 1400) {
    this.max = max; this.count = 0; this.time = 0;
    const n = max;
    this.px = new Float32Array(n); this.py = new Float32Array(n); this.pz = new Float32Array(n);
    this.vx = new Float32Array(n); this.vy = new Float32Array(n); this.vz = new Float32Array(n);
    this.life = new Float32Array(n); this.ttl = new Float32Array(n);
    this.size0 = new Float32Array(n); this.grow = new Float32Array(n);
    this.rot = new Float32Array(n); this.rotv = new Float32Array(n);
    this.cr = new Float32Array(n); this.cg = new Float32Array(n); this.cb = new Float32Array(n);
    this.gy = new Float32Array(n); this.cell = new Float32Array(n); this.hard = new Float32Array(n);
    this.a0 = new Float32Array(n); this.dragK = new Float32Array(n); this.buoy = new Float32Array(n);
    this.turb = new Float32Array(n); this.seed = new Float32Array(n); this.bounce = new Float32Array(n);

    this.iPos = new Float32Array(n * 3);
    this.iData = new Float32Array(n * 4);
    this.iColor = new Float32Array(n * 3);
    this.iExtra = new Float32Array(n * 2);

    const g = new THREE.InstancedBufferGeometry();
    const plane = new THREE.PlaneGeometry(1, 1);
    g.setAttribute('position', plane.getAttribute('position'));
    g.setIndex(plane.getIndex());
    const D = THREE.DynamicDrawUsage;
    this.aPos = new THREE.InstancedBufferAttribute(this.iPos, 3).setUsage(D);
    this.aData = new THREE.InstancedBufferAttribute(this.iData, 4).setUsage(D);
    this.aColor = new THREE.InstancedBufferAttribute(this.iColor, 3).setUsage(D);
    this.aExtra = new THREE.InstancedBufferAttribute(this.iExtra, 2).setUsage(D);
    g.setAttribute('iPos', this.aPos); g.setAttribute('iData', this.aData);
    g.setAttribute('iColor', this.aColor); g.setAttribute('iExtra', this.aExtra);
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.material = new THREE.ShaderMaterial({
      vertexShader: V, fragmentShader: F,
      transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
      uniforms: {
        uMap: { value: map },
        uSky: { value: new THREE.Color(0.62, 0.70, 0.86) },
        uGround: { value: new THREE.Color(0.13, 0.11, 0.09) },
        uKeyCol: { value: new THREE.Color(0.4, 0.45, 0.6) },
        uKeyDir: { value: new THREE.Vector3(0.2, 0.95, 0.2).normalize() },
        uCamRot: { value: new THREE.Matrix3() },
        uFogColor: { value: new THREE.Color(0x05070c) },
        uFogDensity: { value: 0.0016 },
        uSoft: { value: 0.55 }, uNear0: { value: 0.35 }, uNear1: { value: 2.2 },
        uBump: { value: 1.15 },
      },
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 6;
    this.mesh.name = 'vfx.smoke';
    scene.add(this.mesh);
    this.geometry = g;

    this._arrays = [this.px, this.py, this.pz, this.vx, this.vy, this.vz, this.life, this.ttl,
      this.size0, this.grow, this.rot, this.rotv, this.cr, this.cg, this.cb, this.gy,
      this.cell, this.hard, this.a0, this.dragK, this.buoy, this.turb, this.seed, this.bounce];

    // reusable emit descriptor: keeps the hot path allocation-free
    this.d = {
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 1, grow: 2, ttl: 1, alpha: 0.5,
      r: 0.8, g: 0.8, b: 0.8, gy: 0, cell: 0, hard: 0, drag: 1.4, buoy: 0.4,
      turb: 0.6, bounce: 0, rotv: 0.6,
    };
  }

  /** Emit using the shared descriptor (no allocation). */
  emit() {
    const d = this.d;
    let i;
    if (this.count < this.max) i = this.count++;
    else i = (this._rr = ((this._rr | 0) + 1) % this.max);   // recycle oldest-ish under pressure
    this.px[i] = d.x; this.py[i] = d.y; this.pz[i] = d.z;
    this.vx[i] = d.vx; this.vy[i] = d.vy; this.vz[i] = d.vz;
    this.life[i] = d.ttl; this.ttl[i] = d.ttl;
    this.size0[i] = d.size; this.grow[i] = d.grow;
    this.rot[i] = Math.random() * 6.283; this.rotv[i] = (Math.random() - 0.5) * 2 * d.rotv;
    this.cr[i] = d.r; this.cg[i] = d.g; this.cb[i] = d.b;
    this.gy[i] = d.gy; this.cell[i] = d.cell; this.hard[i] = d.hard;
    this.a0[i] = d.alpha; this.dragK[i] = d.drag; this.buoy[i] = d.buoy;
    this.turb[i] = d.turb; this.bounce[i] = d.bounce;
    this.seed[i] = Math.random() * 6.283;
    return i;
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    let n = this.count;
    for (let i = 0; i < n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // swap-remove keeps the live set contiguous so we upload one range
        n--;
        if (i !== n) this.#copy(n, i);
        i--; continue;
      }
      const hard = this.hard[i] > 0.5;
      const s = this.seed[i];
      let vx = this.vx[i], vy = this.vy[i], vz = this.vz[i];
      if (!hard) {
        const tb = this.turb[i];
        vx += Math.sin(this.py[i] * 0.9 + t * 1.3 + s) * tb * dt;
        vz += Math.cos(this.px[i] * 0.8 - t * 1.1 + s) * tb * dt;
        vy += (Math.sin(this.pz[i] * 0.7 + t * 0.8 + s) * 0.35 + this.buoy[i]) * dt;
        const k = Math.exp(-this.dragK[i] * dt);
        vx *= k; vy *= k; vz *= k;
      } else {
        vy -= 9.81 * dt;
        const k = Math.exp(-this.dragK[i] * dt);
        vx *= k; vz *= k;
      }
      let px = this.px[i] + vx * dt, py = this.py[i] + vy * dt, pz = this.pz[i] + vz * dt;

      const lf = this.life[i] / this.ttl[i];
      const size = this.size0[i] * (1 + this.grow[i] * (1 - lf));
      const floorY = this.gy[i] + (hard ? 0.02 : size * 0.10);
      if (py < floorY) {
        py = floorY;
        if (hard) {
          if (vy < -0.4) { vy = -vy * this.bounce[i]; vx *= 0.62; vz *= 0.62; }
          else { vy = 0; vx *= Math.exp(-6 * dt); vz *= Math.exp(-6 * dt); }
        } else {
          vy = Math.abs(vy) * 0.12;           // billow: vertical energy turns into spread
          vx *= 1 + dt * 1.4; vz *= 1 + dt * 1.4;
        }
      }
      this.px[i] = px; this.py[i] = py; this.pz[i] = pz;
      this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
      this.rot[i] += this.rotv[i] * dt;

      const fin = Math.min(1, (1 - lf) * 7);
      const alpha = this.a0[i] * fin * lf * lf * (3 - 2 * lf);

      const i3 = i * 3, i4 = i * 4, i2 = i * 2;
      this.iPos[i3] = px; this.iPos[i3 + 1] = py; this.iPos[i3 + 2] = pz;
      this.iData[i4] = size; this.iData[i4 + 1] = this.rot[i];
      this.iData[i4 + 2] = alpha; this.iData[i4 + 3] = this.cell[i];
      this.iColor[i3] = this.cr[i]; this.iColor[i3 + 1] = this.cg[i]; this.iColor[i3 + 2] = this.cb[i];
      this.iExtra[i2] = this.gy[i]; this.iExtra[i2 + 1] = this.hard[i];
    }
    this.count = n;
    this.geometry.instanceCount = n;
    if (n > 0) {
      up(this.aPos, n * 3); up(this.aData, n * 4); up(this.aColor, n * 3); up(this.aExtra, n * 2);
    }
  }

  setCamera(camera) {
    const u = this.material.uniforms;
    u.uCamRot.value.setFromMatrix4(camera.matrixWorld);
  }

  setLight(probe, gain = 1) {
    const u = this.material.uniforms;
    u.uSky.value.copy(probe.sky).multiplyScalar(gain);
    u.uGround.value.copy(probe.ground).multiplyScalar(gain);
    u.uKeyCol.value.copy(probe.keyColor).multiplyScalar(gain);
    u.uKeyDir.value.copy(probe.keyDir);
  }

  setFog(fog) {
    if (!fog) return;
    const u = this.material.uniforms;
    if (fog.color) u.uFogColor.value.copy(fog.color);
    u.uFogDensity.value = fog.density ?? 0.0016;
  }

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
