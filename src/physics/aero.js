/**
 * 2026 active aerodynamics. Owner: PHYSICS.
 *
 * Two driver-switched states (the in-game names are "Cornering Mode" and
 * "Straight Line Mode" — not X-mode/Z-mode, that is FIA regulation shorthand):
 *
 *   Cornering Mode      high wing angle, max downforce and drag. DEFAULT. Auto-engages
 *                       whenever the car turns, brakes, lifts, or leaves a zone.
 *   Straight Line Mode  BOTH the front and the rear wing flatten. Only inside a
 *                       designated zone, and only at 100 % throttle.
 *
 * WHERE THE CORNERING-MODE NUMBERS COME FROM. The reference gives the 2026 regulation
 * change as downforce -30 % and drag -55 % against 2025. Applied to a 2025 high-downforce
 * car (ClA ~7.7, CdA ~2.1) that is ClA 7.7*0.70 = 5.39 and CdA 2.1*0.45 = 0.95 — so the
 * 2026 car is not just slower through corners, it is MUCH more efficient in a straight
 * line (L/D 3.7 -> 5.7). Getting the drag wrong is why a naive build tops out at 280 km/h.
 *
 * WHY THE TWO MODES DIFFER MORE IN DRAG THAN IN DOWNFORCE. Only the wings move. The
 * floor — still a ground-effect floor in 2026, just a weakened one — makes well over half
 * of the downforce and is unaffected by wing position, but only a third of the drag:
 *
 *              ClA (downforce)        CdA (drag)
 *   floor          3.10                  0.34          fixed
 *   wings          2.30 -> 1.15          0.61 -> 0.28   both flatten in Straight Line Mode
 *   TOTAL          5.40 -> 4.25          0.95 -> 0.62
 *
 * Calibration targets (docs/reference-physics.md), all verified by tools/probe_physics.mjs:
 *   downforce == car weight at 175-195 km/h
 *   downforce at 250 km/h = 1300-1500 kgf
 *   peak lateral G 1.7-2.1 / ~2.65 / 4.0-4.7 g at 80 / 150 / 250 km/h (Cornering Mode)
 *   top speed 315-345 km/h
 */

export const AERO = {
  rho: 1.200,                 // Bahrain night, ~25 C
  ClA_corner: 5.40, CdA_corner: 0.95,
  ClA_straight: 4.25, CdA_straight: 0.62,
  balanceFront: 0.455,        // fraction of downforce on the front axle
  balanceShift: 0.022,        // moves rearward with speed (fast corners lose front)
  yawDamp: 1.10,              // m^3, weathervane yaw damping
  sideStiff: 3.20,            // m^3, directional stability from the aero centre of pressure
  openRate: 1 / 0.38,         // wing actuation — Art. C3.10: transition <= 400 ms
  closeRate: 1 / 0.11,        // shuts fast — Cornering Mode is the fail-safe default
};

/**
 * Bahrain's 3 Straight Line Mode zones, in metres of lap distance (5412 m lap).
 * Bahrain has 3 DRS / Straight-Mode zones. Placed per the reference — Z1 opens just after
 * T3 and ends at T4 (shortest), Z2 opens 50 m after T10 and ends at T11, Z3 opens ~250 m
 * after T15 and runs the 1.1 km main straight to the T1 braking board (longest) — and
 * checked against this centreline's actual low-curvature sections so every zone lands on
 * a real straight. `end` < `start` means the zone wraps past the start/finish line.
 */
export const ZONES = [
  { name: 'Z1', start: 1281, end: 1760 },   // after T3, uphill, ends at T4      (479 m)
  { name: 'Z2', start: 3090, end: 3660 },   // after T10, the back straight      (570 m)
  { name: 'Z3', start: 116, end: 962 },     // after T15, main straight, to T1   (846 m)
];

/**
 * The track module owns the authoritative zone table (`track.slmZones`, which the HUD
 * and the wing animation also read). VehiclePhysics calls this at init so the physics
 * cannot drift from what the player is shown; the table above is the fallback.
 */
export function zonesFrom(track) {
  const z = track?.slmZones;
  if (!Array.isArray(z) || z.length === 0) return ZONES;
  return z.filter(v => Number.isFinite(v.start) && Number.isFinite(v.end))
    .map(v => ({ name: v.name ?? `Z${v.i ?? '?'}`, start: v.start, end: v.end }));
}

export function zoneAt(s, length, zones = ZONES) {
  const m = ((s % length) + length) % length;
  for (const z of zones) {
    if (z.end >= z.start) { if (m >= z.start && m <= z.end) return z; }
    else if (m >= z.start || m <= z.end) return z;
  }
  return null;
}

/** Interpolated aero coefficients for a 0..1 Cornering->Straight blend. */
export function aeroCoeffs(blend) {
  return {
    ClA: AERO.ClA_corner + (AERO.ClA_straight - AERO.ClA_corner) * blend,
    CdA: AERO.CdA_corner + (AERO.CdA_straight - AERO.CdA_corner) * blend,
  };
}

/** Speed at which downforce equals a given weight, km/h — used by the probes. */
export function balanceSpeedKph(weightN, ClA = AERO.ClA_corner) {
  return Math.sqrt(weightN / (0.5 * AERO.rho * ClA)) * 3.6;
}
