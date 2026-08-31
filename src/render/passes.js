/**
 * Custom post passes. Owner: RENDER.
 *   MotionBlurShader — depth-reprojection camera blur + speed-driven radial blur.
 *   FinalShader      — tonemap + grade + chromatic aberration + sharpen + vignette + grain.
 * Both are plain ShaderPass shaders so CONFIG.quality can drop either out of the chain.
 */
import * as THREE from 'three';
import { TONEMAP_GLSL } from './tonemap.js';

const QUAD_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`;

/* ------------------------------------------------------------ motion blur --- */
/**
 * Reconstructs each pixel's world position from depth and reprojects it with the
 * previous frame's view-projection, giving a per-pixel screen velocity. At 300 km/h
 * that is the single biggest "this is a real racing game" cue.
 *
 * uRotBlend deliberately damps the ROTATION part of the camera delta. Full rotational
 * blur smears the car itself (whose true screen velocity is ~0 in a chase camera,
 * because the camera follows it) — the classic reprojection artefact. Damping it keeps
 * the car crisp while the world still streaks past correctly.
 */
export const MotionBlurShader = {
  name: 'F1MotionBlur',
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    uInvViewProj: { value: new THREE.Matrix4() },
    uPrevViewProj: { value: new THREE.Matrix4() },
    uStrength: { value: 1.0 },
    uMaxBlur: { value: 0.038 },
    uRadial: { value: 0.0 },
    uSamples: { value: 9 },
  },
  vertexShader: QUAD_VERT,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform mat4 uInvViewProj;
    uniform mat4 uPrevViewProj;
    uniform float uStrength;
    uniform float uMaxBlur;
    uniform float uRadial;
    uniform int uSamples;
    varying vec2 vUv;

    void main() {
      float d = texture2D( tDepth, vUv ).x;
      float dc = min( d, 0.99995 );

      vec4 clip = vec4( vUv * 2.0 - 1.0, dc * 2.0 - 1.0, 1.0 );
      vec4 wp = uInvViewProj * clip;
      wp.xyz /= ( abs( wp.w ) < 1e-6 ? 1e-6 : wp.w );

      vec4 pc = uPrevViewProj * vec4( wp.xyz, 1.0 );
      vec2 prevUv = ( pc.xy / max( pc.w, 1e-6 ) ) * 0.5 + 0.5;

      vec2 vel = ( vUv - prevUv ) * uStrength;
      if ( pc.w <= 0.0 ) vel = vec2( 0.0 );

      // speed-driven radial streak at the frame edges
      vec2 rad = vUv - 0.5;
      vel += rad * uRadial * smoothstep( 0.02, 0.32, dot( rad, rad ) );

      float len = length( vel );
      if ( len > uMaxBlur ) vel *= uMaxBlur / len;
      if ( len < 0.0006 ) { gl_FragColor = texture2D( tDiffuse, vUv ); return; }

      vec4 sum = vec4( 0.0 );
      float wsum = 0.0;
      for ( int i = 0; i < 16; i ++ ) {
        if ( i >= uSamples ) break;
        float t = float( i ) / float( uSamples - 1 ) - 0.5;
        float w = 1.0 - abs( t ) * 0.55;
        sum += texture2D( tDiffuse, clamp( vUv + vel * t, vec2( 0.001 ), vec2( 0.999 ) ) ) * w;
        wsum += w;
      }
      gl_FragColor = sum / wsum;
    }`,
};

/* ------------------------------------------------------------- final pass --- */
export const FinalShader = {
  name: 'F1Final',
  uniforms: {
    tDiffuse: { value: null },
    uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
    uExposure: { value: 9.0 },
    uContrast: { value: 1.06 },
    uSaturation: { value: 1.10 },
    uCA: { value: 0.85 },
    uSharpen: { value: 0.42 },
    uGrain: { value: 0.030 },
    uVignette: { value: 0.30 },
    uTime: { value: 0 },
  },
  vertexShader: QUAD_VERT,
  fragmentShader: /* glsl */`
    ${TONEMAP_GLSL}
    uniform sampler2D tDiffuse;
    uniform vec2 uTexel;
    uniform float uExposure, uContrast, uSaturation;
    uniform float uCA, uSharpen, uGrain, uVignette, uTime;
    varying vec2 vUv;

    vec3 grade( vec2 uv ) {
      return f1ToneMap( texture2D( tDiffuse, uv ).rgb, uExposure, uContrast, uSaturation );
    }

    float hash12( vec2 p ) {
      vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
      p3 += dot( p3, p3.yzx + 33.33 );
      return fract( ( p3.x + p3.y ) * p3.z );
    }

    void main() {
      vec2 d = vUv - 0.5;
      float r2 = dot( d, d );

      vec3 col = grade( vUv );

      // Photo-mode only: the reference has NO chromatic aberration in gameplay,
      // so uCA ships at 0 and this branch is dead weight until a photo mode wants it.
      if ( uCA > 0.001 ) {
        vec2 off = d * uCA * r2 * uTexel.x * 12.0;
        col.r = grade( vUv + off ).r;
        col.b = grade( vUv - off ).b;
      }

      // unsharp mask
      if ( uSharpen > 0.001 ) {
        vec3 n = grade( vUv + vec2( uTexel.x, 0.0 ) ) + grade( vUv - vec2( uTexel.x, 0.0 ) )
               + grade( vUv + vec2( 0.0, uTexel.y ) ) + grade( vUv - vec2( 0.0, uTexel.y ) );
        col += ( col - n * 0.25 ) * uSharpen;
        col = max( col, vec3( 0.0 ) );
      }

      vec3 srgb = f1LinearToSRGB( clamp( col, 0.0, 1.0 ) );

      // vignette
      srgb *= 1.0 - uVignette * smoothstep( 0.10, 0.80, r2 );

      // film grain — heavier in the shadows, as on a real sensor
      if ( uGrain > 0.0001 ) {
        float g = hash12( vUv * vec2( 1927.0, 1093.0 ) + fract( uTime ) * 137.0 ) - 0.5;
        float lum = dot( srgb, vec3( 0.2126, 0.7152, 0.0722 ) );
        srgb += g * uGrain * mix( 1.35, 0.28, smoothstep( 0.0, 0.6, lum ) );
      }

      gl_FragColor = vec4( clamp( srgb, 0.0, 1.0 ), 1.0 );
    }`,
};
