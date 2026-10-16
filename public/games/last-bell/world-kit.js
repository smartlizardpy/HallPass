// LAST BELL - environment kit loading + static geometry batching. Owned by S1 (World).
//
// Kit GLBs contain many uniquely named nodes (see world.js header). Each node is reduced to "parts"
// (geometry arrays + converted PS1 material). Static level geometry is merged per material per
// spatial chunk (few draw calls, frustum culling per chunk, cheap partial rebuilds on transforms).
import * as THREE from './lib/three/three.module.js';
import { loadGLB, ps1ify, addVertexSnap } from './assets.js';

export const KIT_URLS = ['assets/environment/school_kit.glb', 'assets/environment/props_kit.glb'];

const _m = new THREE.Matrix4();
const _mi = new THREE.Matrix4();

export class Kit {
  constructor() {
    this.nodes = new Map(); // name -> { name, parts: [...], bbox: Box3, root: Object3D }
    this.materials = new Map(); // name -> material (converted)
    this.loaded = false;
  }

  async load(onProgress, base = '') {
    if (this.loaded) return;
    let done = 0;
    const gltfs = await Promise.all(
      KIT_URLS.map((u) =>
        loadGLB(base + u).then((g) => {
          done++;
          onProgress?.(done / KIT_URLS.length, u);
          return g;
        }),
      ),
    );
    for (const gltf of gltfs) {
      const root = gltf.scene;
      ps1ify(root);
      root.updateMatrixWorld(true);
      for (const node of root.children) {
        const parts = [];
        _mi.copy(node.matrixWorld).invert();
        const bbox = new THREE.Box3();
        node.traverse((o) => {
          if (!o.isMesh) return;
          const rel = new THREE.Matrix4().multiplyMatrices(_mi, o.matrixWorld);
          const part = this._part(o, rel);
          parts.push(part);
          bbox.union(part.bbox);
        });
        this.nodes.set(node.name, { name: node.name, parts, bbox, object: node });
      }
    }
    this._setupMaterials();
    this.loaded = true;
  }

  _part(mesh, rel) {
    const g = mesh.geometry;
    const pos = g.attributes.position;
    const n = pos.count;
    const P = new Float32Array(n * 3);
    const N = new Float32Array(n * 3);
    const U = new Float32Array(n * 2);
    const C = new Float32Array(n * 3);
    const v = new THREE.Vector3();
    const nm = new THREE.Matrix3().getNormalMatrix(rel);
    const identity = rel.equals(new THREE.Matrix4());
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, i);
      if (!identity) v.applyMatrix4(rel);
      P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z;
      if (g.attributes.normal) {
        v.fromBufferAttribute(g.attributes.normal, i);
        if (!identity) v.applyMatrix3(nm).normalize();
        N[i * 3] = v.x; N[i * 3 + 1] = v.y; N[i * 3 + 2] = v.z;
      } else N[i * 3 + 1] = 1;
      if (g.attributes.uv) {
        U[i * 2] = g.attributes.uv.getX(i);
        U[i * 2 + 1] = g.attributes.uv.getY(i);
      }
      if (g.attributes.color) {
        C[i * 3] = g.attributes.color.getX(i);
        C[i * 3 + 1] = g.attributes.color.getY(i);
        C[i * 3 + 2] = g.attributes.color.getZ(i);
      } else {
        C[i * 3] = C[i * 3 + 1] = C[i * 3 + 2] = 1;
      }
    }
    let I;
    if (g.index) I = Uint32Array.from(g.index.array);
    else I = Uint32Array.from({ length: n }, (_, i) => i);
    const bbox = new THREE.Box3().setFromArray(P);
    let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
    for (let i = 0; i < n; i++) {
      u0 = Math.min(u0, U[i * 2]); u1 = Math.max(u1, U[i * 2]);
      v0 = Math.min(v0, U[i * 2 + 1]); v1 = Math.max(v1, U[i * 2 + 1]);
    }
    // both kits embed their own copy of shared materials (m_palette, m_wood, ...): unify by name so
    // merged geometry from either kit lands in the same draw call
    let material = this.materials.get(mesh.material.name);
    if (!material) {
      material = mesh.material;
      this.materials.set(material.name, material);
    } else if (material !== mesh.material) {
      mesh.material = material;
    }
    return { P, N, U, C, I, count: n, material, matName: material.name, bbox, uvBox: [u0, v0, u1, v1], geometry: g, rel, identity };
  }

  _setupMaterials() {
    for (const [name, m] of this.materials) {
      if (name === 'm_scuffs') {
        m.alphaTest = 0.5;
        m.transparent = false;
        m.polygonOffset = true;
        m.polygonOffsetFactor = -2;
        m.polygonOffsetUnits = -4;
        m.needsUpdate = true;
      }
      if (name === 'm_wire' || name === 'm_fence') {
        m.alphaTest = 0.5;
        m.transparent = false;
        m.side = THREE.DoubleSide;
        m.needsUpdate = true;
      }
      if (name === 'm_glass_night') {
        m.emissiveIntensity = 0.85;
      }
      if (name === 'm_exit_sign') m.emissiveIntensity = 1.4;
      if (name === 'm_crt') m.emissiveIntensity = 0.7;
      if (name === 'm_red_bulb') m.emissiveIntensity = 2.0;
      if (name === 'm_void') {
        m.color.setRGB(0, 0, 0);
      }
    }
    // Unlit panel material for the instanced fluorescent diffusers (per-instance brightness via instanceColor)
    const src = this.materials.get('m_light_panel');
    this.panelMaterial = new THREE.MeshBasicMaterial({ name: 'm_light_panel_inst', map: src ? src.emissiveMap || src.map : null, color: 0xffffff, fog: true });
    addVertexSnap(this.panelMaterial);
    const cb = this.materials.get('m_chalkboard');
    this.chalkImage = cb && cb.map ? cb.map.image : null;
  }

  has(name) { return this.nodes.has(name); }
  get(name) {
    const n = this.nodes.get(name);
    if (!n) throw new Error('[world] kit node missing: ' + name);
    return n;
  }
  bbox(name) { return this.get(name).bbox; }

  /** Standalone (non-merged) object for dynamic things (doors, hide-spot doors). Shares geometry + material. */
  makeObject(name, materialOverride = null) {
    const node = this.get(name);
    if (node.parts.length === 1 && node.parts[0].identity) {
      const p = node.parts[0];
      const mesh = new THREE.Mesh(p.geometry, materialOverride || p.material);
      mesh.name = name;
      return mesh;
    }
    const g = new THREE.Group();
    g.name = name;
    for (const p of node.parts) {
      const mesh = new THREE.Mesh(p.geometry, materialOverride || p.material);
      if (!p.identity) mesh.applyMatrix4(p.rel);
      g.add(mesh);
    }
    return g;
  }
}

