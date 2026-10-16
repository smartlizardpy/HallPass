// LAST BELL — collectibles (S3). Implements CONTRACTS.md §9.
//
//   const items = new Items(game);  // adds items.group (+ one shared pulse light) to game.scene
//   await items.load();             // assets/items/{keycard,fuse,key}.glb (procedural fallback on failure)
//   items.spawn(world.itemSpawns);  // { keycard: Vector3, fuse: Vector3, key: Vector3 } (floor/surface points)
//   items.update(dt, game);         // hover, spin, glint, pulse light, pickup animation
//   items.getInteractables();       // [{ id:'item:<id>', kind:'item', itemId, position, range, object, getPrompt, interact }]
//   items.reset();                  // remove everything (restart)
//
// Extensions: collect(id) (same as interacting), getEntry(id), group, light (THREE.PointLight —
// remove it if the light budget is exceeded), DESCRIPTIONS.
// Co-op (coop.js): collect() first asks the host (game.coop.requestPick) and runs for real when the
// host says yes ({ fromNet: true }); collectRemote(id) is a teammate's pickup: the item just vanishes,
// a key item joins the (team) inventory and 'item:collected' fires with remote: true (no noise).
// On pickup: player.inventory.add(id) → 'inventory:changed'; emits 'item:collected'
// {id, name, position}, 'noise' {radius 3, source 'item'} and 'subtitle' {text, duration}.
// The UI flashes + animates the slot on 'item:collected'; audio plays the chime.

import * as THREE from './lib/three/three.module.js';
import { ITEM_IDS, ITEM_NAMES, PLAYER } from './config.js';
import { loadGLB, cloneGLB, ps1ify, addVertexSnap } from './assets.js';

export const DESCRIPTIONS = {
  keycard: 'A security keycard. Someone has scratched the face off the photo.',
  fuse: 'A maintenance fuse, still warm. The tag says: MAIN ENTRANCE.',
  key: 'The exit key. The fob just says 000.',
  batteries: 'Fresh batteries. The torch is brighter now.',
};

// Extra pickups: not escape items, never added to the inventory. Collecting one emits its own
// event instead of 'item:collected' (so it can't count towards Room 000 or the exit).
const EXTRAS = { batteries: { event: 'torch:upgrade', name: 'Fresh batteries' } };

const PROMPT = {
  keycard: 'Take security keycard',
  fuse: 'Take maintenance fuse',
  key: 'Take exit key',
  batteries: 'Take fresh batteries',
};

// How each model is presented. The GLBs are ~1.4× real size; pickups are shown larger again so they
// read at the game's low internal resolution. Flat items turn their face toward the player (tilted to
// match the viewing angle) with a slow sway instead of a full spin, so they are never seen edge-on.
const DISPLAY = {
  keycard: { scale: 2.0, flat: true, hover: 0.24, floorHover: 0.34 },
  fuse: { scale: 1.9, flat: false, tilt: 0.3, hover: 0.2, floorHover: 0.3 },
  key: { scale: 2.1, flat: true, hover: 0.22, floorHover: 0.32 },
  batteries: { scale: 1.8, flat: false, tilt: 0.35, hover: 0.18, floorHover: 0.28 },
};

