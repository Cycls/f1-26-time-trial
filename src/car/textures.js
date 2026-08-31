/**
 * Procedural canvas textures for the car. Owner: CAR.
 * No external assets: carbon weave, livery + sponsor decals, Pirelli sidewalls,
 * brake disc, helmet, wheel covers and the steering wheel display are all drawn here.
 */
import * as THREE from 'three';

/* ------------------------------------------------------------------ helpers */
export const THEME = {
  primary: '#c8102e',      // team red
  primaryDark: '#8c0a20',
  carbon: '#131519',
  carbonLight: '#22262c',
  white: '#f2f4f7',
  gold: '#e8c37a',
  cyan: '#25d7f0',
  number: '26',
  team: 'ARDENTE',
  driver: 'A. MARCHAND',
  sponsors: ['AERODYNE', 'VOLTARC', 'NEXA', 'KESTREL', 'HYPERION', 'TITAN', 'ORBIT', 'PROTON', 'MERIDIAN', 'SOLARIS'],
};

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function tex(c, { srgb = true, repeat = null, aniso = 8, wrapS = THREE.RepeatWrapping, wrapT = THREE.RepeatWrapping } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = wrapS; t.wrapT = wrapT;
  t.anisotropy = aniso;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  t.needsUpdate = true;
  return t;
}

/** Condensed technical sans, the look of real sponsor decals. */
function font(px, weight = 800, stretch = '') {
  return `${weight} ${px}px ${stretch}"Arial Narrow", "Helvetica Neue", Helvetica, Arial, sans-serif`;
}

/** Draw text squeezed horizontally by k (used where the UV aspect is non-square). */
function squeezedText(g, text, x, y, px, k, weight = 800, align = 'center') {
  g.save();
  g.translate(x, y); g.scale(k, 1);
  g.font = font(px, weight);
  g.textAlign = align; g.textBaseline = 'middle';
  g.fillText(text, 0, 0);
  g.restore();
}

/* ------------------------------------------------------------- carbon weave */
let _weave = null;
/**
 * 2x2 twill carbon weave. Returns { normal, rough, color } textures.
 * Cells are ~4 mm at the repeat scales used on the car.
 */
export function carbonWeave(size = 512, cells = 32) {
  if (_weave) return _weave;
  const C = size / cells;
  const h = new Float32Array(size * size);
  const filament = (x, y, dirX) => {
    // fine filament striations along the tow direction
    const s = dirX ? y : x;
    return 0.06 * Math.sin(s * 2.9) + 0.03 * Math.sin(s * 7.3 + 1.1);
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = Math.floor(x / C), cy = Math.floor(y / C);
      const over = (((cx + cy) % 4) + 4) % 4 < 2;      // 2/2 twill float
      const fy = (y / C) - Math.floor(y / C);
      const fx = (x / C) - Math.floor(x / C);
      const pH = Math.sin(Math.PI * fy);               // horizontal tow cross-section
      const pV = Math.sin(Math.PI * fx);
      let v = over ? 0.42 + 0.58 * pH * pH : 0.10 + 0.34 * pV * pV;
      v += filament(x, y, over) * (over ? pH : pV);
      h[y * size + x] = v;
    }
  }
  const nrm = canvas(size, size), ng = nrm.getContext('2d');
  const rgh = canvas(size, size), rg = rgh.getContext('2d');
  const col = canvas(size, size), cg = col.getContext('2d');
  const nd = ng.createImageData(size, size);
  const rd = rg.createImageData(size, size);
  const cd = cg.createImageData(size, size);
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  const strength = 2.6;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      nd.data[i] = (-dx / l * 0.5 + 0.5) * 255;
      nd.data[i + 1] = (-dy / l * 0.5 + 0.5) * 255;
      nd.data[i + 2] = (1 / l * 0.5 + 0.5) * 255;
      nd.data[i + 3] = 255;
      const hv = h[y * size + x];
      const r = 0.20 + 0.24 * (1 - hv);                 // valleys read rougher
      rd.data[i] = rd.data[i + 1] = rd.data[i + 2] = r * 255; rd.data[i + 3] = 255;
      const c = 16 + 40 * hv * hv;
      cd.data[i] = c * 0.98; cd.data[i + 1] = c; cd.data[i + 2] = c * 1.12; cd.data[i + 3] = 255;
    }
  }
  ng.putImageData(nd, 0, 0); rg.putImageData(rd, 0, 0); cg.putImageData(cd, 0, 0);
  _weave = {
    normal: tex(nrm, { srgb: false }),
    rough: tex(rgh, { srgb: false }),
    color: tex(col, { srgb: true }),
  };
  return _weave;
}

