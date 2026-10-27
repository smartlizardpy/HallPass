// LAST BELL — PS1 / VHS post-processing. Owned by the main agent.
//
// The scene is rendered into a small half-float render target (chunky pixels), then a single
// full-screen pass upscales it with nearest sampling and applies: filmic tone curve, sRGB
// encode, 15-bit colour quantisation with ordered dithering on the low-res pixel grid,
// vignette, threat tint, scanlines, chromatic aberration, VHS tracking wobble, grain,
// glitch tearing, flash and fade. "Reduced effects" keeps only the calm parts.
// Redaction (seasonal extension, halloween/blood.js): postfx.redact = up to 4 screen boxes, each with an
// optional 6x6 cell mask (box.mask = [bits 0-17, bits 18-35]) so cells with something in front stay sharp
// { minX, minY, maxX, maxY, blocks? } (0..1, y up) are mosaicked like censored bodycam footage: an ellipse of
// coarse blocks aligned to each box (`blocks` tall, default 10). Empty (the default) costs nothing.
// Hold (seasonal): postfx.hold = s (at most 0.2) skips drawing so the last frame stays up: a bodycam stutter.

import * as THREE from './lib/three/three.module.js';
import { QUALITY } from './config.js';
import { PS1 } from './assets.js';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tDiffuse;
uniform vec2 uRes;
uniform vec2 uOut;
uniform float uTime;
uniform float uThreat;
uniform float uGlitch;
uniform float uFade;
uniform float uFlash;
uniform vec3 uFlashColor;
uniform float uReduced;
uniform float uExposure;
uniform float uLevels;
uniform vec4 uRedact[4];
uniform int uRedactN;
uniform vec3 uRedactK[4];   // per box: 6x6 grid of cells (bits 0-17 | 18-35); a cell is censored only when its bit is set; z: blocks tall
varying vec2 vUv;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float bayer4(vec2 p) {
  vec2 m = mod(p, 4.0);
  int i = int(m.x) + int(m.y) * 4;
  // 4x4 Bayer matrix / 16
  if (i == 0) return 0.0 / 16.0;   if (i == 1) return 8.0 / 16.0;
  if (i == 2) return 2.0 / 16.0;   if (i == 3) return 10.0 / 16.0;
  if (i == 4) return 12.0 / 16.0;  if (i == 5) return 4.0 / 16.0;
  if (i == 6) return 14.0 / 16.0;  if (i == 7) return 6.0 / 16.0;
  if (i == 8) return 3.0 / 16.0;   if (i == 9) return 11.0 / 16.0;
  if (i == 10) return 1.0 / 16.0;  if (i == 11) return 9.0 / 16.0;
  if (i == 12) return 15.0 / 16.0; if (i == 13) return 7.0 / 16.0;
  if (i == 14) return 13.0 / 16.0; return 5.0 / 16.0;
}

