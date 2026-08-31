/**
 * Renderer + light rig + post FX. Owner: RENDER.
 * Owns THREE.WebGLRenderer, the composer, scene.environment, scene.fog and the global
 * lights. Constructed before every other module, so anything that depends on the scene
 * being populated is deferred to the first update().
 *
 * API (frozen): .renderer  async init()  update(dt)  resize(w,h)
 *
 * The look, in one paragraph: Bahrain at night is a BRIGHT track in a black desert.
 * A baked top-down illuminance field (lightfield.js) carries the 4,500-luminaire array
 * and gives the corridor its brightness and the desert its blackness; a PMREM of a
 * procedural luminaire ring (skyenv.js) does the shadowless fill and every specular
 * highlight on the bodywork; three shadow-casting keys at fixed world azimuths give
 * three faint overlapping shadows; height haze modulated by the same field makes the
 * air over the circuit glow while the desert stays black; the post chain tone-maps with
 * ACES + highlight desaturation, blooms only what is actually a light source, and adds
 * reprojection motion blur because at 300 km/h the absence of it is the giveaway.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

import { resolveQuality } from './quality.js';
import { LightField, SceneGrade } from './lightfield.js';
import { buildEnvironment, buildSkyDome } from './skyenv.js';
import { LightRig } from './lightrig.js';
import { Atmosphere, findLuminaires } from './atmosphere.js';
import { MotionBlurShader, FinalShader } from './passes.js';

const ONE = new THREE.Vector3(1, 1, 1);

export class RenderPipeline {
  constructor(ctx) {
    this.ctx = ctx;
    this.canvas = ctx.canvas;
    this.state = ctx.state;
    this.q = resolveQuality();
    this._frame = 0;
    this._t = 0; this._f = 0;
    this._prevPos = new THREE.Vector3();
    this._prevQuat = new THREE.Quaternion();
    this._mbWarm = 0;
    this._m = new THREE.Matrix4();
    this._q4 = new THREE.Quaternion();
    this._vp = new THREE.Matrix4();
  }

  async init() {
    const q = this.q;
    const r = this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: false, powerPreference: 'high-performance',
      stencil: false, depth: true, alpha: false,
    });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.setSize(innerWidth, innerHeight);
    r.shadowMap.enabled = !!q.shadows;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.outputColorSpace = THREE.SRGBColorSpace;
    // Tone mapping happens in our own final pass (three's OutputPass has no CUSTOM
    // define). These two only matter for the no-post fallback path.
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = q.exposure;
    r.setClearColor(0x000000, 1);
    r.info.autoReset = false;

    const scene = this.ctx.scene;

    // --- atmosphere ---------------------------------------------------------
    // FogExp2 exists only to raise USE_FOG; the actual falloff is the analytic
    // height fog injected by SceneGrade. Materials we never reach keep this.
    scene.fog = q.fog ? new THREE.FogExp2(0x05060a, 0.00035) : null;
    scene.background = null;

    this.sky = buildSkyDome();
    scene.add(this.sky);

    // --- IBL ----------------------------------------------------------------
    if (q.ibl) {
      try {
        // Full lamp radiance. This is the ONLY thing on the car that produces a
        // specular highlight — there are no analytic lights inside the bodywork's
        // reflection vector — so cutting it (round 1 shipped 6.0 against a
        // documented 105) does not "tone the scene down", it deletes the wet-look
        // clearcoat entirely and leaves flat diffuse plastic. The diffuse side of
        // the same environment is held in range by the blob SIZE in skyenv.js
        // instead, which specular does not care about.
        this.envMap = buildEnvironment(r);
        scene.environment = this.envMap;
        scene.environmentIntensity = 0.75;
      } catch (e) { console.error('[render] IBL build failed', e); }
    }

    // --- lights -------------------------------------------------------------
    // The documented irradiance budget, in full. FIA mandates >=3,000 lux over the
    // whole surface at Bahrain and the venue is lit to near-daylight; a night race
    // is a BRIGHT track in a black desert, and the blackness is the light field's
    // job (see uFldTune.z), not the rig's.
    this.rig = new LightRig(scene, q);
    this.rig.setIntensity(1, { direct: 3.10, rim: 0.62, hemi: 0.55 });
    if (!q.contactShadow) this.rig.setContact(false);

    // --- baked floodlight field --------------------------------------------
    this.field = new LightField();
    this.grade = new SceneGrade(this.field);

    // --- volumetrics --------------------------------------------------------
    this.atmos = new Atmosphere(scene);
    this.atmos.setEnabled(!!q.volumetrics);

    // --- post ---------------------------------------------------------------
    this._buildComposer(innerWidth, innerHeight);

    this.resize(innerWidth, innerHeight);
    this.state.render.exposure = q.exposure;
    this.state.render.quality = q.post ? 'high' : 'low';
  }

  _buildComposer(w, h) {
    const q = this.q, r = this.renderer;
    const px = r.getPixelRatio();
    const W = Math.max(2, Math.floor(w * px)), H = Math.max(2, Math.floor(h * px));

    // AA is a post pass (SMAA), not MSAA: the reference's baseline is TAA/DLAA, and a
    // multisampled target that also carries a depth texture is the single most fragile
    // combination in three. samples:0 keeps the depth attachment simple and correct.
    const mkDepth = () => {
      const d = new THREE.DepthTexture(W, H);
      d.format = THREE.DepthFormat;
      d.type = THREE.UnsignedIntType;
      d.minFilter = THREE.NearestFilter;
      d.magFilter = THREE.NearestFilter;
      return d;
    };
    const rt = new THREE.WebGLRenderTarget(W, H, {
      type: THREE.HalfFloatType,
      samples: 0,
      depthBuffer: true,
      // ALWAYS attached, even with motion blur off. Allocating it only when the flag
      // was set at construction made setQuality({ motionBlur: true }) a silent
      // no-op — the pass had nothing to sample and _prepare() disabled it again on
      // the next frame. One depth attachment is cheap; a dead switch is not.
      depthTexture: mkDepth(),
    });
    rt.texture.name = 'F1.sceneHDR';

    const composer = this.composer = new EffectComposer(r, rt);
    // Two fixes in two lines. setSize: three took _width/_height from the DEVICE
    // pixel size of the target we handed it, so without this the pixel ratio would
    // be applied twice on the first resize. setPixelRatio: restate it so the post
    // chain is guaranteed to run at full device resolution on any three version —
    // if it ever silently fell back to 1 the whole chain would run at a quarter of
    // the pixel count on a retina display, and uTexel (device px) would address a
    // CSS-px buffer, leaving the sharpen kernel tapping sub-texel and doing nothing.
    composer.setSize(w, h);
    composer.setPixelRatio(px);

    // renderTarget2 is a clone, but Texture.clone() SHARES the Source — so both
    // targets would attach the same GPU depth texture and motion blur would read
    // the buffer it is writing. Give rt2 its own.
    if (composer.renderTarget2.depthTexture) {
      composer.renderTarget2.depthTexture.dispose();
      composer.renderTarget2.depthTexture = mkDepth();
    }
    // three never resizes depthTextures, so both have to be tracked and resized by hand.
    this.depthTextures = [composer.renderTarget1.depthTexture, composer.renderTarget2.depthTexture]
      .filter(Boolean);

    composer.addPass(new RenderPass(this.ctx.scene, this.ctx.camera));

    // Built unconditionally and gated by .enabled, so the quality switch is live.
    const mb = this.motionBlur = new ShaderPass(MotionBlurShader);
    mb.material.depthTest = false; mb.material.depthWrite = false;
    mb.enabled = !!q.motionBlur;
    composer.addPass(mb);

    if (q.bloom) {
      // Threshold sits ABOVE anything lit and below the emissive luminaires, so only
      // actual light sources bloom. Radius kept tight: the reference blooms the lamps,
      // it does not soften the frame.
      const bloom = this.bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.50, 0.55, 1.2);
      composer.addPass(bloom);
    }

    const fin = this.final = new ShaderPass(FinalShader);
    fin.material.depthTest = false; fin.material.depthWrite = false;
    fin.uniforms.uExposure.value = q.exposure;
    fin.uniforms.uContrast.value = q.contrast;
    fin.uniforms.uSaturation.value = q.saturation;
    fin.uniforms.uCA.value = q.chromatic;
    fin.uniforms.uSharpen.value = q.sharpen;
    fin.uniforms.uGrain.value = q.grain;
    fin.uniforms.uVignette.value = q.vignette;
    composer.addPass(fin);

    // Edge AA after the display transform, where SMAA's luma edge detection belongs.
    if (q.smaa !== false) {
      try { this.smaa = new SMAAPass(W, H); composer.addPass(this.smaa); }
      catch (e) { console.warn('[render] SMAA unavailable', e); }
    }

    if (q.ao) this._addAO(W, H);
  }

  async _addAO(W, H) {
    try {
      const { GTAOPass } = await import('three/addons/postprocessing/GTAOPass.js');
      const ao = new GTAOPass(this.ctx.scene, this.ctx.camera, W, H);
      ao.output = GTAOPass.OUTPUT.Default;
      ao.blendIntensity = 0.65;
      ao.updateGtaoMaterial({ radius: 1.2, distanceExponent: 1.4, thickness: 0.6, scale: 1.0 });
      // AO must land AFTER motion blur (whose fullscreen quads must not touch the
      // shared depth texture before it is read) and before bloom.
      // This index MUST be derived from the live pass list, not assumed: _addAO is
      // async, so by the time it runs other passes may already have shifted the
      // chain. Getting this wrong puts AO ahead of motion blur, which then samples
      // a depth texture that no longer belongs to its read buffer and outputs BLACK.
      const passes = this.composer.passes;
      const mbIdx = this.motionBlur ? passes.indexOf(this.motionBlur) : -1;
      const bloomIdx = this.bloom ? passes.indexOf(this.bloom) : -1;
      const at = mbIdx >= 0 ? mbIdx + 1
        : bloomIdx >= 0 ? bloomIdx
          : Math.min(1, passes.length);
      this.composer.insertPass(ao, at);
      this.ao = ao;
    } catch (e) { console.warn('[render] GTAO unavailable', e); }
  }

  /* ------------------------------------------------------------------ api --- */

  setQuality(patch = {}) {
    Object.assign(this.q, patch);
    const f = this.final?.uniforms;
    if (f) {
      if (patch.exposure !== undefined) { f.uExposure.value = patch.exposure; this.state.render.exposure = patch.exposure; }
      if (patch.contrast !== undefined) f.uContrast.value = patch.contrast;
      if (patch.saturation !== undefined) f.uSaturation.value = patch.saturation;
      if (patch.chromatic !== undefined) f.uCA.value = patch.chromatic;
      if (patch.sharpen !== undefined) f.uSharpen.value = patch.sharpen;
      if (patch.grain !== undefined) f.uGrain.value = patch.grain;
      if (patch.vignette !== undefined) f.uVignette.value = patch.vignette;
    }
    // The pass and its depth attachment always exist, so this is a live switch
    // rather than a flag nothing reads.
    if (patch.motionBlur !== undefined && this.motionBlur) {
      this.motionBlur.enabled = !!patch.motionBlur;
      if (patch.motionBlur) this._mbWarm = 0;   // re-seed the previous camera pose
    }
    if (patch.shadows !== undefined) { this.renderer.shadowMap.enabled = !!patch.shadows; this.rig?.setShadows(patch.shadows); }
    if (patch.volumetrics !== undefined) this.atmos?.setEnabled(patch.volumetrics);
    if (patch.contactShadow !== undefined) this.rig?.setContact(patch.contactShadow);
    if (patch.bloomStrength !== undefined && this.bloom) this.bloom.strength = patch.bloomStrength;
    if (patch.bloomThreshold !== undefined && this.bloom) this.bloom.threshold = patch.bloomThreshold;
    if (patch.envIntensity !== undefined) this.ctx.scene.environmentIntensity = patch.envIntensity;
    if (patch.lightGain !== undefined) this.grade.uniforms.uFldTune.value.x = patch.lightGain;
    if (patch.falloffPow !== undefined) this.grade.uniforms.uFldTune.value.y = patch.falloffPow;
    if (patch.ambientFloor !== undefined) this.grade.uniforms.uFldTune.value.z = patch.ambientFloor;
    if (patch.hazeGain !== undefined) this.grade.uniforms.uFldTune.value.w = patch.hazeGain;
    if (patch.hazeDensity !== undefined) this.grade.uniforms.uHaze.value.x = patch.hazeDensity;
    if (patch.rig) this.rig?.setIntensity(1, patch.rig);
  }

  resize(w, h) {
    if (!this.renderer) return;
    this.renderer.setSize(w, h);
    const px = this.renderer.getPixelRatio();
    const W = Math.max(2, Math.floor(w * px)), H = Math.max(2, Math.floor(h * px));
    this.composer?.setSize(w, h);
    for (const d of this.depthTextures ?? []) {
      if (d.image.width === W && d.image.height === H) continue;
      d.image.width = W; d.image.height = H; d.needsUpdate = true;
    }
    this.final?.uniforms.uTexel.value.set(1 / W, 1 / H);
    this.bloom?.setSize(W, H);
  }

  /* --------------------------------------------------------------- update --- */

  _deferred() {
    const scene = this.ctx.scene;
    // 1. bake the floodlight field once the track exists
    if (this.q.lightField && !this.field.built) {
      const track = this.ctx.get('track');
      if (track?.length) {
        const t0 = performance.now();
        if (this.field.build(track)) {
          this.grade.setTexture(this.field.texture);
          console.log(`[render] floodlight field baked in ${(performance.now() - t0).toFixed(0)} ms`);
        }
      }
    }
    // 2. patch newly added materials
    if (this.q.lightField && (this._frame < 6 || this._frame % 45 === 0)) this.grade.scan(scene);
    // 3. hang volumetric cones off whatever luminaires ENVIRONMENT placed
    if (this.q.volumetrics && !this.atmos.built && this._frame >= 2) {
      const lamps = findLuminaires(scene);
      if (lamps.length >= 4) {
        this.atmos.build(lamps);
        console.log(`[render] ${lamps.length} luminaires -> volumetric cones`);
      } else if (this._frame > 120) {
        this.atmos.built = true;   // give up quietly
      }
    }
  }

  update(dt) {
    const r = this.renderer, scene = this.ctx.scene, cam = this.ctx.camera;
    r.info.reset();
    this._frame++;
    try { this._prepare(dt); } catch (e) {
      if (!this._prepErr) { this._prepErr = 1; console.error('[render] prepare failed: ' + String(e && (e.stack || e.message) || e)); }
    }

    if (this.q.post && this.composer) {
      try {
        this.composer.render(dt);
      } catch (e) {
        // Never let a post pass take the whole frame down: drop the most fragile pass
        // first, then the chain, and keep drawing.
        const msg = (e && (e.stack || e.message)) ? String(e.stack || e.message) : String(e);
        if (this.ao) { this.composer.removePass(this.ao); this.ao = null; console.warn('[render] GTAO removed after error: ' + msg); }
        else if (this.motionBlur) { this.composer.removePass(this.motionBlur); this.motionBlur = null; console.warn('[render] motion blur removed after error: ' + msg); }
        else { this.q.post = false; console.error('[render] post chain disabled after error: ' + msg); }
        r.render(scene, cam);
      }
    } else {
      r.render(scene, cam);
    }

    const info = r.info.render;
    this.state.render.drawCalls = info.calls;
    this.state.render.triangles = info.triangles;
    this._t += dt; this._f++;
    if (this._t >= 0.5) {
      this.state.render.fps = Math.round(this._f / this._t);
      this.state.render.ms = +(this._t / this._f * 1000).toFixed(2);
      this._t = 0; this._f = 0;
    }
  }

  /** Everything that has to happen before the frame is drawn. */
  _prepare(dt) {
    const cam = this.ctx.camera;
    this._deferred();

    const p = this.state.car.position;

    // light rig follows the car; direction stays world-fixed
    if (this.rig) {
      const track = this.ctx.get('track');
      let y = p.y - 0.30;
      if (track?.locate) { try { y = track.locate(p, this.state.trackQuery?.s).height; } catch { /* keep */ } }
      this.rig.update(p, this.state.car.quaternion, y,
        this.q.contactShadow ? 1 : 0, this.state.car.wheel);
    }

    if (this.sky) this.sky.position.copy(cam.position);

    // world-position reconstruction basis for the light field / height haze
    cam.updateMatrixWorld();
    this.grade.uniforms.uFldInvView.value.copy(cam.matrixWorld);

    // motion blur matrices. RenderPass writes into composer.readBuffer (that is why it
    // has needsSwap=false), so that is where this frame's depth lands.
    if (this.motionBlur && (this.motionBlur.enabled || this.q.motionBlur)) {
      // If the read buffer has no depth attachment the blur shader samples garbage and
      // renders the whole frame black. Fail visibly-safe: skip the pass, keep the image.
      const depth = this.composer.readBuffer && this.composer.readBuffer.depthTexture;
      if (!depth) {
        if (this.motionBlur.enabled) {
          this.motionBlur.enabled = false;
          console.warn('[render] motion blur disabled: read buffer has no depthTexture');
        }
      } else {
        if (!this.motionBlur.enabled) this.motionBlur.enabled = true;
        this.motionBlur.uniforms.tDepth.value = depth;
        cam.updateMatrixWorld();
        this._vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
        const u = this.motionBlur.uniforms;
        u.uInvViewProj.value.copy(this._vp).invert();

        if (this._mbWarm < 2) { this._prevPos.copy(cam.position); this._prevQuat.copy(cam.quaternion); this._mbWarm++; }
        // damp the rotational component: full rotation blur smears the car itself
        this._q4.copy(this._prevQuat).slerp(cam.quaternion, 0.66);
        this._m.compose(this._prevPos, this._q4, ONE).invert();
        u.uPrevViewProj.value.multiplyMatrices(cam.projectionMatrix, this._m);

        // Shutter-time normalised so the smear never depends on frame rate, and MILD:
        // reference-visual.md is explicit that camera blur is gentle and disableable.
        const amt = THREE.MathUtils.clamp(this.q.motionBlurAmount ?? 0.55, 0, 1);
        u.uStrength.value = THREE.MathUtils.clamp(0.0042 * amt / Math.max(dt, 1e-3), 0.02, 0.55);
        u.uMaxBlur.value = 0.012 * amt;
        const kph = this.state.car.kph || 0;
        u.uRadial.value = THREE.MathUtils.clamp((kph - 210) / 150, 0, 1) * 0.0055 * amt;

        this._prevPos.copy(cam.position);
        this._prevQuat.copy(cam.quaternion);
      }
    }

    if (this.final) this.final.uniforms.uTime.value = this.state.t;
  }
}
