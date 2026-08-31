/**
 * Input response curves. Owner: INPUT.
 *
 * The F1 games expose four per-axis pad parameters and the reference
 * (docs/reference-physics.md, "Input") pins the values we must default to:
 *
 *     steering   rate 140 %   deadzone 0   linearity 40   saturation 10
 *     throttle                             linearity 50
 *     brake                                linearity 35     <- what stops lock-ups
 *
 * Semantics implemented here (all four are real, tunable stages, in this order):
 *
 *   1. DEADZONE   (0..100, % of travel)  travel below it produces nothing; the
 *                                        remaining travel is rescaled so the curve
 *                                        still reaches 1.0.
 *   2. SATURATION (0..100, % of travel)  the axis reaches full output this much
 *                                        BEFORE the end of physical travel.
 *   3. LINEARITY  (0..100)               response exponent. 50 == perfectly linear.
 *                                        Below 50 the curve is softer around the
 *                                        neutral point (finer control, less twitch);
 *                                        above 50 it is sharper. Exponent is
 *                                        symmetric in log space: p = 2^((50-L)/25),
 *                                        so L=40 -> p=1.32, L=35 -> p=1.52, L=0 -> p=4.
 *   4. RATE       (%, steering only)     slew limit on how fast the virtual wheel can
 *                                        travel, as a % of a 4.0 units/s base. 140 %
 *                                        == 5.6 units/s == lock-to-lock in ~0.36 s.
 *                                        This is NOT a gain (saturation already does
 *                                        that job); it is what stops a pad flick from
 *                                        teleporting the wheel across 360 degrees.
 *
 * In-game steering lock is 360 degrees total: state.input.steer == +/-1 is +/-180 deg.
 */

export const STEER_LOCK_DEG = 360;          // total, i.e. +/-180 deg at full lock

export const DEFAULT_CURVES = {
  steer: { rate: 140, deadzone: 0, linearity: 40, saturation: 10 },
  throttle: { rate: 100, deadzone: 0, linearity: 50, saturation: 0 },
  brake: { rate: 100, deadzone: 0, linearity: 35, saturation: 0 },
};

export const CURVE_LIMITS = {
  rate: [20, 200, 5], deadzone: [0, 40, 1], linearity: [1, 100, 1], saturation: [0, 50, 1],
};

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Exponent for a 0..100 linearity slider. 50 == linear. */
export function linearityExponent(linearity) {
  return Math.pow(2, (50 - clamp(linearity ?? 50, 1, 100)) / 25);
}

/**
 * Map a raw axis value through deadzone -> saturation -> linearity.
 * Sign preserving, so it works for bipolar (steering) and unipolar (pedals) axes.
 */
export function applyCurve(v, c) {
  if (!c) return clamp(v, -1, 1);
  const s = v < 0 ? -1 : 1;
  let x = Math.abs(v);
  const dz = clamp(c.deadzone ?? 0, 0, 95) / 100;
  const sat = clamp(c.saturation ?? 0, 0, 95) / 100;
  const span = Math.max(1e-4, 1 - dz - sat);
  x = clamp((x - dz) / span, 0, 1);
  if (x <= 0) return 0;
  return s * Math.pow(x, linearityExponent(c.linearity));
}

/** Sample the curve for the settings-menu preview. Returns [[x,y], ...]. */
export function curvePoints(c, n = 33) {
  const out = [];
  for (let i = 0; i <= n; i++) { const x = i / n; out.push([x, applyCurve(x, c)]); }
  return out;
}

/** Slew limiter: move `cur` toward `target` no faster than rate units/second. */
export function slew(cur, target, dt, unitsPerSecond) {
  const d = target - cur;
  const m = unitsPerSecond * dt;
  return d > m ? cur + m : d < -m ? cur - m : target;
}

/** Steering slew speed in units/s for a given RATE percentage. */
export function steerSlewRate(ratePct) { return (clamp(ratePct ?? 100, 10, 400) / 100) * 4.0; }

/**
 * Speed-sensitive steering authority for KEYBOARD (and, softly, for pads).
 * Digital keys have no fine control, so at speed we cap how much of the 360 deg
 * lock a key press may command, otherwise a single tap at 300 km/h is a spin.
 * Tuned by driving: it must still be enough to make T12 (~200 km/h) and the
 * T5-6-7 esses. Never returns less than 0.40 or the car cannot be steered at all.
 */
export function keyboardAuthority(kph) {
  const v = Math.max(0, kph) / 95;
  return 0.42 + 0.58 * Math.exp(-Math.pow(v, 1.4));
}

/**
 * Keyboard steering ramp. Digital in, analogue out. Returns the ramp position in
 * -1..1; the caller multiplies by keyboardAuthority() so full lock stays reachable
 * at parking speed and is progressively withheld at racing speed.
 *  - press:      ramp toward the target at `press` units/s
 *  - release:    return to centre faster (the car self-centres, so should the input)
 *  - reversal:   crossing the centre is faster still, or catching a slide is impossible
 * Values here are ours to choose (the reference does not fix them); they were tuned
 * until a full keyboard lap is actually driveable.
 */
export const KEY_STEER = { press: 3.2, release: 6.0, reverse: 7.5 };
export const KEY_PEDAL = { throttleUp: 4.5, throttleDown: 7.0, brakeUp: 6.5, brakeDown: 9.0 };

export function keyboardSteerRamp(cur, target, dt) {
  let rate;
  if (target === 0) rate = KEY_STEER.release;
  else if (cur !== 0 && Math.sign(target) !== Math.sign(cur)) rate = KEY_STEER.reverse;
  else rate = KEY_STEER.press;
  // slower the further out you already are: the last of the lock arrives gently
  const fine = target === 0 ? 1 : 1 - 0.45 * Math.min(1, Math.abs(cur));
  return slew(cur, target, dt, rate * fine);
}
