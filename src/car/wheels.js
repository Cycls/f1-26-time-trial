/**
 * 2026 wheels. C10.7.2a regulates the rim exactly: diameter 462.5 mm front /
 * 463.0 mm rear, tyre mounting width 315 mm front / 401.3 mm rear, lip external
 * diameter 496 mm, magnesium alloy. Pirelli's 18" tyre is 720 mm outer diameter
 * on BOTH axles — a smaller front tyre reads as a different wheel entirely.
 * No front wheel arches in 2026.
 * Owner: CAR.
 */
import * as THREE from 'three';
import { D } from './dims.js';
import { revolve, mergeSafe } from './geometry.js';
import { tyreSkin } from './textures.js';

// index into the half-profile below where the tread band begins
const TREAD_FROM = 7;

/** Tyre section from inner bead to outer bead. a = axial fraction of W/2, r = radius. */
function tyreProfile(R, W, rim) {
  const hw = W / 2, lip = D.rimLip;
  const half = [
    [1.000, rim],            // bead seated on the rim, at the mounting width
    [1.000, lip],            // up the rim flange to the 496 mm lip
    [0.985, lip + 0.028],
    [0.958, R - 0.052],      // sidewall
    [0.900, R - 0.030],
    [0.818, R - 0.013],
    [0.716, R - 0.0045],
    [0.605, R],              // shoulder — tread starts here (TREAD_FROM)
    [0.310, R + 0.0013],
  ];
  const pts = [];
  for (let i = 0; i < half.length; i++) pts.push({ y: -half[i][0] * hw, r: half[i][1] });
  pts.push({ y: 0, r: R + 0.0017 });
  for (let i = half.length - 1; i >= 0; i--) pts.push({ y: half[i][0] * hw, r: half[i][1] });
  return { pts, treadIdx: [TREAD_FROM, pts.length - 1 - TREAD_FROM] };
}

function rimProfile(W, rim) {
  const hw = W / 2, lip = D.rimLip;
  return [
    { y: -hw, r: lip },
    { y: -hw * 0.965, r: rim },
    { y: -hw * 0.55, r: rim - 0.012 },
    { y: 0, r: rim - 0.017 },
    { y: hw * 0.55, r: rim - 0.012 },
    { y: hw * 0.965, r: rim },
    { y: hw, r: lip },
  ];
}

let _cache = {};

/**
 * @param {object} M materials
 * @param {boolean} front
 * @param {number} side +1 right, -1 left (outboard face points that way)
 */
