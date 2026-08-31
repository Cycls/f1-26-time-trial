/**
 * Approximate the scene light rig for particle shading. Owner: VFX.
 *
 * Custom ShaderMaterials do not get three's light uniforms or scene.environment, so we
 * sample the rig ourselves (cheaply, a few times a second) and reduce it to a hemispheric
 * term + one key direction. Bahrain at night is ~4500 overhead cool-white luminaires, so
 * the hemispheric term dominates and the key is soft: that is exactly what smoke wants.
 */
import * as THREE from 'three';

// Night-race floor: even with no rig present, smoke is never unlit black.
const FLOOR_SKY = new THREE.Color(0.52, 0.60, 0.76);
const FLOOR_GND = new THREE.Color(0.10, 0.085, 0.07);

export class LightProbe {
  constructor(scene) {
    this.scene = scene;
    this.sky = new THREE.Color(0.62, 0.70, 0.86);
    this.ground = new THREE.Color(0.13, 0.11, 0.09);
    this.keyColor = new THREE.Color(0.55, 0.62, 0.80);
    this.keyDir = new THREE.Vector3(0.25, 0.92, 0.3).normalize();
    this._acc = 9;
    this._v = new THREE.Vector3(); this._w = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  update(dt, carPos) {
    this._acc += dt;
    if (this._acc < 0.4) return;
    this._acc = 0;
    let sr = 0, sg = 0, sb = 0, gr = 0, gg = 0, gb = 0;
    let bestI = 0, kr = 0, kg = 0, kb = 0;
    this._w.set(0, 1, 0);
    let localR = 0, localG = 0, localB = 0;

    this.scene.traverse((o) => {
      if (!o.isLight || o.visible === false) return;
      const c = o.color, i = o.intensity;
      if (o.isAmbientLight) { sr += c.r * i; sg += c.g * i; sb += c.b * i; gr += c.r * i; gg += c.g * i; gb += c.b * i; return; }
      if (o.isHemisphereLight) {
        sr += c.r * i; sg += c.g * i; sb += c.b * i;
        const g = o.groundColor; gr += g.r * i; gg += g.g * i; gb += g.b * i; return;
      }
      if (o.isDirectionalLight) {
        if (i > bestI) {
          bestI = i; kr = c.r * i; kg = c.g * i; kb = c.b * i;
          o.getWorldPosition(this._v);
          if (o.target) { o.target.getWorldPosition(this._w); this._v.sub(this._w); }
          if (this._v.lengthSq() > 1e-6) this.keyDir.copy(this._v).normalize();
        }
        // a directional also lifts the general level a little (multi-mast fill)
        sr += c.r * i * 0.16; sg += c.g * i * 0.16; sb += c.b * i * 0.16;
        return;
      }
      if ((o.isPointLight || o.isSpotLight) && carPos) {
        o.getWorldPosition(this._v);
        const d2 = this._v.distanceToSquared(carPos);
        const dist = o.distance || 90;
        if (d2 < dist * dist) {
          const f = i * (1 - Math.sqrt(d2) / dist) * 0.35;
          localR += c.r * f; localG += c.g * f; localB += c.b * f;
        }
      }
    });

    // scene.environment (PMREM) cannot be sampled on the CPU cheaply; treat it as extra sky fill.
    if (this.scene.environment) {
      const ei = this.scene.environmentIntensity ?? 1;
      sr += 0.20 * ei; sg += 0.23 * ei; sb += 0.30 * ei;
      gr += 0.05 * ei; gg += 0.045 * ei; gb += 0.04 * ei;
    }
    sr += localR; sg += localG; sb += localB;

    sr = Math.max(sr, FLOOR_SKY.r); sg = Math.max(sg, FLOOR_SKY.g); sb = Math.max(sb, FLOOR_SKY.b);
    gr = Math.max(gr, FLOOR_GND.r); gg = Math.max(gg, FLOOR_GND.g); gb = Math.max(gb, FLOOR_GND.b);
    kr = Math.max(kr, 0.10); kg = Math.max(kg, 0.11); kb = Math.max(kb, 0.14);

    // Normalise to the flood term. The rig's absolute intensities belong to RENDER and can
    // change by an order of magnitude; what we want from it is the COLOUR and the RATIOS.
    // Level is then set once, by the caller, from the tone-mapping exposure.
    const lum = Math.max(0.2126 * sr + 0.7152 * sg + 0.0722 * sb, 1e-4);
    const kl = (0.2126 * kr + 0.7152 * kg + 0.0722 * kb) / lum;
    const kScale = Math.min(0.55, Math.max(0.18, kl)) / Math.max(kl, 1e-4) / lum;
    const gl = (0.2126 * gr + 0.7152 * gg + 0.0722 * gb) / lum;
    const gScale = Math.min(0.34, Math.max(0.06, gl)) / Math.max(gl, 1e-4) / lum;
    this.sky.setRGB(sr / lum, sg / lum, sb / lum);
    this.ground.setRGB(gr * gScale, gg * gScale, gb * gScale);
    this.keyColor.setRGB(kr * kScale, kg * kScale, kb * kScale);
  }
}
