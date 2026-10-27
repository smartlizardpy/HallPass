// LAST BELL — shared enemy code (Second Floor update, AI workstream). Composition, not inheritance:
// the Caretaker (enemy.js) and The Assistant (assistant.js) each own a Mover, a Puppet and a
// Possession, and call the senses helpers below. The state they work on stays on the enemy object, under
// the field names other modules and the tests already read (path, pathCount, moveStatus, speed, …).
//
//   makeRng(seed)                     mulberry32 → () => [0, 1). Decisions use it (seeded per run).
//   floorOfPos(world, p), floorBaseY(f), inStairwell(x, z), floorList(world, floor, key)
//   los(world, a, b)                  world.lineOfSight(a, b, { strict: true }): the AI's only sight rule
//   candidateTargets(game, floor, world, out), targetId(game, p), pickTarget(agent, dt, game, world)
//   noiseFloorGain(world, floor, noise)   1 same floor · 0.5 from a stairwell on the other floor · 0 else
//   propQuery(world, floor)           (x, z, r) → bool: a prop (furniture) collider within r
//   new Mover(agent, cfg)             paths (≤ 4 requests/s), full-radius moveCircle, door waits for
//                                     door.fullyOpen, stuck handling, stair-cell guard. No squeeze, no vault.
//   new Puppet(agent, cfg)            co-op guest: own snapshot buffer, no extrapolation when slow or on a
//                                     state change, moves toward the sample with collision (snaps only > 1 m)
//   new Possession(agent)             Director input (multiplayer.md §5.4), 3 s watchdog
//
// Feature detection: worlds without the floor facade (no world.floors) are floor 0 only; world.getNav(f),
// world.moveCircle(…, { floor, enemy: true }) and world.isWalkable(x, z, r, floor) take the floor as an
// extra argument that older worlds simply ignore.

import { FLOOR_Y, FLOOR_SPLIT_Y, STAIRS, CELL } from './config.js';

export const DEG = Math.PI / 180;
export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}
/** three.js yaw that faces direction (dx, dz): forward = (-sin yaw, -cos yaw). */
export const yawTo = (dx, dz) => Math.atan2(-dx, -dz);
export const hdist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const EMPTY = Object.freeze([]);

// =============================================================================================== RNG
/** Seeded PRNG (mulberry32). Same seed → same sequence. */
export function makeRng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// =============================================================================================== floors
export const floorBaseY = (f) => FLOOR_Y[f] ?? 0;
/** 0 | 1 for a position (world.floorOf when the facade exists, else from y). */
export function floorOfPos(world, p) {
  if (!p) return 0;
  if (world?.floorOf) {
    const f = world.floorOf(p);
    if (f === 0 || f === 1) return f;
  }
  return (p.y || 0) > FLOOR_SPLIT_Y ? 1 : 0;
}
const itemFloor = (it) => {
  if (it.floor === 0 || it.floor === 1) return it.floor;
  const y = it.position ? it.position.y : it.y;
  return (y || 0) > FLOOR_SPLIT_Y ? 1 : 0;
};
/** 'A' | 'B' if (x, z) is inside a stairwell's cells (the same cells on both floors), else null. */
export function inStairwell(x, z) {
  const cx = Math.floor(x / CELL);
  const cz = Math.floor(z / CELL);
  for (const k in STAIRS) for (const c of STAIRS[k].cells) if (c[0] === cx && c[1] === cz) return k;
  return null;
}
/**
 * A per-floor list (patrolPoints, hidingSpots, doors, rooms…): world.floors[floor][key] when the facade has
 * it, else the world-level list filtered by `.floor` / height. Floor 0 of an old world is the whole list.
 * (Allocates when it filters: callers use it on decisions, not per frame.)
 */
export function floorList(world, floor, key) {
  const f = world?.floors?.[floor];
  if (f && Array.isArray(f[key])) return f[key];
  if (floor === 1 && Array.isArray(world?.floor2?.[key])) return world.floor2[key];
  const all = world?.[key];
  if (!Array.isArray(all)) return EMPTY;
  if (floor === 0 && !world.floors) return all;
  return all.filter((it) => itemFloor(it) === floor);
}
export const onFloor = (it, floor) => itemFloor(it) === floor;

// =============================================================================================== senses
export const STRICT = Object.freeze({ strict: true });
/** The AI's sight rule (enemy-ai.md §2 row 4b): no door soft zone, doors block until fully open. */
export function los(world, a, b) {
  return world?.lineOfSight ? world.lineOfSight(a, b, STRICT) : true;
}