export function buildWheel(M, front, side) {
  const R = front ? D.tyreRf : D.tyreRr;
  const W = front ? D.tyreWf : D.tyreWr;
  const rimR = front ? D.rimRf : D.rimRr;
  const key = front ? 'F' : 'R';

  if (!_cache[key]) {
    const { pts, treadIdx } = tyreProfile(R, W, rimR);
    const rev = revolve(pts, 60);
    rev.geometry.rotateZ(-Math.PI / 2);       // lathe axis Y -> wheel axis X
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].r - pts[i - 1].r, pts[i].y - pts[i - 1].y);
    const skin = tyreSkin({
      vTread0: rev.v[treadIdx[0]], vTread1: rev.v[treadIdx[1]],
      compound: 'soft', radius: R, profileLen: len,
    });
    const tyreMat = new THREE.MeshPhysicalMaterial({
      map: skin.map, roughnessMap: skin.roughnessMap,
      color: 0xffffff, metalness: 0.0, roughness: 1.0,
      clearcoat: 0.25, clearcoatRoughness: 0.55,
      envMapIntensity: 0.6,
    });
    const rimRev = revolve(rimProfile(W, rimR), 40);
    rimRev.geometry.rotateZ(-Math.PI / 2);
    _cache[key] = { tyre: rev.geometry, tyreMat, rim: rimRev.geometry, R, W, rimR };
  }
  const C = _cache[key];

  const wheel = new THREE.Group();
  wheel.name = front ? 'wheelF' : 'wheelR';

  // squash carries the load-dependent sidewall deflection; the spinner rotates inside it
  const squash = new THREE.Group(); squash.name = 'squash';
  const spin = new THREE.Group(); spin.name = 'spin';
  squash.add(spin); wheel.add(squash);

  const tyre = new THREE.Mesh(C.tyre, C.tyreMat);
  tyre.castShadow = true; tyre.receiveShadow = true; tyre.name = 'tyre';
  spin.add(tyre);

  const rim = new THREE.Mesh(C.rim, M.rimBarrel);
  rim.castShadow = true; spin.add(rim);

  // mandatory outboard wheel cover, sitting just inside the rim lip
  const cover = new THREE.Mesh(new THREE.CircleGeometry(D.rimLip - 0.006, 44), M.wheelCover);
  cover.position.x = side * C.W * 0.455;
  cover.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
  spin.add(cover);
  // inboard face plate so you never see through the wheel
  const inner = new THREE.Mesh(new THREE.CircleGeometry(D.rimLip - 0.006, 32), M.matteBlack);
  inner.position.x = -side * C.W * 0.44;
  inner.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
  spin.add(inner);

  // carbon brake disc (spins) — 328 mm front / 280 mm rear, glow driven from
  // brake input and disc temperature
  const discR = front ? 0.164 : 0.140;
  const disc = new THREE.Mesh(new THREE.RingGeometry(discR * 0.42, discR, 40, 1), M.brakeDisc.clone());
  disc.rotation.y = Math.PI / 2;
  disc.position.x = -side * C.W * 0.10;
  disc.name = 'disc';
  spin.add(disc);

  // caliper (upright-mounted, does not spin)
  const calParts = [];
  const arc = new THREE.TorusGeometry(discR * 1.02, 0.030, 8, 12, 1.0);
  arc.rotateY(Math.PI / 2); arc.rotateX(0);
  const arcM = arc.clone();
  arcM.rotateX(-2.35);
  arcM.translate(-side * C.W * 0.10, 0, 0);
  calParts.push(arcM);
  const block = new THREE.BoxGeometry(0.062, 0.075, 0.10);
  block.translate(-side * C.W * 0.10, discR * 0.86, -discR * 0.62);
  calParts.push(block);
  const caliper = new THREE.Mesh(mergeSafe(calParts) ?? block, M.caliper);
  caliper.castShadow = true; caliper.name = 'caliper';
  wheel.add(caliper);

  // brake duct assembly on the inboard face (does not spin)
  const ductParts = [];
  const drum = new THREE.CylinderGeometry(discR * 1.16, discR * 1.20, C.W * 0.44, 22, 1, true);
  drum.rotateZ(Math.PI / 2);
  drum.translate(-side * C.W * 0.30, 0, 0);
  ductParts.push(drum);
  const cake = new THREE.CircleGeometry(discR * 1.20, 26);
  cake.rotateY(side > 0 ? -Math.PI / 2 : Math.PI / 2);
  cake.translate(-side * C.W * 0.52, 0, 0);
  ductParts.push(cake);
  // forward-facing cooling scoop
  const scoop = new THREE.CylinderGeometry(0.052, 0.070, 0.16, 14, 1, true);
  scoop.rotateX(Math.PI / 2);
  scoop.translate(-side * C.W * 0.22, -0.055, R * 0.52);
  ductParts.push(scoop);
  // duct winglets
  for (let i = 0; i < 2; i++) {
    const w = new THREE.BoxGeometry(C.W * 0.60, 0.010, 0.115);
    w.translate(-side * C.W * 0.24, 0.055 + i * 0.075, -R * 0.30 - i * 0.02);
    ductParts.push(w);
  }
  const duct = new THREE.Mesh(mergeSafe(ductParts) ?? drum, M.brakeDuct);
  duct.castShadow = true; duct.name = 'duct';
  wheel.add(duct);

  // glowing duct interior (visible through the drum opening when hot)
  const glow = new THREE.Mesh(new THREE.RingGeometry(discR * 0.5, discR * 1.14, 24, 1), M.ductGlow.clone());
  glow.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
  glow.position.x = -side * C.W * 0.30;
  glow.name = 'ductGlow';
  wheel.add(glow);

  wheel.userData = { front, side, disc, glow, caliper, spin, squash, radius: R };
  return wheel;
}

export function clearWheelCache() { _cache = {}; }