function makeGlintTexture() {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const h = s / 2;
  const core = g.createRadialGradient(h, h, 0, h, h, h);
  core.addColorStop(0, 'rgba(255,250,235,1)');
  core.addColorStop(0.12, 'rgba(255,236,190,0.85)');
  core.addColorStop(0.35, 'rgba(255,214,150,0.18)');
  core.addColorStop(1, 'rgba(255,200,140,0)');
  g.fillStyle = core;
  g.fillRect(0, 0, s, s);
  // four-point star
  g.globalCompositeOperation = 'lighter';
  for (const [w, hgt] of [[s, 3], [3, s]]) {
    const lg = g.createLinearGradient(h - w / 2, h - hgt / 2, h + w / 2, h + hgt / 2);
    lg.addColorStop(0, 'rgba(255,240,210,0)');
    lg.addColorStop(0.5, 'rgba(255,248,230,0.9)');
    lg.addColorStop(1, 'rgba(255,240,210,0)');
    g.fillStyle = lg;
    g.fillRect(h - w / 2, h - hgt / 2, w, hgt);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

function fallbackModel(id) {
  const g = new THREE.Group();
  g.name = `${id}_fallback`;
  const m = (c) => new THREE.MeshLambertMaterial({ color: c });
  if (id === 'batteries') {
    // two chunky D cells, black with a gold band and a silver nub
    for (const x of [-0.024, 0.024]) {
      const cell = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.075, 10), m(0x1c1c1e));
      cell.position.set(x, 0.0375, 0);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0215, 0.0215, 0.022, 10), m(0xc9a227));
      band.position.set(x, 0.062, 0);
      const nub = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.008, 8), m(0xc8ccd2));
      nub.position.set(x, 0.079, 0);
      g.add(cell, band, nub);
    }
    return g;
  }
  if (id === 'keycard') {
    const card = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.004, 0.085), m(0xd8dde2));
    card.position.y = 0.002;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.005, 0.015), m(0xa01a24));
    stripe.position.set(0, 0.002, -0.03);
    g.add(card, stripe);
  } else if (id === 'fuse') {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.14, 8), m(0xe6e0d0));
    body.rotation.z = Math.PI / 2;
    body.position.y = 0.022;
    const capMat = m(0xc89a3a);
    for (const x of [-0.08, 0.08]) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.03, 8), capMat);
      cap.rotation.z = Math.PI / 2;
      cap.position.set(x, 0.024, 0);
      g.add(cap);
    }
    g.add(body);
  } else {
    const fob = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.012, 0.04), m(0x6b4a2e));
    fob.position.set(-0.06, 0.006, 0);
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.008, 0.01), m(0xc89a3a));
    shaft.position.set(0.05, 0.004, 0);
    g.add(fob, shaft);
  }
  return g;
}

export class Items {
  constructor(game) {
    this.game = game;
    this.events = game.events;
    this.group = new THREE.Group();
    this.group.name = 'items';
    game.scene?.add(this.group);

    this.templates = {};
    this.entries = [];
    this._interactables = [];
    this._time = 0;
    this._glintTex = makeGlintTexture();
    this._tmp = new THREE.Vector3();

    // one shared warm pulse light that sits on the nearest uncollected item
    this.light = new THREE.PointLight(0xffd9a0, 0, 1.7, 1.8);
    this.light.name = 'items_pulse_light';
    this.light.castShadow = false;
    this.group.add(this.light);
  }

  async load(onProgress) {
    let done = 0;
    await Promise.all(
      ITEM_IDS.map(async (id) => {
        let root;
        try {
          const gltf = await loadGLB(`assets/items/${id}.glb`);
          root = cloneGLB(gltf.scene);
        } catch (err) {
          console.info(`[items] ${id}.glb unavailable, using fallback`, err?.message || err);
          root = fallbackModel(id);
        }
        this.templates[id] = this._prepareTemplate(id, root);
        onProgress?.(++done, ITEM_IDS.length);
      }),
    );
    return this.templates;
  }

