/**
 * Material library for the car. Owner: CAR.
 * Automotive paint = metallic flake base + clearcoat (MeshPhysicalMaterial).
 * Exposed carbon = procedural 2x2 twill weave (normal + roughness + colour).
 * All maps are generated with canvas — nothing is downloaded.
 */
import * as THREE from 'three';
import {
  THEME, carbonWeave, bodyLivery, podLivery, wingSkin, endplateSkin, haloSkin,
  brakeDiscSkin, wheelCoverSkin, helmetSkin, steeringDisplaySkin, suitSkin, mirrored,
} from './textures.js';
import { bodyProfile } from './bodywork.js';

export { THEME };

/** Fine random-normal map: reads as metallic flake sparkle under the track lights. */
let _flake = null;
function flakeNormal(size = 256) {
  if (_flake) return _flake;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const d = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    // mostly flat with sparse steep flakes
    const flake = Math.random() < 0.12;
    const a = Math.random() * Math.PI * 2;
    const m = flake ? 0.45 + Math.random() * 0.4 : Math.random() * 0.06;
    const nx = Math.cos(a) * m, ny = Math.sin(a) * m;
    const nz = Math.sqrt(Math.max(0.02, 1 - nx * nx - ny * ny));
    d.data[i * 4] = (nx * 0.5 + 0.5) * 255;
    d.data[i * 4 + 1] = (ny * 0.5 + 0.5) * 255;
    d.data[i * 4 + 2] = (nz * 0.5 + 0.5) * 255;
    d.data[i * 4 + 3] = 255;
  }
  g.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 4;
  _flake = t;
  return t;
}

function cloneTex(t, rx, ry) {
  const c = t.clone();
  c.needsUpdate = true;
  c.wrapS = c.wrapT = THREE.RepeatWrapping;
  c.repeat.set(rx, ry);
  return c;
}

/**
 * Build every material the car needs.
 * @param {object} o {primary, accent, envIntensity, compound}
 */
