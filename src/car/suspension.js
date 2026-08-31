/**
 * Suspension: aerofoil-section wishbones, front pushrod, rear pullrod, track rods,
 * driveshafts and uprights. All members are merged into one carbon mesh.
 * Owner: CAR.
 */
import * as THREE from 'three';
import { D } from './dims.js';
import { nacaSection, mergeSafe } from './geometry.js';

const V3 = THREE.Vector3;

/** Aerofoil-section strut running from a to b, chord along the car's Z where possible. */
function strut(a, b, chord = 0.075, thick = 0.16) {
  const dir = new V3().subVectors(b, a);
  const len = dir.length();
  const pts = nacaSection(22, thick, 0.0).map(p => new THREE.Vector2(p.x * chord, p.y * chord));
  const shape = new THREE.Shape(pts);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false, curveSegments: 1 });
  // orient local +Z along the member; keep the chord (local X) pointing along the car
  const o = new THREE.Object3D();
  o.position.copy(a);
  const n = dir.clone().normalize();
  const up = Math.abs(n.y) > 0.86 ? new V3(0, 0, 1) : new V3(0, 1, 0);
  o.up.copy(up);
  o.lookAt(b);
  o.updateMatrix();
  geo.applyMatrix4(o.matrix);
  return geo;
}

function tube(a, b, r = 0.020, seg = 8) {
  const dir = new V3().subVectors(b, a);
  const g = new THREE.CylinderGeometry(r, r, dir.length(), seg);
  const o = new THREE.Object3D();
  o.position.copy(a.clone().add(b).multiplyScalar(0.5));
  o.quaternion.setFromUnitVectors(new V3(0, 1, 0), dir.clone().normalize());
  o.updateMatrix();
  g.applyMatrix4(o.matrix);
  return g;
}

export function buildSuspension(M) {
  const parts = [];
  const P = (x, y, z) => new V3(x, y, z);

  for (const sx of [1, -1]) {
    /* ---------------- front: pushrod ---------------- */
    const zF = D.axleF, hubF = D.trackF - D.tyreWf / 2 - 0.010;   // upright plane
    const uF = P(sx * hubF, 0.085, zF);          // upper outboard
    const lF = P(sx * hubF, -0.115, zF);         // lower outboard
    parts.push(strut(P(sx * 0.128, 0.098, zF + 0.34), uF, 0.078, 0.15));
    parts.push(strut(P(sx * 0.150, 0.092, zF - 0.30), uF, 0.078, 0.15));
    parts.push(strut(P(sx * 0.140, -0.088, zF + 0.38), lF, 0.088, 0.14));
    parts.push(strut(P(sx * 0.163, -0.095, zF - 0.32), lF, 0.088, 0.14));
    // pushrod: outboard-low to chassis-high
    parts.push(strut(P(sx * (hubF - 0.02), -0.108, zF - 0.05), P(sx * 0.112, 0.135, zF + 0.28), 0.050, 0.24));
    // track rod
    parts.push(strut(P(sx * (hubF - 0.01), -0.018, zF - 0.145), P(sx * 0.135, -0.020, zF - 0.30), 0.048, 0.22));
    // upright
    const upF = new THREE.BoxGeometry(0.055, 0.215, 0.09);
    upF.translate(sx * (hubF + 0.012), -0.012, zF);
    parts.push(upF);

    /* ---------------- rear: pullrod ---------------- */
    const zR = D.axleR, hubR = D.trackR - D.tyreWr / 2 - 0.010;
    const uR = P(sx * hubR, 0.112, zR);
    const lR = P(sx * hubR, -0.108, zR);
    parts.push(strut(P(sx * 0.105, 0.100, zR + 0.33), uR, 0.082, 0.15));
    parts.push(strut(P(sx * 0.092, 0.100, zR - 0.24), uR, 0.082, 0.15));
    parts.push(strut(P(sx * 0.108, -0.150, zR + 0.35), lR, 0.092, 0.14));
    parts.push(strut(P(sx * 0.095, -0.152, zR - 0.26), lR, 0.092, 0.14));
    // pullrod: outboard-high to gearbox-low
    parts.push(strut(P(sx * (hubR - 0.02), 0.100, zR + 0.03), P(sx * 0.085, -0.138, zR - 0.26), 0.048, 0.24));
    // toe link
    parts.push(strut(P(sx * (hubR - 0.01), -0.030, zR - 0.150), P(sx * 0.098, -0.040, zR - 0.30), 0.046, 0.22));
    // driveshaft
    parts.push(tube(P(sx * 0.115, 0.040, zR), P(sx * (hubR - 0.01), 0.040, zR), 0.030, 10));
    const upR = new THREE.BoxGeometry(0.055, 0.230, 0.095);
    upR.translate(sx * (hubR + 0.012), 0.002, zR);
    parts.push(upR);
  }

  const geo = mergeSafe(parts);
  const m = new THREE.Mesh(geo ?? parts[0], M.carbon);
  m.castShadow = true; m.receiveShadow = true; m.name = 'suspension';
  return m;
}