/* ------------------------------------------------------------- body livery */
/**
 * Bodywork livery. UV convention from geometry.loft():
 *   u = 0 bottom centre, 0.25 right flank, 0.5 top centre, 0.75 left flank
 *   v = 0 nose tip -> 1 tail
 * Everything is drawn into the left half and mirrored, so the car is symmetric.
 */
/**
 * Monocoque livery sheet.
 *   u (canvas X) wraps the section: 0 = bottom centreline, 0.5 = top centreline.
 *     The colour fields are authored as FRACTIONS of the perimeter, which is what
 *     loft() emits, so they follow the section correctly all the way along the car.
 *   v (canvas Y) runs nose (0) to tail (1) over `length` metres.
 *
 * `perimeterAt(v)` is the ring perimeter in metres at that station. loft() normalises
 * U per ring, so without it a decal keeps a constant FRACTION of the perimeter and
 * therefore shrinks 5x between the cockpit (~1.6 m) and the nose (~0.3 m). Passing
 * the real profile keeps every decal a constant physical size. See bodywork.bodyProfile().
 */
export function bodyLivery({ w = 1024, h = 2048, perimeter = 1.7, length = 4.95, perimeterAt = null } = {}) {
  const out = {};
  for (const mode of ['color', 'rough']) {
    const c = canvas(w, h), g = c.getContext('2d');
    const PXU = w / perimeter, PXV = h / length;       // px per metre
    // px-per-metre correction for this station's actual perimeter
    const uComp = (v) => (perimeterAt ? perimeter / Math.max(0.15, perimeterAt(v)) : 1);
    const U = (u) => u * w, V = (v) => v * h;
    const col = (paint, roughV) => (mode === 'color' ? paint : `rgb(${(roughV * 255) | 0},${(roughV * 255) | 0},${(roughV * 255) | 0})`);
    const T = THEME;

    // base
    g.fillStyle = col(T.primary, 0.16); g.fillRect(0, 0, w, h);

    // underside + lower flank: exposed carbon
    g.fillStyle = col(T.carbon, 0.34); g.fillRect(0, 0, U(0.135), h);
    // top spine: carbon with painted shoulders
    g.fillStyle = col(T.carbon, 0.33); g.fillRect(U(0.44), 0, U(0.06), h);
    // nose top flash
    const grad = g.createLinearGradient(0, 0, 0, V(0.28));
    if (mode === 'color') {
      grad.addColorStop(0, T.white); grad.addColorStop(0.55, T.primary); grad.addColorStop(1, T.primary);
      g.fillStyle = grad;
    } else g.fillStyle = col('', 0.15);
    g.fillRect(U(0.16), 0, U(0.34), V(0.28));

    // dark cockpit surround / tub interior (u near 0.5 in the cockpit band)
    g.fillStyle = col('#0c0d10', 0.55);
    g.fillRect(U(0.455), V(0.30), U(0.045), V(0.24));

    // sidepod flank sweep: white wedge over a carbon lower flank
    const wedge = (colr, rough, pts) => {
      g.fillStyle = col(colr, rough);
      g.beginPath();
      g.moveTo(U(pts[0][0]), V(pts[0][1]));
      for (let i = 1; i < pts.length; i++) g.lineTo(U(pts[i][0]), V(pts[i][1]));
      g.closePath(); g.fill();
    };
    // carbon lower flank sweeping up towards the tail
    wedge(T.carbon, 0.33, [[0.135, 0.50], [0.40, 0.40], [0.42, 0.52], [0.42, 1.0], [0.135, 1.0]]);
    // white speed flash across the sidepod
    wedge(T.white, 0.14, [[0.135, 0.415], [0.405, 0.335], [0.405, 0.400], [0.135, 0.505]]);
    // red returns over the engine cover shoulder
    wedge(T.primary, 0.16, [[0.335, 0.52], [0.42, 0.50], [0.44, 0.62], [0.44, 0.92], [0.335, 0.99]]);
    wedge(T.gold, 0.13, [[0.325, 0.525], [0.335, 0.523], [0.352, 0.99], [0.335, 0.995]]);

    // gold pinstripes running the length of the car
    g.strokeStyle = col(T.gold, 0.12); g.lineWidth = Math.max(2, PXU * 0.012);
    for (const u of [0.155, 0.435]) { g.beginPath(); g.moveTo(U(u), 0); g.lineTo(U(u), h); g.stroke(); }
    g.strokeStyle = col(T.cyan, 0.10); g.lineWidth = Math.max(1.5, PXU * 0.006);
    g.beginPath(); g.moveTo(U(0.168), 0); g.lineTo(U(0.168), h); g.stroke();

    // engine cover cooling louvres (drawn, not modelled)
    g.fillStyle = col('#08090b', 0.62);
    for (let i = 0; i < 7; i++) {
      const y = V(0.63 + i * 0.018);
      g.save(); g.translate(U(0.30), y); g.rotate(0.12);
      g.fillRect(-U(0.055), 0, U(0.11), Math.max(2, PXV * 0.006));
      g.restore();
    }
    // fine flow-vis style detail lines
    g.strokeStyle = mode === 'color' ? 'rgba(255,255,255,0.10)' : 'rgb(48,48,48)';
    g.lineWidth = Math.max(1, PXU * 0.004);
    for (let i = 0; i < 14; i++) {
      const u0 = 0.14 + i * 0.024;
      g.beginPath();
      g.moveTo(U(u0), V(0.30));
      g.bezierCurveTo(U(u0 + 0.03), V(0.52), U(u0 - 0.02), V(0.72), U(u0 + 0.05), V(0.98));
      g.stroke();
    }

    // mirror the colour fields into the other half -> a perfectly symmetric car
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.save();
    g.translate(w, 0); g.scale(-1, 1);
    g.drawImage(c, 0, 0, w / 2, h, 0, 0, w / 2, h);
    g.restore();

    // ---- decals, drawn per side so text NEVER reads backwards -------------
    // Local frame: centimetres; +x advances towards the tail, +y is "down" the flank.
    const decal = (u, v, draw, mirror) => {
      g.save();
      g.translate(U(u), V(v));
      if (mirror) g.scale(-1, 1);
      g.scale((PXU / 100) * uComp(v), PXV / 100);   // 1 unit = 1 cm
      g.rotate(Math.PI / 2);
      draw(g);
      g.restore();
    };
    const both = (u, v, draw) => { decal(u, v, draw, false); decal(1 - u, v, draw, true); };
    const label = (u, v, text, cm, colr, rough, weight = 800) => both(u, v, (x) => {
      x.font = font(cm, weight);
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillStyle = col(colr, rough);
      x.fillText(text, 0, 0);
    });
    const plate = (u, v, wcm, hcm, text, bg, fg) => both(u, v, (x) => {
      x.fillStyle = col(bg, 0.13); x.fillRect(-wcm / 2, -hcm / 2, wcm, hcm);
      x.fillStyle = col(fg, 0.12);
      x.font = font(hcm * 0.62); x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(text, 0, 0);
    });

    // team name along the flank + engine cover
    label(0.30, 0.20, T.team, 13, T.white, 0.12, 900);
    label(0.24, 0.70, T.sponsors[0], 15, T.white, 0.12, 900);
    label(0.33, 0.86, T.sponsors[1], 10, T.gold, 0.11);
    label(0.21, 0.50, T.sponsors[2], 9, T.carbon, 0.15);
    label(0.28, 0.44, T.sponsors[3], 7, T.carbon, 0.15);
    label(0.185, 0.33, T.sponsors[4], 7.5, T.white, 0.12);
    label(0.36, 0.56, T.sponsors[5], 6.5, T.white, 0.12);
    label(0.20, 0.60, T.sponsors[6], 6, T.white, 0.12);
    label(0.40, 0.75, T.sponsors[7], 6, T.white, 0.12);
    label(0.155, 0.80, T.sponsors[8], 5.5, T.gold, 0.11);
    label(0.47, 0.90, T.sponsors[9], 5, T.white, 0.14);

    // small sponsor plates
    plate(0.42, 0.24, 16, 5, 'NEXA', T.white, T.primary);
    plate(0.185, 0.90, 14, 4.5, 'TITAN', T.carbon, T.white);
    plate(0.31, 0.64, 12, 4, 'PROTON', T.white, T.carbon);

    // car number, big, on the nose flank and again on the engine cover shoulder
    both(0.315, 0.115, (x) => {
      x.font = font(26, 900); x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillStyle = col(T.white, 0.11); x.fillText(T.number, 0, 0);
      x.lineWidth = 0.9; x.strokeStyle = col(T.carbon, 0.2); x.strokeText(T.number, 0, 0);
    });
    both(0.465, 0.66, (x) => {
      x.font = font(15, 900); x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillStyle = col(T.gold, 0.11); x.fillText(T.number, 0, 0);
    });
    // driver name band on the cockpit side
    label(0.415, 0.40, T.driver, 5, T.white, 0.12, 700);

    out[mode] = c;
  }
  return { map: tex(out.color), roughnessMap: tex(out.rough, { srgb: false }) };
}

