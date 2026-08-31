/**
 * Camera rig definitions + shared math. Owner: CAMERA.
 *
 * The set and the behaviour follow docs/reference-visual.md, not the generic
 * "racing game camera" playbook:
 *   - Eight views: TV Pod (default), TV Pod Offset, Near Chase, Far Chase, Cockpit,
 *     Nose Offset, Nose, Wing. (Helmet is kept as an EXTRA at the end of the cycle;
 *     it does not replace any of the eight.)
 *   - NO horizon lock. The onboards are mounted in car space and inherit the chassis
 *     attitude 1:1, exactly like the reference.
 *   - "Look to Apex Limit" YAWS the camera toward the corner (0-15, default 4). It does
 *     not roll it.
 *   - Camera Shake and Camera Movement both ship at MAXIMUM on a -20..20 scale.
 *   - No speed-based FOV widening exists in the reference. We keep a token amount
 *     (fovGain, ~2 deg across the whole speed range) and it can be zeroed.
 *
 * GEOMETRY NOTE. Mount positions are in the CAR MODEL's local frame (src/car/dims.js):
 * z = forward, y = up, origin at the physics body origin, road surface at y = D.GROUND.
 * Heights below are quoted relative to that origin, and CameraRig re-bases them onto the
 * measured ground plane at init so a change in the car model's origin cannot silently
 * bury the cameras.
 *
 * SIGN NOTE, derived from geometry rather than from another module's axis labels:
 * three.js is right-handed y-up, so for a body with +z forward and +y up the geometric
 * RIGHT is -x (right = cross(forward, up) = (0,0,1)x(0,1,0) = (-1,0,0)). Therefore:
 *   yaw    theta = atan2(fwd.x, fwd.z), increasing theta = turning LEFT
 *   yawRate  state.car.yawRate = dtheta/dt, so +yawRate = turning left
 *   lateral  aLat = yawRate * speed, + = accelerating leftwards
 *   roll     +roll (Euler z, applied about the view/body forward axis) tilts the up
 *            vector toward -x, i.e. LEANING RIGHT
 *   pitch    +pitchDown (Euler x) tips the forward axis DOWN
 */

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

/** retain-per-second constant for an exponential time constant in seconds. */
export const K = (tau) => Math.exp(-1 / Math.max(tau, 1e-4));

/** Frame-rate independent exponential approach. `retain` = fraction of error left after 1 s. */
export function damp(current, target, retain, dt) {
  return current + (target - current) * (1 - Math.pow(retain, dt));
}

/** Same, for angles: takes the short way round. */
export function dampAngle(current, target, retain, dt) {
  return current + wrapPi(target - current) * (1 - Math.pow(retain, dt));
}

