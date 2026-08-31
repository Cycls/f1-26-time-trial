/**
 * SHARED STATE CONTRACT — Owner: CORE. Read by everyone, written by declared owners only.
 * Modules MUST NOT add top-level keys; extend your own sub-object.
 * Units: metres, seconds, radians, m/s, Newtons, kg, Kelvin-free (degrees C for tyres).
 */
import * as THREE from 'three';

export function createState() {
  return {
    t: 0, dt: 0, frame: 0,

    // --- written by INPUT ---
    input: {
      steer: 0,        // -1 left .. +1 right (already shaped/ramped)
      throttle: 0,     // 0..1
      brake: 0,        // 0..1
      clutch: 0,
      shiftUp: false, shiftDown: false,
      override: false, // 2026 "Manual Override" boost button (replaces DRS)
      drsRequest: false,
      resetRequest: false, flashback: false,
      gamepad: false, source: 'keyboard',
    },

    // --- written by PHYSICS ---
    car: {
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      velocity: new THREE.Vector3(),      // world m/s
      localVel: new THREE.Vector3(),      // body frame: x=lateral(+right) y=up z=forward
      angularVelocity: new THREE.Vector3(),
      speed: 0,            // m/s scalar
      kph: 0,
      rpm: 0, gear: 1, gearCount: 8, clutchEngaged: 1,
      engineLoad: 0, turboBoost: 0, turboSpool: 0,
      ers: 1, ersDeploy: 0, ersHarvest: 0, overrideActive: false, overrideAvail: 1,
      aeroMode: 'Z',       // 'Z' high downforce, 'X' low drag (2026 active aero)
      downforce: 0, drag: 0,
      fuel: 100, fuelMix: 2,
      lateralG: 0, longG: 0, verticalG: 0,
      yawRate: 0, slipAngle: 0,
      steerAngle: 0,        // road wheel angle, radians
      onTrack: true, wheelsOff: 0, airborne: false,
      // per wheel: 0=FL 1=FR 2=RL 3=RR
      wheel: Array.from({ length: 4 }, () => ({
        pos: new THREE.Vector3(), contact: true, load: 0, susTravel: 0, susVel: 0,
        spin: 0, angle: 0, slipRatio: 0, slipAngle: 0, gripUse: 0,
        locked: false, spinning: false, temp: 90, wear: 0, surface: 'asphalt',
        forceLong: 0, forceLat: 0,
      })),
      brakeTemp: [400, 400, 400, 400],
      damage: 0,
    },

    // --- written by TRACK (queried by physics/game) ---
    trackQuery: { s: 0, u: 0, width: 8, heading: 0, elevation: 0, curvature: 0, banking: 0 },

    // --- written by GAME (time trial) ---
    lap: {
      number: 0, time: 0, valid: true, started: false,
      best: null, last: null, bestValid: null,
      sector: [0, 0, 0], sectorDone: [false, false, false],
      bestSector: [null, null, null], sessionBestSector: [null, null, null],
      lastSectorColour: ['', '', ''],   // 'purple'|'green'|'yellow'
      delta: 0, deltaValid: false,
      progress: 0,        // 0..1 around lap
      distance: 0,
      invalidatedAt: null,
      ghost: { active: false, progress: 0, position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), time: 0 },
      leaderboard: [],
    },

    // --- written by CAMERA ---
    camera: { mode: 'tvpod', fov: 62, shake: 0, modes: [] },

    // --- written by RENDER ---
    render: { fps: 0, ms: 0, drawCalls: 0, triangles: 0, quality: 'high', exposure: 1 },

    flags: { paused: false, started: false, ready: false, menu: true, replay: false },
  };
}
