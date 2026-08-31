/**
 * 2026 regulation dimensions, in metres, in the car's local frame.
 * Origin sits 0.32 m above the road (physics publishes car.position at that height),
 * +X right, +Y up, +Z forward.
 *
 * Regulation sources (docs/reference-physics.md):
 *   wheelbase max 3400 | overall width 1900 (+/-950) | floor max width 1540
 *   front wing overall width 1800, profiles span 1350, footplate/diveplane to 900
 *   rear wing 3 elements, span 1150, profiles inside a 725-880 mm band above the
 *   reference plane, beam wing removed
 *   C10.7.2a wheels: rim dia 462.5 F / 463 R, mounting width 315 F / 401.3 R,
 *   lip external dia 496. No front wheel arches in 2026.
 */
export const D = {
  GROUND: -0.32,          // road surface in local coords
  REF: -0.27,             // floor reference plane (50 mm ride height)

  wheelbase: 3.400,
  axleF: 1.55,            // matches physics/vehicle.js WHEELS
  axleR: -1.85,

  width: 1.900,           // max car width

  // Half-track is set so that track + tyre half-width + camber lean lands on
  // exactly +/-950 mm at the widest point of the tyre. Do not raise either value
  // without re-deriving it against tyreW*/camber* below.
  trackF: 0.773,          // 1546 mm front track
  trackR: 0.742,          // 1484 mm rear track
  camberF: 0.052,         // -3.0 deg static
  camberR: 0.020,         // -1.1 deg static

  // Pirelli 18 inch: 720 mm outer diameter on BOTH axles.
  tyreRf: 0.360, tyreRr: 0.360,
  tyreWf: 0.315, tyreWr: 0.4013,   // = regulated rim mounting widths
  rimRf: 0.231250, rimRr: 0.231500, // 462.5 / 463.0 mm diameter
  rimLip: 0.248,                    // 496 mm lip external diameter

  floorHW: 0.770,         // floor half width (1540 mm)

  fwSpan: 0.675,          // front wing PROFILE half span (1350 mm)
  fwOuter: 0.900,         // front wing overall half width (1800 mm)
  fwZ: 2.62,              // front wing main-plane quarter chord
  fwY: -0.200,

  rwSpan: 0.575,          // rear wing half span (1150 mm)
  rwZ: -2.06,
  rwY: 0.470,             // main-plane height; band is REF+0.725 .. REF+0.880
  rwBandLo: -0.27 + 0.725,
  rwBandHi: -0.27 + 0.880,

  noseTip: 2.72,
  tail: -2.34,
};

/** Back-compat alias — a few call sites used a single rim radius. */
D.rimR = D.rimRf;
