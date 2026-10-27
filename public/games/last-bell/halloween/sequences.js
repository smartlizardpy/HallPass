// LAST BELL — The Halloween Shift: the authored haunts the HorrorDirector chooses from.
//
// def = {
//   id, phases: [...]   tension states it may play in          cost      budget it spends
//   major               a peak (spaced by INTENSITY.majorGap)  dreadOk   a major allowed in DREAD
//   bg                  background (runs beside a foreground one; silent world changes out of view)
//   blackout / onRestore  only inside a blackout / as what the returning lights reveal
//   uses: [channels]    exclusive with running haunts using the same: watcher, pane, lights, sound, head, door
//   motifs: [...]       for novelty / ignored-sound memory      notAfter: { idOrMotif: s }  compatibility
//   behind / far / watcher / head / ambient   hints for the behaviour heuristics
//   act (lowest act it may play in), once (once per run), sting (built round a loud hit: waits for the gap),
//   signature (a climax: act III leans towards one per run), hidden (only while the player hides)
//   phases may be 'AFTER': an aftershock, the second scare in the calm after a major (director.js)
//   cooldown, max (per run), minTime (s into the run), intensity: [levels allowed]
//   plan(d, info) → data | null   cheap: can it happen right now, and where?
//   run(d, ctx, plan) → result   async; every wait goes through ctx (aborts cleanly)
// }
//
// Rules every haunt keeps: the Watcher only appears where gaze.canPlace() allows (never pops into view) and
// only leaves when unobserved (or as its withdraw clip, or when its light goes); posters / boards / clocks /
// drawings / blood change out of view (the witnessed exceptions are slow and physical: a drip, a door); no
// haunt makes a noise the Caretaker hears; nothing blocks a path or touches an objective.

import { BOARD_LINES } from './posters.js';
import { glimpse, corridorPath, endStage } from './glimpse.js';
import { ET } from '../world-layout.js';
import { WALL_HEIGHT } from '../config.js';

const yawTo = (d, pos) => Math.atan2(-(d.gaze.eye.x - pos.x), -(d.gaze.eye.z - pos.z));
const unseen = (d, p, heights = [0.4, 1.4]) => {
  const t = d.gaze.test(p, { heights, margin: 0.08 });
  return !t.los || !t.inFrustum;
};
const V = (x, y, z) => ({ x, y, z });

/** Show the Watcher at a spot; wait to be seen; hold; leave the right way. */
async function haunt(d, ctx, spot, o = {}) {
  const w = d.watcher;
  const pose = o.pose || 'stand';
  if (!w.appear(spot, { pose, face: o.face !== false, yaw: o.yaw ?? (o.faceSpot ? spot.yaw : yawTo(d, spot.pos)) })) {
    ctx.res = 'skipped';
    return 'skipped';
  }
  ctx.pose = pose;
  d.markSpot(spot.id, spot.pos);
  ctx.onAbort(() => w.active && w.vanish('unseen'));
  const seen = await ctx.until(() => w.seen || !w.active, o.timeout ?? 22);
  if (!seen || !w.active) {
    w.vanish('unseen');
    await ctx.until(() => !w.active, 30);
    return 'unseen';
  }
  const near = () => (w.lastTest?.dist ?? 99) < (o.near ?? 4.5);
  const hold = d.range(o.holdMin ?? 1.2, o.holdMax ?? 2.6);
  await ctx.until(() => w.seenFor >= hold || near() || !w.seen, hold + 6);
  if (o.notice !== false && w.seen && !near() && (await notice(d, ctx, w))) return 'noticed';
  const close = near();
  if (o.exit) await o.exit(w, close);
  else if (o.withdraw || close) w.withdraw();
  else w.vanish('unseen');
  await ctx.until(() => !w.active, 40);
  return close ? 'approached' : 'seen';
}

function nearestFixture(d, p, maxD = 12) {
  let best = null, bd = maxD * maxD;
  for (const f of d.lights.lights.fixtures) {
    if (f.kind === 'glow' || (f.floor || 0) !== 0) continue;
    const dd = (f.x - p.x) ** 2 + (f.z - p.z) ** 2;
    if (dd < bd) {
      bd = dd;
      best = f;
    }
  }
  return best;
}

function wallsOf(d, room) {
  return d.decor._walls(room).filter((s) => s.kind === ET.WALL || s.kind === ET.EXT);
}

/**
 * Where the slap lands: a bare patch of wall 1-4 m away, facing you, off to the side of your view (13-45 degrees
 * from the centre: you see the hand land, but you are not staring at the spot it comes from). Failing that, a patch
 * out of sight (behind you), unless `inViewOnly`.
 */
function slapSpot(d, inViewOnly = false) {
  const r = d.room;
  if (!r) return null;
  const pp = d.pp;
  const halfH = Math.atan(d.gaze.tanH || 0.7);
  let best = null, bs = -1e9;
  for (const s of wallsOf(d, r)) {
    if ((pp.x - s.x) * s.nx + (pp.z - s.z) * s.nz < 0.3) continue; // its face is towards you
    const a0 = (pp.x - s.x) * s.tx + (pp.z - s.z) * s.tz;
    for (const o of [0, 0.5, -0.5, 1, -1, 1.6, -1.6, 2.2, -2.2]) {
      const a = Math.max(-1.6, Math.min(1.6, a0 + o));
      const p = { ...s, x: s.x + s.tx * a, z: s.z + s.tz * a };
      const dd = Math.hypot(p.x - pp.x, p.z - pp.z);
      if (dd < 1 || dd > 4) continue;
      if (!d.blood.wallClear(p, 0.3, 0) || !d.blood.wallClear(p, 0.3, 0.45) || !d.blood.wallClear(p, 0.3, -0.45)) continue;
      const t = d.gaze.test(V(p.x + s.nx * 0.25, 0, p.z + s.nz * 0.25), { heights: [1.15, 1.45] }); // off the wall: it blocks its own ray
      let sc;
      if (t.los && t.inFrustum && t.angle > 0.22 && t.angle < Math.min(0.8, halfH * 0.85)) sc = 10 - Math.abs(t.angle - 0.5) * 4 - Math.abs(dd - 2) * 0.6;
      else if (!inViewOnly && !t.inFrustum && unseen(d, V(p.x, 0, p.z), [1.1, 1.5])) sc = -dd;
      else continue;
      if (sc > bs) {
        bs = sc;
        best = { ...p, id: 'wall:' + r.id };
      }
    }
  }
  return best;
}

/** Wall stretches with a clear patch for blood (not behind lockers, shelves or boards), moved onto that patch. */
function bloodWalls(d, room, half) {
  const out = [];
  for (const s of wallsOf(d, room)) {
    const a = d.blood.clearAlong(s, half, d.rng);
    if (a != null) out.push({ ...s, x: s.x + s.tx * a, z: s.z + s.tz * a });
  }
  return out;
}

/** Overhead footsteps along a line (floor 2 is closed off tonight). */
async function stepsAcross(d, ctx, from, to, n, gap = 0.85) {
  for (let i = 0; i < n; i++) {
    const u = i / Math.max(1, n - 1);
    d.sound('hw_step', V(from.x + (to.x - from.x) * u, WALL_HEIGHT + 0.5, from.z + (to.z - from.z) * u), { volume: 0.55, rate: 0.85 });
    await ctx.wait(gap * d.range(0.9, 1.15));
  }
}

/** The torch dies for a moment (no click: it wasn't the player). One dip, well under the flash limit. */
/** A corridor tube ahead (within `deg` of the view), `near`-`far` m away, lit, with a clear view down to its floor. */
function glimpseTube(d, near, far, deg = 30, not = null) {
  const e = d.gaze.eye, w = d.game.world;
  let best = null, bs = -1;
  for (const f of d.lights.lights.fixtures) {
    if (f.kind === 'glow' || (f.floor || 0) !== 0 || f.state === 'broken' || (f.hmul ?? 1) < 0.5 || f === not) continue;
    if (not && Math.hypot(f.x - not.x, f.z - not.z) < 3.3) continue;
    const dist = Math.hypot(f.x - e.x, f.z - e.z);
    if (dist < near || dist > far) continue;
    if (!w.rooms[f.roomId]?.isCorridor || !w.isWalkable(f.x, f.z, 0.3, 0) || !d.gaze.facing(f, deg)) continue;
    if (!w.lineOfSight(e, V(f.x, 1.3, f.z)) || !w.lineOfSight(e, V(f.x, 0.3, f.z))) continue;
    const stage = endStage(w, e, f, { near, far: far + 3 }); // the last light, at the end of the corridor
    if (!stage) continue;
    const s = d.memory.novelty('spot', 'tube:' + f.index) * (0.7 + d.rng() * 0.6);
    if (s > bs) {
      bs = s;
      best = { f, stage };
    }
  }
  return best;
}

function torchBlink(d, sec = 0.3) {
  const p = d.game.player;
  if (!p?.flashlightOn || p.isHidden) return;
  p.setFlashlight(false, { silent: true });
  d.later(sec, () => p.setFlashlight(true, { silent: true }));
}

/** A point `dist` m straight behind the eye (from the view direction), or null. */
function behindPoint(d, dist, side = 0) {
  const f = d.gaze.forward;
  const fl = Math.hypot(f.x, f.z) || 1;
  const fx = f.x / fl, fz = f.z / fl;
  return V(d.gaze.eye.x - fx * dist - fz * side, 0, d.gaze.eye.z - fz * dist + fx * side);
}

/** Right at the back of the head, a little to one side (so the cue resolves as they turn). */
function earBehind(d, side, back = 0.3) {
  const p = behindPoint(d, back, side * 0.14);
  return V(p.x, d.gaze.eye.y, p.z);
}

/** Bodycam signal loss: a black screen with static and "NO SIGNAL" (DOM overlay over the canvas). */
function noSignal(on) {
  let el = document.querySelector('.hw-nosignal');
  if (!el && on) {
    el = document.createElement('div');
    el.className = 'hw-nosignal';
    el.innerHTML = '<span>NO SIGNAL</span>';
    document.body.appendChild(el);
  }
  if (el) el.hidden = !on;
}

/**
 * Fixtures along the line from the player to `to`, farthest first (for lights dying one by one towards them).
 * Within `band` m of the line, beyond 1.5 m from the player.
 */
function fixturesAlong(d, to, band = 4.5) {
  const a = d.pp, dx = to.x - a.x, dz = to.z - a.z;
  const L = Math.hypot(dx, dz) || 1;
  const out = [];
  for (const f of d.lights.lights.fixtures) {
    if (f.kind === 'glow' || (f.floor || 0) !== 0) continue;
    const u = ((f.x - a.x) * dx + (f.z - a.z) * dz) / L;
    if (u < 1.5 || u > L + 2.5) continue;
    const off = Math.abs((f.x - a.x) * dz - (f.z - a.z) * dx) / L;
    if (off <= band) out.push({ f, u });
  }
  return out.sort((p, q) => q.u - p.u).map((p) => p.f);
}

