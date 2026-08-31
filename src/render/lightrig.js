/**
 * The global light rig. Owner: RENDER.
 *
 * Hard cap is 8 dynamic lights; we spend 6:
 *   3 shadow-casting "broadcast keys" at FIXED world azimuths and high elevation.
 *     Fixed azimuths (not car-relative) matter: as the car works round the lap its
 *     shadows swing, exactly like driving under a real pole array. Each key carries
 *     only ~1/3 of the direct light, so you get three faint, soft, overlapping
 *     shadows instead of one hard one — the Bahrain read.
 *   2 non-shadow rims (one cool, one warm sodium) for edge definition on bodywork.
 *   1 hemisphere for the last of the fill.
 * The bulk of the ambient comes from the PMREM floodlight environment, which is
 * shadowless by nature and is why the track looks "low-shadow, high-CRI".
 *
 * Plus a fake contact shadow decal under the car: shadow maps at this frustum size
 * cannot resolve the tyre contact patches, and without them the car floats.
 */
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

const KEYS = [
  { az: 28, el: 56, color: 0xe8f0ff, w: 0.38 },
  { az: 152, el: 62, color: 0xdfe9ff, w: 0.34 },
  { az: 268, el: 49, color: 0xeaf2ff, w: 0.28 },
];

/**
 * Contact-shadow textures. Per docs/reference-visual.md the single tell that separates
 * good night lighting from bad is the GRADATION where the tyre meets the road: too dark
 * and flat and the car "appears unnaturally detached, almost floating". So these are not
 * flat blobs — each is a hard, near-black core the size of the actual contact patch,
 * a fast mid falloff, and a long, very light ambient skirt.
 * Stored as multiply factors: 1 = untouched, 0 = black.
 */
function contactTexture(size, stops) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, size, size);
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [t, v] of stops) {
    const q = Math.round(v * 255);
    grd.addColorStop(t, `rgb(${q},${q},${q})`);
  }
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// tyre: 0.30 m contact patch inside a ~1.4 m plane -> core radius ~0.21 of the plane
const TYRE_STOPS = [
  [0.00, 0.06], [0.14, 0.10], [0.22, 0.26], [0.34, 0.52],
  [0.50, 0.74], [0.70, 0.90], [0.86, 0.975], [1.00, 1.0],
];
// floor / bodywork ambient occlusion: broad, gentle, never black
const BODY_STOPS = [
  [0.00, 0.42], [0.30, 0.50], [0.55, 0.68], [0.78, 0.88], [1.00, 1.0],
];

export class LightRig {
  constructor(scene, quality) {
    this.scene = scene;
    this.q = quality;
    this.lights = [];
    this.keys = [];
    this.group = new THREE.Group();
    this.group.name = 'render.lightRig';
    scene.add(this.group);

    const S = quality.shadowMapSize || 1024;

    for (const k of KEYS) {
      const l = new THREE.DirectionalLight(k.color, 1);
      const az = THREE.MathUtils.degToRad(k.az), el = THREE.MathUtils.degToRad(k.el);
      l.userData.dir = new THREE.Vector3(
        Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el),
      ).normalize();
      l.userData.w = k.w;
      if (quality.shadows) {
        l.castShadow = true;
        l.shadow.mapSize.set(S, S);
        const c = l.shadow.camera;
        // +/-36 m reaches past the barrier line on both sides, so the TecPro and
        // tyre walls (which DO set castShadow) finally throw onto the racing
        // surface instead of the frustum ending at the white line. At 2048 that is
        // 3.5 cm/texel — finer than the +/-26 at 1024 it replaces.
        c.left = -36; c.right = 36; c.top = 36; c.bottom = -36;
        c.near = 30; c.far = 340;
        c.updateProjectionMatrix();
        l.shadow.bias = -0.0006;
        // normalBias is in world metres and pushes the receiver along its normal:
        // at 3.5 cm/texel it only has to cover a texel, not the 5 cm one it did.
        l.shadow.normalBias = 0.030;
        l.shadow.intensity = 0.92;
      }
      this.group.add(l, l.target);
      this.keys.push(l);
      this.lights.push(l);
    }

    // cool rim from low behind, warm sodium fill from low front — no shadows
    this.rimCool = new THREE.DirectionalLight(0xbfd6ff, 1);
    this.rimCool.userData.dir = new THREE.Vector3(-0.62, 0.32, -0.72).normalize();
    this.rimWarm = new THREE.DirectionalLight(0xffb469, 1);
    this.rimWarm.userData.dir = new THREE.Vector3(0.70, 0.22, 0.68).normalize();
    this.group.add(this.rimCool, this.rimCool.target, this.rimWarm, this.rimWarm.target);
    this.lights.push(this.rimCool, this.rimWarm);

    this.hemi = new THREE.HemisphereLight(0xb9cdf0, 0x120c06, 1);
    // three derives a HemisphereLight's axis from its WORLD POSITION, not from a
    // target. At the group origin that vector is (0,0,0), transformDirection leaves
    // it degenerate, and every normal in the scene gets dotNL = 0 -> a flat 50/50
    // sky/ground blend: no up/down gradient at all, and the warm ground colour
    // landing on upward-facing asphalt. One metre of offset restores the axis.
    this.hemi.position.set(0, 1, 0);
    this.group.add(this.hemi);
    this.lights.push(this.hemi);