/* ------------------------------------------------------------ wing surfaces */
/**
 * Painted wing element.
 *
 * AXES — this sheet is sampled by geometry.loft() through sweepAirfoil, so:
 *   u (canvas X) runs AROUND the section: 0 = trailing edge, 0.5 = leading edge,
 *     1 = back to the trailing edge. Every wing element is built with scaleY = -1
 *     (they make downforce), so u 0..0.5 is the car's UNDERSIDE and u 0.5..1 is
 *     the top surface. Chordwise graphics are vertical strips.
 *   v (canvas Y) runs across the SPAN, tip to tip. Spanwise graphics are
 *     horizontal bands, and they must be symmetric about v = 0.5 or they would
 *     read backwards on one half of the wing.
 * (Getting these two the wrong way round smears one band along the whole part.)
 */
export function wingSkin({ base = THEME.primary, w = 512, h = 512, stripe = true, tipBlocks = true } = {}) {
  const c = canvas(w, h), g = c.getContext('2d');
  // underside: exposed carbon, the way real wing undersides are finished
  g.fillStyle = THEME.carbon; g.fillRect(0, 0, Math.ceil(w * 0.5), h);
  // top surface: team paint
  g.fillStyle = base; g.fillRect(w * 0.5, 0, w * 0.5, h);
  if (stripe) {
    g.fillStyle = THEME.carbon; g.fillRect(w * 0.50, 0, w * 0.055, h);   // dark leading edge
    g.fillStyle = THEME.gold; g.fillRect(w * 0.555, 0, w * 0.014, h);    // pinstripe behind it
    g.fillStyle = THEME.white; g.fillRect(w * 0.955, 0, w * 0.045, h);   // trailing-edge flash
  }
  if (tipBlocks) {
    // outboard blocks + neutral centre section, painted on the top surface only
    g.fillStyle = THEME.white;
    g.fillRect(w * 0.57, 0, w * 0.43, h * 0.075);
    g.fillRect(w * 0.57, h * 0.925, w * 0.43, h * 0.075);
    g.fillStyle = THEME.carbon;
    g.fillRect(w * 0.57, h * 0.465, w * 0.43, h * 0.07);
  }
  return tex(c);
}