  _prepareTemplate(id, root) {
    ps1ify(root);
    // own materials (one instance per item) with a faint emissive floor so they read in the dark
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = false;
      o.receiveShadow = false;
      const conv = (mat) => {
        const c = mat.clone();
        // clone() drops onBeforeCompile but keeps userData: re-apply the PS1 vertex snap
        if (mat.userData?.__ps1snap) {
          delete c.userData.__ps1snap;
          addVertexSnap(c);
        }
        if (c.emissive) {
          if (c.map && !c.emissiveMap) c.emissiveMap = c.map;
          // faint self-light (linear; 0.05 ≈ 25 % sRGB on a white texel), pulsed + boosted on focus
          if (c.emissive.r + c.emissive.g + c.emissive.b < 0.05) {
            if (c.map) c.emissive.setRGB(0.05, 0.048, 0.044);
            else c.emissive.copy(c.color).multiplyScalar(0.08);
          }
          c.userData.baseEmissive = c.emissiveIntensity || 1;
        }
        return c;
      };
      o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
    });
    // centre the model on its bounding box so tilt/spin pivot around the middle
    const box = new THREE.Box3().setFromObject(root);
    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    return { root, centre, size };
  }

  spawn(itemSpawns = {}) {
    this.reset();
    for (const id of ITEM_IDS) {
      const pos = itemSpawns?.[id];
      if (!pos) continue;
      this._spawnOne(id, pos);
    }
    this._refreshInteractables();
  }

  _spawnOne(id, pos) {
    const tmpl = this.templates[id] || this._prepareTemplate(id, fallbackModel(id));
    this.templates[id] = tmpl;
    const d = DISPLAY[id] || DISPLAY.fuse;

    const holder = new THREE.Group();
    holder.name = `item_${id}`;
    holder.position.set(pos.x, pos.y || 0, pos.z);
    const onFloor = (pos.y || 0) < 0.3;
    const hover = onFloor ? d.floorHover : d.hover;
    const spinner = new THREE.Group();
    spinner.position.y = hover;
    const tilt = new THREE.Group();
    tilt.rotation.x = d.flat ? 0.9 : d.tilt;
    const model = tmpl.root; // one instance per item id → use the template directly
    if (model.parent) model.parent.remove(model);
    model.scale.setScalar(d.scale);
    model.position.copy(tmpl.centre).multiplyScalar(-d.scale);
    model.visible = true;
    tilt.add(model);
    spinner.add(tilt);
    holder.add(spinner);

    // the fuse sparks (beta: "hard to find"): a warm glint that twinkles often and carries further
    const spark = id === 'fuse';
    const glintMat = new THREE.SpriteMaterial({
      map: this._glintTex,
      color: spark ? 0xffc27a : 0xffffff,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const glint = new THREE.Sprite(glintMat);
    glint.scale.setScalar(0.3);
    glint.position.set(0.04, hover + 0.06, 0.02);
    glint.renderOrder = 5;
    holder.add(glint);
    this.group.add(holder);

    const entry = {
      id,
      name: ITEM_NAMES[id] || id,
      holder,
      spinner,
      model,
      glint,
      tilt,
      flat: !!d.flat,
      hover,
      position: new THREE.Vector3(pos.x, (pos.y || 0) + hover, pos.z),
      phase: Math.random() * Math.PI * 2,
      twinkle: 1 + Math.random() * 2,
      spark,
      collected: false,
      pickupT: -1,
      focused: false,
    };
    entry.mats = [];
    model.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m.emissive) entry.mats.push(m);
    });
    const self = this;
    entry.interactable = {
      id: `item:${id}`,
      kind: 'item',
      itemId: id,
      position: entry.position,
      range: PLAYER.interactRange + 0.2,
      object: model,
      getPrompt() {
        return entry.collected ? null : PROMPT[id] || `Take ${entry.name.toLowerCase()}`;
      },
      interact(game) {
        return self.collect(id, game);
      },
    };
    this.entries.push(entry);
    return entry;
  }

  getEntry(id) {
    return this.entries.find((e) => e.id === id) || null;
  }

  /** Place an extra pickup (see EXTRAS) after spawn(). */
  spawnExtra(id, pos) {
    if (!EXTRAS[id] || !pos || this.getEntry(id)) return null;
    const e = this._spawnOne(id, pos);
    e.name = EXTRAS[id].name;
    this._refreshInteractables();
    return e;
  }

  collect(id, game = this.game, opts = {}) {
    const e = this.getEntry(id);
    if (!e || e.collected) return false;
    if (game?.coop?.active && !opts.fromNet) return game.coop.requestPick(id);
    e.collected = true;
    e.pickupT = 0;
    this._refreshInteractables();
    if (EXTRAS[id]) {
      const position = e.position.clone();
      this.events?.emit(EXTRAS[id].event, { id, position });
      this.events?.emit('noise', { position, radius: 3, source: 'item' });
      if (DESCRIPTIONS[id]) this.events?.emit('subtitle', { text: DESCRIPTIONS[id], duration: 4 });
      return true;
    }
    const inv = game?.player?.inventory || game?.inventory;
    inv?.add?.(id);
    const position = e.position.clone();
    this.events?.emit('item:collected', { id, name: e.name, position });
    this.events?.emit('noise', { position, radius: 3, source: 'item' });
    if (DESCRIPTIONS[id]) this.events?.emit('subtitle', { text: DESCRIPTIONS[id], duration: 4.5 });
    return true;
  }

  /** Co-op: a teammate picked this up somewhere else. */
  collectRemote(id, game = this.game) {
    const e = this.getEntry(id);
    if (!e || e.collected) return false;
    e.collected = true;
    e.pickupT = -1;
    e.holder.visible = false;
    this._refreshInteractables();
    if (EXTRAS[id]) return true;
    const inv = game?.player?.inventory || game?.inventory;
    inv?.add?.(id);
    this.events?.emit('item:collected', { id, name: e.name, position: e.position.clone(), remote: true });
    return true;
  }

  _refreshInteractables() {
    this._interactables.length = 0;
    for (const e of this.entries) if (!e.collected) this._interactables.push(e.interactable);
  }

  getInteractables() {
    return this._interactables;
  }

  update(dt, game = this.game) {
    this._time += dt;
    const t = this._time;
    const cam = game?.camera;
    const focusedObj = game?.player?.focused?.object;
    let nearest = null;
    let nearestD = 9;

    for (const e of this.entries) {
      if (e.collected) {
        if (e.pickupT >= 0) {
          // quick lift toward the player, shrink, gone
          e.pickupT += dt;
          const k = Math.min(1, e.pickupT / 0.32);
          if (cam) {
            this._tmp.copy(cam.position);
            e.holder.worldToLocal(this._tmp);
            e.spinner.position.lerpVectors(this._tmpLocal(e), this._tmp, k * k * 0.6);
          }
          e.spinner.scale.setScalar(Math.max(0.001, 1 - k));
          e.glint.material.opacity = (1 - k) * 0.9;
          if (k >= 1) {
            e.pickupT = -1;
            e.holder.visible = false;
          }
        }
        continue;
      }
      e.spinner.position.y = e.hover + Math.sin(t * 1.7 + e.phase) * 0.022;
      let dist = 20;
      if (cam) {
        dist = cam.position.distanceTo(e.position);
        // face the viewer (local +z toward the camera), tilted to the viewing angle, swaying slowly
        const dx = cam.position.x - e.position.x;
        const dz = cam.position.z - e.position.z;
        const face = Math.atan2(dx, dz);
        const sway = Math.sin(t * 0.8 + e.phase) * 0.5;
        let target = face + sway;
        let diff = target - e.spinner.rotation.y;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        e.spinner.rotation.y += diff * Math.min(1, dt * 3);
        if (e.flat) {
          const elev = Math.atan2(cam.position.y - e.position.y, Math.hypot(dx, dz));
          const want = Math.min(1.35, Math.max(0.45, Math.PI / 2 - elev));
          e.tilt.rotation.x += (want - e.tilt.rotation.x) * Math.min(1, dt * 3);
        }
      }
      // glint: steady faint shimmer + an occasional sharp twinkle; fades with distance
      e.twinkle -= dt;
      let tw = 0;
      if (e.twinkle < 0) {
        tw = Math.max(0, 1 + e.twinkle / 0.28);
        if (e.twinkle < -0.28) e.twinkle = e.spark ? 0.35 + Math.random() * 1.3 : 2 + Math.random() * 2.5;
      }
      const near = dist < 5 ? 1 : Math.max(e.spark ? 0.5 : 0.2, 1 - (dist - 5) / (e.spark ? 20 : 14));
      e.glint.material.opacity = (0.32 + 0.12 * Math.sin(t * 3.1 + e.phase) + tw * (e.spark ? 0.9 : 0.65)) * near;
      const s = 0.2 + 0.06 * Math.sin(t * 2.3 + e.phase) + tw * (e.spark ? 0.3 : 0.2);
      e.glint.scale.set(s, s, s);
      e.glint.material.rotation = t * 0.4 + e.phase;
      e.glint.position.y = e.spinner.position.y + 0.05;

      // focus highlight: brighten the self-illumination while targeted
      const focused = focusedObj === e.model;
      const glow = focused ? 2.6 : 1 + 0.3 * Math.sin(t * 2.4 + e.phase);
      for (const m of e.mats) m.emissiveIntensity = (m.userData.baseEmissive || 1) * glow;

      if (dist < nearestD) {
        nearestD = dist;
        nearest = e;
      }
    }

    if (nearest) {
      this.light.position.set(nearest.position.x, nearest.position.y + 0.22, nearest.position.z);
      const fade = nearestD < 4 ? 1 : Math.max(0, 1 - (nearestD - 4) / 5);
      this.light.intensity = (0.45 + 0.2 * Math.sin(t * 2.4 + nearest.phase)) * fade;
    } else this.light.intensity = 0;
  }

  _tmpLocal(e) {
    if (!e._startLocal) e._startLocal = e.spinner.position.clone();
    return e._startLocal;
  }

  reset() {
    for (const e of this.entries) {
      e.holder.parent?.remove(e.holder);
      e.glint.material.dispose();
      if (e.model.parent) e.model.parent.remove(e.model);
      e.spinner.scale.setScalar(1);
    }
    this.entries.length = 0;
    this._interactables.length = 0;
    this.light.intensity = 0;
  }
}