vec3 filmic(vec3 x) {
  // Narkowicz ACES approximation
  const float a = 2.51; const float b = 0.03; const float c = 2.43; const float d = 0.59; const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  vec2 uv = vUv;
  float fx = 1.0 - uReduced;

  // --- VHS tracking: per-line jitter, rolling band, glitch tearing ---
  float row = floor(uv.y * uRes.y);
  float t20 = floor(uTime * 24.0);
  float lineNoise = hash12(vec2(row, t20)) - 0.5;
  float roll = fract(uv.y * 0.6 - uTime * 0.045);
  float band = smoothstep(0.0, 0.035, roll) * smoothstep(0.08, 0.035, roll);
  float tear = step(0.93 - uGlitch * 0.35, hash12(vec2(floor(uv.y * 18.0), t20)));
  uv.x += fx * (lineNoise * (0.0007 + uGlitch * 0.03) + band * 0.0025 + tear * uGlitch * (hash12(vec2(t20, row)) - 0.5) * 0.12);

  // --- redaction mosaic (bodycam-style censor boxes) ---
  float redacted = 0.0;
  float rblk = 0.0;
  vec2 rcuv = uv;
  for (int i = 0; i < 4; i++) {
    if (i >= uRedactN) break;
    vec4 b = uRedact[i];
    vec2 size = max(b.zw - b.xy, vec2(1e-4));
    vec3 kk = uRedactK[i];
    float blk = max(2.0, size.y * uRes.y / max(kk.z, 4.0)); // about 10 blocks tall (heads finer), in low-res pixels
    vec2 cell = floor((uv - b.xy) * uRes / blk);
    vec2 cuv = b.xy + (cell + 0.5) * blk / uRes;
    vec2 e = (cuv - (b.xy + b.zw) * 0.5) / (size * 0.5);
    if (dot(e, e) <= 1.0 && all(greaterThanEqual(uv, b.xy - blk / uRes)) && all(lessThanEqual(uv, b.zw + blk / uRes))) {
      // the mask cells this block overlaps: censored if any of them shows the surface (the safe side);
      // a block wholly over something standing in front of it (lockers, a door frame) stays sharp
      vec2 hb = vec2(blk) / uRes * 0.5;
      vec2 m0 = floor(clamp((cuv - hb - b.xy) / size, 0.0, 0.999) * 6.0);
      vec2 m1 = floor(clamp((cuv + hb - b.xy) / size, 0.0, 0.999) * 6.0);
      vec2 k = kk.xy;
      float on = 0.0;
      for (int yy = 0; yy < 6; yy++) {
        for (int xx = 0; xx < 6; xx++) {
          if (float(xx) < m0.x || float(xx) > m1.x || float(yy) < m0.y || float(yy) > m1.y) continue;
          float idx = float(yy) * 6.0 + float(xx);
          float word = idx < 18.0 ? k.x : k.y;
          on = max(on, mod(floor(word / exp2(mod(idx, 18.0))), 2.0));
        }
      }
      if (on > 0.5) {
        rcuv = cuv;
        rblk = blk;
        redacted = 1.0;
      }
    }
  }

  // --- chromatic aberration (or, inside a censor box, the block's averaged colour) ---
  float ca = fx * (0.0009 + uThreat * 0.0025 + uGlitch * 0.012);
  vec3 col;
  if (redacted > 0.5) {
    // 3x3 samples, weighted towards the reddest: a block with any blood in it reads as blood, so censored gore
    // is a red mosaic (the playtest: a plain average turned big blood into a beige block that read as a glitch)
    vec2 o = vec2(rblk) / uRes * 0.33;
    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    for (int yy = -1; yy <= 1; yy++) {
      for (int xx = -1; xx <= 1; xx++) {
        vec3 c = texture2D(tDiffuse, rcuv + vec2(float(xx) * o.x, float(yy) * o.y)).rgb;
        float red = max(0.0, c.r - max(c.g, c.b) - 0.03);
        float w = 1.0 + 40.0 * red;
        acc += c * w;
        wsum += w;
      }
    }
    col = acc / wsum;
    uv = rcuv;
  } else {
    col.r = texture2D(tDiffuse, uv + vec2(ca, 0.0)).r;
    col.g = texture2D(tDiffuse, uv).g;
    col.b = texture2D(tDiffuse, uv - vec2(ca, 0.0)).b;
  }

  // --- tone + encode ---
  col = filmic(col * uExposure);
  col = toSRGB(col);

  // --- PS1 colour depth: ordered dither on the low-res grid ---
  vec2 px = floor(uv * uRes);
  float d = bayer4(px) - 0.5;
  col = clamp(floor(col * uLevels + 0.5 + d) / uLevels, 0.0, 1.0);

  // --- vignette & threat ---
  vec2 q = vUv - 0.5;
  float r = length(q * vec2(1.15, 1.0));
  float vig = smoothstep(0.82, 0.22, r);
  col *= mix(1.0, vig, 0.5 + uThreat * 0.35);
  float pulse = 0.65 + 0.35 * sin(uTime * (3.0 + uThreat * 6.0));
  float edge = smoothstep(0.25, 0.75, r) * uThreat * pulse;
  col = mix(col, col * vec3(1.25, 0.35, 0.35) + vec3(0.09, 0.0, 0.01), edge * 0.85);

  // --- scanlines + grain (output resolution) ---
  float scan = 0.5 + 0.5 * sin(vUv.y * uOut.y * 3.14159);
  col *= 1.0 - fx * 0.13 * (1.0 - scan);
  float g = hash12(vUv * uOut + fract(uTime) * 917.0) - 0.5;
  col += fx * g * (0.035 + uGlitch * 0.12 + uThreat * 0.03);
  col += fx * band * 0.015;

  // --- flash & fade ---
  col = mix(col, uFlashColor, clamp(uFlash, 0.0, 1.0));
  col *= 1.0 - clamp(uFade, 0.0, 1.0);

  gl_FragColor = vec4(col, 1.0);
}`;

export class PostFX {
  constructor(renderer) {
    this.renderer = renderer;
    this.quality = 'medium';
    this.reduced = false;
    this.threat = 0;
    this.glitch = 0;
    this.fade = 0;
    this.flash = 0;
    this.flashDecay = 2.5;
    this.exposure = 1.0;
    this.redact = null; // seasonal: censor boxes (see header)
    this.hold = 0; // seasonal: s to keep the last frame on screen (a bodycam stutter on a scare); never with reduced effects
    this.internal = new THREE.Vector2(640, 360);
    this.out = new THREE.Vector2(1280, 720);

    this.target = new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      generateMipmaps: false,
    });

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tDiffuse: { value: this.target.texture },
        uRes: { value: this.internal },
        uOut: { value: this.out },
        uTime: { value: 0 },
        uThreat: { value: 0 },
        uGlitch: { value: 0 },
        uFade: { value: 0 },
        uFlash: { value: 0 },
        uFlashColor: { value: new THREE.Color(1, 1, 1) },
        uReduced: { value: 0 },
        uExposure: { value: this.exposure },
        uLevels: { value: 31 },
        uRedact: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
        uRedactN: { value: 0 },
        uRedactK: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
      },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.postScene = new THREE.Scene();
    this.postScene.add(this.quad);
    this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.time = 0;
  }

  setQuality(key) {
    this.quality = QUALITY[key] ? key : 'medium';
    this.setSize(this.out.x, this.out.y);
  }

  setReduced(reduced) {
    this.reduced = !!reduced;
    this.material.uniforms.uReduced.value = this.reduced ? 1 : 0;
    this._updateSnap();
  }

  setSize(width, height) {
    const q = QUALITY[this.quality];
    this.out.set(Math.max(1, width), Math.max(1, height));
    const h = Math.max(180, Math.min(q.maxPixelHeight, Math.round(height * q.renderScale)));
    const w = Math.max(240, Math.round(h * (width / Math.max(1, height))));
    this.internal.set(w, h);
    this.target.setSize(w, h);
    this._updateSnap();
  }

  _updateSnap() {
    // ~2 internal pixels of wobble; disabled with reduced effects
    PS1.setSnap(!this.reduced, this.internal.x / 2.2, this.internal.y / 2.2);
  }

  /** Short screen events. */
  pulseGlitch(amount = 1) {
    if (this.reduced) amount *= 0.25;
    this.glitch = Math.max(this.glitch, amount);
  }

  doFlash(amount = 0.6, color = 0xffffff, decay = 2.5) {
    if (this.reduced) amount *= 0.5;
    this.flash = Math.max(this.flash, amount);
    this.material.uniforms.uFlashColor.value.set(color);
    this.flashDecay = decay;
  }

  render(scene, camera, dt) {
    this.time += dt;
    if (this.hold > 0) {
      // the canvas keeps showing the last frame while nothing is drawn
      this.hold = this.reduced ? 0 : Math.min(this.hold, 0.2) - dt;
      if (this.hold > 0) return;
    }
    this.glitch = Math.max(0, this.glitch - dt * 1.6);
    this.flash = Math.max(0, this.flash - dt * this.flashDecay);
    const u = this.material.uniforms;
    u.uTime.value = this.time;
    u.uThreat.value = this.reduced ? this.threat * 0.5 : this.threat;
    u.uGlitch.value = this.glitch;
    u.uFade.value = this.fade;
    u.uFlash.value = this.flash;
    u.uExposure.value = this.exposure;
    const rd = this.redact;
    const rn = rd ? Math.min(4, rd.length) : 0;
    for (let i = 0; i < rn; i++) {
      u.uRedact.value[i].set(rd[i].minX, rd[i].minY, rd[i].maxX, rd[i].maxY);
      const k = rd[i].mask; // [bits 0-17, bits 18-35]; none = every cell
      u.uRedactK.value[i].set(k ? k[0] : 262143, k ? k[1] : 262143, rd[i].blocks || 10);
    }
    u.uRedactN.value = rn;

    const r = this.renderer;
    r.setRenderTarget(this.target);
    r.clear();
    r.render(scene, camera);
    r.setRenderTarget(null);
    r.render(this.postScene, this.postCamera);
  }

  dispose() {
    this.target.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}