/**
 * Sidepod / engine-cover flank sheet.
 * The pods are their own loft, so they get their own sheet instead of borrowing
 * the monocoque's — sharing it squeezed a 4.95 m livery onto a 2.46 m pod and
 * every graphic appeared twice, at two scales.
 *   u (canvas X) wraps the pod section: 0 top-inboard, ~0.2 top-outboard,
 *     ~0.35 widest point, ~0.6 undercut, ~0.8 floor, 1 back to top-inboard.
 *   v (canvas Y) runs front (inlet) to back (coke bottle).
 * No lettering: the left pod is the right pod mirrored, so text would read
 * backwards on one side. Sponsor names live on the monocoque and the endplates.
 */
export function podLivery({ w = 1024, h = 1024 } = {}) {
  const out = {};
  for (const mode of ['color', 'rough']) {
    const c = canvas(w, h), g = c.getContext('2d');
    const T = THEME;
    const col = (paint, r) => (mode === 'color' ? paint : `rgb(${(r * 255) | 0},${(r * 255) | 0},${(r * 255) | 0})`);
    const U = (u) => u * w, V = (v) => v * h;

    // painted upper flank over an exposed-carbon undercut and floor
    g.fillStyle = col(T.primary, 0.16); g.fillRect(0, 0, w, h);
    g.fillStyle = col(T.carbon, 0.34); g.fillRect(0, 0, U(0.055), h);      // inboard shoulder gap
    g.fillStyle = col(T.carbon, 0.34); g.fillRect(U(0.46), 0, U(0.54), h); // undercut + floor + inner face

    const wedge = (colr, rough, pts) => {
      g.fillStyle = col(colr, rough);
      g.beginPath(); g.moveTo(U(pts[0][0]), V(pts[0][1]));
      for (let i = 1; i < pts.length; i++) g.lineTo(U(pts[i][0]), V(pts[i][1]));
      g.closePath(); g.fill();
    };
    // white speed flash sweeping down the flank towards the tail
    wedge(T.white, 0.14, [[0.30, 0.06], [0.44, 0.10], [0.44, 0.30], [0.30, 0.20]]);
    wedge(T.white, 0.14, [[0.10, 0.62], [0.44, 0.42], [0.44, 0.56], [0.10, 0.80]]);
    // carbon sweep up over the coke-bottle
    wedge(T.carbon, 0.33, [[0.055, 0.86], [0.46, 0.74], [0.46, 1.0], [0.055, 1.0]]);
    // gold pinstripes along the pod
    g.strokeStyle = col(T.gold, 0.12); g.lineWidth = Math.max(2, w * 0.006);
    for (const u of [0.072, 0.452]) { g.beginPath(); g.moveTo(U(u), 0); g.lineTo(U(u), h); g.stroke(); }
    g.strokeStyle = col(T.cyan, 0.10); g.lineWidth = Math.max(1.5, w * 0.003);
    g.beginPath(); g.moveTo(U(0.088), 0); g.lineTo(U(0.088), h); g.stroke();

    // cooling louvres on the upper deck, and the dark inlet surround
    g.fillStyle = col('#08090b', 0.62);
    for (let i = 0; i < 9; i++) {
      const y = V(0.30 + i * 0.032);
      g.save(); g.translate(U(0.17), y); g.rotate(0.09);
      g.fillRect(-U(0.085), 0, U(0.17), Math.max(2, h * 0.006));
      g.restore();
    }
    g.fillStyle = col('#0c0d10', 0.55); g.fillRect(0, 0, U(0.46), V(0.035));

    // fine flow-vis detail
    g.strokeStyle = mode === 'color' ? 'rgba(255,255,255,0.09)' : 'rgb(48,48,48)';
    g.lineWidth = Math.max(1, w * 0.002);
    for (let i = 0; i < 12; i++) {
      const u0 = 0.07 + i * 0.030;
      g.beginPath(); g.moveTo(U(u0), V(0.05));
      g.bezierCurveTo(U(u0 + 0.02), V(0.40), U(u0 - 0.01), V(0.70), U(u0 + 0.03), V(0.98));
      g.stroke();
    }
    out[mode] = c;
  }
  return { map: tex(out.color), roughnessMap: tex(out.rough, { srgb: false }) };
}

