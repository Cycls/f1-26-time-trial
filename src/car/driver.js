/**
 * Driver: helmet + visor, HANS, shoulders, arms, gloves and the steering wheel.
 * The wheel and gloves rotate with steering input. Owner: CAR.
 */
import * as THREE from 'three';
import { roundedRect, sweepProfile, ellipseProfile, plateZY, mergeSafe } from './geometry.js';

const V3 = THREE.Vector3;
const TAU = Math.PI * 2;

export function buildDriver(M) {
  const g = new THREE.Group();
  g.name = 'driver';

  const HX = 0, HY = 0.288, HZ = -0.130;      // helmet centre

  // ---- helmet -------------------------------------------------------------
  const helmetGeo = new THREE.SphereGeometry(0.136, 30, 22, 0, TAU, 0, Math.PI * 0.80);
  helmetGeo.scale(1.0, 1.06, 1.10);
  const helmet = new THREE.Mesh(helmetGeo, M.helmet);
  helmet.position.set(HX, HY, HZ);
  helmet.castShadow = true; helmet.receiveShadow = true;
  helmet.name = 'helmet';
  g.add(helmet);
  if (M.helmet.map) { M.helmet.map.offset.x = 0.25; M.helmet.map.needsUpdate = true; }

  // visor: iridescent band across the front
  const visorGeo = new THREE.SphereGeometry(0.1385, 26, 12, 0.17, 2.80, 0.92, 0.56);
  visorGeo.scale(1.0, 1.06, 1.10);
  const visor = new THREE.Mesh(visorGeo, M.visor);
  visor.position.set(HX, HY, HZ);
  visor.name = 'visor';
  g.add(visor);
  // visor surround
  const surroundGeo = new THREE.SphereGeometry(0.1375, 26, 14, 0.155, 2.83, 0.885, 0.625);
  surroundGeo.scale(1.0, 1.06, 1.10);
  const surround = new THREE.Mesh(surroundGeo, M.matteBlack);
  surround.position.set(HX, HY, HZ);
  g.add(surround);

  // helmet aero fin
  const finGeo = plateZY(roundedRect(0.11, 0.030, 0.012, -0.02, 0), 0.010);
  const fin = new THREE.Mesh(finGeo, M.matteBlack);
  fin.position.set(0, HY + 0.138, HZ - 0.055);
  g.add(fin);

  // ---- HANS + shoulders ---------------------------------------------------
  const hans = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.030, 8, 18, Math.PI * 1.25), M.hans);
  hans.position.set(0, HY - 0.120, HZ + 0.012);
  hans.rotation.set(Math.PI / 2 - 0.22, 0, Math.PI * 0.875);
  hans.castShadow = true;
  g.add(hans);

  const shoulderShape = roundedRect(0.36, 0.19, 0.085, 0, 0);
  const shoulderGeo = new THREE.ExtrudeGeometry(shoulderShape, { depth: 0.24, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 3, curveSegments: 8 });
  const shoulders = new THREE.Mesh(shoulderGeo, M.suit);
  shoulders.position.set(0, HY - 0.150, HZ - 0.10);
  shoulders.castShadow = true;
  g.add(shoulders);

  // ---- steering column + wheel (rotates with steering) --------------------
  const steer = new THREE.Group();
  steer.name = 'steeringWheel';
  steer.position.set(0, 0.168, 0.318);
  steer.rotation.x = -0.42;                 // column rake

  // wheel body: F1 "butterfly" plan, extruded
  const bodyShape = new THREE.Shape();
  bodyShape.moveTo(-0.132, 0.052);
  bodyShape.lineTo(0.132, 0.052);
  bodyShape.quadraticCurveTo(0.150, 0.046, 0.150, 0.012);
  bodyShape.quadraticCurveTo(0.150, -0.052, 0.104, -0.062);
  bodyShape.quadraticCurveTo(0.070, -0.070, 0.062, -0.030);
  bodyShape.lineTo(-0.062, -0.030);
  bodyShape.quadraticCurveTo(-0.070, -0.070, -0.104, -0.062);
  bodyShape.quadraticCurveTo(-0.150, -0.052, -0.150, 0.012);
  bodyShape.quadraticCurveTo(-0.150, 0.046, -0.132, 0.052);
  const holeL = roundedRect(0.052, 0.036, 0.012, -0.098, 0.006);
  const holeR = roundedRect(0.052, 0.036, 0.012, 0.098, 0.006);
  bodyShape.holes.push(holeL, holeR);
  const wheelGeo = new THREE.ExtrudeGeometry(bodyShape, { depth: 0.026, bevelEnabled: true, bevelSize: 0.005, bevelThickness: 0.004, bevelSegments: 2, curveSegments: 10 });
  const wheelMesh = new THREE.Mesh(wheelGeo, M.carbon);
  wheelMesh.position.z = -0.013;
  wheelMesh.castShadow = true;
  steer.add(wheelMesh);

  // display
  const disp = new THREE.Mesh(new THREE.PlaneGeometry(0.115, 0.058), M.display);
  disp.position.set(0, 0.012, 0.015);
  steer.add(disp);
  // rotary dials + buttons
  const btns = [];
  for (let i = 0; i < 6; i++) {
    const b = new THREE.CylinderGeometry(0.0075, 0.0075, 0.006, 8);
    b.rotateX(Math.PI / 2);
    b.translate(-0.10 + (i % 3) * 0.028, -0.008 - Math.floor(i / 3) * 0.022, 0.016);
    btns.push(b);
    const b2 = b.clone(); b2.translate(0.20, 0, 0); btns.push(b2);
  }
  const btnMesh = new THREE.Mesh(mergeSafe(btns) ?? btns[0], M.paintWhite);
  steer.add(btnMesh);

  // grips
  for (const sx of [1, -1]) {
    const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.019, 0.070, 4, 10), M.matteBlack);
    grip.position.set(sx * 0.128, 0.006, 0.004);
    grip.rotation.z = sx * 0.12;
    steer.add(grip);
  }
  // gloves on the grips
  for (const sx of [1, -1]) {
    const glove = new THREE.Mesh(new THREE.CapsuleGeometry(0.031, 0.062, 5, 12), M.glove);
    glove.position.set(sx * 0.129, 0.008, 0.010);
    glove.rotation.z = sx * 0.12;
    glove.castShadow = true;
    steer.add(glove);
  }
  g.add(steer);

  // ---- arms ---------------------------------------------------------------
  const arms = new THREE.Group();
  arms.name = 'arms';
  for (const sx of [1, -1]) {
    const curve = new THREE.CatmullRomCurve3([
      new V3(sx * 0.148, HY - 0.145, HZ - 0.030),
      new V3(sx * 0.170, HY - 0.185, 0.075),
      new V3(sx * 0.152, HY - 0.180, 0.205),
      new V3(sx * 0.130, HY - 0.168, 0.290),
    ]);
    const armGeo = sweepProfile(curve, (t) => ellipseProfile(0.045 - 0.012 * t, 0.042 - 0.010 * t, 10), 18);
    const arm = new THREE.Mesh(armGeo, M.suit);
    arm.castShadow = true;
    arms.add(arm);
  }
  g.add(arms);

  return { group: g, steer, arms, helmet, visor };
}
