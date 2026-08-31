// Global tunables. Owner: CORE. Modules may READ; propose changes rather than editing others' blocks.
export const CONFIG = {
  build: 'F1-26-three',
  quality: { shadows: true, shadowMapSize: 2048, cascades: 3, post: true, msaa: 4, anisotropy: 8 },
  world: { timeOfDay: 'night', latitude: 26.03, sunAzimuth: 250, sunElevation: -6 },
  // 2026 F1 technical regulations (see docs/reference-physics.md)
  car: {
    mass: 768, wheelbase: 3.400, trackWidth: 1.900, cgHeight: 0.28, cgBias: 0.455,
    tyreRadiusF: 0.330, tyreRadiusR: 0.360, tyreWidthF: 0.270, tyreWidthR: 0.375,
    revLimit: 15000, idleRpm: 4000, gears: 8,
    powerICE: 400000, powerMGUK: 350000, // watts
  },
  track: { name: 'Bahrain International Circuit', length: 5412, turns: 15, sectors: 3 },
  debug: { telemetry: false, wireframe: false, freecam: false },
};