/** The torch is off and the lights round pos are dead: it can be put there even close and in view. */
function darkFor(d, pos) {
  return !d.game.player.flashlightOn && d.lights.levelAt(pos.x, pos.z) < 0.16;
}

/** A clear straight run from the eye to p (sight at chest and knee height): nothing for a rush to pass through. */
function clearRun(d, p) {
  const w = d.game.world;
  return w.lineOfSight(d.gaze.eye, V(p.x, 1.4, p.z)) && w.lineOfSight(V(d.gaze.eye.x, 0.5, d.gaze.eye.z), V(p.x, 0.5, p.z));
}

/** "It notices you": in act III, a Watcher stared at too long snaps its head, hits, and is gone in the dark. */
async function notice(d, ctx, w) {
  if (d.act < 3 || d.once.has('notice') || !d.canSting() || d.rng() > 0.55) return false;
  if ((w.lastTest?.dist ?? 99) > 14) return false;
  const held = await ctx.until(() => !w.seen || w.seenFor >= d.range(2.3, 3), 4);
  if (!held || !w.seen) return false;
  d.once.add('notice');
  w.playOnce('snap', 'stare');
  await ctx.wait(0.22);
  const rooms = d.lights.roomsNear(w.position, 3);
  ctx.onAbort(() => d.lights.normal(rooms, 1));
  await d.sting(ctx, { volume: 0.95 });
  w.vanish('now'); // inside the bodycam stutter
  d.lights.set(rooms, 0, 0.06);
  torchBlink(d, 0.35);
  await ctx.wait(1.6);
  d.lights.normal(rooms, 1.2);
  d.duck(1, 3);
  return true;
}