// ------------------------------------------------------------------------------------------- batching

/**
 * Placement = { node, m: Matrix4, tint?: [r,g,b], uvTo?: [u0,v0,u1,v1] (remaps parts using material m_signs or m_posters) }
 * Placements are grouped by owner key (room / edge / vertex ...) so transforms can swap them.
 */
export class StaticBatcher {
  constructor(kit, parent, chunkSize = 20) {
    this.kit = kit;
    this.parent = parent;
    this.chunkSize = chunkSize;
    this.owners = new Map(); // owner -> placements[]
    this.chunkOwners = new Map(); // chunkKey -> Set(owner)
    this.chunkMeshes = new Map(); // chunkKey -> Mesh[]
    this.dirty = new Set();
    this.stats = { meshes: 0, vertices: 0, triangles: 0 };
  }

  _chunkOf(pl, layer) {
    if (!this.chunkSize) return layer;
    const e = pl.m.elements;
    return layer + ':' + Math.floor(e[12] / this.chunkSize) + ',' + Math.floor(e[14] / this.chunkSize);
  }

  /** layer: placements in different layers never share a merged mesh ('S' = never changes, 'D' = dynamic). */
  setOwner(owner, placements, layer = 'D') {
    this.removeOwner(owner);
    if (!placements || !placements.length) return;
    this.owners.set(owner, placements);
    for (const pl of placements) {
      const k = (pl._chunk = this._chunkOf(pl, layer));
      let s = this.chunkOwners.get(k);
      if (!s) this.chunkOwners.set(k, (s = new Set()));
      s.add(owner);
      this.dirty.add(k);
    }
  }

  removeOwner(owner) {
    const old = this.owners.get(owner);
    if (!old) return;
    for (const pl of old) {
      this.dirty.add(pl._chunk);
      const s = this.chunkOwners.get(pl._chunk);
      if (s) s.delete(owner);
    }
    this.owners.delete(owner);
  }

  getOwner(owner) { return this.owners.get(owner) || null; }

  flush() {
    for (const k of this.dirty) this._rebuildChunk(k);
    const n = this.dirty.size;
    this.dirty.clear();
    return n;
  }