export function wrapPi(a) {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const smoothstep = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

/** Reference default for "Look to Apex Limit": 4 on a 0-15 scale. */
export const LOOK_TO_APEX_DEFAULT = 4;
export const LOOK_TO_APEX_MAX = 15;

/**
 * Rig table.
 *  pos         mount point, car-model local metres (y is re-based onto the road at init)
 *  pitchDown   static downward tilt of the optical axis, degrees
 *  fov         vertical FOV at 16:9, degrees
 *  fovGain     extra FOV at ~300 km/h. The reference has none; this is a token 2 deg.
 *  apexMax     look-to-apex yaw limit in degrees AT SETTING 15 (scaled by the setting)
 *  apexLead    seconds of yaw-rate lead folded into the same clamp
 *  movePitch   Camera Movement: deg of extra pitch per g of longitudinal accel
 *  moveRoll    Camera Movement: deg of extra roll per g of lateral accel
 *  leanIn      deg per g of head-lean INTO the corner (the Helmet extra only)
 *  lag         metres of rearward mount lag per g of longitudinal accel
 *  latLag      metres of outward mount slide per g of lateral accel
 *  shake       per-rig shake multiplier
 *  rollFollow  chase rigs only: fraction of chassis roll the rig inherits
 *  spring      chase rigs only: world-space follow constants (time constants, seconds)
 */
export const MODES = {
  // ---------------------------------------------------------------- the eight
  tvpod: {
    key: 'tvpod', label: 'TV Pod', group: 'onboard',
    pos: [0, 0.65, -0.42], pitchDown: 3.0, fov: 62, fovGain: 2.0,
    apexMax: 20, apexLead: 0.08, movePitch: 0.50, moveRoll: 0.40, leanIn: 0,
    lag: 0.045, latLag: 0.018, shake: 0.95, spring: null,
  },
  tvpodOffset: {
    key: 'tvpodOffset', label: 'TV Pod Offset', group: 'onboard',
    // forward of the roll hoop and a touch lower: the halo hoop drops into the lower
    // third and the side arcs leave frame, which is the whole point of the Offset view
    pos: [0, 0.58, 0.16], pitchDown: 2.5, fov: 65, fovGain: 2.0,
    apexMax: 20, apexLead: 0.09, movePitch: 0.55, moveRoll: 0.45, leanIn: 0,
    lag: 0.045, latLag: 0.020, shake: 1.05, spring: null,
  },
  chase: {
    key: 'chase', label: 'Near Chase', group: 'chase',
    pos: [0, 1.73, -5.60], pitchDown: 0, fov: 64, fovGain: 2.0,
    apexMax: 14, apexLead: 0.12, movePitch: 0.22, moveRoll: 0, leanIn: 0,
    lag: 0.10, latLag: 0, shake: 0.45, rollFollow: 0.35,
    spring: { pos: 0.055, yaw: 0.085, aim: 0.045, aimAhead: 9.0, aimHeight: 0.43 },
  },
  chaseFar: {
    key: 'chaseFar', label: 'Far Chase', group: 'chase',
    pos: [0, 2.78, -10.50], pitchDown: 0, fov: 58, fovGain: 1.5,
    apexMax: 11, apexLead: 0.10, movePitch: 0.16, moveRoll: 0, leanIn: 0,
    lag: 0.12, latLag: 0, shake: 0.30, rollFollow: 0.22,
    spring: { pos: 0.085, yaw: 0.130, aim: 0.070, aimAhead: 12.0, aimHeight: 0.53 },
  },
  cockpit: {
    key: 'cockpit', label: 'Cockpit', group: 'onboard',
    // driver's eye, just inside the visor: the helmet shell falls entirely inside the
    // 0.25 m near plane so it self-clips instead of filling the frame.
    pos: [0, 0.293, -0.050], pitchDown: 2.0, fov: 70, fovGain: 2.0,
    apexMax: 22, apexLead: 0.10, movePitch: 0.60, moveRoll: 0.50, leanIn: 0,
    lag: 0.055, latLag: 0.022, shake: 1.00, spring: null,
  },
  noseOffset: {
    key: 'noseOffset', label: 'Nose Offset', group: 'onboard',
    pos: [0, 0.24, 1.45], pitchDown: 2.5, fov: 72, fovGain: 2.5,
    apexMax: 16, apexLead: 0.07, movePitch: 0.40, moveRoll: 0.30, leanIn: 0,
    lag: 0.035, latLag: 0.014, shake: 1.15, spring: null,
  },
  nose: {
    key: 'nose', label: 'Nose', group: 'onboard',
    // on the nose camera pods the car model carries at z = 2.16
    pos: [0, 0.13, 1.95], pitchDown: 2.0, fov: 72, fovGain: 2.0,
    apexMax: 16, apexLead: 0.06, movePitch: 0.35, moveRoll: 0.26, leanIn: 0,
    lag: 0.030, latLag: 0.012, shake: 1.30, spring: null,
  },
  wing: {
    key: 'wing', label: 'Wing', group: 'onboard',
    // Behind and above the rear wing on a long-ish lens. A wide FOV here shrinks the car
    // to a smear in the middle of the frame; 52 deg puts the rear tyres in the bottom
    // corners and the wing endplates across the lower third, which is the real view.
    pos: [0, 0.95, -3.30], pitchDown: 5.5, fov: 52, fovGain: 1.5,
    apexMax: 16, apexLead: 0.10, movePitch: 0.30, moveRoll: 0.30, leanIn: 0,
    lag: 0.055, latLag: 0.020, shake: 0.80, spring: null,
  },

  // ---------------------------------------------------------------- extras
  helmet: {
    key: 'helmet', label: 'Helmet (extra)', group: 'onboard',
    pos: [0, 0.315, 0.010], pitchDown: 0.5, fov: 72, fovGain: 2.0,
    // the one place a lean exists: a driver's head tips into the corner. Kept small and
    // clearly labelled as an addition, because the reference has no helmet camera.
    apexMax: 26, apexLead: 0.18, movePitch: 0.65, moveRoll: 0.30, leanIn: 0.95,
    lag: 0.060, latLag: 0.026, shake: 1.05, spring: null,
  },
  trackside: {
    key: 'trackside', label: 'Trackside Replay', group: 'replay',
    pos: [0, 0, 0], pitchDown: 0, fov: 30, fovGain: 0,
    apexMax: 0, apexLead: 0, movePitch: 0, moveRoll: 0, leanIn: 0,
    lag: 0, latLag: 0, shake: 0.22, spring: null,
  },
  cinematic: {
    key: 'cinematic', label: 'Cinematic', group: 'replay',
    pos: [0, 0, 0], pitchDown: 0, fov: 34, fovGain: 0,
    apexMax: 0, apexLead: 0, movePitch: 0, moveRoll: 0, leanIn: 0,
    lag: 0, latLag: 0, shake: 0.16, spring: null,
  },
};

/** Reference cycle order; TV Pod is the default. Helmet is appended as an extra. */
export const DRIVE_CYCLE = [
  'tvpod', 'tvpodOffset', 'chase', 'chaseFar', 'cockpit', 'noseOffset', 'nose', 'wing', 'helmet',
];
/** V toggles the replay/beauty set. */
export const REPLAY_CYCLE = ['trackside', 'cinematic'];
export const MODE_LIST = [...DRIVE_CYCLE, ...REPLAY_CYCLE];

/** Legacy / alternate spellings the capture harness and other modules may hand us. */
const ALIAS = {
  halo: 'cockpit', driver: 'cockpit', head: 'helmet',
  tv: 'tvpod', t: 'tvpod', tvcam: 'tvpod', tvPod: 'tvpod',
  tvpodoffset: 'tvpodOffset', tvpod_offset: 'tvpodOffset', offset: 'tvpodOffset',
  chasenear: 'chase', chaseNear: 'chase', chase_near: 'chase', nearchase: 'chase',
  chasefar: 'chaseFar', chase_far: 'chaseFar', farchase: 'chaseFar', far: 'chaseFar',
  noseoffset: 'noseOffset', nose_offset: 'noseOffset',
  bumper: 'nose', front: 'nose', rear: 'wing', rearwing: 'wing',
  replay: 'trackside', beauty: 'cinematic', cinema: 'cinematic',
};

/** Normalise whatever was assigned to rig.mode into a real rig key. */
export function resolveMode(m) {
  if (typeof m !== 'string') return 'tvpod';
  if (MODES[m]) return m;
  if (ALIAS[m]) return ALIAS[m];
  const lower = m.toLowerCase();
  for (const k of MODE_LIST) if (k.toLowerCase() === lower) return k;
  if (ALIAS[lower]) return ALIAS[lower];
  return 'tvpod';
}