/** The player's net id: the local player is game.net.selfId ('local' solo), a coop stand-in its .id. */
export function targetId(game, p) {
  if (!p) return null;
  if (p === game.player) return game.net?.selfId ?? 'local';
  return p.id ?? null;
}

function validTarget(game, p, floor, world) {
  if (!p?.position || p.alive === false || p.director || p.spectator) return false;
  const id = targetId(game, p);
  if (id != null && game.isDirector?.(id)) return false;
  return floorOfPos(world, p.position) === floor;
}

/** Everyone this enemy may hunt: alive, on its floor, never a Director or spectator. */
export function candidateTargets(game, floor, world, out) {
  out.length = 0;
  const coop = game.coop;
  if (coop?.active && typeof coop.targets === 'function') {
    for (const p of coop.targets()) if (validTarget(game, p, floor, world)) out.push(p);
  } else if (game.player && validTarget(game, game.player, floor, world)) out.push(game.player);
  return out;
}

/**
 * Whom the enemy is after. Solo: you (if you're on its floor). Co-op host: distance, visible (strict LOS
 * eye to eye), sticky while chasing. agent: { object, floor, _eye, _state, _target, _tgtT, _cands,
 * _losTimer, _visible, stickyStates }.
 */
export function pickTarget(agent, dt, game, world) {
  const list = candidateTargets(game, agent.floor, world, agent._cands || (agent._cands = []));
  if (!game.coop?.active) {
    const p = list[0] || null;
    if (p !== agent._soloTarget) {
      agent._soloTarget = p;
      agent._losTimer = 0;
    }
    return p;
  }
  const cur = agent._target && list.includes(agent._target) ? agent._target : null;
  if (cur && agent.stickyStates?.includes(agent._state)) return cur;
  agent._tgtT -= dt;
  if (cur && agent._tgtT > 0) return cur;
  agent._tgtT = 0.5;
  let best = null;
  let bestScore = -Infinity;
  const pos = agent.object.position;
  for (const p of list) {
    const d = hdist(pos, p.position);
    let score = -d;
    if (!p.isHidden && d < 30 && los(world, agent._eye, p.eyePosition || p.position)) score += 25;
    if (p === cur) score += 4; // don't flip-flop between two players at a similar distance
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  if (best !== agent._target) {
    agent._target = best;
    agent._losTimer = 0; // perceive the new target right away
    agent._visible = false;
  }
  return best;
}

/** How much of a noise reaches an enemy on `floor`: 1 same floor, 0.5 from inside a stairwell, else 0. */
export function noiseFloorGain(world, floor, n) {
  const nf = n.floor === 0 || n.floor === 1 ? n.floor : floorOfPos(world, n.position);
  if (nf === floor) return 1;
  return inStairwell(n.position.x, n.position.z) ? 0.5 : 0;
}

/**
 * (x, z, r) → true if a furniture (prop) collider is within r on that floor; null if the world can't say.
 * The collider set is looked up on every call (worlds replace it on generate()).
 */
export function propQuery(world, floor) {
  const colsOf = () => world?.floors?.[floor]?.colliders ?? (floor === 0 ? world?.colliders : null);
  if (colsOf()?.forEach) {
    let cx = 0;
    let cz = 0;
    let rr = 0;
    let px = 0;
    let pz = 0;
    const hit = (c) => {
      if (c.kind !== 'prop' || c.noCollide) return false;
      cx = px < c.minX ? c.minX : px > c.maxX ? c.maxX : px;
      cz = pz < c.minZ ? c.minZ : pz > c.maxZ ? c.maxZ : pz;
      return (px - cx) ** 2 + (pz - cz) ** 2 < rr;
    };
    return (x, z, r) => {
      const cols = colsOf();
      if (!cols?.forEach) return false;
      px = x;
      pz = z;
      rr = r * r;
      return cols.forEach(x - r, z - r, x + r, z + r, hit);
    };
  }
  // dev mock worlds: plain boxes, kind 'wall' or furniture
  const st = world?.floors?.[floor]?.statics ?? (floor === 0 || world?.floorTestMap ? world?.statics : null);
  if (Array.isArray(st)) {
    const props = st.filter((b) => b.kind !== 'wall' && (b.floor ?? 0) === floor);
    return (x, z, r) => {
      for (const c of props) {
        const cx = x < c.minX ? c.minX : x > c.maxX ? c.maxX : x;
        const cz = z < c.minZ ? c.minZ : z > c.maxZ ? c.maxZ : z;
        if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) return true;
      }
      return false;
    };
  }
  return null;
}

