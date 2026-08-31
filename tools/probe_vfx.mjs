/**
 * THROWAWAY VFX probe (owner: VFX). The normal capture harness poses the car with throttle
 * applied and never produces a lock-up, wheelspin or an off-track excursion, so this drives
 * the car kinematically and forces the wheel states the effects key off.
 *
 *   node tools/probe_vfx.mjs --out shots/vfx_probe --w 1280 --h 720
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const A = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean)
  .map(s => { const [k, ...v] = s.trim().split(/\s+/); return [k, v.join(' ')]; }));
const OUT = path.resolve(A.out ?? 'shots/vfx_probe');
const W = +(A.w ?? 1280), H = +(A.h ?? 720);
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  headless: true, protocolTimeout: 900000,
  args: ['--no-sandbox', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist',
    '--enable-unsafe-swiftshader', '--enable-webgl', '--disable-dev-shm-usage',
    '--hide-scrollbars', `--window-size=${W},${H}`],
});
const page = await browser.newPage();
page.setDefaultTimeout(600000);
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
const logs = [], errors = [];
page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', e => errors.push(String(e.stack || e)));
await page.goto('http://localhost:8123/index.html', { waitUntil: 'domcontentloaded', timeout: 240000 });
try { await page.waitForFunction('window.__F1 && window.__F1.state.flags.ready', { timeout: 180000 }); }
catch { errors.push('TIMEOUT: window.__F1 never became ready'); }
await new Promise(r => setTimeout(r, 1800));

await page.evaluate(() => {
  window.__force = (o) => {
    const g = window.__F1, T = window.__THREE, st = g.state;
    const tr = g.modules.get('track');
    const vfx = g.modules.get('vfx'), cam = g.modules.get('camera');
    const car = g.modules.get('car'), ren = g.modules.get('render');
    if (o.cam) { cam.mode = o.cam; st.camera.mode = o.cam; }
    const dt = 1 / 60;
    let s = o.s;
    const fwd = new T.Vector3(0, 0, 1), up = new T.Vector3(0, 1, 0);
    for (let f = 0; f < (o.frames ?? 90); f++) {
      s += (o.kph / 3.6) * dt;
      const t = tr.sampleS(s);
      const lat = (o.latFrac !== undefined) ? o.latFrac * t.halfWidth : (o.lat ?? 0);
      const p = t.point.clone().addScaledVector(t.right, lat).add(new T.Vector3(0, 0.32, 0));
      const c = st.car;
      c.position.copy(p);
      c.quaternion.setFromUnitVectors(fwd, t.tangent.clone().setY(0).normalize());
      c.velocity.copy(t.tangent).multiplyScalar(o.kph / 3.6);
      c.speed = o.kph / 3.6; c.kph = o.kph;
      c.onTrack = !(o.off); c.aeroMode = o.aero ?? 'Z';
      c.steerAngle = o.steer ?? 0; c.lateralG = o.latG ?? 0; c.longG = o.longG ?? 0;
      st.lap.distance = s % tr.length;
      st.input.brake = o.brake ?? 0; st.input.throttle = o.throttle ?? 0;
      st.dt = dt; st.t += dt; st.frame++;
      for (let i = 0; i < 4; i++) {
        const w = c.wheel[i];
        const rear = i >= 2;
        w.locked = !!o.locked && (!o.rearOnly);
        w.spinning = !!o.spinning && rear;
        w.gripUse = o.gripUse ?? 0.4;
        w.slipRatio = o.slipRatio ?? 0;
        w.slipAngle = o.slipAngle ?? 0;
        w.surface = o.surface ?? 'asphalt';
        w.spin += (o.kph / 3.6) / 0.36 * dt;
        w.load = 3000;
      }
      try { vfx.update(dt); } catch (e) { console.error('vfx.update', e); }
      try { cam.update(dt); } catch (e) { console.error('cam', e); }
      try { car.lateUpdate(dt); } catch (e) { console.error('car', e); }
      try { vfx.lateUpdate(dt); } catch (e) { console.error('vfx.lateUpdate', e); }
      if (o.raw) {
        // bypass the (currently broken) post chain: plain forward render + ACES
        const R = g.renderer;
        R.setRenderTarget(null);
        R.toneMapping = window.__THREE.ACESFilmicToneMapping;
        R.toneMappingExposure = st.render.exposure || 1;
        R.setClearColor(0x05070c, 1);
        try { R.render(g.scene, g.camera); } catch (e) { console.error('rawRender', e); }
        st.render.drawCalls = R.info.render.calls; st.render.triangles = R.info.render.triangles;
        R.info.reset();
      } else {
        try { ren.update(dt); } catch (e) { console.error('render', e); }
      }
    }
    const v = g.modules.get('vfx');
    return {
      smoke: v.stats.smoke, streaks: v.stats.streaks, markQuads: v.stats.markQuads,
      drawCalls: st.render.drawCalls, triangles: st.render.triangles,
      hazePass: !!(v.haze && v.haze.pass && g.modules.get('render').composer?.passes.includes(v.haze.pass)),
      gain: v.gain, addGain: v.addGain, exposure: st.render.exposure,
    };
  };
});

// TEMP WORKAROUND (probe only, never shipped): src/render/lightfield.js currently throws
// "VERT_HEAD is not defined" from SceneGrade._onBeforeCompile, which makes WebGLRenderer
// throw on the first draw and leaves every capture black. Neutralise the patch so the
// frame renders and the VFX can be judged. Logged in docs/REQUESTS.md for RENDER.
await page.evaluate(() => {
  window.__fixGrade = () => {
    const g = window.__F1, ren = g.modules.get('render');
    let n = 0;
    if (ren.grade) ren.grade._onBeforeCompile = () => {};
    g.scene.traverse((o) => {
      const m = o.material; if (!m) return;
      for (const mm of (Array.isArray(m) ? m : [m])) {
        if (mm.onBeforeCompile) { mm.onBeforeCompile = () => {}; mm.customProgramCacheKey = () => 'vfxprobe'; mm.needsUpdate = true; n++; }
      }
    });
    ren.q.post = true;
    return n;
  };
  window.__vfxVisible = (on) => {
    const v = window.__F1.modules.get('vfx');
    for (const m of [v.smoke.mesh, v.streaks.mesh, v.marks.mesh, v.marbles.mesh]) m.visible = on;
    const comp = window.__F1.modules.get('render').composer;
    if (v.haze?.pass) {
      const i = comp.passes.indexOf(v.haze.pass);
      if (!on && i >= 0) comp.removePass(v.haze.pass);
      if (on && i < 0) v.haze.attach();
    }
  };
});

const SCENES = {
  sparks: { cam: 'chase', s: 300, kph: 320, throttle: 1, gripUse: 0.5, frames: 60 },
  lockup: { cam: 'chase', s: 980, kph: 210, brake: 1, locked: true, gripUse: 1.32, slipRatio: -0.7, frames: 60 },
  lockTV: { cam: 'tvpod', s: 980, kph: 190, brake: 1, locked: true, gripUse: 1.3, slipRatio: -0.7, frames: 60 },
  spin: { cam: 'chase', s: 1150, kph: 95, throttle: 1, spinning: true, gripUse: 1.25, slipRatio: 0.45, frames: 60 },
  gravel: { cam: 'chaseFar', s: 1900, kph: 140, throttle: 0.4, surface: 'gravel', off: true, latFrac: 1.9, gripUse: 1.1, frames: 70 },
  kerb: { cam: 'chase', s: 1100, kph: 190, throttle: 1, latFrac: 1.12, gripUse: 0.8, frames: 60 },
};
const RAW = A.raw !== undefined;
for (const k in SCENES) SCENES[k].raw = RAW;
const want = (A.scenes ?? 'sparks,lockup,lockTV,spin,gravel,kerb').split(',').map(s => s.trim());

console.log('grade patch neutralised on', await page.evaluate(() => window.__fixGrade()), 'materials');

const report = {};
for (const name of want) {
  const bare = name.endsWith('!');
  const key = bare ? name.slice(0, -1) : name;
  const o = SCENES[key];
  if (!o) continue;
  await page.evaluate((on) => window.__vfxVisible(on), !bare);
  report[name] = await page.evaluate((oo) => window.__force(oo), o);
  await new Promise(r => setTimeout(r, 250));
  await page.screenshot({ path: path.join(OUT, `${key}${bare ? '_novfx' : ''}.png`) });
  console.log(name, JSON.stringify(report[name]));
}

fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
fs.writeFileSync(path.join(OUT, 'console.log'), logs.join('\n'));
fs.writeFileSync(path.join(OUT, 'errors.json'), JSON.stringify(errors, null, 1));
console.log(errors.length ? `\n!! ${errors.length} ERRORS:\n` + errors.slice(0, 10).join('\n') : '\nno page errors');
await browser.close();