/** Rear wing / front wing endplate decal sheet. */
export function endplateSkin({ w = 512, h = 512 } = {}) {
  const c = canvas(w, h), g = c.getContext('2d');
  g.fillStyle = THEME.carbon; g.fillRect(0, 0, w, h);
  g.fillStyle = THEME.primary; g.fillRect(0, 0, w, h * 0.42);
  g.fillStyle = THEME.gold; g.fillRect(0, h * 0.42, w, h * 0.025);
  g.save();
  g.translate(w * 0.5, h * 0.22);
  g.fillStyle = THEME.white; g.font = font(h * 0.16, 900);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(THEME.sponsors[0], 0, 0);
  g.restore();
  g.fillStyle = THEME.white; g.font = font(h * 0.10, 800);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(THEME.team, w * 0.5, h * 0.62);
  g.fillStyle = THEME.gold; g.font = font(h * 0.075, 700);
  g.fillText(THEME.sponsors[3], w * 0.5, h * 0.78);
  return tex(c);
}

/**
 * Halo.
 *
 * A real halo is a titanium hoop under a matte carbon skin — black, with at most
 * a thin decal. It also sits 350 mm from the driver's eye, so it frames the whole
 * cockpit view: anything bright painted on it dominates the forward view and, under
 * Bahrain's floodlights, blows out. (An earlier version filled 60% of this sheet
 * with team red and put a stretched wordmark on it, which read as a giant warped
 * red-and-white wing arcing over the car.)
 *
 * AXES: the halo is a swept tube, so u wraps the ~160 mm section perimeter and v
 * runs the 2.4 m sweep. Nothing here may be directional — u/v are far too anisotropic
 * to carry a graphic. Uniform dark skin with a woven micro-texture only.
 */