// =============================================================================================== mover
const _vD = { x: 0, y: 0, z: 0 };
const _vOut = { x: 0, y: 0, z: 0 };
/**
 * Walks an enemy along nav paths with full-radius collision. cfg:
 *   radius, floor, speedFor(mode) → m/s, turnClips (bool), turn: { walk, run, face }, accel: { walk, run, brake },
 *   doorPause(chasing) → s before opening, doorOpenHold (s to stand after open() at least), onDoorPause(door, chasing),
 *   isChasing() → bool, isCapturing() → bool, cornerCap(absDiffYaw, mode) → max speed (optional),
 *   walkSpeed (stuck threshold reference)
 */
export class Mover {
  constructor(agent, cfg) {
    this.a = agent;
    this.cfg = cfg;
    this.stairGuardHits = 0;
    this._lastValid = { x: 0, z: 0, ok: false };
    this._moveOpts = { floor: cfg.floor, enemy: true };
  }

  goTo(target, mode = 'walk', arrive = 0.6) {
    const a = this.a;
    const moved = hdist(a.goal, target);
    a.goal.set(target.x, a.goal.y, target.z);
    a.goalMode = mode;
    a.goalArrive = arrive;
    if (a.moveStatus !== 'moving' || a.pathCount === 0) {
      a._needPath = true;
      a.moveStatus = 'moving';
      a._stuckTimer = 0;
      a._stuckAnchor.copy(a.object.position);
    } else if (moved > 0.01 && hdist(a.goal, a.pathTarget) > (mode === 'run' ? 0.75 : 1.5)) {
      a._needPath = true;
    }
  }

  stop() {
    const a = this.a;
    a.moveStatus = 'idle';
    a.pathCount = 0;
    a.pathIndex = 0;
    a._needPath = false;
    a._doorWait = null;
    a._sidestep = 0;
  }

  syncNav(world) {
    const a = this.a;
    this._world = world;
    const nav = world.getNav ? world.getNav(this.cfg.floor) : null;
    if (!nav) return;
    if (nav !== a._navRef || nav.version !== a._navVersion) {
      a.nav.setNav(nav, world.doors);
      a._navRef = nav;
      a._navVersion = nav.version;
      const pq = propQuery(world, this.cfg.floor);
      if (pq) a.nav.buildSoft(pq);
      if (a.moveStatus === 'moving') a._needPath = true;
    } else if (a.nav.doors !== world.doors) {
      a.nav.doors = world.doors;
    }
  }

  requestPath() {
    const a = this.a;
    const pos = a.object.position;
    a._lastPathTime = a._time;
    a._needPath = false;
    a.pathTarget.copy(a.goal);
    // a goal his nav can't reach (a gap between desks, a cupboard, a closed-off room): walk to the
    // nearest cell he can reach instead of letting A* flood the whole school for a partial path
    let gx = a.goal.x;
    let gz = a.goal.z;
    // open leaves standing into rooms block cells the static grid thinks are free
    if (this._world?.doors) a.nav.updateLeaves(this._world.doors, this.cfg.floor, this.cfg.radius);
    const alt = a.nav.reachableNear(pos.x, pos.z, gx, gz);
    if (alt) {
      gx = alt.x;
      gz = alt.z;
    }
    const n = a.nav.findPath(pos.x, pos.z, gx, gz, a.path, 256);
    a.pathCount = n;
    a.pathIndex = 0;
    a.pathRequests = (a.pathRequests || 0) + 1;
    // where the path really ends, and how far that is from what he wanted (the stand-off gap)
    const ex = n ? a.path[(n - 1) * 2] : pos.x;
    const ez = n ? a.path[(n - 1) * 2 + 1] : pos.z;
    a.pathEnd.set(ex, a.pathEnd.y, ez);
    a._pathGap = Math.hypot(ex - a.goal.x, ez - a.goal.z);
    // partial = he can't get where he wanted: no path, A* gave up, another component, or the path ends
    // short of the goal (A* snaps an impassable goal to the nearest open cell without saying so)
    a._pathPartial = !n || !!a.nav.lastPartial || !!alt || a._pathGap > 0.45;
    if (!n) {
      const d = hdist(pos, a.goal);
      a.moveStatus = d <= a.goalArrive + 0.3 ? 'arrived' : alt && hdist(pos, alt) < 0.6 ? 'arrived' : 'failed';
    }
  }

