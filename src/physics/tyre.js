/**
 * 2026 F1 slick tyre model. Owner: PHYSICS.
 *
 * Two things make this a racing tyre rather than a road tyre:
 *
 *  1. LOAD SENSITIVITY.  mu(Fz) = 1.8 - 5e-5 * Fz   (docs/reference-physics.md)
 *     Peak grip per newton falls as the wheel is loaded up. Omitting this is the classic
 *     cause of "our lateral G is 6 g" — an F1 car carries ~1400 kgf of downforce at
 *     250 km/h and a fixed mu turns all of it into cornering force.
 *
 *  2. SHARP PEAK / STEEP FALLOFF.  A Pacejka Magic Formula whose peak sits at
 *     7 deg slip angle / 10 % slip ratio, holding only ~85 % of peak at twice peak slip
 *     and ~65 % when fully sliding. A road tyre would hold ~95 % at 2x.
 *
 * Combined slip is a true friction ellipse: the lateral and longitudinal slips are
 * normalised by their own peak values, combined as a vector, and one Magic Formula
 * evaluation is shared between the two axes.
 */

export const TYRE = {
  // --- load sensitivity (reference formula) ---
  muBase: 1.80,
  muLoad: 5.0e-5,
  // The reference line stays live all the way out to a kerb strike: an 18 kN corner is
  // NOT 1.28-grippy. Floor it only where the formula would go non-physical.
  muMin: 0.80,
  muMax: 1.80,

  // --- peak slip (reference: 6-8 deg lateral, ~10 % longitudinal) ---
  peakSlipRatio: 0.10,
  peakSlipAngle: 0.1222,          // 7.0 deg

  // --- Magic Formula shape, normalised so the peak sits at combined slip = 1 ---
  B: 1.410, C: 1.500, E: -0.700,

  // --- post-peak falloff (slick: steeper than a road tyre) ---
  fallMin: 0.86, fallK: 0.95, fallP: 1.40,

  longRel: 1.05,        // longitudinal peak mu / lateral peak mu
  relaxLength: 0.35,    // lateral relaxation length, m
  kappaVmin: 2.0,       // slip-ratio denominator floor, m/s

  radiusF: 0.330, radiusR: 0.360,
  halfWidthF: 0.135, halfWidthR: 0.1875,
  inertiaF: 1.10, inertiaR: 1.35,   // kg m^2 (wheel + tyre + upright + disc)

  // temperature window (game table, C3): min 80 / optimal 90 / max 105
  tempOpt: 90, tempMin: 80, tempMax: 105,
};

const TAN_AP = Math.tan(TYRE.peakSlipAngle);

/** Surface grip multipliers. Bahrain is abrasive graywacke — asphalt is the 1.0 datum. */
export const SURFACE = {
  asphalt: { mu: 1.00, roll: 0.012 },
  kerb: { mu: 0.62, roll: 0.016 },
  astro: { mu: 0.62, roll: 0.045 },
  gravel: { mu: 0.45, roll: 0.230 },
  grass: { mu: 0.48, roll: 0.090 },
  wall: { mu: 0.90, roll: 0.012 },
};

/** Load-sensitive peak friction coefficient for one tyre carrying Fz newtons. */
export function muAt(Fz) {
  const mu = TYRE.muBase - TYRE.muLoad * Math.max(0, Fz);
  return mu < TYRE.muMin ? TYRE.muMin : mu > TYRE.muMax ? TYRE.muMax : mu;
}

/**
 * Normalised Magic Formula. Argument is combined slip normalised so 1.0 == peak.
 * Returns 0..1 with an exact 1.0 at s = 1 and a slick-like post-peak decay.
 */
export function mf(s) {
  const x = TYRE.B * s;
  const inner = x - TYRE.E * (x - Math.atan(x));
  let f = Math.sin(TYRE.C * Math.atan(inner));
  const over = s - 1;
  if (over > 0) {
    f *= TYRE.fallMin + (1 - TYRE.fallMin) / (1 + TYRE.fallK * Math.pow(over, TYRE.fallP));
  }
  return f;
}

/**
 * Grip multiplier from carcass temperature.
 * Reference: over-temp costs almost no grip (98-99 %) but rockets wear; under-temp
 * is the bigger grip loss (95-97 %). Modelling over-temp as a cliff is a common error.
 */
export function tempGrip(T) {
  const cold = Math.max(0, Math.min(1, (TYRE.tempMin - T) / 28));
  const hot = Math.max(0, Math.min(1, (T - TYRE.tempMax) / 45));
  return 1 - 0.045 * cold - 0.018 * hot;
}

/**
 * Combined-slip tyre forces in the WHEEL frame.
 *   kappa  longitudinal slip ratio  (omega*r - u)/max(|u|,vmin)
 *   alpha  slip angle, radians      atan2(v_lat, |u|)
 *   Fz     vertical load, N
 *   scale  surface x temperature grip multiplier
 * Returns { fx, fy, s, mu, D } — fx positive drives the car forward, fy opposes lateral slip.
 */
export function tyreForces(kappa, alpha, Fz, scale) {
  if (Fz <= 1) return { fx: 0, fy: 0, s: 0, mu: 0, D: 0 };
  const mu = muAt(Fz) * scale;
  const D = mu * Fz;
  const a = alpha > 1.35 ? 1.35 : alpha < -1.35 ? -1.35 : alpha;
  const sx = kappa / TYRE.peakSlipRatio;
  const sy = Math.tan(a) / TAN_AP;
  let s = Math.hypot(sx, sy);
  if (s < 1e-7) return { fx: 0, fy: 0, s: 0, mu, D };
  const sc = s > 40 ? 40 : s;
  const f = mf(sc) * D;
  return { fx: (sx / s) * f * TYRE.longRel, fy: -(sy / s) * f, s, mu, D };
}

/** Longitudinal slip stiffness dFx/dkappa at kappa=0 — used to make the wheel-spin step implicit. */
export function slipStiffnessX(D) {
  return D * TYRE.longRel * TYRE.B * TYRE.C / TYRE.peakSlipRatio;
}
