// LAST BELL — The Halloween Shift: the opening beat. "What was that?"
//
// At spawn the player is in a classroom. Out in the corridor, the far light in each direction is dead and the tubes on the way burn low (set on
// the first frame, out of sight). The first time they stand in the corridor and look straight down it at a dead
// end (12-20 m away), the flicker reveal plays (glimpse.js): the corridor dies, the ceiling tubes flicker and in
// the flashes the Watcher is standing at the far end, then the hit, the boy's gasp, and the lights back on over an
// empty corridor. Then he starts whispering Al-Fatiha (recite.js). It never comes closer.
//
// Varies across runs (a counter in the haunt memory): the first run always shows it; later runs sometimes
// blink on an empty corridor, or leave the ends dead and never blink at all, and the figure's pose changes.
//
// Rules kept: gameplay is untouched (dead lights only; the Caretaker's light rule is the fixed one in mode.js);
// the figure exists only inside the blink (it is never seen arriving or leaving); single blinks well under
// the 3-per-second flash limit, and with reduced effects one slow pulse instead.

import { glimpse, endStage } from './glimpse.js';
import { ET } from '../world-layout.js';

const POSES = ['stand', 'stare', 'distort']; // far away, the lean reads as a lump
const NEAR = 12, FAR = 23; // far: a shape at the end of the corridor (playtest: close reads as a glitch)
const DIM = 0.3; // "the lights aren't fully on": the corridor between the door and a dead end

export class Opening {
  constructor(mode) {
    this.mode = mode;
    this.state = 'off';
    this.sites = [];
  }

  get g() {
    return this.mode.game;
  }

  /** The last corridor tube before the end of a corridor, 12-23 m from `from`, in clear view, best first (about 16 m). */
  _candidates(from, dir = null) {
    const w = this.g.world, L = this.mode.lights;
    const eye = { x: from.x, y: 1.6, z: from.z };
    const out = [];
    for (const f of L.lights.fixtures) {
      if (f.kind === 'glow' || (f.floor || 0) !== 0 || f.state === 'broken') continue;
      const dx = f.x - eye.x, dz = f.z - eye.z, d = Math.hypot(dx, dz);
      if (d < NEAR || d > FAR) continue;
      if (!w.rooms[f.roomId]?.isCorridor || !w.isWalkable(f.x, f.z, 0.3, 0)) continue;
      if (!w.lineOfSight(eye, { x: f.x, y: 1.3, z: f.z }) || !w.lineOfSight(eye, { x: f.x, y: 0.3, z: f.z })) continue;
      const stage = endStage(w, eye, f, { near: NEAR, far: FAR + 2 }); // the ghost stands at the end
      if (!stage) continue;
      const cos = dir ? (dx * dir.x + dz * dir.z) / d : 0;
      out.push({ f, d, ux: dx / d, uz: dz / d, stage, s: cos * 3 - Math.abs(d - 16) * 0.15 }); // far (playtest: "too close"), a small shape at the end
    }
    return out.sort((a, b) => b.s - a.s);
  }