  /** The leaf of `door` sweeps through where he stands (he'd be inside it while it opens). */
  _inSwing(door) {
    const pos = this.a.object.position;
    const h = door.hinge || door.pivot?.position;
    if (!h || door.openAngle === undefined || door.baseRot === undefined) return false;
    const L = (door.leafLen || 1.16) + this.cfg.radius + 0.08;
    const dh = Math.hypot(pos.x - h.x, pos.z - h.z);
    if (dh >= L) return false;
    const th = door.baseRot + door.openAngle;
    const tipX = h.x + Math.cos(th) * (door.leafLen || 1.16);
    const tipZ = h.z - Math.sin(th) * (door.leafLen || 1.16);
    const n = door.n;
    if (!n) return false;
    const sideTip = (tipX - door.position.x) * n.x + (tipZ - door.position.z) * n.z;
    const sideMe = (pos.x - door.position.x) * n.x + (pos.z - door.position.z) * n.z;
    return sideTip * sideMe > 0;
  }

  /** Look ahead along the path for a door that isn't fully open; starts the stop/open/wait sequence. */
  checkDoorAhead(world, dirX, dirZ) {
    const a = this.a;
    if (!a.nav.nav || !world.doors) return false;
    const pos = a.object.position;
    for (let k = 1; k <= 3; k++) {
      const L = 0.3 * k + 0.25;
      const di = a.nav.doorAt(pos.x + dirX * L, pos.z + dirZ * L);
      if (di <= 0) continue;
      const door = world.doors[di - 1];
      if (!door || door.active === false) return false;
      const fully = door.fullyOpen ?? door.isOpen; // mock worlds have no leaf angle: isOpen is all there is
      if (fully) return false;
      if (door.isLocked && !door.isOpen) {
        a.nav.blockDoor(di - 1);
        a._needPath = true;
        return true;
      }
      const chasing = this.cfg.isChasing();
      if (door.isOpen) {
        // ajar, or still swinging: push it the rest of the way and wait for the leaf
        door.open?.('enemy');
        a._doorWait = { door, index: di - 1, phase: 'after', t: this.cfg.doorOpenHold ?? 0, max: 1.6 };
      } else {
        a._doorWait = { door, index: di - 1, phase: this._inSwing(door) ? 'clear' : 'pause', t: this.cfg.doorPause(chasing), max: 1.6 };
        this.cfg.onDoorPause?.(door, chasing);
      }
      a.speed = Math.min(a.speed, 0.4);
      return true;
    }
    return false;
  }

  /** Door sequence step. Returns { yaw, speed, back } for this frame. */
  _doorStep(dt, world) {
    const a = this.a;
    const w = a._doorWait;
    const door = w.door;
    const pos = a.object.position;
    const out = this._doorOut || (this._doorOut = { yaw: null, speed: 0, back: false });
    out.yaw = door.position ? yawTo(door.position.x - pos.x, door.position.z - pos.z) : null;
    out.speed = 0;
    out.back = false;
    w.t -= dt;
    if (w.phase === 'clear') {
      // standing where the leaf will swing: step back out of its arc first (≤ 0.8 s)
      if (!this._inSwing(door) || w.t < -0.8) {
        w.phase = 'pause';
        w.t = 0.15;
      } else {
        out.back = true;
        out.speed = 0.7;
      }
    } else if (w.phase === 'pause' && w.t <= 0) {
      if (!door.isOpen && !door.isLocked) door.open?.('enemy');
      w.phase = 'after';
      w.t = this.cfg.doorOpenHold ?? 0;
      w.max = 1.6;
    } else if (w.phase === 'after') {
      w.max -= dt;
      const fully = door.fullyOpen ?? door.isOpen;
      if ((fully && w.t <= 0) || w.max <= 0) {
        a._doorWait = null;
        if (door.isLocked && !door.isOpen) {
          a.nav.blockDoor(w.index);
          a._needPath = true;
        } else if (!fully) {
          // it won't open (someone in its way): treat it as shut for a moment and look for another way
          a.nav.blockDoor(w.index);
          a._needPath = true;
          a._doorBlockT = 4;
          a._doorBlockIdx = w.index;
        }
      }
    }
    return out;
  }

  startTurn(diffYaw) {
    const a = this.a;
    if (!a.anim || !this.cfg.turnClips) return false;
    const name = diffYaw > 0 ? 'turn_left' : 'turn_right';
    if (!a.anim.has(name)) return false;
    const dur = a.anim.duration(name) * 0.85;
    a._turn = { left: diffYaw, rate: diffYaw / dur, time: dur, name };
    a.anim.play(name, { fade: 0.15, restart: true, timeScale: Math.abs(diffYaw) > 150 * DEG ? 0.85 : 1 });
    a._wantAnim = name;
    return true;
  }