  _rebuildChunk(key) {
    const old = this.chunkMeshes.get(key);
    if (old) {
      for (const m of old) {
        this.parent.remove(m);
        m.geometry.dispose();
      }
      this.chunkMeshes.delete(key);
    }
    const owners = this.chunkOwners.get(key);
    if (!owners || !owners.size) return;
    // pass 1: count per material
    const buckets = new Map(); // material -> {verts, idx, items: [[part, pl]]}
    for (const owner of owners) {
      const pls = this.owners.get(owner);
      if (!pls) continue;
      for (const pl of pls) {
        if (pl._chunk !== key) continue;
        const node = this.kit.get(pl.node);
        for (const part of node.parts) {
          let b = buckets.get(part.material);
          if (!b) buckets.set(part.material, (b = { verts: 0, idx: 0, items: [] }));
          b.verts += part.count;
          b.idx += part.I.length;
          b.items.push(part, pl);
        }
      }
    }
    const meshes = [];
    for (const [material, b] of buckets) {
      const P = new Float32Array(b.verts * 3);
      const N = new Float32Array(b.verts * 3);
      const U = new Float32Array(b.verts * 2);
      const C = new Float32Array(b.verts * 3);
      const I = b.verts > 65535 ? new Uint32Array(b.idx) : new Uint16Array(b.idx);
      let vo = 0;
      let io = 0;
      for (let k = 0; k < b.items.length; k += 2) {
        const part = b.items[k];
        const pl = b.items[k + 1];
        const e = pl.m.elements;
        const tr = pl.tint ? pl.tint[0] : 1, tg = pl.tint ? pl.tint[1] : 1, tb = pl.tint ? pl.tint[2] : 1;
        let remap = null;
        if (pl.uvTo && (part.matName === 'm_signs' || part.matName === 'm_posters')) remap = [part.uvBox, pl.uvTo];
        const n = part.count;
        const p = part.P, nn = part.N, uu = part.U, cc = part.C;
        for (let i = 0; i < n; i++) {
          const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
          const o = (vo + i) * 3;
          P[o] = e[0] * x + e[4] * y + e[8] * z + e[12];
          P[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
          P[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
          const a = nn[i * 3], bb = nn[i * 3 + 1], c = nn[i * 3 + 2];
          let nx = e[0] * a + e[4] * bb + e[8] * c;
          let ny = e[1] * a + e[5] * bb + e[9] * c;
          let nz = e[2] * a + e[6] * bb + e[10] * c;
          const l = 1 / (Math.hypot(nx, ny, nz) || 1);
          N[o] = nx * l; N[o + 1] = ny * l; N[o + 2] = nz * l;
          C[o] = cc[i * 3] * tr; C[o + 1] = cc[i * 3 + 1] * tg; C[o + 2] = cc[i * 3 + 2] * tb;
          let u = uu[i * 2], v = uu[i * 2 + 1];
          if (remap) {
            const [f, t] = remap;
            u = t[0] + ((u - f[0]) / (f[2] - f[0] || 1)) * (t[2] - t[0]);
            v = t[1] + ((v - f[1]) / (f[3] - f[1] || 1)) * (t[3] - t[1]);
          }
          U[(vo + i) * 2] = u;
          U[(vo + i) * 2 + 1] = v;
        }
        const src = part.I;
        for (let i = 0; i < src.length; i++) I[io + i] = src[i] + vo;
        vo += n;
        io += src.length;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(U, 2));
      geo.setAttribute('color', new THREE.BufferAttribute(C, 3));
      geo.setIndex(new THREE.BufferAttribute(I, 1));
      geo.computeBoundingSphere();
      geo.computeBoundingBox();
      const mesh = new THREE.Mesh(geo, material);
      mesh.name = 'static:' + key + ':' + material.name;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.parent.add(mesh);
      meshes.push(mesh);
    }
    this.chunkMeshes.set(key, meshes);
  }

  computeStats() {
    let meshes = 0, vertices = 0, triangles = 0;
    for (const ms of this.chunkMeshes.values()) {
      for (const m of ms) {
        meshes++;
        vertices += m.geometry.attributes.position.count;
        triangles += m.geometry.index.count / 3;
      }
    }
    this.stats = { meshes, vertices, triangles };
    return this.stats;
  }

  dispose() {
    for (const ms of this.chunkMeshes.values()) {
      for (const m of ms) {
        this.parent.remove(m);
        m.geometry.dispose();
      }
    }
    this.chunkMeshes.clear();
    this.owners.clear();
    this.chunkOwners.clear();
    this.dirty.clear();
  }
}

// ------------------------------------------------------------------------------------------- helpers

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3(1, 1, 1);
const _p = new THREE.Vector3();

/** Matrix for a kit node at (x,y,z) with yaw rotY (+ optional pitch/roll applied in local space). */
export function placeMatrix(x, y, z, rotY, rx = 0, rz = 0, scale = 1) {
  _e.set(rx, rotY, rz, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(scale, scale, scale);
  return new THREE.Matrix4().compose(_p, _q, _s);
}