export function haloSkin({ w = 256, h = 256 } = {}) {
  const c = canvas(w, h), g = c.getContext('2d');
  g.fillStyle = '#0a0b0d'; g.fillRect(0, 0, w, h);
  // faint 2x2 twill so the halo does not read as flat black plastic
  const d = g.getImageData(0, 0, w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const twill = ((x >> 2) + (y >> 2)) % 4 < 2 ? 5 : 0;
      const n = (Math.random() * 6) | 0;
      d.data[i] += twill + n; d.data[i + 1] += twill + n; d.data[i + 2] += twill + n + 1;
    }
  }
  g.putImageData(d, 0, 0);
  return tex(c);
}

/* ------------------------------------------------------------------- tyres */
/**
 * Pirelli sidewall + slick tread.
 * vTread0 / vTread1 are the profile V coordinates where the tread band starts/ends
 * (from geometry.revolve()). compound: 'soft'|'medium'|'hard'.
 */
export function tyreSkin({ vTread0, vTread1, compound = 'soft', radius = 0.33, profileLen = 0.45 }) {
  const w = 2048, h = 1024;
  const bandCol = { soft: '#e01a2b', medium: '#f2d21c', hard: '#f0f0f0' }[compound] ?? '#e01a2b';
  const circ = Math.PI * 2 * radius;
  const kx = (circ / w) / (profileLen / h);            // horizontal squeeze for text
  const out = {};
  for (const mode of ['color', 'rough']) {
    const c = canvas(w, h), g = c.getContext('2d');
    const col = (paint, r) => (mode === 'color' ? paint : `rgb(${(r * 255) | 0},${(r * 255) | 0},${(r * 255) | 0})`);
    // Real slicks photograph warm-neutral, not blue-black.
    g.fillStyle = col('#24211f', 0.66); g.fillRect(0, 0, w, h);

    // tread: slick, no grooves — glossier scrubbed rubber with fine circumferential grain
    const t0 = vTread0 * h, t1 = vTread1 * h;
    g.fillStyle = col('#191715', 0.45); g.fillRect(0, t0, w, t1 - t0);
    g.strokeStyle = mode === 'color' ? 'rgba(255,255,255,0.030)' : 'rgb(120,120,120)';
    g.lineWidth = 1.5;
    for (let i = 0; i < 190; i++) {
      const y = t0 + Math.random() * (t1 - t0);
      g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
    }
    // shoulder scuff
    g.fillStyle = mode === 'color' ? 'rgba(140,140,150,0.10)' : 'rgb(100,100,100)';
    g.fillRect(0, t0, w, (t1 - t0) * 0.06); g.fillRect(0, t1 - (t1 - t0) * 0.06, w, (t1 - t0) * 0.06);

    // Both sidewalls. The two faces are seen from opposite directions, so one of
    // them has its lettering drawn mirrored — that way PIRELLI reads correctly
    // whichever side of the car you look from.
    // f = 0 at the tread shoulder, f = 1 at the bead. The coloured compound band
    // belongs just inboard of the shoulder (~88-94% of the tyre radius) where a
    // camera can actually see it; down at f ~ 0.8 it is hidden against the rim.
    const sidewall = (a, b, flip, hmirror) => {
      const at = (f) => a + (b - a) * (flip ? 1 - f : f);
      const span = Math.abs(b - a);
      g.save();
      if (hmirror) { g.translate(w, 0); g.scale(-1, 1); }
      // coloured compound band, wide enough to read at speed
      const bandA = at(0.40), bandB = at(0.14);
      g.fillStyle = col(bandCol, 0.30);
      g.fillRect(0, Math.min(bandA, bandB), w, Math.abs(bandB - bandA));
      // moulding ribs near the bead
      g.fillStyle = col('#141210', 0.72);
      for (let i = 0; i < 5; i++) {
        const y = at(0.86 + i * 0.028);
        g.fillRect(0, y, w, span * 0.014);
      }
      // PIRELLI x4 around the circumference, inboard of the band
      const yTxt = at(0.56), ySub = at(0.72);
      for (let i = 0; i < 4; i++) {
        const x = (i + 0.5) * (w / 4);
        g.fillStyle = col('#f4f4f6', 0.34);
        squeezedText(g, 'PIRELLI', x, yTxt, span * 0.20, kx, 900);
        g.fillStyle = col('#d8d8dc', 0.36);
        squeezedText(g, 'P ZERO', x, ySub, span * 0.11, kx, 700);
      }
      // compound letter inside the band. 2026 runs C1-C5 — there is no C6.
      for (let i = 0; i < 2; i++) {
        g.fillStyle = col('#ffffff', 0.28);
        squeezedText(g, compound === 'soft' ? 'C5' : compound === 'medium' ? 'C3' : 'C1',
          (i + 0.5) * (w / 2), (bandA + bandB) / 2, Math.abs(bandB - bandA) * 0.58, kx, 900);
      }
      g.restore();
    };
    sidewall(0, vTread0 * h, true, false);
    sidewall(vTread1 * h, h, false, true);
    out[mode] = c;
  }
  return { map: tex(out.color), roughnessMap: tex(out.rough, { srgb: false }) };
}