  /** Moves him by (dx, dz) with full-radius collision on his floor; keeps y on the floor; stair guard. */
  step(world, dx, dz) {
    const a = this.a;
    const pos = a.object.position;
    _vD.x = dx;
    _vD.y = 0;
    _vD.z = dz;
    const np = world.moveCircle(pos, _vD, this.cfg.radius, a._vMove || _vOut, this._moveOpts);
    const moved = Math.hypot(np.x - pos.x, np.z - pos.z);
    pos.x = np.x;
    pos.z = np.z;
    pos.y = floorBaseY(this.cfg.floor);
    this.guard();
    return moved;
  }

  /** Push open any ajar (open, not fully open), unlocked leaf within reach of his body. */
  _shoveAjar(world) {
    const pos = this.a.object.position;
    const reach = this.cfg.radius + 0.35;
    for (const d of world.doors) {
      if (!d.isOpen || d.fullyOpen !== false || d.isLocked || d.active === false || (d.floor ?? 0) !== this.cfg.floor) continue;
      if (Math.abs(d.target) >= Math.abs(d.openAngle) * 0.9) continue; // already on its way
      const h = d.hinge || d.pivot?.position;
      if (!h || Math.hypot(pos.x - h.x, pos.z - h.z) > (d.leafLen || 1.16) + reach) continue;
      const seg = d.leafSeg;
      if (seg && (seg.ax !== seg.bx || seg.az !== seg.bz)) {
        // distance from his centre to the leaf segment
        const vx = seg.bx - seg.ax;
        const vz = seg.bz - seg.az;
        const u = clamp(((pos.x - seg.ax) * vx + (pos.z - seg.az) * vz) / (vx * vx + vz * vz), 0, 1);
        if (Math.hypot(pos.x - (seg.ax + vx * u), pos.z - (seg.az + vz * u)) > reach) continue;
      }
      d.open?.('enemy');
    }
  }

  /** A door on his floor still swinging within reach of his body (its leaf could sweep into him). */
  _swingNear(world) {
    const doors = world.doors;
    if (!doors) return false;
    const pos = this.a.object.position;
    const r = this.cfg.radius + 0.1;
    for (let i = 0; i < doors.length; i++) {
      const d = doors[i];
      if (d.angle === d.target || d.active === false || (d.floor ?? 0) !== this.cfg.floor) continue;
      const h = d.hinge || d.pivot?.position;
      if (h && Math.hypot(pos.x - h.x, pos.z - h.z) < (d.leafLen || 1.16) + r) return true;
    }
    return false;
  }

  /** Never on a stair flight (nav.zone 1): push back to the last good spot and say so (tests: never fires). */
  guard() {
    const a = this.a;
    const pos = a.object.position;
    const nav = a.nav.nav;
    if (!nav?.zone) return;
    const i = a.nav.index(pos.x, pos.z);
    if (i >= 0 && nav.zone[i] === 1) {
      this.stairGuardHits++;
      if (this.stairGuardHits === 1 || this.stairGuardHits % 120 === 0) console.warn(`[enemy] ${a.who} stepped onto a stair cell; pushed back`);
      if (this._lastValid.ok) {
        pos.x = this._lastValid.x;
        pos.z = this._lastValid.z;
      }
    } else {
      this._lastValid.x = pos.x;
      this._lastValid.z = pos.z;
      this._lastValid.ok = true;
    }
  }

