/**
 * Procedural night sky + IBL environment. Owner: RENDER.
 *
 * Two products from one idea:
 *  1. `buildEnvironment(renderer)` renders a throw-away scene — black dome, a ring of
 *     HDR cool-white luminaire blobs at 18..48 deg elevation, a warm sodium band at the
 *     horizon, dark sand below — through PMREMGenerator. That becomes `scene.environment`,
 *     so bodywork finally has something to reflect: many small bright highlights sliding
 *     over the clearcoat is THE signature of a floodlit F1 car, and it is also the
 *     cheapest possible "4,500 luminaires" approximation for indirect light.
 *  2. `buildSkyDome()` is the sky the player actually sees: near-black overhead, a low
 *     warm dust glow at the horizon. Unlit, unfogged, drawn first.
 */
import * as THREE from 'three';

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize( position );
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w;   // pin to far plane
}`;

const SKY_FRAG = /* glsl */`
varying vec3 vDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform float uGlowPow;
void main() {
  float h = clamp( vDir.y, -1.0, 1.0 );
  float up = clamp( h, 0.0, 1.0 );
  vec3 c = mix( uHorizon, uZenith, pow( up, 0.42 ) );
  // tight band of scattered floodlight / city sodium sitting on the horizon
  float band = pow( clamp( 1.0 - abs( h ) * 6.5, 0.0, 1.0 ), uGlowPow );
  c += uGlow * band;
  // below the horizon: desert, effectively black
  c = mix( c * 0.10, c, smoothstep( -0.06, 0.02, h ) );
  gl_FragColor = vec4( c, 1.0 );
}`;

export function buildSkyDome(radius = 4500) {
  const geo = new THREE.SphereGeometry(radius, 32, 20);
  const mat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false, toneMapped: false,
    uniforms: {
      uZenith: { value: new THREE.Color(0.0016, 0.0022, 0.0044) },
      uHorizon: { value: new THREE.Color(0.0075, 0.0072, 0.0076) },
      uGlow: { value: new THREE.Color(0.030, 0.021, 0.012) },
      uGlowPow: { value: 2.1 },
    },
  });
  const m = new THREE.Mesh(geo, mat);
  m.name = 'render.sky';
  m.frustumCulled = false;
  m.renderOrder = -1000;
  m.userData.noLightField = true;
  return m;
}

/** HDR cube env representing the floodlight array. Returns a PMREM texture. */
export function buildEnvironment(renderer, opts = {}) {
  const lumRadiance = opts.lumRadiance ?? 105;
  const s = new THREE.Scene();

  // --- dome: black sky, warm horizon, dark ground -----------------------------
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(60, 32, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, toneMapped: false,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: {
        uZenith: { value: new THREE.Color(0.006, 0.008, 0.014) },
        uHorizon: { value: new THREE.Color(0.055, 0.048, 0.045) },
        uGlow: { value: new THREE.Color(0.55, 0.38, 0.20) },
        uGlowPow: { value: 1.6 },
      },
    }),
  );
  s.add(dome);

  // --- ground bounce: the asphalt is bright, so there IS a floor contribution --
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(58, 32),
    new THREE.MeshBasicMaterial({ toneMapped: false, side: THREE.DoubleSide }),
  );
  floor.material.color.setRGB(0.085, 0.083, 0.082);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -2;
  s.add(floor);

  // --- the luminaire ring -----------------------------------------------------
  // Poles run 10 m to 45 m: map that to a spread of elevations, and vary cluster
  // size so specular highlights on the bodywork are not all identical.
  //
  // SIZE AND RADIANCE ARE NOT INTERCHANGEABLE, and getting that backwards is what
  // killed the first pass. A mirror-ish surface samples a sharp mip, so its
  // highlight peaks at (radiance x envMapIntensity) no matter how small the source
  // is; a rough surface samples the cosine-convolved mip, so its irradiance goes as
  // (radiance x SOLID ANGLE x envMapIntensity). Dimming the whole environment to
  // keep the asphalt from blowing out therefore costs every specular highlight on
  // the bodywork and buys nothing else. The fix is small and fierce: full lamp
  // radiance for the specular, blob radii ~0.24x so the integrated irradiance
  // lands where a 0.17-albedo road wants it. That factor is the reason these radii
  // look absurdly small for a "light" — they are the right angular size for a
  // luminaire cluster 46 m away.
  const blobGeo = new THREE.SphereGeometry(1, 10, 8);
  const cool = new THREE.MeshBasicMaterial({ toneMapped: false });
  cool.color.setRGB(lumRadiance * 0.90, lumRadiance * 0.965, lumRadiance);
  const coolLow = new THREE.MeshBasicMaterial({ toneMapped: false });
  coolLow.color.setRGB(lumRadiance * 0.52, lumRadiance * 0.56, lumRadiance * 0.60);
  const warm = new THREE.MeshBasicMaterial({ toneMapped: false });
  warm.color.setRGB(lumRadiance * 0.22, lumRadiance * 0.125, lumRadiance * 0.055);

  let seed = 1337;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

  const R = 46;
  const add = (az, el, r, mat) => {
    const m = new THREE.Mesh(blobGeo, mat);
    m.position.set(
      Math.cos(az) * Math.cos(el) * R,
      Math.sin(el) * R,
      Math.sin(az) * Math.cos(el) * R,
    );
    m.scale.setScalar(r);
    s.add(m);
  };

  // Count is up (76 -> 118) while each blob is down to ~a quarter of its radius:
  // more, smaller highlights sliding over the clearcoat is the floodlit read, and
  // it costs nothing because they are all in one throw-away PMREM bake.
  // main broadcast ring — high poles, cool white
  for (let i = 0; i < 52; i++) {
    const az = (i / 52) * Math.PI * 2 + rnd() * 0.10;
    const el = THREE.MathUtils.degToRad(26 + rnd() * 22);
    add(az, el, 0.36 + rnd() * 0.34, cool);
  }
  // lower poles, slightly dimmer / cooler-grey
  for (let i = 0; i < 34; i++) {
    const az = (i / 34) * Math.PI * 2 + 0.14 + rnd() * 0.2;
    const el = THREE.MathUtils.degToRad(11 + rnd() * 11);
    add(az, el, 0.26 + rnd() * 0.26, coolLow);
  }
  // warm sodium: grandstand / paddock light close to the horizon
  for (let i = 0; i < 24; i++) {
    const az = (i / 24) * Math.PI * 2 + 0.4;
    const el = THREE.MathUtils.degToRad(2 + rnd() * 7);
    add(az, el, 0.52 + rnd() * 0.56, warm);
  }
  // a couple of very bright near-overhead clusters (main straight rig)
  for (let i = 0; i < 8; i++) {
    add(rnd() * Math.PI * 2, THREE.MathUtils.degToRad(52 + rnd() * 16), 0.48 + rnd() * 0.24, cool);
  }

  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(s, 0.012, 1, 200);
  pmrem.dispose();

  s.traverse((o) => { o.geometry?.dispose?.(); if (o.material && o.material !== cool && o.material !== coolLow && o.material !== warm) o.material.dispose?.(); });
  cool.dispose(); coolLow.dispose(); warm.dispose();

  return rt.texture;
}