  /**
   * Kill the far corridor lights (up to one per direction) outside the room the player starts in. Called on the
   * run's first frame (from mode.update); the debug key O calls it with now = true to replay it from wherever the
   * player is standing (then only what is in front of them).
   */
  arm({ now = false } = {}) {
    this.cancel();
    const m = this.mode, g = this.g, w = g.world, L = m.lights;
    const p = g.player.position;
    const picks = [];
    if (now) {
      const c = this._candidates(p, { x: -Math.sin(g.player.yaw), z: -Math.cos(g.player.yaw) })[0];
      if (c) picks.push({ ...c, from: { x: p.x, z: p.z } });
    } else {
      // from just outside each door of the start room that opens onto a corridor
      const room = w.playerSpawn?.room?.id ?? w.playerSpawn?.room; // a room object (an id in older builds)
      for (const door of w.doors || []) {
        const a = door.roomA?.id ?? door.roomA, b = door.roomB?.id ?? door.roomB;
        if (door.kind !== 'door' || (a !== room && b !== room)) continue;
        const other = a === room ? b : a;
        if (!w.rooms[other]?.isCorridor) continue;
        const k = b === room ? -1.3 : 1.3; // n points into room B
        const out = { x: door.position.x + door.n.x * k, z: door.position.z + door.n.z * k };
        for (const c of this._candidates(out)) {
          c.from = out;
          c.door = door;
          c.room = w.rooms[room];
          // one per direction along the corridor
          if (picks.some((q) => q.ux * c.ux + q.uz * c.uz > 0.5 || Math.hypot(q.f.x - c.f.x, q.f.z - c.f.z) < 4)) continue;
          picks.push(c);
          if (picks.length >= 2) break;
        }
      }
    }
    if (!picks.length) return false;
    const mem = m.memory;
    const n = now ? 0 : mem.p.openings || 0;
    const rng = Math.random;
    this.variant = n === 0 ? 'reveal' : rng() < 0.55 ? 'reveal' : rng() < 0.67 ? 'empty' : 'none';
    const poses = n === 0 ? ['stand'] : POSES.filter((x) => x !== mem.p.openPose);
    this.pose = poses[(rng() * poses.length) | 0];
    if (!now) {
      mem.p.openings = n + 1;
      if (this.variant === 'reveal') mem.p.openPose = this.pose;
      mem._dirty = true;
    }
    const taken = new Set();
    const fl = L.lights.fixtures.filter((x) => x.kind !== 'glow' && !(x.floor || 0) && x.state !== 'broken');
    const sites = picks.map(({ f, ux, uz, from, door, room, stage }) => {
      // the tube and its twin across the corridor (a dead pair reads as "the end is dark", not a missing light)
      const group = fl.filter((x) => !taken.has(x.index) && Math.hypot(x.x - f.x, x.z - f.z) < 3.3);
      for (const x of group) taken.add(x.index);
      return { f, ux, uz, from, group, door, room, stage };
    });
    this.sites = sites.map(({ f, ux, uz, from, group, door, room, stage }) => {
      for (const x of group) L.fixture(x.index, 0, 0);
      // the tubes on the way there burn low, so the far one is the brightest thing in view when it blinks
      const len = Math.hypot(f.x - from.x, f.z - from.z);
      const dim = fl.filter((x) => {
        if (taken.has(x.index) || !w.rooms[x.roomId]?.isCorridor) return false;
        const t = ((x.x - from.x) * ux + (x.z - from.z) * uz) / len;
        const off = Math.abs((x.x - from.x) * uz - (x.z - from.z) * ux);
        return t > -0.35 && t < 1.35 && off < 4.5; // behind you to past the end: all of it goes out for the reveal
      });
      for (const x of dim) {
        taken.add(x.index);
        L.fixture(x.index, DIM, 0);
      }
      const spot = stage.spot; // at the end of the corridor, under its last light
      return { f, group, dim, spot, from, door, room };
    });
    if (!now) this._dress(this.sites[0], rng);
    this.t = 0;
    this.wait = now ? 0.5 : 3.8; // after the start-of-run flicker (0.4-3.2 s, game.js)
    this.limit = now ? 30 : 90;
    this.state = 'armed';
    this.shown = false;
    this.site = null;
    return true;
  }

  /**
   * Blood you can't miss on the way out (playtest: "can't find the blood"): a drag trail from the classroom door
   * down the corridor towards the dead end where it will stand, and a bloody handprint on the wall facing the door.
   */
  _dress(site, rng) {
    const m = this.mode, d = m.director, w = this.g.world, b = d?.blood;
    if (!site || !b) return;
    const from = site.from;
    const len = Math.hypot(site.spot.x - from.x, site.spot.z - from.z);
    const ux = (site.spot.x - from.x) / len, uz = (site.spot.z - from.z) / len;
    const end = Math.min(len * 0.62, 9);
    b.trail(from.x + ux * 0.4, from.z + uz * 0.4, from.x + ux * end, from.z + uz * end, 2026 + ((rng() * 1e4) | 0));
    // handprints by the door you leave through: inside the classroom beside it ("someone tried to get out"), else
    // on the corridor wall facing it
    const dp = site.door?.position;
    let best = null, bd = 9;
    for (const s of dp && site.room ? d.decor?._walls?.(site.room) || [] : []) {
      if (s.kind !== ET.WALL && s.kind !== ET.EXT) continue;
      const a0 = (dp.x - s.x) * s.tx + (dp.z - s.z) * s.tz;
      for (const o of [0.9, -0.9, 1.4, -1.4]) {
        const a = Math.max(-1.6, Math.min(1.6, a0 + o));
        const p = { ...s, x: s.x + s.tx * a, z: s.z + s.tz * a };
        const dd = Math.hypot(p.x - dp.x, p.z - dp.z);
        if (dd < 0.75 || dd > 2 || dd >= bd) continue;
        if (!b.wallClear(p, 0.25, 0) || !b.wallClear(p, 0.25, 0.42 * Math.sign(o))) continue;
        best = { ...p, tx: s.tx * Math.sign(o), tz: s.tz * Math.sign(o) }; // the second print further from the door
        bd = dd;
        break;
      }
    }
    const room = d.roomAt?.({ x: from.x, z: from.z });
    const walls = !best && room?.isCorridor ? d.decor?._walls?.(room) || [] : [];
    for (const s of walls) {
      if (s.kind !== ET.WALL && s.kind !== ET.EXT) continue; // not the doorway itself
      // the wall you face as you come out of the door (the bare stretch of it nearest the door point)
      const a0 = (from.x - s.x) * s.tx + (from.z - s.z) * s.tz;
      for (const o of [0, 0.5, -0.5, 1, -1, 1.6, -1.6]) {
        const a = Math.max(-1.6, Math.min(1.6, a0 + o));
        const p = { ...s, x: s.x + s.tx * a, z: s.z + s.tz * a };
        const dd = Math.hypot(p.x - from.x, p.z - from.z);
        if (dd > 4 || dd >= bd) continue;
        if ((from.x - p.x) * s.nx + (from.z - p.z) * s.nz < 0.5) continue;
        if (!b.wallClear(p, 0.25, 0) || !b.wallClear(p, 0.25, 0.42)) continue;
        best = p;
        bd = dd;
        break;
      }
    }
    if (best) {
      b.hand(best, { height: 1.4, seed: 77 + ((rng() * 1e4) | 0), left: rng() < 0.5 });
      b.hand({ ...best, x: best.x + best.tx * 0.42, z: best.z + best.tz * 0.42 }, { height: 1.2, seed: 91 + ((rng() * 1e4) | 0) });
    }
  }