  /** Path following + turning + collision-aware motion + stuck handling (the Caretaker's, shared). */
  locomote(dt, world) {
    const a = this.a;
    const cfg = this.cfg;
    const pos = a.object.position;
    let targetSpeed = 0;
    let turnRate = cfg.turn.pivot ?? 2.4;
    let desiredYaw = null;
    let back = false;

    if (a._doorBlockT > 0) {
      a._doorBlockT -= dt;
      if (a._doorBlockT <= 0) a.nav.blockDoor(a._doorBlockIdx, false);
    }

    if (a._turn) {
      // in-place pivot driven by the turn clip
      const t = a._turn;
      const step = t.rate * dt;
      if (Math.abs(step) >= Math.abs(t.left)) {
        a.yaw = wrapAngle(a.yaw + t.left);
        a._turn = null;
      } else {
        a.yaw = wrapAngle(a.yaw + step);
        t.left -= step;
        t.time -= dt;
        if (t.time <= -0.3) a._turn = null;
      }
      a.speed = 0;
      a._actualSpeed = 0;
      a.object.rotation.y = a.yaw;
      return;
    }

    if (a._doorWait) {
      const o = this._doorStep(dt, world);
      desiredYaw = o.yaw;
      if (o.back) {
        back = true;
        targetSpeed = o.speed;
      }
    } else if (a.moveStatus === 'moving' && world) {
      // ---- path management (≤ 4 requests per second)
      const canPath = a._time - a._lastPathTime >= 0.25;
      if (a.nav.nav && (a._needPath || a.pathCount === 0) && canPath) this.requestPath();
      if (a.moveStatus === 'moving' && a.pathCount > 0) {
        let wx = a.path[a.pathIndex * 2];
        let wz = a.path[a.pathIndex * 2 + 1];
        let d = Math.hypot(wx - pos.x, wz - pos.z);
        while (a.pathIndex < a.pathCount - 1 && d < 0.45) {
          a.pathIndex++;
          wx = a.path[a.pathIndex * 2];
          wz = a.path[a.pathIndex * 2 + 1];
          d = Math.hypot(wx - pos.x, wz - pos.z);
        }
        const last = a.pathIndex === a.pathCount - 1;
        const goalD = hdist(pos, a.goal);
        if ((last && d < a.goalArrive) || goalD < a.goalArrive * 0.8) {
          a.moveStatus = 'arrived';
        } else {
          const dirX = (wx - pos.x) / Math.max(d, 1e-4);
          const dirZ = (wz - pos.z) / Math.max(d, 1e-4);
          desiredYaw = yawTo(dirX, dirZ);
          const diffYaw = wrapAngle(desiredYaw - a.yaw);
          const run = a.goalMode === 'run';
          // big in-place turn when starting to walk
          if (!run && a.speed < 0.35 && Math.abs(diffYaw) > 100 * DEG && this.startTurn(diffYaw)) return;
          turnRate = run ? cfg.turn.run : cfg.turn.walk;
          targetSpeed = cfg.speedFor(a.goalMode) * clamp(Math.cos(diffYaw) * 1.25, 0.12, 1);
          if (cfg.cornerCap) targetSpeed = Math.min(targetSpeed, cfg.cornerCap(Math.abs(diffYaw), a.goalMode));
          if (last && !run) targetSpeed *= clamp(d / 1.3, 0.4, 1);
          if (this.checkDoorAhead(world, dirX, dirZ)) targetSpeed = 0;
          if (a._sidestep > 0) {
            a._sidestep -= dt;
            desiredYaw = wrapAngle(desiredYaw + a._sidestepDir * 80 * DEG);
            targetSpeed = cfg.speedFor('walk') * 0.8;
          }
        }
      } else if (a.moveStatus === 'moving' && a.pathCount === 0 && a.nav.nav === null) {
        // no nav grid at all: walk straight with collision
        const d = hdist(pos, a.goal);
        if (d < a.goalArrive) a.moveStatus = 'arrived';
        else {
          desiredYaw = yawTo(a.goal.x - pos.x, a.goal.z - pos.z);
          targetSpeed = cfg.speedFor(a.goalMode);
        }
      }
    }

    if (desiredYaw === null && a._facing && a.moveStatus !== 'moving') {
      const dx = a._faceTarget.x - pos.x;
      const dz = a._faceTarget.z - pos.z;
      if (dx * dx + dz * dz > 0.04) {
        desiredYaw = yawTo(dx, dz);
        const diffYaw = wrapAngle(desiredYaw - a.yaw);
        if (Math.abs(diffYaw) > 55 * DEG && a.speed < 0.3 && !cfg.isCapturing() && this.startTurn(diffYaw)) return;
        turnRate = cfg.turn.face;
      }
    }
    a._facing = false;

    // ---- turning
    if (desiredYaw !== null) {
      const diffYaw = wrapAngle(desiredYaw - a.yaw);
      const maxStep = turnRate * dt;
      a.yaw = wrapAngle(a.yaw + clamp(diffYaw, -maxStep, maxStep));
    }
    a.object.rotation.y = a.yaw;

    // ---- an ajar leaf sticking into the room beside his path (the nav grid can't see leaves): shove it open,
    // the same rule the world applies within 1.5 m of a doorway (checked 4× a second)
    if ((this._ajarT = (this._ajarT || 0) - dt) <= 0) {
      this._ajarT = 0.25;
      if (targetSpeed > 0.2 && world?.doors) this._shoveAjar(world);
    }

    // ---- speed & collision-aware motion (always his full radius)
    const accel = targetSpeed > a.speed ? (a.goalMode === 'run' ? cfg.accel.run : cfg.accel.walk) : cfg.accel.brake;
    a.speed += clamp(targetSpeed - a.speed, -accel * dt, accel * dt);
    if (a.speed > 0.01 && world?.moveCircle) {
      const sgn = back ? -1 : 1;
      const fx = -Math.sin(a.yaw) * sgn;
      const fz = -Math.cos(a.yaw) * sgn;
      const moved = this.step(world, fx * a.speed * dt, fz * a.speed * dt);
      a._actualSpeed = lerp(a._actualSpeed, moved / Math.max(dt, 1e-4), clamp(dt * 10, 0, 1));
    } else {
      a._actualSpeed = lerp(a._actualSpeed, 0, clamp(dt * 10, 0, 1));
      if (a.speed <= 0.01) a.speed = 0;
      // standing still while a leaf swings into him (the world opens doors whoever is in the arc): let the
      // leaf shove him aside like any collision, instead of passing through his body
      if (world?.moveCircle && this._swingNear(world)) this.step(world, 0, 0);
    }

    // ---- stuck detection & recovery
    if (a.moveStatus === 'moving' && targetSpeed > 0.3 && !a._doorWait) {
      a._stuckTimer += dt;
      if (a._stuckTimer > 1.2) {
        const prog = hdist(pos, a._stuckAnchor);
        if (prog < 0.25) {
          a._stuckCount++;
          a.stuckEvents++;
          if (a._stuckCount === 1) a._needPath = true;
          else if (a._stuckCount === 2) {
            a._sidestep = 0.7;
            a._sidestepDir = a.rng() < 0.5 ? -1 : 1;
            a._needPath = true;
          } else {
            a.moveStatus = 'failed';
            a._stuckCount = 0;
          }
        } else a._stuckCount = 0;
        a._stuckTimer = 0;
        a._stuckAnchor.copy(pos);
      }
    } else {
      a._stuckTimer = 0;
      a._stuckAnchor.copy(pos);
    }
  }