    // ---- contact shadows ----------------------------------------------------
    const decalMat = (tex) => new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, uStrength: { value: 1 } },
      vertexShader: `varying vec2 vUvC;
        void main(){
          vUvC = uv;
          vec4 lp = vec4( position, 1.0 );
          #ifdef USE_INSTANCING
            lp = instanceMatrix * lp;
          #endif
          gl_Position = projectionMatrix * modelViewMatrix * lp;
        }`,
      fragmentShader: `uniform sampler2D map; uniform float uStrength; varying vec2 vUvC;
        void main(){
          vec3 c = texture2D( map, vUvC ).rgb;
          gl_FragColor = vec4( mix( vec3( 1.0 ), c, uStrength ), 1.0 );
        }`,
      transparent: true, depthWrite: false, blending: THREE.MultiplyBlending,
      toneMapped: false, fog: false,
    });

    const plane = new THREE.PlaneGeometry(1, 1);
    plane.rotateX(-Math.PI / 2);            // bake the flatten into the geometry

    this.bodyAO = new THREE.Mesh(plane, decalMat(contactTexture(128, BODY_STOPS)));
    this.bodyAO.scale.set(2.6, 1, 5.6);
    this.bodyAO.renderOrder = 4;
    this.bodyAO.frustumCulled = false;
    this.bodyAO.name = 'render.bodyAO';
    this.bodyAO.userData.noLightField = true;
    scene.add(this.bodyAO);

    this.tyreAO = new THREE.InstancedMesh(plane, decalMat(contactTexture(128, TYRE_STOPS)), 4);
    this.tyreAO.renderOrder = 6;
    this.tyreAO.frustumCulled = false;
    this.tyreAO.name = 'render.tyreAO';
    this.tyreAO.userData.noLightField = true;
    this.tyreAO.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.tyreAO);

    this.setIntensity(1);
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._qy = new THREE.Quaternion();
    this._m4 = new THREE.Matrix4();
    this._pos = new THREE.Vector3();
    this._scl = new THREE.Vector3();
  }

  /**
   * @param {number} scale overall multiplier on the whole rig
   * @param {object} mix   {direct, rim, hemi} irradiance budget in three units
   */
  setIntensity(scale, mix = {}) {
    const direct = (mix.direct ?? 3.10) * scale;
    const rim = (mix.rim ?? 0.62) * scale;
    const hemi = (mix.hemi ?? 0.55) * scale;
    for (const l of this.keys) l.intensity = direct * l.userData.w;
    this.rimCool.intensity = rim;
    this.rimWarm.intensity = rim * 0.62;
    this.hemi.intensity = hemi;
  }

  setShadows(on) {
    for (const l of this.keys) l.castShadow = on && !!this.q.shadows;
  }

  setContact(on) {
    if (this.bodyAO) this.bodyAO.visible = !!on;
    if (this.tyreAO) this.tyreAO.visible = !!on;
  }

  /**
   * Keep every shadow frustum centred on the car and the contact decals glued to the road.
   * @param wheels state.car.wheel — real per-wheel world positions, so the tyre shadows
   *               track steering, suspension travel and any airborne moment.
   */
  update(carPos, carQuat, trackY, contactStrength = 1, wheels = null) {
    const D = 170;
    for (const l of this.lights) {
      const d = l.userData?.dir; if (!d) continue;
      l.position.set(carPos.x + d.x * D, carPos.y + d.y * D, carPos.z + d.z * D);
      l.target.position.copy(carPos);
      l.target.updateMatrixWorld();
    }

    const yaw = Math.atan2(
      2 * (carQuat.w * carQuat.y + carQuat.x * carQuat.z),
      1 - 2 * (carQuat.y * carQuat.y + carQuat.x * carQuat.x),
    );
    const y0 = (trackY ?? 0);
    const on = contactStrength > 0.02;

    if (this.bodyAO) {
      this.bodyAO.visible = on;
      this.bodyAO.position.set(carPos.x, y0 + 0.030, carPos.z);
      this._e.set(0, yaw, 0);
      this.bodyAO.setRotationFromEuler(this._e);
      this.bodyAO.material.uniforms.uStrength.value = contactStrength * 0.85;
    }

    if (this.tyreAO) {
      this.tyreAO.visible = on;
      this.tyreAO.material.uniforms.uStrength.value = contactStrength;
      this._qy.setFromAxisAngle(UP, yaw);
      for (let i = 0; i < 4; i++) {
        const w = wheels?.[i];
        // fall back to a nominal footprint if physics has not written wheel poses yet
        let wx = carPos.x, wz = carPos.z;
        if (w?.pos && Number.isFinite(w.pos.x)) { wx = w.pos.x; wz = w.pos.z; }
        else {
          const lx = (i % 2 ? 1 : -1) * 0.82, lz = (i < 2 ? 1.62 : -1.78);
          wx = carPos.x + Math.cos(yaw) * lx + Math.sin(yaw) * lz;
          wz = carPos.z - Math.sin(yaw) * lx + Math.cos(yaw) * lz;
        }
        // rear tyres are 375 mm wide vs 275 front — the shadow should show it
        const k = i < 2 ? 1.25 : 1.55;
        const lift = w?.contact === false ? 0.10 : 0.0;
        this._pos.set(wx, y0 + 0.022, wz);
        this._scl.set(k, 1, k * 1.06);
        this._m4.compose(this._pos, this._qy, this._scl);
        this.tyreAO.setMatrixAt(i, this._m4);
        if (lift) { /* airborne wheels keep their decal but it is already faint */ }
      }
      this.tyreAO.instanceMatrix.needsUpdate = true;
    }
  }
}
