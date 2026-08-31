/**
 * Airborne sand: volumetric cones + luminaire halos. Owner: RENDER.
 *
 * Bahrain's desert air is dusty enough that every pole throws a visible cone. Real
 * volumetrics are out of budget, so instead we find the emissive luminaire bodies the
 * ENVIRONMENT module placed (by scanning the scene — we never touch their objects) and
 * hang two instanced, additive proxies off each:
 *   - an open cone whose alpha follows |N.V|, so the shell is dense through the middle
 *     and vanishes at the silhouette. That reads as a light shaft, not a cone of plastic.
 *   - a camera-facing halo disc for the near-source scattering glow that bloom alone
 *     cannot produce (bloom is grey and symmetric; real halos are tinted and tight).
 * Two extra draw calls total, no matter how many poles exist.
 */
import * as THREE from 'three';

const CONE_VERT = /* glsl */`
varying vec3 vN;
varying vec3 vV;
varying float vH;
varying float vFade;
uniform float uFar;
void main() {
  vec4 local = instanceMatrix * vec4( position, 1.0 );
  vec4 world = modelMatrix * local;
  vec4 mv = viewMatrix * world;
  vH = uv.y;
  vN = normalize( mat3( modelMatrix ) * mat3( instanceMatrix ) * normal );
  vV = normalize( cameraPosition - world.xyz );
  float d = length( cameraPosition - world.xyz );
  vFade = 1.0 - smoothstep( uFar * 0.45, uFar, d );
  gl_Position = projectionMatrix * mv;
}`;

const CONE_FRAG = /* glsl */`
varying vec3 vN;
varying vec3 vV;
varying float vH;
varying float vFade;
uniform vec3 uColor;
uniform float uIntensity;
void main() {
  float f = abs( dot( normalize( vN ), normalize( vV ) ) );
  float shell = pow( f, 1.35 );
  // uv.y: 0 at the wide bottom, 1 at the lamp
  float along = pow( clamp( vH, 0.0, 1.0 ), 2.0 );
  float a = shell * along * vFade * uIntensity;
  gl_FragColor = vec4( uColor * a, a );
}`;

const HALO_VERT = /* glsl */`
varying vec2 vP;
varying float vFade;
uniform float uFar;
uniform float uSize;
void main() {
  vP = position.xy;
  vec4 world = modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
  vec4 mv = viewMatrix * world;
  float d = -mv.z;
  vFade = smoothstep( 0.0, 25.0, d ) * ( 1.0 - smoothstep( uFar * 0.5, uFar, d ) );
  mv.xy += position.xy * uSize;
  gl_Position = projectionMatrix * mv;
}`;

const HALO_FRAG = /* glsl */`
varying vec2 vP;
varying float vFade;
uniform vec3 uColor;
uniform float uIntensity;
void main() {
  float r = length( vP ) * 2.0;
  float core = exp( -r * r * 7.0 );
  float bloom = exp( -r * 2.6 ) * 0.55;
  float a = ( core + bloom ) * vFade * uIntensity;
  gl_FragColor = vec4( uColor * a, a );
}`;

/** Find emissive luminaire heads placed by other modules. Read-only scan. */
export function findLuminaires(scene, { minY = 6, maxCount = 260 } = {}) {
  const out = [];
  const p = new THREE.Vector3();
  const m = new THREE.Matrix4();
  scene.traverse((o) => {
    if (out.length >= maxCount || !o.isMesh) return;
    if (o.name?.startsWith('render.')) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const em = mats.find((x) => x && x.emissive && (x.emissiveIntensity ?? 1) >= 1.5
      && (x.emissive.r + x.emissive.g + x.emissive.b) > 0.4);
    if (!em) return;
    if (o.isInstancedMesh) {
      for (let i = 0; i < o.count && out.length < maxCount; i++) {
        o.getMatrixAt(i, m);
        p.setFromMatrixPosition(m).applyMatrix4(o.matrixWorld);
        if (p.y >= minY) out.push({ pos: p.clone(), color: em.emissive.clone() });
      }
    } else {
      o.getWorldPosition(p);
      if (p.y >= minY) out.push({ pos: p.clone(), color: em.emissive.clone() });
    }
  });
  return out;
}

export class Atmosphere {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'render.atmosphere';
    scene.add(this.group);
    this.built = false;
    this.cones = null;
    this.halos = null;
  }

  build(lamps) {
    if (this.built || !lamps.length) return false;
    this.built = true;

    const N = lamps.length;
    const H = 30, RB = 21;

    // ---- cones -------------------------------------------------------------
    const coneGeo = new THREE.CylinderGeometry(1.6, RB, H, 14, 1, true);
    coneGeo.translate(0, -H / 2, 0);           // apex-ish at origin, opens downward
    const coneMat = new THREE.ShaderMaterial({
      vertexShader: CONE_VERT, fragmentShader: CONE_FRAG,
      uniforms: {
        uColor: { value: new THREE.Color(0.62, 0.70, 0.86) },
        // 200+ additive 30 m shells stack, and at 0.30 each they filled the upper
        // half of the frame with a milky wash that out-ran the track below it.
        uIntensity: { value: 0.15 },
        uFar: { value: 620 },
      },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide, toneMapped: false, fog: false,
    });
    const cones = new THREE.InstancedMesh(coneGeo, coneMat, N);
    cones.frustumCulled = false;
    cones.name = 'render.lightCones';
    cones.renderOrder = 12;

    // ---- halos -------------------------------------------------------------
    const haloGeo = new THREE.PlaneGeometry(1, 1);
    const haloMat = new THREE.ShaderMaterial({
      vertexShader: HALO_VERT, fragmentShader: HALO_FRAG,
      uniforms: {
        uColor: { value: new THREE.Color(1.15, 1.10, 0.98) },
        uIntensity: { value: 2.4 },
        // A tall mast's lamp cluster is a 12.4 m boom. A 14 m halo therefore
        // swallowed the fixture whole and turned every pole into a featureless
        // ball 51 px across at FWHM — one lamp spanning up to 22% of frame width
        // with nothing inside it. At 3.5 m the halo is the near-source scattering
        // glow it was meant to be and the boom, the lenses and the lattice survive.
        uSize: { value: 3.5 },
        uFar: { value: 900 },
      },
      transparent: true, depthWrite: false, depthTest: true,
      blending: THREE.AdditiveBlending, toneMapped: false, fog: false,
    });
    const halos = new THREE.InstancedMesh(haloGeo, haloMat, N);
    halos.frustumCulled = false;
    halos.name = 'render.lampHalos';
    halos.renderOrder = 13;

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    let seed = 7717;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < N; i++) {
      const p = lamps[i].pos;
      const k = 0.82 + rnd() * 0.42;
      s.set(k, 1 + rnd() * 0.35, k);
      m.compose(p, q, s);
      cones.setMatrixAt(i, m);
      s.set(1, 1, 1);
      m.compose(p, q, s);
      halos.setMatrixAt(i, m);
    }
    cones.instanceMatrix.needsUpdate = true;
    halos.instanceMatrix.needsUpdate = true;

    this.group.add(cones, halos);
    this.cones = cones; this.halos = halos;
    return true;
  }

  setEnabled(on) { this.group.visible = !!on; }

  set(params = {}) {
    if (this.cones && params.coneIntensity !== undefined) this.cones.material.uniforms.uIntensity.value = params.coneIntensity;
    if (this.halos && params.haloIntensity !== undefined) this.halos.material.uniforms.uIntensity.value = params.haloIntensity;
    if (this.halos && params.haloSize !== undefined) this.halos.material.uniforms.uSize.value = params.haloSize;
  }
}
