/**
 * The foil pack's shaders (WebGL 1 / GLSL ES 1.00, so every Chromebook and
 * phone that has WebGL runs them).
 *
 * Lighting is a small studio, not a physical simulation: a dim purple room,
 * two soft boxes and a top strip light reflected by the foil, plus a point
 * light that follows the pointer, and a clear lacquer on top. What sells the
 * material is that the reflections come from the surface normal, which bends
 * with the pouch's puff, its crinkles and the strip as it peels, so highlights
 * slide and break across the wrinkles as the pack moves.
 *
 * The fragment shader also cuts each part along the torn edge (by texture
 * coordinate) and paints the edge itself: the pale core of the film where it
 * tore, only where it has torn.
 */

export const VERTEX = /* glsl */ `
attribute vec3 aPos;
attribute vec3 aNrm;
attribute vec3 aTan;
attribute vec2 aUv;
uniform mat4 uModel;
uniform mat3 uNormalMat;
uniform mat4 uViewProj;
varying vec3 vPos;
varying vec3 vNrm;
varying vec3 vTan;
varying vec2 vUv;
void main() {
  vec4 wp = uModel * vec4(aPos, 1.0);
  vPos = wp.xyz;
  vNrm = uNormalMat * aNrm;
  vTan = uNormalMat * aTan;
  vUv = aUv;
  gl_Position = uViewProj * wp;
}
`;

export const FRAGMENT = /* glsl */ `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uColour;
uniform sampler2D uMaterial;
uniform sampler2D uNormal;
uniform sampler2D uSeam;
uniform float uPart;
uniform vec2 uTorn;
uniform vec2 uSeamRange;
uniform vec3 uEye;
uniform vec4 uLight;
uniform float uAlpha;
uniform float uBump;
uniform float uAspect;
uniform float uExposure;
uniform vec3 uRoom;
varying vec3 vPos;
varying vec3 vNrm;
varying vec3 vTan;
varying vec2 vUv;

float seamV(float u) { return uSeamRange.x + texture2D(uSeam, vec2(u, 0.5)).r * uSeamRange.y; }
float hash(float x) { return fract(sin(x * 127.1) * 43758.5453); }

vec3 studio(vec3 r, float rough) {
  float spread = 0.012 + rough * rough * 0.55;
  vec3 col = mix(uRoom * 0.25, uRoom * 0.9 + 0.04, smoothstep(-0.7, 0.9, r.y));
  col += vec3(1.0, 0.96, 0.9) * 1.7 * exp(-(1.0 - dot(r, normalize(vec3(-0.55, 0.6, 0.58)))) / spread);
  col += vec3(0.82, 0.88, 1.0) * 1.25 * exp(-(1.0 - dot(r, normalize(vec3(0.78, 0.08, 0.62)))) / (spread * 1.5));
  col += vec3(1.0, 0.97, 0.95) * 0.8 * exp(-(1.0 - dot(r, normalize(vec3(0.05, 0.96, 0.28)))) / (spread * 2.2));
  // A broad diffuser behind the camera, so foil facing the viewer shows its colour.
  col += vec3(0.92, 0.9, 1.0) * 0.42 * exp(-(1.0 - dot(r, normalize(vec3(0.0, 0.12, 1.0)))) / (spread * 4.0 + 0.22));
  return col;
}

void main() {
  float s = seamV(vUv.x);
  float below = vUv.y - s;
  bool torn = vUv.x >= uTorn.x && vUv.x <= uTorn.y;
  if (uPart < 0.5) { if (below < 0.0) discard; } else { if (below >= 0.0) discard; }

  vec4 tex = texture2D(uColour, vUv);
  if (tex.a < 0.004) discard;
  vec3 base = pow(tex.rgb / tex.a, vec3(2.2));
  vec3 m = texture2D(uMaterial, vUv).rgb;
  float metal = m.r;
  float rough = max(0.06, m.g);
  float coat = m.b;

  vec3 N = normalize(vNrm);
  vec3 T = normalize(vTan - N * dot(N, vTan));
  vec3 B = cross(N, T);
  vec3 nt = texture2D(uNormal, vUv).xyz * 2.0 - 1.0;
  vec3 n = normalize(T * nt.x * uBump + B * nt.y * uBump + N * nt.z);

  if (!gl_FrontFacing) {
    // The inside of the wrapper: plain silver metallised film.
    n = -n;
    base = vec3(0.6, 0.61, 0.64);
    metal = 1.0;
    rough = 0.36;
    coat = 0.0;
  }

  vec3 V = normalize(uEye - vPos);
  vec3 R = reflect(-V, n);
  float NdV = clamp(dot(n, V), 0.0, 1.0);
  vec3 L = normalize(uLight.xyz - vPos);
  vec3 H = normalize(L + V);
  float NdH = max(dot(n, H), 0.0);

  vec3 F0 = mix(vec3(0.04), min(vec3(1.0), base * 1.35 + 0.04), metal);
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - NdV, 5.0);
  float shine = mix(420.0, 10.0, rough);
  float point = pow(NdH, shine) * 0.55 + pow(NdH, shine * 0.06 + 3.0) * 0.3;
  vec3 spec = studio(R, rough) + vec3(point) * uLight.w;
  float key = max(dot(n, normalize(vec3(-0.45, 0.55, 0.7))), 0.0);
  vec3 diffuse = base * (1.0 - metal) * (0.28 + 0.62 * key + 0.35 * uLight.w * max(dot(n, L), 0.0));
  vec3 col = diffuse + F * spec;

  // Clear lacquer: crisp white reflections over everything printed.
  float Fc = 0.04 + 0.96 * pow(1.0 - NdV, 5.0);
  col += coat * (Fc * studio(R, 0.04) * 0.55 + pow(NdH, 900.0) * uLight.w * 0.9);

  // The torn edge: the film's pale core, ragged.
  if (torn) {
    float w = (0.0042 + 0.0022 * hash(floor(vUv.x * 900.0))) / uAspect;
    float e = abs(below);
    float fibre = 1.0 - smoothstep(w * 0.55, w, e);
    vec3 paper = vec3(0.9, 0.88, 0.84) * (0.55 + 0.45 * max(dot(n, L), 0.0) + 0.25 * key);
    col = mix(col, paper, fibre);
    col *= 1.0 - 0.35 * (1.0 - smoothstep(w, w * 2.6, e)) * (1.0 - fibre);
  }

  col *= uExposure;
  col = col / (1.0 + col * 0.55);
  col = pow(col, vec3(1.0 / 2.2));
  float a = tex.a * uAlpha;
  if (torn) a *= smoothstep(0.0, 0.0018, abs(below));
  gl_FragColor = vec4(col * a, a);
}
`;