  update(dt) {
    if (this.state === 'off' || this.state === 'blink') return;
    const m = this.mode, g = this.g, gaze = m.gaze, pp = g.player.position;
    this.t += dt;
    const e = g.enemy;
    const dist = (s) => Math.hypot(s.spot.x - pp.x, s.spot.z - pp.z);
    const near = (s) => e?.enabled !== false && e?.position && Math.hypot(e.position.x - s.spot.x, e.position.z - s.spot.z) < 10;
    if (this.state === 'armed') {
      if (this.t > this.limit) return this._restore(this.sites, 1.2); // never looked
      // walked up to a dead end without looking (or the Caretaker is there): that end comes back, empty
      const off = this.sites.filter((s) => (this.t > this.wait && dist(s) < 7) || near(s));
      if (off.length) this._restore(off, 1.2);
      if (!this.sites.length || this.t < this.wait || this.variant === 'none') return;
      // only from the corridor itself (never through the classroom door: it would be right outside it), far away,
      // and not over the PA's opening announcement
      if (!m.director.room?.isCorridor) return;
      if ((g.audio?._annBusyUntil || 0) > performance.now()) return;
      for (const s of this.sites) {
        const d = dist(s);
        if (d < 11 || d > FAR + 3) continue;
        if (gaze.facing(s.spot, 12) && g.world.lineOfSight(gaze.eye, { x: s.spot.x, y: 1.2, z: s.spot.z })) {
          this._blink(s);
          return;
        }
      }
    } else if (this.state === 'after') {
      // the ends stay dead a while; they come back on an empty corridor
      if (this.t > this.until) return this._restore(this.sites, 0.9);
      const off = this.sites.filter((s) => dist(s) < 6 || near(s));
      if (off.length) this._restore(off, 0.9);
    }
  }

  async _blink(site) {
    this.state = 'blink';
    this.site = site;
    const m = this.mode, d = m.director;
    // a timer that gives up when the opening is cancelled (run end, a new arm)
    const wait = (sec) => new Promise((res, rej) => setTimeout(() => (this.state === 'blink' ? res() : rej(new Error('cancelled'))), sec * 1000));
    let res = 'empty';
    try {
      res = await glimpse(d, { tube: site.f, group: site.group, path: site.dim, spot: site.spot, pose: this.variant === 'reveal' ? this.pose : null, wait, strength: 0.7 });
    } catch {
      return; // cancelled: cancel() has cleaned up
    }
    if (this.state !== 'blink') return;
    this.shown = res === 'seen';
    d._log?.('opening', this.variant, this.shown ? this.pose : 'empty');
    if (this.shown) m.recite?.saw('glimpse'); // after the gasp and the empty corridor, he starts to whisper
    this.state = 'after';
    this.t = 0;
    this.until = 25 + Math.random() * 15;
  }

  _restore(sites, fade) {
    const L = this.mode.lights;
    for (const s of [...sites]) {
      for (const f of s.group) L.fixture(f.index, L.baseLevel ?? 1, fade);
      for (const f of s.dim) L.fixture(f.index, L.baseLevel ?? 1, fade * 3); // slowly, as if the building warms up
      this.g.audio?.play?.('flicker', { position: { x: s.f.x, y: 2.7, z: s.f.z }, volume: 0.3 });
      this.sites = this.sites.filter((x) => x !== s);
    }
    if (!this.sites.length) this.state = 'off';
  }

  /** Back to normal at once (run end / teardown / a new arm). */
  cancel() {
    if (this.state === 'off') return;
    if ((this.shown || this.state === 'blink') && this.mode.watcher.active) {
      this.mode.watcher.setEmissive?.(0);
      this.mode.watcher.vanish('now');
    }
    this.state = 'off';
    for (const s of this.sites) for (const f of [...s.group, ...s.dim]) this.mode.lights.fixture(f.index, this.mode.lights.baseLevel ?? 1, 0);
    this.sites = [];
  }
}