/* -------------------------------------------------------------- brake disc */
/** Drilled carbon disc: colour + emissive mask (the glow lives on the friction band). */
export function brakeDiscSkin(size = 512) {
  const cCol = canvas(size, size), g = cCol.getContext('2d');
  const cEm = canvas(size, size), e = cEm.getContext('2d');
  const R = size / 2;
  g.fillStyle = '#000'; g.fillRect(0, 0, size, size);
  e.fillStyle = '#000'; e.fillRect(0, 0, size, size);
  // friction band
  const grad = g.createRadialGradient(R, R, R * 0.35, R, R, R);
  grad.addColorStop(0, '#1a1a1d'); grad.addColorStop(0.55, '#2c2c30'); grad.addColorStop(1, '#3a3a3f');
  g.fillStyle = grad; g.beginPath(); g.arc(R, R, R, 0, Math.PI * 2); g.fill();
  const eg = e.createRadialGradient(R, R, R * 0.42, R, R, R * 0.99);
  eg.addColorStop(0, '#2a0a00'); eg.addColorStop(0.35, '#b02800'); eg.addColorStop(0.8, '#ffffff'); eg.addColorStop(1, '#ff7a20');
  e.fillStyle = eg; e.beginPath(); e.arc(R, R, R, 0, Math.PI * 2); e.fill();
  // drilled cooling holes in concentric rings
  for (let ring = 0; ring < 4; ring++) {
    const rr = R * (0.55 + ring * 0.11);
    const n = 26 + ring * 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + ring * 0.11;
      const x = R + Math.cos(a) * rr, y = R + Math.sin(a) * rr;
      g.fillStyle = '#050506'; g.beginPath(); g.arc(x, y, R * 0.016, 0, Math.PI * 2); g.fill();
      e.fillStyle = '#000'; e.beginPath(); e.arc(x, y, R * 0.016, 0, Math.PI * 2); e.fill();
    }
  }
  // radial machining marks
  g.strokeStyle = 'rgba(255,255,255,0.05)'; g.lineWidth = 1;
  for (let i = 0; i < 180; i++) {
    const a = (i / 180) * Math.PI * 2;
    g.beginPath();
    g.moveTo(R + Math.cos(a) * R * 0.42, R + Math.sin(a) * R * 0.42);
    g.lineTo(R + Math.cos(a) * R, R + Math.sin(a) * R);
    g.stroke();
  }
  return { map: tex(cCol, { wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping }), emissiveMap: tex(cEm, { wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping }) };
}

/* -------------------------------------------------------------- wheel cover */
export function wheelCoverSkin(size = 512) {
  const c = canvas(size, size), g = c.getContext('2d');
  const R = size / 2;
  g.fillStyle = '#0d0e11'; g.fillRect(0, 0, size, size);
  g.fillStyle = '#16181c'; g.beginPath(); g.arc(R, R, R * 0.98, 0, Math.PI * 2); g.fill();
  // spoke shadows visible through the cover vents
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    g.save(); g.translate(R, R); g.rotate(a);
    g.fillStyle = '#0a0b0d';
    g.beginPath(); g.moveTo(R * 0.30, -R * 0.055); g.lineTo(R * 0.86, -R * 0.10);
    g.lineTo(R * 0.86, R * 0.10); g.lineTo(R * 0.30, R * 0.055); g.closePath(); g.fill();
    g.restore();
  }
  // painted rim ring + team colour
  g.strokeStyle = THEME.primary; g.lineWidth = R * 0.10;
  g.beginPath(); g.arc(R, R, R * 0.90, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = THEME.gold; g.lineWidth = R * 0.018;
  g.beginPath(); g.arc(R, R, R * 0.82, 0, Math.PI * 2); g.stroke();
  // hub
  g.fillStyle = '#26292e'; g.beginPath(); g.arc(R, R, R * 0.26, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#c9ced6'; g.beginPath(); g.arc(R, R, R * 0.12, 0, Math.PI * 2); g.fill();
  // wordmark around the cover
  g.save(); g.translate(R, R);
  g.fillStyle = THEME.white; g.font = font(R * 0.11, 900);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 0; i < 4; i++) {
    g.save(); g.rotate((i / 4) * Math.PI * 2); g.translate(0, -R * 0.62); g.fillText(THEME.team, 0, 0); g.restore();
  }
  g.restore();
  return tex(c, { wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping });
}

