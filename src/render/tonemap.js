/**
 * Display transform. Owner: RENDER.
 *
 * ACES (Stephen Hill fit — same matrices three ships) plus two things the stock
 * ACESFilmicToneMapping lacks and that a floodlit night race needs:
 *   1. progressive highlight DESATURATION, so luminaires and white barriers roll into
 *      clean white instead of clipping channel-by-channel into coloured mush;
 *   2. a small print "look" (pivot contrast + saturation) so the desert stays genuinely
 *      black while the lit corridor keeps mid-tone punch.
 *
 * Exported as GLSL because the pipeline tone-maps inside its own final pass:
 * three's OutputPass has no CUSTOM_TONE_MAPPING define, so CustomToneMapping would
 * silently do nothing there.
 */

export const TONEMAP_GLSL = /* glsl */`
const mat3 F1_ACES_IN = mat3(
  vec3( 0.59719, 0.07600, 0.02840 ),
  vec3( 0.35458, 0.90834, 0.13383 ),
  vec3( 0.04823, 0.01566, 0.83777 ) );
const mat3 F1_ACES_OUT = mat3(
  vec3(  1.60475, -0.10208, -0.00327 ),
  vec3( -0.53108,  1.10813, -0.07276 ),
  vec3( -0.07367, -0.00605,  1.07602 ) );

vec3 f1RRTAndODTFit( vec3 v ) {
  vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
  vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
  return a / b;
}

// The ACES fit reaches 1.0 at an input of ~25.7 and everything above that lands on
// exactly the same flat white. A floodlit night race feeds it values far past that —
// lamp emissives are ~4 before exposure, and bloom stacks on top — so without a
// shoulder every luminaire, every white barrier and every bloom core collapses into
// one featureless clipped disc. The reference clips 0.00% of the frame; we must too.
// Below F1_KNEE nothing is touched, so the mid-tone grade of the track is unchanged.
const float F1_KNEE = 1.20;   // highlights start compressing here
const float F1_TOP  = 4.20;   // ...and asymptote here. ACES( 4.2 ) ~ 0.914, never 1.0

// linear HDR -> tone-mapped, graded, still linear-ish 0..1
vec3 f1ToneMap( vec3 color, float exposure, float contrast, float saturation ) {
  color = max( color * exposure, vec3( 0.0 ) );

  float pk = max( color.r, max( color.g, color.b ) );

  // 1. progressive desaturation, so a hot lamp rolls to clean white rather than
  //    clipping channel-by-channel into coloured mush. Engages across the range the
  //    luminaires actually occupy, not one they fly straight past.
  color = mix( color, vec3( pk ), smoothstep( 1.50, 9.0, pk ) * 0.85 );

  // 2. highlight shoulder. Hue-preserving (every channel takes the same scale), so
  //    the desaturation above still decides how white a highlight goes.
  if ( pk > F1_KNEE ) {
    float t = ( pk - F1_KNEE ) / ( F1_TOP - F1_KNEE );
    color *= ( F1_KNEE + ( F1_TOP - F1_KNEE ) * t / ( 1.0 + t ) ) / pk;
  }

  color = F1_ACES_OUT * f1RRTAndODTFit( F1_ACES_IN * color );
  color = clamp( color, 0.0, 1.0 );

  float l = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
  color = mix( vec3( l ), color, saturation );
  color = ( color - 0.20 ) * contrast + 0.20;
  return clamp( color, 0.0, 1.0 );
}

vec3 f1LinearToSRGB( vec3 c ) {
  return mix( c * 12.92, 1.055 * pow( max( c, vec3( 0.0031308 ) ), vec3( 0.41666 ) ) - 0.055,
              step( vec3( 0.0031308 ), c ) );
}
`;
