// LAST BELL - fluorescent fixtures: instanced emissive panels + a small pool of real PointLights that
// follow the player (smooth fades, no popping), flicker, broken lights and global light modes.
// Owned by S1 (World).
import * as THREE from './lib/three/three.module.js';
import { placeMatrix } from './world-kit.js';

const PANEL = new THREE.Color(0xe8f0ff);
const PANEL_DEAD = new THREE.Color(0x1a1c20);
const RED = new THREE.Color(0xff1a10);
const LIGHT_COLOR = new THREE.Color(0xdbe6ff);
const LIGHT_RED = new THREE.Color(0xff2a18);
const BULB_COLOR = new THREE.Color(0xff2010);
const _c = new THREE.Color();

const MODE = {
  normal: { mul: 1.0, red: 0, flick: 0 },
  flicker: { mul: 0.9, red: 0, flick: 1 },
  dim: { mul: 0.32, red: 0, flick: 0 },
  red: { mul: 0.75, red: 1, flick: 0 },
  blackout: { mul: 0.0, red: 0, flick: 0 },
};

export class LightSystem {
  constructor(world) {
    this.world = world;
    this.reduced = !!world?.settings?.reducedEffects; // kept in sync by game.applySettings
    this.group = new THREE.Group();
    this.group.name = 'world-lights';
    this.fixtures = [];
    this.pool = [];
    this.poolSize = 0;
    this.mode = 'normal';
    this.mul = 1;
    this.red = 0;
    this.flickAmt = 0;
    this.panels = null;
    this.baseIntensity = 18.0;
    this.range = 15;
    this.time = 0;
    this._best = new Int32Array(8);
    this._bestD = new Float32Array(8);
    this._dirty = false;
  }