  /** Director possession: drive with stick input through the same speeds and collision. */
  drive(dt, world, inp, speedWalk, speedRun, turnRate = 5) {
    const a = this.a;
    const mx = clamp(+inp.mx || 0, -1, 1);
    const mz = clamp(+inp.mz || 0, -1, 1);
    const yaw = Number.isFinite(inp.yaw) ? inp.yaw : a.yaw;
    let len = Math.hypot(mx, mz);
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    let vx = fx * mz + rx * mx;
    let vz = fz * mz + rz * mx;
    if (len > 1) {
      vx /= len;
      vz /= len;
      len = 1;
    }
    const want = len > 0.05 ? yawTo(vx, vz) : yaw;
    const diff = wrapAngle(want - a.yaw);
    a.yaw = wrapAngle(a.yaw + clamp(diff, -turnRate * dt, turnRate * dt));
    a.object.rotation.y = a.yaw;
    const target = len > 0.05 ? (inp.run ? speedRun : speedWalk) * len : 0;
    const accel = target > a.speed ? (inp.run ? this.cfg.accel.run : this.cfg.accel.walk) : this.cfg.accel.brake;
    a.speed += clamp(target - a.speed, -accel * dt, accel * dt);
    if (a.speed > 0.01 && world?.moveCircle) {
      // he moves where he faces, like the AI (turn-limited), so a Director can't strafe faster than he can turn
      const k = clamp(Math.cos(diff) * 1.25, 0.15, 1);
      const moved = this.step(world, -Math.sin(a.yaw) * a.speed * k * dt, -Math.cos(a.yaw) * a.speed * k * dt);
      a._actualSpeed = lerp(a._actualSpeed, moved / Math.max(dt, 1e-4), clamp(dt * 10, 0, 1));
    } else {
      a._actualSpeed = lerp(a._actualSpeed, 0, clamp(dt * 10, 0, 1));
      if (a.speed <= 0.01) a.speed = 0;
    }
  }
}

// =============================================================================================== puppet
/**
 * Co-op guest: the host's enemy from snapshots. Keeps its own buffer (sentAt = host clock ms), samples
 * `delay` ms behind, interpolates, and only extrapolates (≤ 120 ms) while the enemy is moving briskly with
 * an unchanged state and animation. follow() moves the body toward the sample with moveCircle (collision),
 * snapping only when it is more than 1 m off (a lost packet burst, a capture slide).
 */
