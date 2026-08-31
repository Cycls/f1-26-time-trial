/**
 * BAHRAIN INTERNATIONAL CIRCUIT (Sakhir) — Grand Prix layout. Owner: TRACK.
 *
 * GEOMETRY PROVENANCE — this is not a hand-drawn spline.
 *   OpenStreetMap ways tagged `highway=raceway, name="Grand Prix Circuit"`
 *   (ids 4818385 / 881756728 / 881756729, oneway=yes so node order IS the racing
 *   direction), stitched into a closed loop of 238 nodes, cross-checked against
 *   bacinger/f1-circuits `bh-2002.geojson` (independent 94-point trace).
 *   The two sources agree to within 1 m of total length: 5403.3 m vs 5402.2 m
 *   (official centreline 5412 m — a polyline always cuts the corners slightly).
 *   Projected equirectangular about lat0 26.0325, lon0 50.5106:
 *       x = (lon-lon0) * 111320 * cos(lat0)      +x = EAST
 *       z = -(lat-lat0) * 110540                 +z = SOUTH
 *   so the plan view is true north-up and the circuit footprint is the real
 *   809 m (E-W) x 1191 m (N-S). Resampled to 1 m, Gaussian-smoothed (sigma 4.5 m,
 *   removes OSM digitisation jitter without touching corner radii), rotated so
 *   index 0 is the start/finish line, scaled to exactly 5412 m, then decimated
 *   adaptively (5-8 m through corners, 30 m down straights).
 *
 * DIRECTION: clockwise viewed north-up. The main straight runs NORTH up the west
 * edge of the site; T1 is at its north end.
 *
 * START/FINISH: 101 m after the T15 exit kink, level with the north end of the
 * pit lane as mapped in OSM (the pit road runs s=76..845 alongside the straight).
 * That puts T1 at s=1009 m and gives the 1.09 km full-throttle run the reference
 * describes, and lines up with the shared brief's landmark distances
 * (300 main straight / 1100 T1 / 3400 back straight / 5000 final corners).
 *
 * All `s` values below are metres of lap distance from the start/finish line.
 */
