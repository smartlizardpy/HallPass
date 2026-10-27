// LAST BELL — The Halloween Shift: director-controlled lighting on top of world-lights.js.
//
//   const hl = new HorrorLights(game); hl.attach();     after world.generate (and again after transforms)
//   hl.set(roomIds | null, level, fadeSec)               fixture multiplier (fixture.hmul) for rooms / all
//   hl.fixture(index, level, fadeSec)                    one fitting (false recovery)
//   hl.flicker(roomIds, sec)                             photosensitivity-safe flicker (world-lights limits)
//   hl.ambient(level, fadeSec) / hl.fog(mul, fadeSec)    hemisphere light / fog density multipliers
//   hl.levelAt(x, z) → 0..1                              how lit a floor spot is now (fixtures + ambient)
//   hl.darkness(x, z) → 0..1                             the light here now / the light here normally
//   hl.restoreAll(fadeSec)                               everything back to normal
//   hl.update(dt)
//
// Glows (pumpkin candles, decor.js) are separate 'glow' fixtures that ignore hmul, so they keep burning in a
// blackout. While the mode is on, world.getLightLevel = 0.5 × darkness(x, z): exactly the Caretaker's
// default (0.5) under normal lights, lower in the dark, where his detection already says "darkness hides
// you" when your torch is off (enemy.js). The same rule applies to every run.

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class HorrorLights {
  constructor(game) {
    this.game = game;
    this.tweens = new Map(); // key → { get, set, from, to, t, dur }
    this.byRoom = new Map();
    this.flickers = [];
    this.ambientLevel = 1;
    this.enabled = true; // debug: subsystem switch
    this.reduced = false;
  }

  get lights() {
    return this.game.world.lights;
  }

  get env() {
    return this.game.world.env;
  }

  attach() {
    this.byRoom.clear();
    for (const f of this.lights.fixtures) {
      if (f.kind === 'glow' || (f.floor || 0) !== 0) continue;
      if (f.hmul === undefined) f.hmul = 1;
      if (!this.byRoom.has(f.roomId)) this.byRoom.set(f.roomId, []);
      this.byRoom.get(f.roomId).push(f);
    }
  }

  _tween(key, get, set, to, dur) {
    dur = Math.max(0, dur);
    if (dur === 0) {
      this.tweens.delete(key);
      set(to);
      return;
    }
    this.tweens.set(key, { get, set, from: get(), to, t: 0, dur });
  }

  _fixtures(roomIds) {
    if (!roomIds) return this.lights.fixtures.filter((f) => f.kind !== 'glow' && (f.floor || 0) === 0);
    const out = [];
    for (const id of roomIds) for (const f of this.byRoom.get(id) || []) out.push(f);
    return out;
  }

  set(roomIds, level, fade = 0.4) {
    for (const f of this._fixtures(roomIds)) this.fixture(f.index, level, fade);
  }

  fixture(index, level, fade = 0.4) {
    const f = this.lights.fixtures[index];
    if (!f) return;
    this._tween('f' + index, () => f.hmul ?? 1, (v) => (f.hmul = v), clamp01(level), fade);
  }

  ambient(level, fade = 1) {
    this.ambientLevel = level;
    this._tween('amb', () => this.env.horrorMul, (v) => (this.env.horrorMul = v), level, fade);
  }

  fog(mul, fade = 2) {
    this._tween('fog', () => this.env.fogMul, (v) => (this.env.fogMul = v), mul, fade);
  }

  /** Flicker some rooms' fittings for `sec` (world-lights.js holds every level ≥ 0.17 s, never full dark). */
  flicker(roomIds, sec = 3) {
    for (const f of this._fixtures(roomIds)) {
      if (f.state === 'broken' || f.state === 'flicker' || f.kind !== 'panel') continue;
      f.state = 'flicker';
      this.flickers.push({ f, until: sec });
    }
  }

  /** Back to this mode's resting level (baseLevel: Halloween night keeps the fittings a little low). */
  normal(roomIds, fade = 0.6) {
    this.set(roomIds, this.baseLevel ?? 1, fade);
  }

  restoreAll(fade = 2) {
    const base = this.baseLevel ?? 1;
    for (const f of this._fixtures(null)) if (Math.abs((f.hmul ?? 1) - base) > 0.01 || this.tweens.has('f' + f.index)) this.fixture(f.index, base, fade);
    this.ambient(this.baseAmbient ?? 1, fade);
    this.fog(this.baseFog ?? 1, fade);
  }

  /** Rooms (floor 0) whose centre lies within r metres of p. */
  roomsNear(p, r) {
    const out = [];
    for (const room of this.game.world.rooms) {
      const b = room.bounds;
      const dx = Math.max(b.minX - p.x, 0, p.x - b.maxX);
      const dz = Math.max(b.minZ - p.z, 0, p.z - b.maxZ);
      if (dx * dx + dz * dz <= r * r) out.push(room.id);
    }
    return out;
  }

  /** 0..1: fixtures within 9 m (current level × multiplier) + ambient. */
  levelAt(x, z, normal = false) {
    let sum = 0;
    const fx = this.lights.fixtures;
    for (let i = 0; i < fx.length; i++) {
      const f = fx[i];
      if (!f.enabled || f.state === 'broken' || (f.floor || 0) !== 0) continue;
      const d2 = (f.x - x) ** 2 + (f.z - z) ** 2;
      if (d2 > 81) continue;
      // f.cur already carries hmul (world-lights.js eases each fitting towards level × hmul)
      const lvl = f.kind === 'glow' ? 0.35 : normal ? 1 : Math.min(1, f.cur ?? 1);
      sum += lvl / (1 + d2 * 0.12);
    }
    const amb = 0.12 * (normal ? 1 : this.env.horrorMul ?? 1);
    return clamp01(sum * 0.55 + amb);
  }

  darkness(x, z) {
    const n = this.levelAt(x, z, true);
    return n > 0 ? clamp01(this.levelAt(x, z) / n) : 1;
  }

  update(dt) {
    for (const [k, tw] of this.tweens) {
      tw.t += dt;
      const p = Math.min(1, tw.t / tw.dur);
      const e = p * p * (3 - 2 * p);
      tw.set(tw.from + (tw.to - tw.from) * e);
      if (p >= 1) this.tweens.delete(k);
    }
    for (let i = this.flickers.length - 1; i >= 0; i--) {
      const fl = this.flickers[i];
      fl.until -= dt;
      if (fl.until <= 0) {
        fl.f.state = 'ok';
        this.lights._dirty = true;
        this.flickers.splice(i, 1);
      }
    }
  }

  /** Is any director dimming in force? */
  get altered() {
    if (this.tweens.size || this.flickers.length) return true;
    if ((this.env.horrorMul ?? 1) < 0.98) return true;
    for (const f of this.lights.fixtures) if ((f.hmul ?? 1) < 0.98) return true;
    return false;
  }

  detach() {
    this.tweens.clear();
    for (const fl of this.flickers) fl.f.state = 'ok';
    this.flickers = [];
    for (const f of this.lights?.fixtures || []) if (f.hmul !== undefined) f.hmul = 1;
    if (this.env) {
      this.env.horrorMul = 1;
      this.env.fogMul = 1;
    }
    if (this.lights) this.lights._dirty = true;
  }
}