/* ------------------------------------------------------------------ helmet */
export function helmetSkin(w = 1024, h = 512) {
  const c = canvas(w, h), g = c.getContext('2d');
  g.fillStyle = '#f2f4f7'; g.fillRect(0, 0, w, h);
  // crown band
  g.fillStyle = THEME.primary; g.fillRect(0, 0, w, h * 0.30);
  g.fillStyle = THEME.carbon; g.fillRect(0, h * 0.30, w, h * 0.045);
  g.fillStyle = THEME.gold; g.fillRect(0, h * 0.345, w, h * 0.018);
  // lower band
  g.fillStyle = THEME.carbon; g.fillRect(0, h * 0.80, w, h * 0.20);
  // side chevrons
  g.fillStyle = THEME.primary;
  for (const cx of [w * 0.25, w * 0.75]) {
    g.beginPath();
    g.moveTo(cx - w * 0.10, h * 0.80); g.lineTo(cx, h * 0.52);
    g.lineTo(cx + w * 0.10, h * 0.80); g.lineTo(cx + w * 0.05, h * 0.80);
    g.lineTo(cx, h * 0.63); g.lineTo(cx - w * 0.05, h * 0.80);
    g.closePath(); g.fill();
  }
  g.fillStyle = THEME.white; g.font = font(h * 0.10, 900);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(THEME.number, w * 0.25, h * 0.16);
  g.fillText(THEME.number, w * 0.75, h * 0.16);
  g.fillStyle = THEME.carbon; g.font = font(h * 0.06, 800);
  g.fillText(THEME.sponsors[2], w * 0.5, h * 0.44);
  g.fillText(THEME.sponsors[2], w * 0.0, h * 0.44);
  return tex(c);
}

/* --------------------------------------------------- steering wheel display */
export function steeringDisplaySkin(w = 512, h = 256) {
  const c = canvas(w, h), g = c.getContext('2d');
  g.fillStyle = '#05070a'; g.fillRect(0, 0, w, h);
  // shift lights
  const n = 12;
  for (let i = 0; i < n; i++) {
    g.fillStyle = i < 5 ? '#19e04a' : i < 9 ? '#e02020' : '#3a1ae0';
    g.fillRect(w * 0.06 + i * (w * 0.075), h * 0.08, w * 0.055, h * 0.11);
  }
  g.fillStyle = '#eef2ff'; g.font = font(h * 0.44, 900);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('6', w * 0.5, h * 0.52);
  g.font = font(h * 0.14, 700);
  g.fillStyle = '#7de2ff';
  g.fillText('1:31.4', w * 0.5, h * 0.86);
  g.fillStyle = '#ffd166';
  g.fillText('ERS 82', w * 0.16, h * 0.52);
  g.fillStyle = '#8affa0';
  g.fillText('C4', w * 0.86, h * 0.52);
  return tex(c, { wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping });
}

/**
 * Horizontally mirrored copy of a texture — used for the -X side of any part
 * whose geometry is shared between the two sides (endplates, wheel covers), so
 * lettering reads the right way round from both sides of the car.
 */
export function mirrored(t) {
  const m = t.clone();
  m.needsUpdate = true;
  m.wrapS = THREE.RepeatWrapping;
  m.repeat.x = -Math.abs(m.repeat.x || 1);
  m.offset.x = 1;
  return m;
}

/* ------------------------------------------------------------ suit / gloves */
export function suitSkin(w = 512, h = 512) {
  const c = canvas(w, h), g = c.getContext('2d');
  g.fillStyle = THEME.carbon; g.fillRect(0, 0, w, h);
  g.fillStyle = THEME.primary; g.fillRect(0, h * 0.30, w, h * 0.26);
  g.fillStyle = THEME.white; g.font = font(h * 0.09, 900);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(THEME.sponsors[0], w * 0.5, h * 0.43);
  g.fillStyle = THEME.gold; g.fillRect(0, h * 0.58, w, h * 0.02);
  return tex(c);
}