export const BAHRAIN = {
  name: 'Bahrain International Circuit', country: 'Bahrain',
  length: 5412, turnCount: 15, direction: 'clockwise',

  /** Closed centreline control points [x, z] in metres. Index 0 = start/finish. */
  points: [
    [-31.1,521.8],[-30.0,491.8],[-28.9,461.7],[-27.7,431.6],[-26.5,401.5],[-25.3,371.4],
    [-24.1,341.4],[-22.9,311.3],[-21.8,281.2],[-20.6,251.2],[-19.4,221.1],[-18.2,191.0],
    [-17.0,160.9],[-15.8,130.8],[-14.6,100.8],[-13.4,70.7],[-12.2,40.6],[-11.0,10.6],
    [-9.8,-19.5],[-8.6,-49.6],[-7.5,-79.7],[-6.3,-109.7],[-5.1,-139.8],[-3.9,-169.9],
    [-2.7,-200.0],[-1.5,-230.0],[-0.3,-260.1],[0.9,-290.2],[2.1,-320.3],[3.3,-350.3],
    [4.6,-380.4],[5.9,-410.5],[7.1,-440.6],[8.4,-470.6],[9.0,-475.6],[10.5,-480.4],
    [13.6,-484.3],[17.9,-486.7],[22.9,-487.2],[27.6,-485.7],[31.9,-483.0],[35.7,-479.8],
    [57.5,-459.0],[79.2,-438.2],[83.6,-434.1],[87.6,-431.0],[92.0,-428.6],[96.8,-427.1],
    [101.7,-426.7],[106.7,-427.3],[111.5,-428.7],[140.1,-438.3],[168.6,-447.8],[181.0,-451.8],
    [185.9,-453.1],[190.8,-454.1],[195.8,-454.9],[200.7,-455.4],[205.7,-455.7],[210.8,-455.8],
    [215.8,-455.7],[220.8,-455.4],[225.8,-454.8],[230.7,-454.1],[260.3,-448.4],[289.8,-442.7],
    [319.4,-437.1],[349.0,-431.5],[378.6,-425.9],[408.1,-420.3],[437.7,-414.8],[467.3,-409.3],
    [496.9,-403.8],[526.5,-398.3],[556.1,-392.9],[585.7,-387.4],[615.3,-381.8],[644.8,-376.1],
    [674.4,-370.5],[703.9,-364.8],[733.5,-359.1],[760.1,-353.9],[764.9,-352.5],[769.4,-350.3],
    [773.1,-347.0],[775.7,-342.7],[777.0,-337.9],[777.2,-332.9],[776.9,-327.9],[776.4,-322.9],
    [775.5,-318.0],[774.2,-313.1],[772.5,-308.4],[770.5,-303.8],[768.1,-299.4],[765.3,-295.2],
    [762.1,-291.4],[758.5,-287.9],[754.6,-284.7],[750.4,-282.0],[728.3,-268.2],[720.1,-262.4],
    [711.3,-255.8],[689.8,-237.6],[667.3,-217.7],[645.6,-196.8],[624.6,-175.3],[613.0,-162.7],
    [608.6,-157.3],[604.9,-152.5],[601.5,-147.6],[598.3,-142.5],[594.8,-136.4],[592.0,-131.1],
    [588.1,-122.9],[576.3,-95.2],[574.1,-90.7],[571.5,-86.4],[568.6,-82.3],[565.4,-78.5],
    [561.8,-75.0],[557.9,-71.8],[553.8,-69.0],[549.4,-66.5],[544.9,-64.4],[540.1,-62.7],
    [535.3,-61.5],[530.3,-60.6],[525.3,-60.1],[520.3,-60.1],[515.3,-60.5],[510.4,-61.1],
    [480.7,-66.1],[467.8,-68.3],[462.8,-68.8],[457.8,-69.0],[452.8,-68.9],[447.8,-68.4],
    [442.8,-67.6],[438.0,-66.4],[433.2,-64.8],[428.6,-62.9],[424.1,-60.6],[419.9,-57.9],
    [415.8,-55.0],[411.8,-51.9],[408.0,-48.7],[404.4,-45.2],[400.9,-41.7],[397.5,-37.9],
    [392.4,-31.7],[373.9,-8.0],[355.6,15.9],[337.1,39.7],[318.8,63.5],[300.3,87.3],
    [288.0,103.1],[284.6,106.8],[280.6,109.9],[276.1,112.0],[271.2,112.8],[266.2,112.4],
    [261.5,110.8],[257.3,108.0],[254.0,104.2],[251.7,99.8],[250.2,95.0],[249.1,90.1],
    [248.4,85.1],[247.9,80.2],[247.8,75.1],[247.9,70.1],[248.3,65.1],[249.1,59.1],
    [253.8,29.4],[258.6,-0.3],[263.4,-30.0],[268.2,-59.7],[273.0,-89.4],[277.7,-119.2],
    [282.5,-148.9],[287.2,-178.6],[291.8,-208.3],[292.4,-213.3],[292.8,-218.3],[292.8,-223.3],
    [292.5,-228.3],[291.9,-233.3],[290.9,-238.2],[289.6,-243.1],[288.0,-247.8],[286.1,-252.5],
    [283.8,-257.0],[281.3,-261.3],[278.4,-265.4],[275.2,-269.3],[271.2,-273.8],[266.4,-278.8],
    [261.3,-283.7],[256.8,-287.6],[251.3,-292.1],[228.8,-308.9],[224.5,-311.4],[219.6,-312.2],
    [215.1,-310.1],[212.5,-305.9],[211.3,-301.0],[210.5,-296.1],[206.3,-266.3],[202.3,-236.4],
    [198.3,-206.6],[195.0,-176.7],[192.5,-146.7],[190.9,-116.6],[189.7,-86.6],[188.6,-56.5],
    [187.5,-26.4],[186.5,3.7],[185.4,33.8],[184.2,63.8],[183.0,93.9],[181.7,124.0],
    [180.5,154.0],[179.2,184.1],[178.0,214.2],[176.7,244.3],[175.5,274.3],[174.3,304.4],
    [173.0,334.5],[171.9,364.6],[171.7,374.6],[171.9,379.6],[172.6,384.6],[173.8,389.4],
    [175.6,394.1],[178.0,398.5],[180.9,402.6],[184.3,406.3],[188.2,409.4],[192.5,411.9],
    [197.2,413.8],[202.1,415.0],[207.0,416.0],[211.9,416.8],[216.9,417.3],[221.9,417.7],
    [226.9,417.9],[231.9,417.8],[237.9,417.5],[242.9,417.0],[247.9,416.4],[252.9,415.5],
    [257.8,414.4],[263.6,412.9],[268.4,411.5],[273.1,409.8],[277.8,408.0],[283.3,405.6],
    [287.8,403.3],[293.1,400.5],[297.4,397.9],[302.4,394.6],[306.5,391.7],[311.3,388.0],
    [315.8,384.1],[321.0,379.3],[326.0,374.4],[330.7,369.2],[335.3,363.8],[339.6,358.3],
    [343.6,352.6],[347.5,346.7],[351.0,340.6],[353.9,335.3],[356.9,329.0],[360.1,321.6],
    [363.1,314.2],[373.3,285.8],[381.4,264.2],[383.4,259.7],[385.7,255.2],[388.2,250.8],
    [390.9,246.6],[393.7,242.4],[396.7,238.4],[399.9,234.6],[403.2,230.8],[406.7,227.2],
    [410.3,223.7],[414.1,220.4],[418.0,217.3],[422.0,214.3],[426.2,211.5],[430.4,208.8],
    [434.8,206.4],[439.3,204.1],[443.8,202.0],[448.5,200.1],[453.2,198.3],[457.9,196.8],
    [462.8,195.4],[467.6,194.2],[472.6,193.2],[477.5,192.4],[482.5,191.8],[487.5,191.4],
    [492.5,191.2],[497.5,191.2],[502.5,191.4],[507.5,191.8],[512.5,192.3],[517.5,193.1],
    [522.4,194.2],[528.2,195.6],[534.0,197.4],[540.6,199.7],[546.2,201.9],[551.7,204.3],
    [559.8,208.3],[586.7,221.8],[613.8,235.0],[640.8,248.1],[645.2,250.6],[649.5,253.3],
    [653.5,256.1],[657.5,259.2],[661.3,262.5],[664.9,266.0],[668.4,269.6],[671.6,273.4],
    [674.7,277.4],[677.5,281.5],[680.2,285.8],[682.6,290.2],[685.3,295.6],[687.3,300.2],
    [688.8,304.9],[689.6,309.9],[689.7,314.9],[689.0,319.9],[687.6,324.7],[685.4,329.2],
    [682.6,333.4],[679.4,337.2],[676.0,340.8],[670.9,345.7],[667.1,349.0],[662.4,352.8],
    [658.4,355.8],[654.3,358.6],[649.1,361.7],[622.9,376.5],[596.6,391.1],[570.3,405.8],
    [544.0,420.5],[517.7,435.1],[491.5,449.8],[465.2,464.4],[438.9,479.1],[412.6,493.7],
    [386.3,508.4],[360.0,523.1],[333.7,537.7],[307.4,552.4],[281.2,567.1],[254.9,581.7],
    [228.6,596.4],[202.3,611.0],[176.0,625.7],[149.7,640.3],[123.4,654.9],[97.1,669.6],
    [70.8,684.2],[44.5,698.8],[26.9,708.5],[22.3,710.5],[17.5,711.8],[12.5,712.1],
    [7.6,711.3],[2.9,709.4],[-1.2,706.5],[-4.6,702.9],[-7.2,698.6],[-9.4,694.1],
    [-21.9,666.7],[-25.5,658.4],[-27.7,652.8],[-29.3,648.1],[-30.7,643.2],[-31.9,638.4],
    [-32.8,633.4],[-33.6,628.5],[-34.1,623.5],[-34.5,618.5],[-34.6,613.5],[-34.6,608.5],
    [-33.1,578.4],[-32.0,548.3]  ],

  /**
   * Elevation keyframes [s, y] metres. Bahrain is not flat: ~17 m of range.
   * Climb out of T1 all the way to the T4 crest, tumble down the esses, heavy
   * downhill braking into the T8 hairpin, floor of the lap at the T10 apex
   * (the corner "drops at the apex"), then a long climb up to T11 and a gentle
   * descent through T12-T15 back to the pit straight.
   * Interpolated with a monotone-ish Catmull-Rom, so keep them ~50-250 m apart.
   */
  elevation: [
    [0, 3.0], [300, 2.9], [600, 2.8], [850, 2.6], [1009, 2.4],        // pit straight -> T1
    [1075, 3.6], [1111, 4.6], [1160, 6.2], [1207, 7.6],               // T1 exit climbs, T2, T3
    [1330, 9.3], [1500, 10.9], [1650, 12.3], [1740, 13.6],            // long climb up DRS-1
    [1802, 15.1], [1860, 16.4], [1930, 16.9],                         // T4 apex -> crest at T4 exit
    [2000, 16.1], [2073, 14.9], [2152, 13.3], [2230, 11.5],           // T5, T6 descending
    [2292, 10.0], [2370, 8.2], [2450, 6.2], [2510, 4.6],              // T7 -> downhill braking
    [2542, 3.7], [2603, 3.1], [2700, 2.9], [2800, 2.8],               // T8 hairpin (low)
    [2905, 2.5], [2960, 1.9], [3010, 0.4], [3050, 0.9],               // T9, T10 drops at the apex
    [3150, 1.5], [3300, 2.1], [3450, 2.8], [3600, 4.2],               // back straight rises
    [3690, 5.7], [3745, 7.0], [3830, 8.2], [3958, 8.9],               // T11 uphill left
    [4080, 9.1], [4200, 8.6], [4310, 7.6], [4403, 6.7],               // T12, T13
    [4520, 5.9], [4700, 5.1], [4900, 4.4], [5080, 3.7],               // run down to T14
    [5195, 3.2], [5278, 3.2], [5340, 3.1], [5412, 3.0],               // T14, T15, back to s=0
  ],

  /**
   * Half-width keyframes [s, halfWidth] metres (full width = 2x).
   * Bahrain runs ~14 m through the twisty middle and opens out to 20 m on the
   * pit straight and into the T1 braking zone, which is why the field can go
   * three abreast there.
   */
  width: [
    [0, 9.5], [700, 9.7], [900, 10.0], [1009, 8.6],                   // pit straight / T1 braking
    [1075, 7.2], [1111, 7.0], [1207, 7.1], [1300, 7.4],               // T1-T2-T3 complex is narrow
    [1600, 7.6], [1760, 8.4], [1802, 8.8], [1900, 8.2],               // wide, bumpy T4
    [2000, 7.4], [2073, 7.2], [2152, 7.1], [2292, 7.1],               // esses
    [2420, 7.6], [2542, 7.5], [2650, 7.3],                            // T8
    [2905, 7.4], [3010, 7.8], [3100, 7.6], [3400, 7.5],               // T9-T10, back straight
    [3650, 8.2], [3745, 8.1], [3900, 7.6], [4080, 7.4],               // T11, T12
    [4300, 7.5], [4403, 7.6], [4550, 7.6], [4900, 7.8],               // T13
    [5100, 8.6], [5195, 8.4], [5278, 7.9], [5340, 8.6], [5412, 9.5],  // T14, T15 -> pit straight
  ],

  /**
   * Banking keyframes [s, degrees]. Positive = the road rolls so its right-hand
   * edge is lower (i.e. positive banking through a right-hander). Bahrain is
   * essentially flat-bottomed; only a couple of degrees anywhere, plus the
   * deliberately off-camber drop at the T10 apex.
   */
  banking: [
    [0, 0], [980, 0.4], [1009, 1.6], [1060, 0.6], [1111, -1.2], [1207, 0.8],
    [1500, 0], [1780, 1.4], [1802, 2.2], [1880, 0.9], [2073, -1.1], [2152, 1.3],
    [2292, -1.2], [2450, 0], [2542, 1.5], [2700, 0], [2905, -0.9],
    [3010, -1.6], [3060, -0.7], [3300, 0], [3745, -1.8], [3900, -0.6],
    [4080, 1.1], [4403, 1.4], [4600, 0], [5195, 1.7], [5278, 1.0], [5412, 0],
  ],

  /**
   * Turn table. `s` is the apex, `in`/`out` bracket the corner.
   * dir R/L, gear + apex speed from docs/reference-physics.md.
   * Handedness here is measured off the OSM geometry; where the reference prose
   * and the survey disagree (it calls T9 a right and T14 a left) the survey wins.
   */
  turns: [
    { n: 1,  dir: 'R', s: 1009, in: 975,  out: 1055, gear: 2, kph: 78,  name: 'Michael Schumacher',
      note: 'end of the 1.09 km run; brake at the 100-120 m board, 8th->2nd' },
    { n: 2,  dir: 'L', s: 1111, in: 1082, out: 1140, gear: 4, kph: 165, note: 'effectively flat, straight-lined with T3' },
    { n: 3,  dir: 'R', s: 1207, in: 1188, out: 1258, gear: 6, kph: 205, note: 'uphill, really T2s exit kerb' },
    { n: 4,  dir: 'R', s: 1802, in: 1755, out: 1900, gear: 4, kph: 145, note: 'uphill, wide, bumpy; straddle the entry kerb' },
    { n: 5,  dir: 'L', s: 2073, in: 2046, out: 2110, gear: 5, kph: 225, note: 'esses' },
    { n: 6,  dir: 'R', s: 2152, in: 2126, out: 2225, gear: 5, kph: 200, note: 'esses' },
    { n: 7,  dir: 'L', s: 2292, in: 2248, out: 2350, gear: 6, kph: 215, note: 'esses' },
    { n: 8,  dir: 'R', s: 2542, in: 2500, out: 2610, gear: 2, kph: 80,  note: 'tight downhill hairpin, lock-up risk' },
    { n: 9,  dir: 'L', s: 2905, in: 2862, out: 2958, gear: 6, kph: 195, note: 'sacrificed to set up T10' },
    { n: 10, dir: 'L', s: 3010, in: 2958, out: 3040, gear: 2, kph: 72,  name: 'hardest corner',
      note: 'long entry that tightens and drops at the apex' },
    { n: 11, dir: 'L', s: 3745, in: 3685, out: 3860, gear: 4, kph: 150, note: 'uphill after the back straight, trail-brake from the 50 m board' },
    { n: 12, dir: 'R', s: 4080, in: 4000, out: 4225, gear: 7, kph: 200, note: 'fast, historically flat; 2026 cars lift to save energy' },
    { n: 13, dir: 'R', s: 4403, in: 4300, out: 4472, gear: 5, kph: 170 },
    { n: 14, dir: 'R', s: 5195, in: 5158, out: 5228, gear: 3, kph: 110, note: '309 km/h into 100 m of braking' },
    { n: 15, dir: 'R', s: 5278, in: 5246, out: 5318, gear: 5, kph: 175, note: 'exit is the most lap-critical point on the circuit' },
  ],

  /**
   * Straight Line Mode zones (2026 active aero; replaces DRS).
   * Distances taken from docs/reference-physics.md and mapped onto this survey:
   *   Z1 detect 50 m before T1, activate 23 m after T3
   *   Z2 detect 10 m before T9, activate 50 m after T10
   *   Z3 detect 110 m before T14, activate 250 m after T15  (longest, pit straight)
   */
  slmZones: [
    { i: 1, detect: 959,  start: 1281, end: 1760, name: 'T3 - T4' },
    { i: 2, detect: 2852, start: 3090, end: 3660, name: 'T10 - T11' },
    { i: 3, detect: 5085, start: 116,  end: 962,  name: 'T15 - T1 (main straight)' },
  ],

  /** Sector end distances (m). S1 closes just past the T4 crest, S2 on T11 exit. */
  sectors: [1980, 3950, 5412],

  /** Pit lane, as mapped in OSM: entry just before the line, exit far up the straight. */
  pit: { side: -1, entry: 5330, boxStart: 76, boxEnd: 700, exit: 862 },

  /** 20 grid slots, 8 m pitch, staggered either side of the centreline. */
  grid: { slots: 20, pitch: 8.0, offset: 3.4, firstS: -6 },

  /**
   * Kerb regions. side: 'L' | 'R' (L = negative lateral, R = positive lateral).
   * type: 'high'  tall sawtooth at the slow corners (T1's is famous for unsettling the rear)
   *       'std'   normal FIA red/white sawtooth
   *       'flat'  the wide flat extension kerbs Bahrain runs at the T2/T3/T4 exits
   */
  kerbs: [
    { from: 985,  to: 1058, side: 'R', type: 'high' },
    { from: 1020, to: 1090, side: 'L', type: 'std' },
    { from: 1086, to: 1146, side: 'L', type: 'std' },
    { from: 1118, to: 1180, side: 'R', type: 'flat' },
    { from: 1190, to: 1262, side: 'R', type: 'std' },
    { from: 1232, to: 1320, side: 'L', type: 'flat' },
    { from: 1762, to: 1892, side: 'R', type: 'std' },
    { from: 1852, to: 1975, side: 'L', type: 'flat' },
    { from: 2044, to: 2115, side: 'L', type: 'std' },
    { from: 2124, to: 2205, side: 'R', type: 'std' },
    { from: 2180, to: 2248, side: 'L', type: 'std' },
    { from: 2246, to: 2348, side: 'L', type: 'std' },
    { from: 2318, to: 2392, side: 'R', type: 'std' },
    { from: 2498, to: 2612, side: 'R', type: 'high' },
    { from: 2566, to: 2650, side: 'L', type: 'std' },
    { from: 2860, to: 2962, side: 'L', type: 'std' },
    { from: 2958, to: 3042, side: 'L', type: 'high' },
    { from: 3008, to: 3092, side: 'R', type: 'std' },
    { from: 3684, to: 3868, side: 'L', type: 'std' },
    { from: 3820, to: 3910, side: 'R', type: 'std' },
    { from: 3998, to: 4232, side: 'R', type: 'std' },
    { from: 4296, to: 4478, side: 'R', type: 'std' },
    { from: 4416, to: 4506, side: 'L', type: 'std' },
    { from: 5154, to: 5236, side: 'R', type: 'high' },
    { from: 5200, to: 5272, side: 'L', type: 'std' },
    { from: 5244, to: 5326, side: 'R', type: 'std' },
    { from: 5292, to: 5372, side: 'L', type: 'std' },
  ],

  /**
   * What is beyond the white line, per side, as bands measured outwards from the
   * track edge: ['astro'|'asphalt'|'gravel'|'grass', width_m]. Anything past the
   * last band is desert ('gravel'). The default is the thin astro strip + a slice
   * of paved run-off that Bahrain runs almost everywhere; the entries below are
   * the corners with the big tarmac aprons or real gravel traps.
   */
  runoffDefault: { L: [['astro', 1.1], ['asphalt', 3.0]], R: [['astro', 1.1], ['asphalt', 3.0]] },
  runoff: [
    { from: 930,  to: 1120, L: [['astro', 1.4], ['asphalt', 15.0]], R: [['astro', 1.2], ['asphalt', 7.0]] },   // T1
    { from: 1120, to: 1330, L: [['astro', 1.2], ['asphalt', 8.0]],  R: [['astro', 1.2], ['asphalt', 5.0], ['gravel', 8.0]] }, // T2/T3
    { from: 1700, to: 1990, L: [['astro', 1.4], ['asphalt', 15.0]], R: [['astro', 1.2], ['asphalt', 6.0]] },   // T4
    { from: 2030, to: 2130, L: [['astro', 1.2], ['asphalt', 4.0]],  R: [['astro', 1.2], ['asphalt', 3.0], ['gravel', 10.0]] }, // T5
    { from: 2130, to: 2260, L: [['astro', 1.2], ['asphalt', 3.0], ['gravel', 10.0]], R: [['astro', 1.2], ['asphalt', 4.0]] },  // T6
    { from: 2260, to: 2400, L: [['astro', 1.2], ['asphalt', 4.0]],  R: [['astro', 1.2], ['asphalt', 3.0], ['gravel', 11.0]] }, // T7
    { from: 2460, to: 2660, L: [['astro', 1.4], ['asphalt', 13.0]], R: [['astro', 1.2], ['asphalt', 6.0]] },   // T8
    { from: 2840, to: 3110, L: [['astro', 1.2], ['asphalt', 6.0]],  R: [['astro', 1.4], ['asphalt', 13.0]] },  // T9/T10
    { from: 3650, to: 3930, L: [['astro', 1.2], ['asphalt', 6.0]],  R: [['astro', 1.4], ['asphalt', 12.0]] },  // T11
    { from: 3980, to: 4250, L: [['astro', 1.2], ['asphalt', 3.0], ['gravel', 9.0]], R: [['astro', 1.2], ['asphalt', 8.0]] },   // T12
    { from: 4280, to: 4520, L: [['astro', 1.2], ['asphalt', 3.0], ['gravel', 9.0]], R: [['astro', 1.4], ['asphalt', 12.0]] },  // T13
    { from: 5120, to: 5400, L: [['astro', 1.4], ['asphalt', 12.0]], R: [['astro', 1.2], ['asphalt', 7.0]] },   // T14/T15
  ],

  /** Braking-distance boards, [s of the corner they serve, [board metres...]]. */
  boards: [
    [1009, [300, 200, 150, 100, 50]],
    [1802, [200, 150, 100, 50]],
    [2542, [150, 100, 50]],
    [3010, [200, 150, 100, 50]],
    [3745, [150, 100, 50]],
    [4403, [100, 50]],
    [5195, [200, 150, 100, 50]],
  ],
};