// ------------------------------------------------------------------------------------------------ catalogue
export const SEQUENCES = [
  // ===== background: the school changes while you aren't looking =====
  {
    id: 'poster_turn', phases: ['CALM', 'UNEASE', 'DREAD', 'RECOVERY'], bg: true, cost: 0.4, cooldown: 22, uses: ['poster'], motifs: ['poster'],
    plan(d) {
      const cap = d.intensity === 'mild' ? 2 : d.time > 200 ? 3 : 2;
      const list = d.posters.list.filter((p) => p.state < cap && d.posters.canChange(p, d.gaze));
      if (!list.length) return null;
      // prefer posters the player has walked past (rooms visited), so they notice the change
      list.sort((a, b) => (d.gaze.visits.has(b.room) ? 1 : 0) - (d.gaze.visits.has(a.room) ? 1 : 0) || a.state - b.state);
      return { posters: list.slice(0, 1 + Math.floor(d.rng() * 3)) };
    },
    async run(d, ctx, { posters }) {
      for (const p of posters) {
        if (!d.posters.canChange(p, d.gaze)) continue;
        d.posters.setState(p, p.state + 1);
        if (p.state >= 2) d.noteChange('poster', p.pos); // the first step is too slight to call out
        d.memory.note('spot', 'poster:' + p.id, d.time);
        d.markSpot('poster:' + p.id, p.pos);
      }
    },
  },
  {
    id: 'board_write', phases: ['UNEASE', 'DREAD', 'RECOVERY'], bg: true, cost: 0.5, cooldown: 70, max: 3, uses: ['board'], motifs: ['board'],
    plan(d) {
      const list = d.posters.boards.filter((b) => !b.changed && b.roomId !== d.room?.id && unseen(d, b.pos, [0]));
      return list.length ? { b: d.pick(list) } : null;
    },
    async run(d, ctx, { b }) {
      const used = new Set(d.posters.boards.map((x) => x.text));
      const lines = BOARD_LINES.filter((l) => !used.has(l));
      d.posters.boardWrite(b, d.pick(lines.length ? lines : BOARD_LINES));
      d.markSpot('board:' + b.id, b.pos);
      d.noteChange('board', b.pos);
    },
  },
  {
    id: 'clock_wrong', phases: ['UNEASE', 'DREAD'], bg: true, cost: 0.4, cooldown: 60, max: 3, uses: ['clock'], motifs: ['clock'],
    plan(d) {
      const list = d.posters.clocks.filter((c) => c.mode === 'normal' && unseen(d, c.pos, [0]));
      return list.length ? { c: d.pick(list) } : null;
    },
    async run(d, ctx, { c }) {
      d.posters.setClock(c, d.rng() < 0.5 ? 'backwards' : 'stopped');
      d.noteChange('clock', c.pos);
    },
  },
  {
    id: 'drawing_change', phases: ['UNEASE', 'DREAD'], bg: true, cost: 0.5, cooldown: 90, max: 2, uses: ['decor'], motifs: ['drawing'],
    plan(d) {
      const ok = d.decor.drawings.some((x) => x.kind !== 'figure' && unseen(d, x.mesh.position.clone().setY(0), [x.mesh.position.y]));
      return ok ? {} : null;
    },
    async run(d) {
      const x = d.decor.corruptDrawing((x) => unseen(d, x.mesh.position.clone().setY(0), [x.mesh.position.y]));
      if (x) d.noteChange('drawing', x.mesh.position);
    },
  },
  {
    id: 'blood_stain', phases: ['UNEASE', 'DREAD', 'RECOVERY'], bg: true, cost: 0.6, cooldown: 50, max: 4, uses: ['blood'], motifs: ['blood'],
    plan(d) {
      const rooms = d.lights.roomsNear(d.pp, 18).map((id) => d.game.world.rooms[id]).filter((r) => r && !r.isCorridor && r.id !== d.room?.id && d.gaze.visits.has(r.id));
      for (const r of rooms.sort(() => d.rng() - 0.5)) {
        const walls = bloodWalls(d, r, 0.35).filter((s) => unseen(d, V(s.x, 0, s.z), [0.5, 1.6]));
        if (walls.length) return { spot: { ...d.pick(walls), id: 'wall:' + r.id } };
      }
      return null;
    },
    async run(d, ctx, { spot }) {
      d.blood.wall(spot, { size: 'small', seed: (d.time * 1000) | 0, progress: 1 });
      d.markSpot(spot.id, spot);
    },
  },

  // ===== unease: sounds and small wrongness =====
  {
    id: 'distant_knock', phases: ['UNEASE', 'DREAD'], cost: 1.4, max: 3, cooldown: 55, uses: ['sound'], motifs: ['knock'], ambient: true,
    plan(d) {
      const doors = d.game.world.doors.filter((x) => (x.floor || 0) === 0 && x.kind === 'door' && !x.isLocked && x.roomB?.id !== d.room?.id);
      const list = doors.filter((x) => {
        const dd = d.dist(x.position);
        return dd > 7 && dd < 16 && !d.gaze.facing(x.position, 35);
      });
      const door = d.pick(list);
      return door ? { door, spot: { id: 'door:' + door.id, pos: door.position } } : null;
    },
    async run(d, ctx, { door }) {
      const p = V(door.position.x, 1.2, door.position.z);
      d.sound('hw_knock', p, { volume: 0.8 });
      d.markSpot('door:' + door.id, door.position);
      const heard = await d.reaction(ctx, 'knock', p, 4);
      // they went to look: the second knock comes from somewhere else entirely, or not at all
      if (heard && d.rng() < 0.4) {
        await ctx.wait(d.range(5, 9));
        const other = d.game.world.doors.find((x) => x !== door && (x.floor || 0) === 0 && x.kind === 'door' && d.dist(x.position) > 9 && d.dist(x.position) < 18);
        if (other) d.sound('hw_knock', V(other.position.x, 1.2, other.position.z), { volume: 0.6 });
      }
      return heard ? 'heard' : 'ignored';
    },
  },
  {
    id: 'steps_above', phases: ['UNEASE', 'DREAD'], cost: 1.5, cooldown: 80, max: 2, uses: ['sound'], motifs: ['step'],
    plan: () => ({}),
    async run(d, ctx) {
      const f = d.gaze.forward;
      const a = Math.atan2(f.z, f.x) + d.range(-0.6, 0.6) + Math.PI / 2;
      const from = V(d.pp.x + Math.cos(a) * 6, 0, d.pp.z + Math.sin(a) * 6);
      const to = V(d.pp.x - Math.cos(a) * 3, 0, d.pp.z - Math.sin(a) * 3);
      await stepsAcross(d, ctx, from, to, 5 + Math.floor(d.rng() * 3), 0.95);
      // and it stops right above you
      return (await d.reaction(ctx, 'step', V(to.x, 3, to.z), 3)) ? 'heard' : 'ignored';
    },
  },
  {
    id: 'chair_scrape', phases: ['UNEASE'], cost: 0.9, max: 2, cooldown: 60, uses: ['sound'], motifs: ['scrape'], ambient: true,
    plan(d) {
      const ids = d.lights.roomsNear(d.pp, 11).filter((id) => id !== d.room?.id);
      const rooms = ids.map((id) => d.game.world.rooms[id]).filter((r) => r && !r.isCorridor && !d.game.world.lineOfSight(d.gaze.eye, V(r.center.x, 1, r.center.z)));
      const r = d.pick(rooms);
      return r ? { r } : null;
    },
    async run(d, ctx, { r }) {
      const p = V(r.center.x + d.range(-1, 1), 0.4, r.center.z + d.range(-1, 1));
      d.sound('hw_scrape', p, { volume: 0.8 });
      return (await d.reaction(ctx, 'scrape', p, 4)) ? 'heard' : 'ignored';
    },
  },
  {
    id: 'hum_dim', phases: ['UNEASE', 'DREAD'], cost: 1.4, max: 2, cooldown: 70, uses: ['lights'], motifs: ['hum'],
    gate: (d) => !!d.room,
    plan(d) {
      const f = nearestFixture(d, d.pp, 7);
      return f ? { f, room: d.room.id } : null;
    },
    async run(d, ctx, { f, room }) {
      ctx.onAbort(() => d.lights.normal([room], 1));
      d.sound('hw_hum_die', V(f.x, f.y ?? 3, f.z), { volume: 0.9 });
      d.lights.set([room], 0.28, 2.4);
      await ctx.wait(d.range(6, 10));
      d.lights.normal([room], 1.6);
      await ctx.wait(1.6);
    },
  },
  {
    id: 'pane_face', phases: ['UNEASE', 'DREAD'], cost: 2, cooldown: 90, max: 2, uses: ['pane'], motifs: ['pane'],
    plan(d) {
      // a window you can see from here but aren't looking at (out of view now, so it can be there when you turn)
      const s = d.freshest(d.spots('pane', { min: 3, max: 11, los: true }).filter((s) => !d.gaze.facing(s.pos, 40) && d.gaze.canPlace(s.pos, [1.0, 1.6])));
      return s ? { spot: s } : null;
    },
    async run(d, ctx, { spot }) {
      if (!d.pane.show(spot)) return 'skipped';
      ctx.onAbort(() => d.pane.hideWhenUnseen() || (d._paneLeave = true));
      d.markSpot(spot.id, spot.pos);
      if (d.rng() < 0.45) d.sound('hw_tap', V(spot.pos.x, 1.4, spot.pos.z), { volume: 0.7 });
      const seen = await ctx.until(() => d.gaze.test(d.pane.mesh.position.clone().setY(0), { heights: [1.2, 1.6] }).perceived, 25);
      if (seen) {
        // it knows you saw it: it taps on the glass... then slams both palms on it, and you gasp
        const at = V(spot.pos.x, 1.4, spot.pos.z);
        await ctx.wait(d.range(0.5, 0.8));
        d.sound('hw_tap', at, { volume: 0.9 });
        await ctx.wait(d.range(0.45, 0.7));
        d.sound('hw_tap', at, { volume: 0.95, rate: 0.9 });
        await ctx.wait(d.range(0.6, 0.9));
        d.lastStingAt = d.time;
        d.sound('hw_slap', at, { volume: d.intensity === 'mild' ? 0.5 : 0.85, rate: 1.1 });
        d.jolt({ glitch: 0.25, hold: 0.05, kick: 4 });
        d.react(0.15, { gasp: 0.7, heart: 0.6 });
        // then it slides down the glass, out of sight below the window
        await ctx.wait(d.range(0.9, 1.4));
        const m = d.pane.mesh, y0 = m.position.y;
        for (let i = 1; i <= 24 && m.visible; i++) {
          m.position.y = y0 - 0.9 * (i / 24) ** 1.6;
          await ctx.wait(0.05);
        }
        m.visible = false;
        d.pane.spot = null;
        m.position.y = y0;
      }
      await ctx.until(() => d.pane.hideWhenUnseen(), 60);
      return seen ? 'seen' : 'unseen';
    },
  },
  {
    id: 'door_close', phases: ['UNEASE', 'DREAD'], cost: 1.4, cooldown: 75, max: 2, uses: ['door'], motifs: ['door'],
    gate: (d, info) => info.caretakerDist > 20,
    plan(d) {
      const w = d.game.world;
      const list = w.doors.filter((x) => (x.floor || 0) === 0 && x.kind === 'door' && x.isOpen && !x.pair && d.dist(x.position) > 4 && d.dist(x.position) < 10
        && d.gaze.facing(x.position, 35) && w.lineOfSight(d.gaze.eye, V(x.position.x, 1.2, x.position.z)));
      const door = d.pick(list);
      return door ? { door, spot: { id: 'door:' + door.id, pos: door.position } } : null;
    },
    async run(d, ctx, { door }) {
      d.duck(0.35, 0.8);
      ctx.onAbort(() => d.duck(1, 1.5));
      await ctx.wait(1.2);
      if (!door.close('world')) return 'blocked';
      await ctx.wait(3.5);
      d.duck(1, 2);
    },
  },
  {
    id: 'silence', phases: ['UNEASE', 'DREAD'], cost: 0.4, max: 3, cooldown: 70, uses: ['sound'], motifs: ['silence'],
    plan: () => ({}),
    async run(d, ctx) {
      ctx.onAbort(() => d.duck(1, 2));
      d.duck(0.1, 1.4);
      await ctx.wait(d.range(9, 15));
      d.duck(1, 3);
      await ctx.wait(2);
    },
  },
  {
    id: 'ceiling_drip', phases: ['UNEASE', 'DREAD'], cost: 1.6, cooldown: 80, max: 2, uses: ['blood'], motifs: ['drip', 'blood'],
    plan(d) {
      const s = d.freshest(d.spots('corridor', { min: 6, max: 13 }).filter((s) => unseen(d, s.pos, [3.1]) && d.inFront(s.pos, -0.2)));
      return s ? { spot: s } : null;
    },
    async run(d, ctx, { spot }) {
      const x = spot.pos.x + d.range(-0.6, 0.6), z = spot.pos.z + d.range(-0.6, 0.6);
      const drip = d.blood.ceiling(x, z, (d.time * 77) | 0);
      d.dripSites.push({ x, z, drip, at: d.time, used: false });
      d.markSpot(spot.id, spot.pos);
    },
  },

  // ===== dread: the Watcher, the blood =====
  {
    // The flicker (the opening beat, anywhere: glimpse.js). The corridor ahead dies; the ceiling tubes flicker and
    // in the flashes the Watcher is standing at the far end, then the hit and the boy's gasp; the lights come back
    // on an empty corridor. It needs no hiding place, so it works while the player walks down a lit corridor (the
    // haunts that wait for an unseen spot rarely get one there).
    id: 'light_glimpse', phases: ['UNEASE', 'DREAD'], cost: 2.2, cooldown: 55, max: 3, uses: ['watcher', 'lights'], motifs: ['watcher', 'lights'], watcher: true, far: true,
    plan(d) {
      // far, every act (playtest, twice: "too near" / "it was too close"); a small shape at the end of the corridor
      const t = glimpseTube(d, 14, 21, 30);
      return t ? { f: t.f, stage: t.stage, spot: { id: 'tube:' + t.f.index, pos: V(t.stage.spot.x, 0, t.stage.spot.z) } } : null;
    },
    async run(d, ctx, { f, stage }) {
      const L = d.lights, w = d.watcher;
      const base = L.baseLevel ?? 1;
      const group = L.lights.fixtures.filter((x) => x.kind !== 'glow' && !(x.floor || 0) && x.state !== 'broken' && Math.hypot(x.x - f.x, x.z - f.z) < 3.3);
      ctx.onAbort(() => {
        if (w.active) {
          w.setEmissive?.(0);
          w.vanish('now');
        }
        for (const x of [...group, ...corridorPath(d, f, group)]) {
          x.snap = false;
          L.fixture(x.index, base, 0.6);
        }
        L.ambient?.(L.baseAmbient ?? 1, 1);
        d.duck(1, 1);
        d._glimpsing = false;
      });
      // it starts when they're looking down at it (the plan picked a tube in front of them)
      const looking = () => d.gaze.facing(f, 14) && d.game.world.lineOfSight(d.gaze.eye, V(f.x, 1.2, f.z)) && Math.hypot(f.x - d.gaze.eye.x, f.z - d.gaze.eye.z) > 12.5;
      if (!(await ctx.until(looking, 6))) return 'ignored';
      const spot = stage.spot; // at the end of the corridor, under its last light
      const pose = d.act >= 3 && d.rng() < 0.3 ? 'distort' : d.rng() < 0.5 ? 'stand' : 'stare';
      const res = await glimpse(d, {
        tube: f, group, path: corridorPath(d, f, group), spot, pose, wait: (sec) => ctx.wait(sec),
        strength: d.canSting() ? [0, 0.7, 0.8, 0.9][d.act] : 0,
      });
      if (res === 'seen') d.game.halloween?.recite?.saw?.('glimpse');
      return res;
    },
  },
  {
    id: 'watcher_far', phases: ['UNEASE', 'DREAD'], cost: 2.8, cooldown: 70, max: 2, uses: ['watcher'], motifs: ['watcher'], watcher: true, far: true,
    plan(d) {
      const min = [0, 16, 12, 9][d.act]; // each act it is allowed a little closer
      const s = d.freshest(d.spots(['corridor', 'corner'], { min, max: min + 11, los: true, placeable: true, front: -0.1 }));
      return s ? { spot: s } : null;
    },
    async run(d, ctx, { spot }) {
      return haunt(d, ctx, spot, {
        pose: d.rng() < 0.6 ? 'stand' : 'stare', timeout: 25, holdMin: 1.5, holdMax: 3.2, near: 8, notice: d.act >= 3,
        async exit(w, close) {
          if (close || d.rng() < 0.6) return w.vanish('unseen');
          // the far lights die around it; when they come back it's gone
          const rooms = d.lights.roomsNear(w.position, 2.5);
          ctx.onAbort(() => d.lights.normal(rooms, 1));
          d.lights.set(rooms, 0, d.reducedFlash ? 0.6 : 0.25);
          w.vanish('dark');
          await ctx.wait(1.6);
          w.vanish('unseen');
          d.lights.normal(rooms, 1.2);
        },
      });
    },
  },
  {
    id: 'watcher_peek', phases: ['DREAD', 'PEAK'], dreadOk: true, act: 2, cost: 3, cooldown: 80, uses: ['watcher'], motifs: ['watcher', 'peek'], watcher: true,
    plan(d) {
      const s = d.freshest(d.spots('doorway', { min: 5, max: 14, los: true, placeable: true, doorOpen: true, front: 0.2 }).filter((s) => s.roomId !== d.room?.id));
      return s ? { spot: s } : null;
    },
    async run(d, ctx, { spot }) {
      return haunt(d, ctx, spot, { pose: 'peek', faceSpot: true, withdraw: true, holdMin: 0.9, holdMax: 1.8, near: 3.8 });
    },
  },
  {
    id: 'watcher_window', phases: ['DREAD'], cost: 2.8, cooldown: 90, max: 2, uses: ['watcher'], motifs: ['watcher', 'window'], watcher: true,
    gate: (d) => !!d.room?.isCorridor,
    plan(d) {
      const s = d.freshest(d.spots('window', { min: 3.5, max: 12, los: true, placeable: true }));
      return s ? { spot: s } : null;
    },
    async run(d, ctx, { spot }) {
      return haunt(d, ctx, spot, {
        pose: 'stare', faceSpot: true, holdMin: 1.4, holdMax: 3,
        async exit(w) {
          const rooms = [spot.roomId];
          ctx.onAbort(() => d.lights.normal(rooms, 1));
          d.lights.set(rooms, 0, d.reducedFlash ? 0.7 : 0.3);
          w.vanish('dark');
          await ctx.wait(2.2);
          w.vanish('unseen');
          d.lights.normal(rooms, 1.4);
        },
      });
    },
  },
  {
    // A whisper right at the back of your head, with words (subtitled: playtest, a bare whisper sound was "didn't
    // understand"). Turn round and it is standing down the corridor behind you, staring; it goes in a glitch with
    // your gasp. Ignore it and it whispers again, closer, and it is nearer when you do turn.
    id: 'whisper_behind', phases: ['DREAD'], cost: 2.2, cooldown: 100, max: 2, uses: ['sound', 'watcher'], motifs: ['whisper'], behind: true,
    plan(d) {
      // only where something can stand behind you (the payoff is the point)
      const far = d.freshest(d.spots(['corridor', 'corner', 'doorframe'], { min: 6, max: 12, los: true, behind: true, placeable: true }));
      return far ? { far } : null;
    },
    async run(d, ctx, { far }) {
      const g = d.game;
      ctx.onAbort(() => d.duck(1, 1.5));
      ctx.onAbort(() => d.watcher.active && d.watcher.vanish('unseen'));
      d.duck(0.25, 1);
      await ctx.wait(1.4);
      let side = d.rng() < 0.5 ? 1 : -1;
      const lines = d.pick([['…turn around…', '…why won’t you look at me…'], ['…behind you…', '…I’m right here…'], ['…don’t look…', '…look at me…']]);
      // something standing behind them (always from act II; most of the time in act I): as near straight behind
      // where they face NOW as there is, and the whisper comes from that side, so turning to it finds it
      let now = null;
      if (d.act >= 2 || d.rng() < 0.7) {
        const f = d.gaze.forward, e = d.gaze.eye;
        let best = 0.2;
        for (const s of d.spots(['corridor', 'corner', 'doorframe'], { min: 5, max: 12, los: true, behind: true, placeable: true })) {
          const dx = s.pos.x - e.x, dz = s.pos.z - e.z, l = Math.hypot(dx, dz) || 1;
          const back = -(dx * f.x + dz * f.z) / (l * Math.hypot(f.x, f.z) || 1); // 1 = straight behind
          if (back > best) {
            best = back;
            now = s;
          }
        }
        now ||= far;
        if (now) side = (now.pos.x - e.x) * -f.z + (now.pos.z - e.z) * f.x > 0 ? 1 : -1; // its side (+1: your right)
      }
      // right at the back of the head, a little to one side (the front/back cue resolves as they turn)
      d.sound('hw_whisper', earBehind(d, side, 0.35), { volume: 0.95 });
      g.subtitle?.(lines[0], 2.6, 'Whisper');
      if (now) {
        if (d.watcher.appear(now, { pose: 'stare', yaw: yawTo(d, now.pos) })) ctx.pose = 'stare';
        else if (now !== far && d.watcher.appear(far, { pose: 'stare', yaw: yawTo(d, far.pos) })) ctx.pose = 'stare';
        d._log?.('whisper', ctx.pose ? 'figure' : 'no figure');
      }
      let turned = await ctx.until(() => d.gaze.turnedAround(2), 3.5);
      if (!turned) {
        // again, closer, and so is it
        d.sound('hw_whisper', earBehind(d, -side, 0.15), { volume: 1, rate: 0.92 });
        g.subtitle?.(lines[1], 2.8, 'Whisper');
        if (d.watcher.active && !d.watcher.seen) {
          const near = d.freshest(d.spots(['corridor', 'corner', 'doorframe'], { min: 3.5, max: 6, los: true, behind: true, placeable: true }));
          if (near) {
            d.watcher.vanish('now'); // it is behind them, unseen: gone at once
            d.watcher.appear(near, { pose: 'distort', yaw: yawTo(d, near.pos) });
          }
        }
        turned = await ctx.until(() => d.gaze.turnedAround(2), 4);
      }
      d.memory[turned ? 'heardSound' : 'ignoredSound']('whisper');
      if (d.watcher.active) {
        const saw = await ctx.until(() => d.watcher.seen && d.watcher.seenFor > 0.15, 1.8);
        if (saw) {
          d.game.audio?.play?.('hw_swell', { volume: 0.55 });
          await ctx.wait(d.range(0.6, 0.9));
          d.watcher.vanish('now'); // in a glitch, never cleanly in view
          d.react(0.15, { gasp: 0.75, heart: 0.6 });
        } else d.watcher.vanish('unseen');
        await ctx.until(() => !d.watcher.active, 30);
      }
      d.duck(1, 2.5);
      return turned ? 'turned' : 'ignored';
    },
  },
  {
    id: 'blood_run', phases: ['DREAD'], cost: 2.2, cooldown: 100, max: 2, uses: ['blood'], motifs: ['blood'],
    gate: (d) => d.room && !d.room.isCorridor,
    plan(d) {
      // a wall of this room the player isn't looking at; it will be running when they turn
      const walls = bloodWalls(d, d.room, 0.7).filter((s) => d.dist(s) > 2 && d.dist(s) < 7 && unseen(d, V(s.x, 0, s.z), [0.6, 1.8]));
      const s = d.pick(walls);
      return s ? { spot: { ...s, id: 'wall:' + d.room.id } } : null;
    },
    async run(d, ctx, { spot }) {
      // big, so it reads (and is censored like the rest; playtest: "didn't see the censor"); small on Milder scares
      const big = d.intensity !== 'mild';
      const dec = d.blood.wall(spot, { size: big ? 'big' : 'small', seed: (d.time * 1311) | 0, progress: 0.12, speed: 0.045 });
      d.markSpot(spot.id, spot);
      const base = V(spot.x + spot.nx * 0.1, 0.05, spot.z + spot.nz * 0.1);
      const mid = V(spot.x, 0, spot.z);
      let found = false;
      for (let i = 0; i < 6 && dec.progress < 0.95; i++) {
        const t = d.range(2.5, 4);
        // you turn and it is running: a swell, and the boy catches his breath
        if (found) await ctx.wait(t);
        else if (await ctx.until(() => d.gaze.test(mid, { heights: [0.6, 1.6] }).perceived, t)) {
          found = true;
          d.sound('hw_swell', V(spot.x + spot.nx * 0.3, 1.2, spot.z + spot.nz * 0.3), { volume: 0.45 });
          d.react(0.35, { gasp: 0.45, heart: 0.4 });
          await ctx.wait(1);
        }
        d.sound('hw_drip', base, { volume: 0.5 });
      }
      return found ? 'found' : 'done';
    },
  },
  {
    // The slap. The room goes quiet; something wet drags along the wall; silence; then a palm slams flat on the
    // wall a metre or two away, at the side of your view, so you SEE it land (playtest: behind you, it was only a
    // noise: "didn't understand"), and a second one beside it. Both slide slowly down the wall, as if whoever
    // made them is sinking to the floor. Can come early (act I), so blood is one of the first things a run shows.
    id: 'blood_hand', phases: ['DREAD', 'PEAK'], dreadOk: true, major: true, cost: 3.2, cooldown: 120, max: 2, uses: ['blood', 'sound'], motifs: ['blood', 'slap'],
    plan(d) {
      const spot = slapSpot(d, true); // only where it can land in view (the point of it)
      return spot ? { spot } : null;
    },
    async run(d, ctx, { spot }) {
      const g = d.game;
      ctx.onAbort(() => d.duck(1, 1.2));
      // build-up: everything drops away; a wet drag along the wall
      d.duck(0.15, 0.9);
      await ctx.wait(d.range(1.0, 1.5));
      d.sound('hw_drip', V(spot.x + spot.nx * 0.1 - spot.tx, 0.9, spot.z + spot.nz * 0.1 - spot.tz), { volume: 0.5 });
      await ctx.wait(d.range(0.8, 1.2));
      d.sound('hw_breath', V(spot.x + spot.nx * 0.05, 1.35, spot.z + spot.nz * 0.05), { volume: 0.35 });
      // silence before the hit (nothing in the last half second: prepulse)
      d.duck(0.02, 0.1);
      await ctx.wait(d.range(0.9, 1.3));
      // they may have turned during the build-up: land it where they will see it now, if there is such a place
      spot = slapSpot(d, true) || spot;
      d.markSpot(spot.id, spot);
      const at = V(spot.x + spot.nx * 0.05, 1.35, spot.z + spot.nz * 0.05);
      const seed = (d.time * 733) | 0, left = d.rng() < 0.5, h = d.range(1.3, 1.5);
      const h1 = d.blood.hand(spot, { height: h, seed, left, speed: 0.12 });
      d.lastStingAt = d.time;
      g.audio?.play?.('hw_slap', { position: at, volume: d.intensity === 'mild' ? 0.55 : 1 });
      d.lastCueAt = d.time;
      d.jolt({ glitch: 0.22, hold: 0.06, kick: 6 }); // a light tear: the print must stay readable
      if (d.intensity !== 'mild' && !d.reducedFlash && d.dist(spot) < 1.9) d.blood.lens({ n: 2 });
      await ctx.wait(d.range(0.45, 0.65));
      const side = d.rng() < 0.5 ? 1 : -1;
      const s2 = { ...spot, x: spot.x + spot.tx * 0.45 * side, z: spot.z + spot.tz * 0.45 * side };
      const h2 = d.blood.hand(s2, { height: h - 0.18, seed: seed + 1, left: !left, speed: 0.1 });
      g.audio?.play?.('hw_slap', { position: V(s2.x + s2.nx * 0.05, 1.2, s2.z + s2.nz * 0.05), volume: d.intensity === 'mild' ? 0.45 : 0.85, rate: 0.94 });
      // the second one makes him drop his torch (playtest: "more realistic... the player's hands... drop the
      // flashlight"): his hand jerks, it clatters to the floor and spins, the beam sweeping the wall; he grabs it back
      if (d.torch?.drop({ hold: 1.5 })) d.flinch?.(1.1);
      d.react(0.35);
      // then both drag slowly down the wall, with a wet squeak
      await ctx.wait(0.9);
      for (const x of [h1, h2]) if (x) x.speed = 0.09;
      d.sound('hw_drip', at, { volume: 0.45, rate: 0.7 });
      await ctx.wait(1.6);
      d.duck(1, 3);
      return 'done';
    },
  },
  {
    id: 'blood_reveal', phases: ['DREAD', 'PEAK'], dreadOk: true, cost: 2.6, cooldown: 120, max: 1, uses: ['blood'], motifs: ['blood'], intensity: ['standard', 'intense'],
    plan(d) {
      // a wall of the room you are in, out of view (playtest: it used to go in another room, and was never found);
      // else a room you have been in, near by
      if (d.room && !d.room.isCorridor) {
        const walls = bloodWalls(d, d.room, 0.7).filter((s) => d.dist(s) > 1.8 && d.dist(s) < 8 && unseen(d, V(s.x, 0, s.z), [0.5, 1.8]));
        if (walls.length) return { room: d.room, spot: { ...d.pick(walls), id: 'wall:' + d.room.id } };
      }
      const ids = d.lights.roomsNear(d.pp, 15).filter((id) => id !== d.room?.id && d.gaze.visits.has(id));
      for (const id of ids.sort(() => d.rng() - 0.5)) {
        const r = d.game.world.rooms[id];
        if (!r || r.isCorridor) continue;
        const walls = bloodWalls(d, r, 0.7).filter((s) => unseen(d, V(s.x, 0, s.z), [0.5, 1.8]));
        if (walls.length) return { room: r, spot: { ...d.pick(walls), id: 'wall:' + r.id } };
      }
      return null;
    },
    async run(d, ctx, { room, spot }) {
      const dec = d.blood.wall(spot, { size: 'big', seed: (d.time * 917) | 0, progress: 1 });
      d.markSpot(spot.id, spot);
      const mid = V(spot.x, 0, spot.z);
      const found = await ctx.until(() => d.gaze.test(mid, { heights: [0.6, 1.6] }).perceived, 90);
      if (!found) return 'unfound';
      d.duck(0.3, 0.5);
      ctx.onAbort(() => d.duck(1, 1.5));
      // you turn and it is there: a swell, and the boy catches his breath
      d.sound('hw_swell', V(spot.x + spot.nx * 0.3, 1.2, spot.z + spot.nz * 0.3), { volume: 0.45 });
      d.react(0.35, { gasp: 0.45, heart: 0.4 });
      d.sound('hw_drip', V(spot.x + spot.nx * 0.2, 0.05, spot.z + spot.nz * 0.2), { volume: 0.7 });
      await ctx.wait(4);
      d.duck(1, 2.5);
      return dec ? 'found' : 'done';
    },
  },

  // ===== peaks =====
  {
    id: 'head_drop', phases: ['PEAK'], major: true, act: 2, cost: 4.5, cooldown: 120, uses: ['head', 'sound', 'lights'], motifs: ['head'], head: true, minTime: 60,
    notAfter: { watcher_reveal: 60 },
    plan(d) {
      // the drip the player was shown earlier, if they're walking towards it; else just ahead
      const site = d.dripSites.find((s) => !s.used && d.dist(s) > 3.4 && d.dist(s) < 8 && d.inFront(s, 0.55)
        && d.game.world.lineOfSight(d.gaze.eye, V(s.x, 0.4, s.z)));
      if (site) return { x: site.x, z: site.z, site };
      const p = d.ahead(d.range(4, 6));
      return p ? { x: p.x, z: p.z } : null;
    },
    async run(d, ctx, plan) {
      const spot = V(plan.x, 0, plan.z);
      if (plan.site) plan.site.used = true;
      ctx.onAbort(() => d.duck(1, 1.5));
      // the fake-out (playtest: "I was expecting it... run it when the user is not expecting it"): it goes quiet,
      // the ceiling creaks over a spot ahead, a drop of blood lands... and nothing. The sound comes back. Later, once
      // you have moved on and stopped watching that spot, it drops right in front of you with no warning at all.
      d.duck(0.12, 1.1);
      await ctx.wait(d.range(1.2, 2));
      d.sound('hw_ceiling', V(spot.x, WALL_HEIGHT - 0.1, spot.z), { volume: 0.9 });
      if (!plan.site) d.blood.splat(spot.x + 0.1, spot.z, 0.12, (d.time * 31) | 0);
      await ctx.wait(d.range(2.6, 3.4));
      d.sound('hw_ceiling', V(spot.x, WALL_HEIGHT - 0.1, spot.z), { volume: 0.35, rate: 0.8 }); // it settles
      await ctx.wait(1.4);
      d.duck(1, 2.5); // nothing: back to normal
      d._log?.('head_drop', 'fake-out');
      const t0 = d.time, p0 = { x: d.pp.x, z: d.pp.z };
      await ctx.until(() => {
        const t = d.time - t0, moved = Math.hypot(d.pp.x - p0.x, d.pp.z - p0.z);
        return t > 6 && (moved > 3 || t > 9) && (!d.gaze.facing(spot, 30) || t > 14); // (staring at it: 14 s at most)
      }, 20);
      // now: just ahead, in view, never on top of them; no build-up
      let at = null;
      for (let k = 0; k < 4 && !at; k++) {
        const p = d.ahead(d.range(3, 4.5), { lateral: 0.4 });
        if (p && d.dist(p) > 2.4) at = V(p.x, 0, p.z);
      }
      if (!at) {
        if (!d.gaze.facing(spot, 35) || d.dist(spot) < 2.4) return 'fake-out only';
        at = spot;
      }
      d.heads.hatch(at.x, at.z);
      const toP = { x: d.pp.x - at.x, z: d.pp.z - at.z };
      const l = Math.hypot(toP.x, toP.z) || 1;
      const h = d.heads.drop(at.x, at.z, { roll: { x: (toP.x / l) * 0.55 + d.range(-0.25, 0.25), z: (toP.z / l) * 0.55 + d.range(-0.25, 0.25) } });
      d.headsUsed++;
      ctx.pose = 'head';
      let saw = false;
      d.heads.onLand = (hd) => {
        if (hd !== h) return;
        d.sound('hw_headfall', hd.obj.position, { volume: 1 });
        saw = d.gaze.test(hd.obj.position.clone().setY(0), { heights: [0.12] }).perceived;
        if (d.canSting()) {
          d.lastStingAt = d.time; // the hit lands with the head (same instant: no prepulse)
          d.game.audio?.play?.('hw_sting', { volume: 0.75 });
          d.jolt({ glitch: 0.5, hold: 0.08, kick: 5 });
        } else if (d.game.postfx) d.game.postfx.glitch = Math.max(d.game.postfx.glitch || 0, 0.25);
        if (saw && d.intensity !== 'mild' && !d.reducedFlash && d.dist(hd.obj.position) < 4.2) d.blood.lens({ n: 3 }); // it splashes
        d.react(0.3);
        const room = d.roomAt(hd.obj.position);
        if (room && !d.reducedFlash) d.lights.flicker([room.id], 1.4);
      };
      ctx.onAbort(() => (d.heads.onLand = null));
      await ctx.wait(4.5);
      d.duck(1, 3.5);
      await ctx.wait(18);
      d.heads.removeUnseen();
      return saw ? 'seen' : 'heard';
    },
  },
  {
    id: 'head_behind', phases: ['PEAK'], major: true, act: 2, cost: 4, cooldown: 140, uses: ['head', 'sound'], motifs: ['head'], head: true, behind: true, minTime: 90,
    plan(d) {
      const p = d.ahead(d.range(2.6, 3.6), { back: true, lateral: 0.4 });
      return p && unseen(d, p, [0.15, 3.0]) ? { x: p.x, z: p.z } : null;
    },
    async run(d, ctx, plan) {
      ctx.onAbort(() => d.duck(1, 1.5));
      d.duck(0.15, 0.8);
      await ctx.wait(1.3);
      d.heads.hatch(plan.x, plan.z);
      const h = d.heads.drop(plan.x, plan.z, { roll: { x: d.range(-0.5, 0.5), z: d.range(-0.5, 0.5) } });
      d.headsUsed++;
      ctx.pose = 'head';
      d.heads.onLand = (hd) => {
        if (hd !== h) return;
        d.sound('hw_headfall', hd.obj.position, { volume: 1 });
        d.lastStingAt = d.time;
        d.jolt({ glitch: 0.25, hold: 0, kick: 4 }); // it lands right behind you: you flinch
      };
      ctx.onAbort(() => (d.heads.onLand = null));
      const turned = await ctx.until(() => d.gaze.turnedAround(2) || d.gaze.test(h.obj.position.clone().setY(0), { heights: [0.12] }).perceived, 5);
      if (turned) {
        // what you turn round to: a low swell under it, the gasp, the heart
        d.game.audio?.play?.('hw_swell', { volume: 0.45 });
        d._lastReact = -99;
        d.react(0.15);
      }
      await ctx.wait(4);
      d.duck(1, 3);
      await ctx.wait(15);
      d.heads.removeUnseen();
      return turned ? 'turned' : 'ignored';
    },
  },
  {
    id: 'watcher_reveal', phases: ['PEAK'], major: true, act: 2, cost: 4.5, cooldown: 120, uses: ['watcher', 'lights', 'sound'], motifs: ['watcher', 'dark'], watcher: true,
    plan(d) {
      const [min, max] = d.act >= 3 ? [2.6, 5] : [4.5, 8.5];
      const list = d.spots(['corridor', 'corner', 'doorframe'], { min, max, los: true, front: 0.6 });
      return list.length ? { list } : null;
    },
    async run(d, ctx, { list }) {
      const rooms = [...new Set([...d.lights.roomsNear(d.pp, 9)])];
      ctx.onAbort(() => {
        d.lights.normal(rooms, 1);
        d.duck(1, 1.5);
      });
      d.duck(0.2, 0.4);
      const f = nearestFixture(d, d.pp, 8);
      d.sound(f ? 'hw_hum_die' : 'hw_breaker', f ? V(f.x, 3, f.z) : V(d.pp.x, 3, d.pp.z), { volume: 0.8 });
      d.lights.set(rooms, 0, d.reducedFlash ? 0.6 : 0.2);
      if (d.act >= 3) torchBlink(d, 2.2 + (d.reducedFlash ? 0.4 : 0)); // the torch goes with them, and comes back with them
      await ctx.wait(1.2);
      // now, in the dark, it can be put there (canPlace accepts unlit spots out of the torch beam)
      const spot = d.freshest(list.filter((s) => d.gaze.canPlace(s.pos) || darkFor(d, s.pos)));
      const pose = d.act >= 3 && d.rng() < 0.5 ? 'lean' : d.intensity === 'intense' && d.rng() < 0.5 ? 'distort' : 'stare';
      const shown = spot && d.watcher.appear(spot, { pose, face: pose !== 'lean', force: darkFor(d, spot.pos), yaw: yawTo(d, spot.pos) });
      ctx.onAbort(() => d.watcher.active && d.watcher.vanish('unseen'));
      if (shown) {
        ctx.spot = spot;
        ctx.pose = d.watcher.pose;
        d.markSpot(spot.id, spot.pos);
      }
      await ctx.wait(d.range(1.2, 2));
      d.lights.normal(rooms, d.reducedFlash ? 0.6 : 0.3);
      if (!shown) {
        await ctx.wait(1);
        d.duck(1, 2);
        return 'empty';
      }
      if (d.canSting() && (await ctx.until(() => d.watcher.seen, 1.2))) {
        await ctx.wait(d.range(0.15, 0.3));
        await d.sting(ctx, d.act >= 3 ? { hold: 0.1, kick: 6 } : { volume: 0.65, glitch: 0.6, hold: 0.07, kick: 4 });
      }
      await ctx.until(() => d.watcher.seenFor > d.range(1.2, 2), 4);
      // breath, dark, gone
      d.sound('hw_exhale', V(spot.pos.x, 1.7, spot.pos.z), { volume: 0.8 });
      d.lights.set(rooms, 0, d.reducedFlash ? 0.6 : 0.2);
      torchBlink(d, 1.3);
      d.watcher.vanish('dark');
      await ctx.wait(1.5);
      d.watcher.vanish('unseen');
      d.lights.normal(rooms, 1.2);
      await ctx.wait(1.2);
      d.duck(1, 3);
      return d.watcher.seenTotal > 0.3 ? 'seen' : 'missed';
    },
  },
  {
    id: 'watcher_walk', phases: ['PEAK'], major: true, act: 2, cost: 4, cooldown: 120, max: 1, uses: ['watcher'], motifs: ['watcher', 'walk'], watcher: true, far: true,
    plan(d) {
      const list = d.spots('corridor', { min: 11, max: 20, los: true, front: 0.75 });
      for (const a of list) {
        if (!d.gaze.canPlace(a.pos)) continue;
        // a neighbour cell across the line of sight
        for (const b of list) {
          if (a === b) continue;
          const dd = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
          if (dd > 3.5 && dd < 4.5) return { a, b };
        }
      }
      return null;
    },
    async run(d, ctx, { a, b }) {
      const w = d.watcher;
      if (!w.appear(a, { pose: 'walk', face: false })) return 'skipped';
      ctx.spot = a;
      ctx.pose = 'walk';
      ctx.onAbort(() => w.active && w.vanish('unseen'));
      w.walk(b.pos, 0.7);
      await ctx.until(() => !w.active, 30);
      return w.seenTotal > 0.3 ? 'seen' : 'unseen';
    },
  },

  // ===== the new arc: false alarms, things that follow you, close encounters =====
  {
    // an empty build-up: the dread swells, the heart goes... and nothing comes (keeps every build-up honest)
    id: 'build', phases: ['UNEASE', 'DREAD'], cost: 0.8, cooldown: 70, max: 3, uses: ['sound'], motifs: ['build'],
    plan: () => ({}),
    async run(d, ctx) {
      ctx.onAbort(() => d.duck(1, 2));
      d.duck(0.25, 2);
      d.game.audio?.play?.('hw_swell', { volume: 0.6 });
      await ctx.wait(3.6);
      for (let i = 0, n = 3 + ((d.rng() * 4) | 0); i < n; i++) {
        d.game.audio?.play?.('hw_heart', { volume: 0.45 + i * 0.05, rate: 0.9 + i * 0.02 });
        await ctx.wait(d.range(0.95, 1.1));
      }
      await ctx.wait(d.range(2, 4));
      d.duck(1, 3.5);
      return 'nothing';
    },
  },
  {
    // footsteps behind you that copy yours, catching up, and stop one step after you stop
    id: 'copy_steps', phases: ['UNEASE', 'DREAD'], act: 2, cost: 1.8, cooldown: 120, max: 2, uses: ['sound'], motifs: ['step', 'follow'], behind: true, needsMoving: true,
    gate: (d) => !!d.room?.isCorridor,
    plan: () => ({}),
    async run(d, ctx) {
      const trail = [{ x: d.pp.x, z: d.pp.z }];
      // where they were ~`back` m ago along their path (or straight behind if they haven't walked that far)
      const echoAt = (back) => {
        let acc = 0;
        for (let i = trail.length - 1; i > 0; i--) {
          acc += Math.hypot(trail[i].x - trail[i - 1].x, trail[i].z - trail[i - 1].z);
          if (acc >= back) return V(trail[i - 1].x, 0.05, trail[i - 1].z);
        }
        const b = behindPoint(d, back);
        return V(b.x, 0.05, b.z);
      };
      let delay = d.range(0.42, 0.55);
      let n = 0;
      let last = d.time;
      const off = d.game.events?.on?.('player:footstep', () => {
        if (ctx.aborted) return;
        n++;
        last = d.time;
        const back = Math.max(3.2, 6.5 - n * 0.22); // closing in
        d.sound('hw_step', echoAt(back), { volume: Math.min(0.95, 0.45 + n * 0.035), rate: 0.82, delay });
        delay = Math.max(0.16, delay - 0.03);
      });
      ctx.onAbort(() => off?.());
      ctx.onAbort(() => d.duck(1, 1.5));
      const turned = await ctx.until(() => {
        const t = trail.at(-1);
        if (Math.hypot(d.pp.x - t.x, d.pp.z - t.z) > 0.35) trail.push({ x: d.pp.x, z: d.pp.z });
        return d.gaze.turnedAround(1.5) || n >= 18 || (n >= 4 && d.time - last > 0.8);
      }, 30);
      off?.();
      if (turned && d.gaze.turnedAround(1.5)) {
        // they looked: nothing there, and the building holds its breath
        d.duck(0.15, 0.2);
        await ctx.wait(d.range(2.5, 4));
        d.duck(1, 3);
        return 'turned';
      }
      if (n >= 18) return 'walked';
      // they stopped: one more step, closer, a beat late. Then nothing.
      d.duck(0.2, 0.3);
      await ctx.wait(d.range(0.45, 0.7));
      d.sound('hw_step', echoAt(2.6), { volume: 1, rate: 0.78 });
      d.memory.heardSound('step');
      await ctx.wait(d.range(3, 5));
      d.duck(1, 3);
      return 'stopped';
    },
  },
  {
    // red light, green light: at the end of the corridor; each time you look away and back, it's closer
    id: 'red_light', phases: ['DREAD'], act: 2, cost: 3, cooldown: 150, max: 1, uses: ['watcher', 'lights'], motifs: ['watcher', 'approach'], watcher: true, far: true,
    plan(d) {
      // somewhere lit (the game only works if they can see it every time they look), unseen right now
      const s = d.freshest(d.spots(['corridor', 'corner'], { min: 12, max: 22, los: true, placeable: true }).filter((s) => d.lights.levelAt(s.pos.x, s.pos.z) > 0.3));
      return s ? { spot: s } : null;
    },
    async run(d, ctx, { spot }) {
      const w = d.watcher;
      if (!w.appear(spot, { pose: 'stare', yaw: yawTo(d, spot.pos) })) return 'skipped';
      ctx.pose = 'stare';
      d.markSpot(spot.id, spot.pos);
      ctx.onAbort(() => w.active && w.vanish('unseen'));
      if (!(await ctx.until(() => w.seen, 20))) {
        w.vanish('unseen');
        await ctx.until(() => !w.active, 30);
        return 'unseen';
      }
      const minD = d.act >= 3 ? 2.4 : 4.5;
      const world = d.game.world;
      let steps = 0;
      for (let k = 0; k < 5; k++) {
        // they look away (or walk up to it: it backs off)
        const away = await ctx.until(() => !w.seen || (w.lastTest?.dist ?? 99) < 3.2, 14);
        if (!away) break; // a stare-down: it simply stays... until the lights go
        if ((w.lastTest?.dist ?? 99) < 3.2 && w.seen) {
          w.withdraw();
          await ctx.until(() => !w.active, 20);
          return 'approached';
        }
        await ctx.wait(d.range(0.35, 0.7));
        // a step closer along the line to them, only to somewhere they can't see right now
        const p = w.position, dx = d.pp.x - p.x, dz = d.pp.z - p.z, L = Math.hypot(dx, dz);
        if (L <= minD + 0.4) break;
        let moved = false;
        for (const step of [d.range(3, 4.2), 2.4, 1.6]) {
          const nd = Math.max(minD, L - step);
          const q = V(d.pp.x - (dx / L) * nd, 0, d.pp.z - (dz / L) * nd);
          if (!world.isWalkable(q.x, q.z, 0.25, 0) || !d.gaze.canPlace(q) || d.lights.levelAt(q.x, q.z) < 0.25) continue;
          if (!world.lineOfSight(d.gaze.eye, V(q.x, 1.4, q.z)) && d.rng() < 0.7) continue; // mostly where they'll see it
          w.object.position.set(q.x, 0, q.z);
          w.facePlayer();
          moved = true;
          steps++;
          break;
        }
        if (!moved) continue;
        // and waits to be found again
        if (!(await ctx.until(() => w.seen, 12))) {
          w.vanish('unseen'); // they never looked back: it's still out there somewhere
          await ctx.until(() => !w.active, 30);
          return 'unresolved';
        }
        if (Math.hypot(d.pp.x - w.position.x, d.pp.z - w.position.z) <= minD + 0.5) break;
        await ctx.wait(d.range(0.6, 1.2));
      }
      // the end: up close in act III it hits; otherwise the lights round it die and it's gone
      const rooms = d.lights.roomsNear(w.position, 3);
      ctx.onAbort(() => d.lights.normal(rooms, 1));
      if (w.seen && d.act >= 3 && d.canSting() && (w.lastTest?.dist ?? 99) < 6) {
        await ctx.wait(d.range(0.25, 0.5));
        await d.sting(ctx);
        w.vanish('now');
        torchBlink(d, 0.3);
      } else {
        await ctx.wait(d.range(0.8, 1.6));
        d.lights.set(rooms, 0, d.reducedFlash ? 0.6 : 0.15);
        w.vanish('dark');
      }
      await ctx.wait(1.8);
      w.vanish('unseen');
      d.lights.normal(rooms, 1.2);
      await ctx.until(() => !w.active, 20);
      return 'steps:' + steps;
    },
  },
  {
    // the hiding place stops being safe: while they're hidden (and he's far away) something is right outside
    id: 'locker', phases: ['UNEASE', 'DREAD'], hidden: true, act: 2, cost: 2.4, cooldown: 200, max: 1, uses: ['sound', 'watcher'], motifs: ['locker'],
    gate: (d, info) => info.caretakerDist > 18 && d.time - (d.hiddenSince ?? d.time) > 4,
    plan: () => ({}),
    async run(d, ctx) {
      const f = d.gaze.forward, fl = Math.hypot(f.x, f.z) || 1;
      const out = (k, y = d.gaze.eye.y) => V(d.gaze.eye.x + (f.x / fl) * k, y, d.gaze.eye.z + (f.z / fl) * k);
      const danger = () => !d.game.player.isHidden || d.info().caretakerDist < 12 || d.info().hunted;
      ctx.onAbort(() => d.duck(1, 2));
      await d.hush(ctx, 1.5, 2.5);
      if (danger()) return 'left';
      d.sound('hw_breath', out(0.7, d.gaze.eye.y - 0.05), { volume: 0.9 });
      await ctx.wait(3.6);
      if (danger()) return 'left';
      d.sound('hw_nails', out(0.45, d.gaze.eye.y - 0.25), { volume: 0.9 });
      await ctx.wait(d.range(4.5, 6.5)); // the scrape, then a silence long enough to hope
      if (danger()) return 'left';
      if (d.canSting()) {
        d.lastStingAt = d.time;
        d.sound('hw_bang', out(0.4), { volume: 1 }); // a palm slammed on the door, inches away
        d.jolt({ glitch: 0.5, hold: 0.08, kick: 4 });
      } else d.sound('hw_knock', out(0.4), { volume: 1, rate: 0.9 });
      await ctx.wait(d.range(3, 5));
      d.duck(1, 5);
      // they come out: nothing there. In act III, maybe something far down the corridor, already leaving
      const left = await ctx.until(() => !d.game.player.isHidden, 25);
      if (!left || d.act < 3 || d.rng() > 0.5) return 'knocked';
      await ctx.wait(0.8);
      const s = d.freshest(d.spots(['corridor', 'corner'], { min: 9, max: 18, los: true, placeable: true, front: 0.3 }));
      if (!s) return 'knocked';
      return haunt(d, ctx, s, { pose: 'stand', timeout: 8, holdMin: 0.8, holdMax: 1.6, withdraw: true, notice: false });
    },
  },
  {
    // a locker slams on one side; while they look, it's standing at the far end on the other
    id: 'bait_switch', phases: ['DREAD'], act: 2, sting: true, cost: 2.6, cooldown: 140, max: 1, uses: ['sound', 'watcher'], motifs: ['bang', 'watcher'], watcher: true,
    plan(d) {
      const f = d.gaze.forward, fl = Math.hypot(f.x, f.z) || 1;
      const rx = -f.z / fl, rz = f.x / fl; // right of the view
      const side = d.rng() < 0.5 ? 1 : -1;
      const bang = V(d.pp.x + rx * side * 3.4 + (f.x / fl) * 1.2, 1.1, d.pp.z + rz * side * 3.4 + (f.z / fl) * 1.2);
      const far = d.spots(['corridor', 'corner', 'doorway'], { min: 8, max: 18, los: true, front: -0.2 })
        .filter((s) => ((s.pos.x - d.pp.x) * rx + (s.pos.z - d.pp.z) * rz) * side < -1.5);
      const spot = d.freshest(far);
      return spot ? { bang, spot } : null;
    },
    async run(d, ctx, { bang, spot }) {
      ctx.onAbort(() => d.duck(1, 1.5));
      await d.hush(ctx, 0.9, 1.6);
      await d.sting(ctx, { id: 'hw_bang', pos: bang, glitch: 0.35, hold: 0, kick: 3 });
      d.duck(1, 2.5);
      const looked = await ctx.until(() => d.gaze.facing(bang, 45), 3);
      if (!looked) return 'ignored';
      // now, while they look at the noise, it takes its place on the other side
      return haunt(d, ctx, spot, { pose: d.rng() < 0.5 ? 'stare' : 'stand', timeout: 12, holdMin: 1, holdMax: 2, near: 5 });
    },
  },
  {
    // the bodycam loses signal; when the picture comes back, it is standing right in front of them
    id: 'signal_lost', phases: ['PEAK'], major: true, signature: true, act: 2, cost: 4, cooldown: 150, max: 1, uses: ['watcher', 'sound'], motifs: ['signal', 'watcher'], watcher: true,
    intensity: ['standard', 'intense'],
    gate: (d, info) => info.caretakerDist > 20,
    plan(d) {
      const p = d.ahead(d.act >= 3 ? d.range(2.6, 3.4) : d.range(3.6, 4.8), { lateral: 0.3 });
      return p ? { p } : null;
    },
    async run(d, ctx, { p }) {
      const g = d.game, w = d.watcher, pl = g.player;
      const clock = g.timeLeft;
      let stat = null;
      const outage = (on) => {
        noSignal(on);
        pl.enabled = !on; // blind and still: the clock and the player both stop, so no one gains or loses time
        if (on) stat = g.audio?.play?.('hw_static', { volume: 0.9 }) || null;
        else stat?.stop(0.05);
      };
      ctx.onAbort(() => {
        outage(false);
        if (w.active) w.vanish('now');
        d.duck(1, 1.5);
      });
      const hold = () => (g.timeLeft = Math.max(g.timeLeft, clock));
      d.duck(0.05, 0.08);
      outage(true);
      d.jolt({ glitch: 1, hold: 0, kick: 0 });
      await ctx.until(() => (hold(), false), d.range(1.2, 1.7));
      // in the dark of the outage it takes its place, facing them
      const at = d.ahead(Math.hypot(p.x - d.pp.x, p.z - d.pp.z), { lateral: 0.2 }) || p;
      const pose = d.act >= 3 && d.rng() < 0.6 ? 'lean' : 'stare';
      const shown = w.appear({ pos: at }, { pose, force: true, face: pose !== 'lean', yaw: yawTo(d, at) });
      ctx.pose = pose;
      outage(false);
      hold();
      if (!shown) {
        d.duck(1, 2);
        return 'empty';
      }
      ctx.spot = { id: 'ahead', pos: at };
      if (d.canSting()) {
        await ctx.until(() => w.seen, 0.6);
        await ctx.wait(0.12);
        await d.sting(ctx, d.act >= 3 ? { glitch: 0.6, hold: 0.09 } : { volume: 0.7, glitch: 0.5, hold: 0.07, kick: 5 });
      }
      await ctx.until(() => w.seenFor > d.range(0.7, 1.1), 2.5);
      // the signal drops once more; when it's back, it's gone
      outage(true);
      w.vanish('now');
      await ctx.until(() => (hold(), false), 0.3);
      outage(false);
      hold();
      d.duck(1, 3);
      return w.seenTotal > 0.2 ? 'seen' : 'missed';
    },
  },
  {
    // breath on the back of the neck. Turn round, and it is right there, its face at yours.
    id: 'behind_you', phases: ['PEAK'], major: true, signature: true, act: 3, once: true, sting: true, cost: 4, cooldown: 120, uses: ['watcher', 'sound', 'lights'], motifs: ['watcher', 'behind'], watcher: true, behind: true,
    intensity: ['standard', 'intense'],
    plan(d) {
      const p = behindPoint(d, 1.45);
      const w = d.game.world;
      return w.isWalkable(p.x, p.z, 0.3, 0) && d.gaze.canPlace(p) && w.lineOfSight(d.gaze.eye, V(p.x, 1.2, p.z)) ? { p } : null;
    },
    async run(d, ctx) {
      const w = d.watcher, world = d.game.world;
      ctx.onAbort(() => w.active && w.vanish('now'));
      await d.hush(ctx, 1.4, 2.4);
      // it keeps to arm's length behind them (only ever moved while it can't be seen)
      const follow = () => {
        if (!w.active || w.seen) return;
        if (d.gaze.test(w.position, { margin: 0.25 }).inFrustum) return; // they're turning into it: it stays
        const q = behindPoint(d, 1.45);
        if (world.isWalkable(q.x, q.z, 0.25, 0) && d.gaze.canPlace(q) && world.lineOfSight(d.gaze.eye, V(q.x, 1.2, q.z))) {
          w.object.position.set(q.x, 0, q.z);
          w.object.rotation.y = yawTo(d, q);
        } else if (Math.hypot(w.position.x - d.pp.x, w.position.z - d.pp.z) < 0.9) w.vanish('now'); // never let them back into it
      };
      const start = behindPoint(d, 1.45);
      if (!d.gaze.canPlace(start) || !w.appear({ pos: start }, { pose: 'lean', face: false, yaw: yawTo(d, start) })) {
        d.duck(1, 2);
        return 'skipped';
      }
      ctx.pose = 'lean';
      const side = d.rng() < 0.5 ? 1 : -1;
      let seen = false;
      for (let k = 0; k < 2 && !seen; k++) {
        d.sound('hw_breath', earBehind(d, side, k ? 0.22 : 0.32), { volume: k ? 1 : 0.85 });
        seen = await ctx.until(() => (follow(), w.seen), k ? 5 : 4.5);
      }
      if (!seen || !w.active) {
        // it never comes. They will spend the rest of the run wondering
        if (w.active) w.vanish('unseen');
        await ctx.wait(1.5);
        d.duck(1, 4);
        return 'ignored';
      }
      // a beat to register the face, then the hit; it is gone inside the stutter
      await ctx.wait(d.range(0.12, 0.22));
      const rooms = d.lights.roomsNear(d.pp, 4);
      ctx.onAbort(() => d.lights.normal(rooms, 1));
      d.game.audio?.play?.('hw_scream', { position: V(w.position.x, 1.6, w.position.z), volume: 0.6 });
      await d.sting(ctx, { hold: 0.13, kick: 9 });
      w.vanish('now');
      torchBlink(d, 0.35);
      d.lights.set(rooms, 0, 0.05);
      await ctx.wait(1.4);
      d.lights.normal(rooms, d.reducedFlash ? 1.2 : 0.5);
      await ctx.wait(1.5);
      d.duck(1, 4);
      return 'turned';
    },
  },
  {
    // the corridor lights die one by one towards you, and it comes out of the dark at a run
    id: 'charge', phases: ['PEAK'], major: true, signature: true, act: 3, once: true, sting: true, cost: 4.5, cooldown: 120, uses: ['watcher', 'lights', 'sound'], motifs: ['watcher', 'charge', 'dark'], watcher: true, far: true,
    intensity: ['standard', 'intense'],
    gate: (d) => !!d.room?.isCorridor,
    plan(d) {
      const list = d.spots(['corridor', 'corner'], { min: 11, max: 19, los: true, front: 0.88 }).filter((s) => clearRun(d, s.pos));
      const spot = d.pick(list);
      return spot ? { spot, fixtures: fixturesAlong(d, spot.pos) } : null;
    },
    async run(d, ctx, { spot, fixtures }) {
      const w = d.watcher;
      const fx = fixtures.length ? fixtures : fixturesAlong(d, spot.pos);
      const amb0 = d.lights.ambientLevel ?? 1;
      const endRooms = d.lights.roomsNear(spot.pos, 3).filter((id) => id !== d.room?.id); // spill from rooms off the end
      ctx.onAbort(() => {
        d.lights.ambient(amb0, 1);
        d.lights.normal(endRooms, 1);
        for (const f of fx) d.lights.fixture(f.index, 1, 0.8);
        if (w.active) w.vanish('now');
        d.duck(1, 1.5);
      });
      d.duck(0.2, 0.5);
      await ctx.wait(d.range(0.8, 1.5));
      // far to near, each light gives out with a clunk
      const gap = d.reducedFlash ? 0.75 : d.range(0.38, 0.5);
      const far = fx.filter((f) => Math.hypot(f.x - d.pp.x, f.z - d.pp.z) > 5);
      d.lights.ambient(Math.min(amb0, 0.3), 2.5);
      d.lights.set(endRooms, 0, 1.5);
      for (const f of far) {
        d.lights.fixture(f.index, 0, d.reducedFlash ? 0.5 : 0.07);
        d.sound('hw_breaker', V(f.x, 2.8, f.z), { volume: 0.4, rate: 1.5 });
        await ctx.wait(gap);
      }
      d.duck(0.03, 0.15);
      // the torch gives out with the last of them; in that dark it takes its place at the end of the corridor
      const blinked = d.game.player.flashlightOn;
      torchBlink(d, d.range(0.8, 1.1));
      await ctx.wait(0.3);
      const cover = (blinked && d.lights.levelAt(spot.pos.x, spot.pos.z) < 0.3) || darkFor(d, spot.pos);
      if (!(cover || d.gaze.canPlace(spot.pos)) || !w.appear(spot, { pose: 'lunge', face: false, force: true, yaw: yawTo(d, spot.pos) })) {
        for (const f of fx) d.lights.fixture(f.index, 1, 1);
        d.lights.ambient(amb0, 1);
        d.lights.normal(endRooms, 1);
        d.duck(1, 2);
        d._log('charge', 'no cover', +d.lights.levelAt(spot.pos.x, spot.pos.z).toFixed(2));
        return 'skipped';
      }
      ctx.spot = spot;
      ctx.pose = 'lunge';
      const looking = await ctx.until(() => d.gaze.facing(spot.pos, 22), 6);
      if (!looking || !clearRun(d, w.position)) {
        w.vanish('unseen');
        d.lights.ambient(amb0, 1.5);
        d.lights.normal(endRooms, 1.5);
        for (const f of fx) d.lights.fixture(f.index, 1, 1.2);
        d.duck(1, 2.5);
        await ctx.until(() => !w.active, 20);
        return 'held';
      }
      await ctx.wait(d.range(0.3, 0.8));
      // it comes: straight at the camera, killing the near lights as it passes
      const f = d.gaze.forward, fl = Math.hypot(f.x, f.z) || 1;
      w.rush(V(d.pp.x + (f.x / fl) * 1.15, 0, d.pp.z + (f.z / fl) * 1.15), d.intensity === 'intense' ? 10 : 8.5);
      const near = fx.filter((q) => !far.includes(q));
      await ctx.until(() => {
        for (const q of near) if (Math.hypot(q.x - w.position.x, q.z - w.position.z) < 1.5) d.lights.fixture(q.index, 0, 0.05);
        return !w.moving || Math.hypot(w.position.x - d.pp.x, w.position.z - d.pp.z) < 1.4;
      }, 4);
      d.game.audio?.play?.('hw_scream', { position: V(w.position.x, 1.8, w.position.z), volume: 0.65 });
      await d.sting(ctx, { hold: 0.14, kick: 11 });
      w.vanish('now');
      torchBlink(d, 0.4);
      for (const q of near) d.lights.fixture(q.index, 0, 0.05);
      await ctx.wait(1.6);
      // the lights come back near to far on an empty corridor
      d.lights.ambient(amb0, 1.5);
      d.lights.normal(endRooms, 2);
      for (const q of [...fx].reverse()) {
        d.lights.fixture(q.index, 1, d.reducedFlash ? 0.8 : 0.25);
        await ctx.wait(0.22);
      }
      d.duck(1, 4);
      return 'charged';
    },
  },
  {
    // the Caretaker's hum, slowed and wrong, from a room he isn't in (he is far away; nothing is in there)
    id: 'hum_wrong', phases: ['UNEASE', 'DREAD'], act: 2, cost: 1.6, cooldown: 150, max: 1, uses: ['sound'], motifs: ['hum'], ambient: true,
    gate: (d, info) => info.caretakerDist > 25 && !info.alert,
    plan(d) {
      const s = d.pick(d.spots(['doorway', 'doorframe'], { min: 6, max: 13 }).filter((s) => s.roomId !== d.room?.id));
      return s ? { spot: s } : null;
    },
    async run(d, ctx, { spot }) {
      ctx.onAbort(() => d.duck(1, 1.5));
      d.duck(0.4, 1.2);
      await ctx.wait(1.2);
      const at = V(spot.pos.x, 1.5, spot.pos.z);
      d.sound('caretaker_hum', at, { volume: 0.75, rate: d.range(0.78, 0.84) });
      d.markSpot(spot.id, spot.pos);
      const heard = await d.reaction(ctx, 'hum', spot.pos, 6);
      if (heard && d.rng() < 0.45) {
        // from the other side now
        const b = behindPoint(d, 7);
        await ctx.wait(d.range(2, 4));
        d.sound('caretaker_hum', V(b.x, 1.5, b.z), { volume: 0.55, rate: d.range(0.7, 0.76) });
      }
      await ctx.wait(4);
      d.duck(1, 3);
      return heard ? 'heard' : 'ignored';
    },
  },

  // ===== aftershocks: the second scare, in the calm after a peak (phase 'AFTER', see director) =====
  {
    id: 'after_bang', phases: ['AFTER'], sting: true, cost: 0, uses: ['sound'], motifs: ['bang'],
    plan(d) {
      const side = d.rng() < 0.5 ? 1 : -1;
      const p = behindPoint(d, -1.5, side * 3.2); // ahead-left or ahead-right, out of the room's middle
      return { p: V(p.x, 1.1, p.z) };
    },
    async run(d, ctx, { p }) {
      ctx.onAbort(() => d.duck(1, 1.5));
      await d.hush(ctx, 0.8, 1.4);
      await d.sting(ctx, { id: 'hw_bang', pos: p, glitch: 0.3, hold: 0, kick: 3 });
      await ctx.wait(2);
      d.duck(1, 3);
    },
  },
  {
    id: 'after_breath', phases: ['AFTER'], cost: 0, uses: ['sound'], motifs: ['breath'], behind: true,
    plan: () => ({}),
    async run(d, ctx) {
      ctx.onAbort(() => d.duck(1, 1.5));
      d.duck(0.1, 0.4);
      await ctx.wait(d.range(0.8, 1.6));
      d.sound('hw_breath', earBehind(d, d.rng() < 0.5 ? 1 : -1, 0.3), { volume: 0.9 });
      await ctx.wait(4);
      d.duck(1, 3);
    },
  },
  {
    id: 'after_return', phases: ['AFTER'], cost: 0, uses: ['watcher'], motifs: ['watcher'], watcher: true, far: true,
    plan(d) {
      const s = d.freshest(d.spots(['corridor', 'corner', 'doorway'], { min: 10, max: 20, los: true, placeable: true, front: 0.2 }));
      return s ? { spot: s } : null;
    },
    async run(d, ctx, { spot }) {
      return haunt(d, ctx, spot, { pose: 'stand', timeout: 14, holdMin: 0.6, holdMax: 1.2, notice: false });
    },
  },

  // ===== inside a blackout =====
  {
    id: 'bo_torch_watcher', phases: [], blackout: true, cost: 0, uses: ['watcher'], motifs: ['watcher', 'torch'], watcher: true,
    plan(d) {
      const [min, max] = d.act >= 3 ? [3.5, 8] : [6, 13];
      const s = d.freshest(d.spots(['corridor', 'corner', 'doorframe'], { min, max, los: true, placeable: true, front: 0.1 }));
      return s ? { spot: s } : null;
    },
    async run(d, ctx, { spot }) {
      await ctx.wait(d.range(2, 5));
      if (!d.gaze.canPlace(spot.pos)) return 'skipped';
      return haunt(d, ctx, spot, {
        pose: d.act >= 3 && d.rng() < 0.5 ? 'lean' : 'stand', face: true, timeout: 12, holdMin: 0.4, holdMax: 0.9, notice: false,
        async exit(w) {
          w.vanish('dark'); // the moment the beam leaves it
          await ctx.until(() => !w.active, 10);
          w.vanish('unseen');
        },
      });
    },
  },
  {
    id: 'bo_steps', phases: [], blackout: true, cost: 0, uses: ['sound'], motifs: ['step'], behind: true,
    plan: () => ({}),
    async run(d, ctx) {
      await ctx.wait(d.range(3, 7));
      const f = d.gaze.forward;
      const n = 5;
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1);
        const k = 7 - u * 5;
        d.sound('hw_step', V(d.pp.x - f.x * k, 0.05, d.pp.z - f.z * k), { volume: 0.5 + u * 0.4 });
        await ctx.wait(0.8);
      }
      return (await ctx.until(() => d.gaze.turnedAround(2), 3)) ? 'turned' : 'ignored';
    },
  },
  {
    id: 'bo_whisper', phases: [], blackout: true, cost: 0, uses: ['sound'], motifs: ['whisper'],
    plan: () => ({}),
    async run(d, ctx) {
      await ctx.wait(d.range(4, 9));
      const f = d.gaze.forward;
      const side = d.rng() < 0.5 ? 1 : -1;
      d.sound('hw_whisper', V(d.pp.x - f.z * side * 1.2, 1.6, d.pp.z + f.x * side * 1.2), { volume: 0.85 });
    },
  },
  {
    id: 'bo_head_return', phases: [], blackout: true, onRestore: true, cost: 0, uses: ['head'], motifs: ['head'], head: true, intensity: ['standard', 'intense'],
    plan(d) {
      const p = d.ahead(d.range(3.5, 6), { lateral: 1.2 });
      return p && d.gaze.canPlace(p, [0.15]) ? { x: p.x, z: p.z } : null;
    },
    async run(d, ctx, plan) {
      // placed in the dark, out of the beam; the lights come up on it
      if (!d.gaze.canPlace(V(plan.x, 0, plan.z), [0.15])) return 'skipped';
      d.heads.place(plan.x, plan.z, d.range(0, 6.28));
      d.headsUsed++;
      d.memory.note('seq', 'bo_head_return', d.time);
      d.later(20, () => d.heads.removeUnseen());
      return 'placed';
    },
  },
];