  /** fixtures: [{x,y,z,rot,state:'ok'|'flicker'|'broken',roomId,kind:'panel'|'bulb', dangling}] */
  build(fixtures, kit) {
    this.dispose();
    this.fixtures = fixtures.map((f, i) => ({
      ...f, index: i, cur: f.state === 'broken' ? 0 : 1, flick: 1, timer: Math.random() * 2, target: 1,
      panel: -1, enabled: true, spark: 0,
    }));
    const panels = this.fixtures.filter((f) => f.kind === 'panel' && !f.dangling);
    const part = kit.get('light_panel').parts[0];
    const mesh = new THREE.InstancedMesh(part.geometry, kit.panelMaterial, Math.max(1, panels.length));
    mesh.name = 'light-panels';
    mesh.count = panels.length;
    panels.forEach((f, k) => {
      f.panel = k;
      mesh.setMatrixAt(k, placeMatrix(f.x, f.y, f.z, f.rot));
      mesh.setColorAt(k, f.state === 'broken' ? PANEL_DEAD : PANEL);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    this.panels = mesh;
    this.group.add(mesh);
    this._dirty = true;
  }

  setPoolSize(n) {
    n = Math.max(0, Math.min(8, n | 0));
    if (n === this.poolSize && this.pool.length === n) return;
    for (const s of this.pool) this.group.remove(s.light);
    this.pool = [];
    for (let i = 0; i < n; i++) {
      const light = new THREE.PointLight(LIGHT_COLOR, 0, this.range * 0.75, 2.0);
      light.castShadow = false;
      light.position.set(0, -50, 0);
      this.group.add(light);
      this.pool.push({ light, fx: -1, w: 0 });
    }
    this.poolSize = n;
  }

  /** Short global surge (e.g. 'lights:flicker' event). */
  pulse(intensity = 1, duration = 1) {
    this.pulseT = Math.max(this.pulseT || 0, duration);
    this.pulseAmt = Math.max(0, Math.min(1, intensity));
  }

  setMode(mode) {
    if (!MODE[mode]) mode = 'normal';
    this.mode = mode;
    this._dirty = true;
  }

  /** Enable / disable fixtures of a room (Room 000 before reveal). */
  setRoomEnabled(roomId, on) {
    for (const f of this.fixtures) if (f.roomId === roomId) f.enabled = on;
    this._dirty = true;
  }

  rotateBroken(rng, filter) {
    const changed = [];
    for (const f of this.fixtures) {
      if (f.kind !== 'panel' || f.dangling || !filter(f)) continue;
      if (f.state === 'broken' && rng.chance(0.5)) { f.state = rng.chance(0.3) ? 'flicker' : 'ok'; changed.push(f); }
      else if (f.state !== 'broken' && rng.chance(0.18)) { f.state = 'broken'; changed.push(f); }
    }
    this._dirty = true;
    return changed;
  }

  _fixtureLevel(f, dt) {
    if (!f.enabled) return 0;
    if (f.state === 'broken') {
      // rare dying spark (none with reduced effects)
      if (f.spark > 0) { f.spark -= dt; return f.spark > 0 ? 0.45 : 0; }
      if (!this.reduced && Math.random() < dt * 0.02) f.spark = 0.12 + Math.random() * 0.1;
      return 0;
    }
    // Photosensitivity: every level is held for at least ~0.17 s (at most ~3 changes a second),
    // dips never go fully dark, and update() eases between levels instead of hard-cutting.
    // Reduced effects turns it into a slow, shallow dim.
    if (f.state === 'flicker' || this.flickAmt > 0) {
      f.timer -= dt;
      if (f.timer <= 0) {
        const r = Math.random();
        const slow = this.reduced ? 2.2 : 1;
        if (f.state === 'flicker') {
          if (r < 0.3) { f.target = this.reduced ? 0.72 : 0.3; f.timer = (0.17 + Math.random() * 0.2) * slow; }
          else if (r < 0.42) { f.target = this.reduced ? 0.85 : 0.6; f.timer = (0.17 + Math.random() * 0.15) * slow; }
          else { f.target = 1; f.timer = (0.5 + Math.random() * 1.9) * slow; }
        } else {
          const dip = f.target !== 1 ? false : r < 0.3 * this.flickAmt; // never two dips in a row
          f.target = dip ? (this.reduced ? 0.75 : 0.4) : 1;
          f.timer = (dip ? 0.17 + Math.random() * 0.15 : 0.25 + Math.random() * 0.35) * slow;
        }
      }
      return f.target;
    }
    return 1;
  }

  update(dt, ref, refRoom) {
    this.time += dt;
    const M = MODE[this.mode];
    const k = Math.min(1, dt * 3);
    this.mul += (M.mul - this.mul) * k;
    this.red += (M.red - this.red) * k;
    let flickTarget = M.flick;
    if (this.pulseT > 0) { this.pulseT -= dt; flickTarget = Math.max(flickTarget, this.pulseAmt); }
    this.flickAmt += (flickTarget - this.flickAmt) * Math.min(1, dt * 8);
    let redPulse = 1;
    if (this.red > 0.01) redPulse = 0.75 + 0.25 * Math.sin(this.time * 3.0);
    const transitioning = Math.abs(this.mul - M.mul) > 0.002 || Math.abs(this.red - M.red) > 0.002;
    // 1) fixture levels + panel colours
    const panels = this.panels;
    let colorsChanged = false;
    for (let i = 0; i < this.fixtures.length; i++) {
      const f = this.fixtures[i];
      const lvl = this._fixtureLevel(f, dt);
      const flickering = f.state === 'flicker' || this.flickAmt > 0.01;
      const ease = flickering ? (this.reduced ? 6 : 22) : 8; // ~50 ms edges while flickering
      const cur = f.state === 'broken' && !this.reduced ? lvl : f.cur + (lvl - f.cur) * Math.min(1, dt * ease);
      const changed = Math.abs(cur - f.cur) > 0.002;
      f.cur = cur;
      if (f.panel >= 0 && (changed || this._dirty || transitioning || this.red > 0.01)) {
        const b = f.cur * this.mul * (this.red > 0.01 ? redPulse : 1);
        _c.copy(PANEL).lerp(RED, this.red).multiplyScalar(Math.max(0, b));
        if (b < 0.12) _c.lerp(PANEL_DEAD, 1 - b / 0.12);
        panels.setColorAt(f.panel, _c);
        colorsChanged = true;
      }
    }
    if (colorsChanged && panels.instanceColor) panels.instanceColor.needsUpdate = true;
    this._dirty = false;
    // 2) choose the nearest lit fixtures for the pool
    const N = this.pool.length;
    if (!N || !ref) return;
    const best = this._best;
    const bestD = this._bestD;
    let nb = 0;
    const R2 = this.range * this.range;
    const rooms = this.world.rooms;
    const refCorr = refRoom && refRoom.isCorridor;
    for (let i = 0; i < this.fixtures.length; i++) {
      const f = this.fixtures[i];
      if (!f.enabled || f.state === 'broken') continue;
      const dx = f.x - ref.x, dz = f.z - ref.z;
      let d = dx * dx + dz * dz;
      if (d > R2) continue;
      if (refRoom && f.roomId !== refRoom.id) {
        const fr = rooms[f.roomId];
        if (!(refCorr && fr && fr.isCorridor)) d += 30;
      }
      for (let s = 0; s < N; s++) if (this.pool[s].fx === i) { d -= 5; break; }
      // insertion into the best-N list
      if (nb < N) {
        let j = nb++;
        while (j > 0 && bestD[j - 1] > d) { bestD[j] = bestD[j - 1]; best[j] = best[j - 1]; j--; }
        bestD[j] = d; best[j] = i;
      } else if (d < bestD[N - 1]) {
        let j = N - 1;
        while (j > 0 && bestD[j - 1] > d) { bestD[j] = bestD[j - 1]; best[j] = best[j - 1]; j--; }
        bestD[j] = d; best[j] = i;
      }
    }
    // 3) fade slots in/out, reassign free slots
    const fade = Math.min(1, dt * 4);
    for (let s = 0; s < N; s++) {
      const slot = this.pool[s];
      let wanted = false;
      for (let j = 0; j < nb; j++) if (best[j] === slot.fx) { wanted = true; break; }
      slot.w += ((wanted ? 1 : 0) - slot.w) * fade;
      if (!wanted && slot.w < 0.02) { slot.fx = -1; slot.w = 0; }
    }
    for (let j = 0; j < nb; j++) {
      const fi = best[j];
      let has = false;
      for (let s = 0; s < N; s++) if (this.pool[s].fx === fi) { has = true; break; }
      if (has) continue;
      for (let s = 0; s < N; s++) {
        if (this.pool[s].fx === -1) { this.pool[s].fx = fi; this.pool[s].w = 0; break; }
      }
    }
    for (let s = 0; s < N; s++) {
      const slot = this.pool[s];
      const L = slot.light;
      if (slot.fx < 0) { L.intensity = 0; continue; }
      const f = this.fixtures[slot.fx];
      const dx = f.x - ref.x, dz = f.z - ref.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const edge = Math.min(1, Math.max(0, (this.range - dist) / (this.range * 0.4)));
      if (f.kind === 'bulb') {
        L.color.copy(BULB_COLOR);
        L.position.set(f.x, f.y - 0.05, f.z);
        L.intensity = 14.0 * slot.w * edge * (0.85 + 0.15 * Math.sin(this.time * 2.1));
        L.distance = 8;
      } else {
        L.color.copy(LIGHT_COLOR).lerp(LIGHT_RED, this.red);
        L.position.set(f.x, f.y - 0.35, f.z);
        L.intensity = this.baseIntensity * f.cur * this.mul * slot.w * edge * (this.red > 0.01 ? redPulse : 1);
        L.distance = this.range * 0.75;
      }
    }
  }

  dispose() {
    if (this.panels) {
      this.group.remove(this.panels);
      this.panels.dispose();
      this.panels = null;
    }
    this.fixtures = [];
    for (const s of this.pool) { s.fx = -1; s.w = 0; s.light.intensity = 0; }
  }
}