export class Puppet {
  constructor(agent, { radius, floor, decode, delay = 110 }) {
    this.a = agent;
    this.radius = radius;
    this.floor = floor;
    this.decode = decode;
    this.delay = delay;
    this.list = [];
    this.out = {};
    this.snaps = 0;
    this._opts = { floor, enemy: true };
    this._d = { x: 0, y: 0, z: 0 };
  }
  get size() {
    return this.list.length;
  }
  clear() {
    this.list.length = 0;
  }
  push(arr, sentAt) {
    if (!Array.isArray(arr) || arr.length < 15) return false;
    for (let i = 0; i < arr.length; i++) if (typeof arr[i] !== 'number' || !Number.isFinite(arr[i])) return false;
    const s = this.decode(arr);
    if (!s) return false;
    const t = Number.isFinite(sentAt) ? sentAt : performance.now();
    const L = this.list;
    if (L.length && t <= L[L.length - 1].t) return false; // stale / reordered (unreliable channel)
    L.push({ t, s });
    if (L.length > 24) L.shift();
    return true;
  }
  sample(now) {
    const L = this.list;
    if (!L.length) return null;
    const t = now - this.delay;
    const out = this.out;
    if (t <= L[0].t) return Object.assign(out, L[0].s);
    for (let i = L.length - 1; i > 0; i--) {
      const a = L[i - 1];
      const b = L[i];
      if (t >= a.t) {
        if (t <= b.t) {
          const k = (t - a.t) / Math.max(1, b.t - a.t);
          Object.assign(out, b.s);
          out.x = a.s.x + (b.s.x - a.s.x) * k;
          out.z = a.s.z + (b.s.z - a.s.z) * k;
          out.y = a.s.y + (b.s.y - a.s.y) * k;
          out.yaw = a.s.yaw + wrapAngle(b.s.yaw - a.s.yaw) * k;
          return out;
        }
        break;
      }
    }
    const b = L[L.length - 1];
    Object.assign(out, b.s);
    if (L.length > 1) {
      const a = L[L.length - 2];
      const brisk = a.s.spd > 1 && b.s.spd > 1;
      const same = a.s.state === b.s.state && a.s.anim === b.s.anim && a.s.flags === b.s.flags;
      const k = Math.min(t - b.t, 120) / Math.max(1, b.t - a.t);
      if (brisk && same && k > 0) {
        out.x = b.s.x + (b.s.x - a.s.x) * k;
        out.z = b.s.z + (b.s.z - a.s.z) * k;
      }
    }
    return out;
  }
  /** Move the body toward (x, z) with collision; snap when > 1 m off. */
  follow(world, s, dt = 1 / 60) {
    const pos = this.a.object.position;
    let ex = s.x - pos.x;
    let ez = s.z - pos.z;
    const err = Math.hypot(ex, ez);
    if (err > 1 || !world?.moveCircle) {
      if (err > 1) this.snaps++;
      pos.set(s.x, Number.isFinite(s.y) ? s.y : floorBaseY(this.floor), s.z);
      return;
    }
    if (err > 1e-4) {
      // catch up after a lost packet without a visible lurch: at most 1.5× his speed (6 m/s floor)
      const cap = Math.max(6, (Number(s.spd) || 0) * 1.5) * Math.min(dt, 0.1);
      if (err > cap) {
        ex *= cap / err;
        ez *= cap / err;
      }
      this._d.x = ex;
      this._d.z = ez;
      const np = world.moveCircle(pos, this._d, this.radius, this.a._vMove, this._opts);
      pos.x = np.x;
      pos.z = np.z;
    }
    pos.y = Number.isFinite(s.y) ? s.y : floorBaseY(this.floor);
  }
}

// =============================================================================================== possession
/** Director possession state (multiplayer.md §5.4). The enemy applies the input with its own mover. */
export class Possession {
  constructor() {
    this.by = null;
    this.input = { mx: 0, mz: 0, yaw: 0, pitch: 0, run: false, action: null };
    this.lastInput = 0;
    this.timeout = 3;
  }
  get active() {
    return this.by !== null;
  }
  set(by, now) {
    this.by = by ?? null;
    this.lastInput = now;
    const i = this.input;
    i.mx = i.mz = i.pitch = 0;
    i.run = false;
    i.action = null;
  }
  apply(inp, by, now, yawNow) {
    if (this.by === null || !inp || typeof inp !== 'object') return false;
    if (by !== undefined && by !== null && by !== this.by) return false;
    const i = this.input;
    const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    i.mx = clamp(num(inp.mx), -1, 1);
    i.mz = clamp(num(inp.mz), -1, 1);
    i.yaw = num(inp.yaw, yawNow);
    i.pitch = clamp(num(inp.pitch), -1.4, 1.4);
    i.run = !!inp.run;
    i.action = typeof inp.action === 'string' ? inp.action.slice(0, 16) : null;
    this.lastInput = now;
    return true;
  }
  timedOut(now) {
    return this.by !== null && now - this.lastInput > this.timeout;
  }
}