// ------------------------------------------------------------------------------------------------ blackouts
function farPoint(d, k = 14) {
  return V(d.pp.x + k, 1.5, d.pp.z + k * 0.4);
}

function goDark(d, fade, ambient = 0.2) {
  d.lights.set(null, 0, fade);
  d.lights.ambient(ambient, Math.max(0.12, fade));
  d.lights.fog(1.3, 2);
}

export const BLACKOUT_VARIANTS = [
  {
    id: 'gradual', weight: 1,
    async onset(d, ctx) {
      const f = nearestFixture(d, d.pp, 10);
      d.sound('hw_hum_die', f ? V(f.x, 3, f.z) : V(d.pp.x, 3, d.pp.z), { volume: 1 });
      goDark(d, 3.2, 0.22);
      await ctx.wait(3.2);
    },
  },
  {
    id: 'sudden', weight: 1,
    async onset(d, ctx) {
      d.sound('hw_breaker', farPoint(d), { volume: 0.9 });
      goDark(d, d.reducedFlash ? 0.5 : 0.06);
      await ctx.wait(0.6);
    },
  },
  {
    id: 'partial', weight: 0.9,
    async onset(d, ctx) {
      // the dark comes for this part of the school; far corridors keep a weak, sick light
      d.sound('hw_breaker', farPoint(d, 10), { volume: 0.7, rate: 0.9 });
      d.lights.set(null, 0.22, 1.2);
      d.lights.set(d.lights.roomsNear(d.pp, 13), 0, d.reducedFlash ? 0.8 : 0.4);
      d.lights.ambient(0.25, 1);
      d.lights.fog(1.25, 2);
      await ctx.wait(1.2);
    },
  },
  {
    id: 'false', weight: 0.8, flashy: true,
    async onset(d, ctx) {
      d.sound('hw_breaker', farPoint(d), { volume: 0.9 });
      goDark(d, 0.08);
      await ctx.wait(0.6);
    },
    async during(d, ctx, until) {
      await ctx.wait(Math.min(6.5, until - d.time - 8));
      // they come back... (each level held well over the photosensitive limit)
      d.lights.set(null, 0.85, 0.45);
      d.lights.ambient(0.9, 0.45);
      d.duck(0.9, 0.6);
      await ctx.wait(2.4);
      d.sound('hw_breaker', farPoint(d, 9), { volume: 0.8, rate: 0.9 });
      goDark(d, 0.12);
      d.duck(0.4, 0.8);
    },
  },
];