export function createMaterials(o = {}) {
  const env = o.envIntensity ?? 1.15;
  const weave = carbonWeave();
  const flake = flakeNormal();
  const livery = bodyLivery({ perimeterAt: bodyProfile() });
  const pod = podLivery();

  const carbonAt = (rx, ry, extra = {}) => new THREE.MeshPhysicalMaterial({
    color: 0x1b1e23,
    map: cloneTex(weave.color, rx, ry),
    normalMap: cloneTex(weave.normal, rx, ry),
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughnessMap: cloneTex(weave.rough, rx, ry),
    roughness: 1.0, metalness: 0.15,
    clearcoat: 0.85, clearcoatRoughness: 0.10,
    envMapIntensity: env * 0.9,
    ...extra,
  });

  // metallic flake pigment sits UNDER a clear coat: low metalness on the base,
  // the "metallic" read comes from the flake normals + the clearcoat specular.
  const paint = (hex, extra = {}) => new THREE.MeshPhysicalMaterial({
    color: hex,
    normalMap: flake, normalScale: new THREE.Vector2(0.06, 0.06),
    metalness: 0.18, roughness: 0.30,
    clearcoat: 1.0, clearcoatRoughness: 0.045,
    envMapIntensity: env,
    ...extra,
  });

  const M = {};

  // ---- bodywork -----------------------------------------------------------
  M.body = new THREE.MeshPhysicalMaterial({
    map: livery.map,
    roughnessMap: livery.roughnessMap,
    normalMap: cloneTex(flake, 24, 70), normalScale: new THREE.Vector2(0.055, 0.055),
    metalness: 0.16, roughness: 1.0,
    clearcoat: 1.0, clearcoatRoughness: 0.05,
    envMapIntensity: env,
  });

  // sidepods carry their own sheet — see textures.podLivery
  M.bodyPod = new THREE.MeshPhysicalMaterial({
    map: pod.map,
    roughnessMap: pod.roughnessMap,
    normalMap: cloneTex(flake, 18, 40), normalScale: new THREE.Vector2(0.055, 0.055),
    metalness: 0.16, roughness: 1.0,
    clearcoat: 1.0, clearcoatRoughness: 0.05,
    envMapIntensity: env,
  });

  M.paint = paint(o.primary ?? 0xc8102e);
  M.paintWhite = paint(0xeef1f5, { metalness: 0.05, roughness: 0.26 });
  M.paintGold = paint(0xe8c37a, { metalness: 0.95, roughness: 0.18 });

  // ---- carbon -------------------------------------------------------------
  // Repeat counts are chosen for the UV convention each mesh actually uses.
  // Extruded plates (plateZY/plateZX/ExtrudeGeometry) carry UVs in METRES, so
  // 7.7 repeats/m x 32 cells = ~4 mm weave. carbonMetric goes on lofts built with
  // metricUV: 0.13, where 1 UV unit is already 0.13 m.
  M.carbon = carbonAt(7.7, 7.7);                     // extruded plates, metric UVs
  M.carbonMetric = carbonAt(1, 1);                   // lofts built with metricUV: 0.13
  M.carbonBody = M.carbonMetric;                     // legacy alias
  M.carbonFloor = carbonAt(1, 1, { clearcoat: 0.55, roughness: 1.0 });
  M.carbonMatte = carbonAt(3, 5, {
    clearcoat: 0.12, clearcoatRoughness: 0.5, color: 0x14161a,
  });
  M.matteBlack = new THREE.MeshStandardMaterial({ color: 0x0b0c0e, metalness: 0.05, roughness: 0.86, envMapIntensity: env * 0.5 });
  M.cockpitInner = new THREE.MeshStandardMaterial({ color: 0x0a0b0d, metalness: 0.1, roughness: 0.9, envMapIntensity: env * 0.35, side: THREE.DoubleSide });

  // ---- wings --------------------------------------------------------------
  M.wingMain = new THREE.MeshPhysicalMaterial({
    map: wingSkin({}),
    normalMap: flake, normalScale: new THREE.Vector2(0.05, 0.05),
    metalness: 0.16, roughness: 0.28, clearcoat: 1.0, clearcoatRoughness: 0.05,
    envMapIntensity: env,
  });
  M.wingFlap = new THREE.MeshPhysicalMaterial({
    map: wingSkin({ base: '#e6e9ee', stripe: false, tipBlocks: false }),
    metalness: 0.05, roughness: 0.27, clearcoat: 1.0, clearcoatRoughness: 0.05,
    envMapIntensity: env,
  });
  const epMap = endplateSkin();
  M.endplate = new THREE.MeshPhysicalMaterial({
    map: epMap,
    normalMap: flake, normalScale: new THREE.Vector2(0.04, 0.04),
    metalness: 0.16, roughness: 0.30, clearcoat: 1.0, clearcoatRoughness: 0.06,
    envMapIntensity: env, side: THREE.DoubleSide,
  });
  // mirrored copy for the -X side so the sponsor never reads backwards
  M.endplateL = M.endplate.clone();
  M.endplateL.map = mirrored(epMap);
  // Matte black carbon. The halo sits ~350 mm from the cockpit eye: anything
  // bright on it frames — and under floodlights, blows out — the entire forward view.
  M.halo = new THREE.MeshPhysicalMaterial({
    map: haloSkin(),
    color: 0xffffff,
    metalness: 0.10, roughness: 0.55, clearcoat: 0.18, clearcoatRoughness: 0.40,
    envMapIntensity: env * 0.45,
  });

  // ---- metals -------------------------------------------------------------
  M.metal = new THREE.MeshStandardMaterial({ color: 0x9aa2ad, metalness: 1.0, roughness: 0.30, envMapIntensity: env * 1.3 });
  M.titanium = new THREE.MeshStandardMaterial({ color: 0x6e737b, metalness: 1.0, roughness: 0.42, envMapIntensity: env * 1.1 });
  M.exhaust = new THREE.MeshStandardMaterial({ color: 0x4a4038, metalness: 1.0, roughness: 0.55, envMapIntensity: env });
  M.mirrorGlass = new THREE.MeshStandardMaterial({ color: 0xc8d2dc, metalness: 1.0, roughness: 0.06, envMapIntensity: env * 2.0 });

  // ---- wheels -------------------------------------------------------------
  M.rimBarrel = new THREE.MeshStandardMaterial({ color: 0x1d2025, metalness: 0.95, roughness: 0.33, envMapIntensity: env });
  const coverMap = wheelCoverSkin();
  M.wheelCover = new THREE.MeshPhysicalMaterial({
    map: coverMap, metalness: 0.55, roughness: 0.32,
    clearcoat: 0.9, clearcoatRoughness: 0.09, envMapIntensity: env,
  });
  M.wheelCoverL = M.wheelCover.clone();
  M.wheelCoverL.map = mirrored(coverMap);
  const disc = brakeDiscSkin();
  M.brakeDisc = new THREE.MeshStandardMaterial({
    map: disc.map, emissiveMap: disc.emissiveMap,
    color: 0x2a2a2e, metalness: 0.25, roughness: 0.62,
    emissive: 0xff3a00, emissiveIntensity: 0.0,
    envMapIntensity: env * 0.5, side: THREE.DoubleSide,
  });
  M.caliper = new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.9, roughness: 0.35, emissive: 0xff2200, emissiveIntensity: 0, envMapIntensity: env });
  M.brakeDuct = carbonAt(7, 7, { emissive: 0xff3000, emissiveIntensity: 0 });
  M.ductGlow = new THREE.MeshStandardMaterial({ color: 0x101216, metalness: 0.2, roughness: 0.7, emissive: 0xff4000, emissiveIntensity: 0, envMapIntensity: env * 0.5 });

  // ---- driver -------------------------------------------------------------
  M.helmet = new THREE.MeshPhysicalMaterial({
    map: helmetSkin(), metalness: 0.25, roughness: 0.18,
    clearcoat: 1.0, clearcoatRoughness: 0.03, envMapIntensity: env * 1.2,
  });
  M.visor = new THREE.MeshPhysicalMaterial({
    color: 0x120d05, metalness: 1.0, roughness: 0.06,
    clearcoat: 1.0, clearcoatRoughness: 0.02,
    envMapIntensity: env * 2.2,
  });
  M.suit = new THREE.MeshStandardMaterial({ map: suitSkin(), metalness: 0.0, roughness: 0.78, envMapIntensity: env * 0.6 });
  M.glove = new THREE.MeshStandardMaterial({ color: 0x1a1c20, metalness: 0.0, roughness: 0.72, envMapIntensity: env * 0.6 });
  M.hans = new THREE.MeshStandardMaterial({ color: 0x101216, metalness: 0.2, roughness: 0.6, envMapIntensity: env * 0.6 });
  M.display = new THREE.MeshBasicMaterial({ map: steeringDisplaySkin(), toneMapped: false });

  // ---- lights -------------------------------------------------------------
  M.rainLight = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff1010, emissiveIntensity: 3.0, roughness: 0.4, toneMapped: true });

  M.tyreSkins = {};   // filled per axle by wheels.js
  return M;
}

/** Legacy factory name kept so nothing that imported it breaks. */
export function createLivery(opts = {}) {
  return createMaterials(opts);
}
