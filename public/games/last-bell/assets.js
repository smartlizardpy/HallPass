// LAST BELL — shared asset loading + PS1 material treatment. Owned by the main agent.
//
//   import { loadGLB, cloneGLB, ps1ify, preloadGLBs, PS1 } from './assets.js';
//
//   const gltf = await loadGLB('assets/environment/desk.glb'); // cached per URL
//   const copy = cloneGLB(gltf.scene);                          // skinning-safe deep clone
//   ps1ify(copy);   // Lambert materials, nearest-filtered textures, vertex snapping
//
// ps1ify() keeps shared materials shared (one converted material per source material),
// so instancing / draw-call batching still works after conversion.

import {
  LoadingManager,
  MeshLambertMaterial,
  NearestFilter,
  NearestMipmapLinearFilter,
  SRGBColorSpace,
  Vector2,
} from './lib/three/three.module.js';
import { GLTFLoader } from './lib/three/addons/loaders/GLTFLoader.js';
import { clone as skeletonClone } from './lib/three/addons/utils/SkeletonUtils.js';

export const loadingManager = new LoadingManager();
const loader = new GLTFLoader(loadingManager);
const cache = new Map(); // url -> Promise<gltf>

/** Load a GLB/glTF once; later calls with the same URL return the same promise. */
export function loadGLB(url) {
  if (!cache.has(url)) {
    cache.set(
      url,
      new Promise((resolve, reject) => {
        loader.load(url, resolve, undefined, (err) => {
          cache.delete(url);
          reject(new Error(`Failed to load ${url}: ${err?.message || err}`));
        });
      }),
    );
  }
  return cache.get(url);
}

/** Load several GLBs in parallel. onProgress(loaded, total) is called as each finishes. */
export async function preloadGLBs(urls, onProgress) {
  let done = 0;
  const results = await Promise.allSettled(
    urls.map((u) =>
      loadGLB(u).finally(() => {
        done++;
        onProgress?.(done, urls.length, u);
      }),
    ),
  );
  const failed = results
    .map((r, i) => (r.status === 'rejected' ? urls[i] : null))
    .filter(Boolean);
  if (failed.length) console.warn('[assets] failed to load:', failed);
  return results;
}

/** Deep clone that rebinds skeletons (safe for SkinnedMesh). */
export function cloneGLB(root) {
  return skeletonClone(root);
}

// ---------------------------------------------------------------------------
// PS1 look: shared uniforms driven by game.js (snap grid follows render size).
// ---------------------------------------------------------------------------
export const PS1 = {
  uniforms: {
    uSnapRes: { value: new Vector2(320, 180) },
    uSnapOn: { value: 1 },
  },
  setSnap(enabled, width, height) {
    this.uniforms.uSnapOn.value = enabled ? 1 : 0;
    if (width && height) this.uniforms.uSnapRes.value.set(width, height);
  },
};

const converted = new WeakMap(); // source material -> converted material
const treatedTextures = new WeakSet();

function treatTexture(tex, isColor) {
  if (!tex || treatedTextures.has(tex)) return;
  treatedTextures.add(tex);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestMipmapLinearFilter;
  tex.anisotropy = 1;
  if (isColor) tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
}

/** Inject screen-space vertex snapping ("PS1 wobble") into any built-in material. */
export function addVertexSnap(material) {
  if (material.userData.__ps1snap) return material;
  material.userData.__ps1snap = true;
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  material.onBeforeCompile = function (shader, renderer) {
    if (prev) prev.call(this, shader, renderer);
    shader.uniforms.uSnapRes = PS1.uniforms.uSnapRes;
    shader.uniforms.uSnapOn = PS1.uniforms.uSnapOn;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec2 uSnapRes;\nuniform float uSnapOn;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        if (uSnapOn > 0.5 && gl_Position.w > 0.0) {
          vec4 sp = gl_Position;
          sp.xy = floor(sp.xy / sp.w * uSnapRes + 0.5) / uSnapRes * sp.w;
          gl_Position = sp;
        }`,
      );
  };
  material.customProgramCacheKey = function () {
    return (prevKey ? prevKey.call(this) : '') + '|ps1snap';
  };
  material.needsUpdate = true;
  return material;
}

function convertMaterial(m, opts) {
  if (converted.has(m)) return converted.get(m);
  let out = m;
  if (opts.lambert && (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial || m.isMeshPhongMaterial)) {
    out = new MeshLambertMaterial({
      name: m.name,
      color: m.color.clone(),
      map: m.map,
      emissive: m.emissive ? m.emissive.clone() : undefined,
      emissiveMap: m.emissiveMap,
      emissiveIntensity: m.emissiveIntensity ?? 1,
      aoMap: m.aoMap,
      aoMapIntensity: m.aoMapIntensity ?? 1,
      lightMap: m.lightMap,
      alphaMap: m.alphaMap,
      vertexColors: m.vertexColors,
      transparent: m.transparent,
      opacity: m.opacity,
      alphaTest: m.alphaTest,
      side: m.side,
      depthWrite: m.depthWrite,
      fog: true,
      flatShading: !!opts.flatShading,
    });
    out.userData = { ...m.userData };
  }
  treatTexture(out.map, true);
  treatTexture(out.emissiveMap, true);
  treatTexture(out.aoMap, false);
  treatTexture(out.lightMap, false);
  treatTexture(out.alphaMap, false);
  if (opts.snap) addVertexSnap(out);
  converted.set(m, out);
  return out;
}

/**
 * Convert every mesh material under `root` to the house PS1 style.
 * opts.lambert (default true): Standard/Physical -> Lambert (much cheaper on Chromebooks).
 * opts.snap (default true): vertex snapping (toggled globally via PS1.setSnap).
 * opts.shadows: { cast, receive } booleans applied to meshes (default false/false).
 */
export function ps1ify(root, opts = {}) {
  const o = { lambert: true, snap: true, flatShading: false, ...opts };
  root.traverse((obj) => {
    if (!obj.isMesh && !obj.isSkinnedMesh) return;
    if (Array.isArray(obj.material)) obj.material = obj.material.map((m) => convertMaterial(m, o));
    else if (obj.material) obj.material = convertMaterial(obj.material, o);
    if (o.shadows) {
      obj.castShadow = !!o.shadows.cast;
      obj.receiveShadow = !!o.shadows.receive;
    }
  });
  return root;
}
