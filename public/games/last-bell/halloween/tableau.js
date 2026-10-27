// LAST BELL — The Halloween Shift: a head left on the teacher's desk, bleeding off the edge onto the floor.
//
// The head is censored like every head (heads.js → blood.censorSphere). The blood is not: a pool on the desk around
// it, a smear to the edge, and drops falling off the edge into a pool on the lino that grows while you look (kept
// under the 0.55 m censor size, so it stays plain red). One is set at the start of every run on the teacher's desk in
// the room you start in (mode.js). It faces the board; look away and back and it is facing you (tickDeskHeads).

const TOP = 0.77; // desk_teacher: the desktop's height (measured), half width 0.7 m, half depth 0.37 m
const HX = 0.7, HZ = 0.37;
const TIP = 0.45; // s to tip over and slide to the edge before it falls

/** The teacher's desk in a room: its centre and its local axes (x along the desk), or null. */
export function teacherDesk(world, roomId) {
  const pl = world.static?.owners?.get('room:' + roomId)?.find((p) => /^desk_teacher/.test(p.node));
  if (!pl) return null;
  const e = pl.m.elements;
  const lx = Math.hypot(e[0], e[2]) || 1, lz = Math.hypot(e[8], e[10]) || 1;
  return { x: e[12], z: e[14], ax: { x: e[0] / lx, z: e[2] / lx }, az: { x: e[8] / lz, z: e[10] / lz }, roomId };
}

/** Whether a desk already has a head on it. */
export function deskTaken(d, desk) {
  return d.heads.list.some((h) => h.keep && Math.hypot(h.obj.position.x - desk.x, h.obj.position.z - desk.z) < 1.2);
}

/** Put the head and the blood on this room's teacher's desk. Returns { head, drip, x, y, z, desk } or null. */
export function headOnDesk(d, roomId, seed = 1) {
  const w = d.game.world, desk = teacherDesk(w, roomId);
  if (!desk || deskTaken(d, desk)) return null;
  const at = (u, v) => ({ x: desk.x + desk.ax.x * u + desk.az.x * v, z: desk.z + desk.ax.z * u + desk.az.z * v });
  // the end of the desk with clear floor beside it (where the blood lands)
  // (tested a little way out: the desk's own collider covers the floor right at its edge)
  const clear = (s) => w.isWalkable(at((HX + 0.3) * s, 0).x, at((HX + 0.3) * s, 0).z, 0.12, 0);
  let s = seed % 2 ? 1 : -1;
  if (!clear(s)) {
    s = -s;
    if (!clear(s)) return null;
  }
  const edge = at((HX + 0.05) * s, 0.05);
  const hp = at(0.3 * s, 0.02);
  // upright on its neck, facing the board: from the class you see the back of it (hair). Look away and back and
  // it is facing you (tickDeskHeads).
  const room = w.rooms[roomId];
  const c = room?.center || { x: hp.x, z: hp.z + 1 };
  const yaw = Math.atan2(hp.x - c.x, hp.z - c.z);
  const head = d.heads.placeAt(hp.x, TOP, hp.z, yaw);
  head.desk = true;
  // blood on the desk: a pool round the neck and a smear running to the edge
  d.blood.splat(hp.x, hp.z, 0.5, seed + 1, seed * 0.7, TOP);
  const mid = at(0.55 * s, 0.03);
  const ux = desk.ax.x * s, uz = desk.ax.z * s;
  const smear = d.blood.splat(mid.x, mid.z, 0.3, seed + 2, Math.atan2(-ux, -uz), TOP);
  smear.mesh.scale.set(0.18, 0.42, 1);
  // over the edge and down the end of the desk
  const face = at(HX * s, 0.03);
  d.blood.streak({ x: face.x, z: face.z, nx: ux, nz: uz }, { top: TOP + 0.005, len: 0.55, w: 0.26, seed: seed + 4 });
  // drops off the edge into a pool on the floor; it has been bleeding a while
  const drip = d.blood.ceiling(edge.x, edge.z, seed + 3, { from: TOP - 0.02, stain: false, every: 1.1, max: 0.54 });
  if (drip) {
    drip.poolSize = 0.34;
    drip.pool.scale.setScalar(0.34);
  }
  head.deskInfo = desk;
  return { head, drip, x: hp.x, y: TOP, z: hp.z, desk };
}

/**
 * Walk up to it after it has turned to face you, and it topples off the desk towards you: it tips, slides to the
 * edge nearest you, drops to the floor with a thud and rolls to your feet (playtest: "can be more scary").
 */
function topple(d, h) {
  const desk = h.deskInfo, o = h.obj.position, e = d.gaze.eye;
  // the way to you, and where that leaves the desk (in the desk's frame), a little past the edge
  let dx = e.x - o.x, dz = e.z - o.z;
  const l = Math.hypot(dx, dz) || 1;
  dx /= l;
  dz /= l;
  let exit = { x: o.x + dx * 0.4, z: o.z + dz * 0.4 };
  if (desk) {
    const lu = (o.x - desk.x) * desk.ax.x + (o.z - desk.z) * desk.ax.z, lv = (o.x - desk.x) * desk.az.x + (o.z - desk.z) * desk.az.z;
    const du = dx * desk.ax.x + dz * desk.ax.z, dv = dx * desk.az.x + dz * desk.az.z;
    const tu = Math.abs(du) > 1e-4 ? ((du > 0 ? HX : -HX) - lu) / du : 9, tv = Math.abs(dv) > 1e-4 ? ((dv > 0 ? HZ : -HZ) - lv) / dv : 9;
    const t = Math.max(0.05, Math.min(tu, tv)) + 0.1;
    exit = { x: o.x + dx * t, z: o.z + dz * t };
  }
  h.toppling = { t: 0, from: { x: o.x, y: o.y, z: o.z }, to: exit, dx, dz, rx: h.obj.rotation.x };
  h.desk = false; // it stops watching
  d.sound?.('hw_scrape', { x: o.x, y: o.y, z: o.z }, { volume: 0.35, rate: 1.4 });
  d._log?.('desk_head', 'topple');
  h.onLand = (hd) => {
    hd.onLand = null;
    const p = hd.obj.position;
    d.sound?.('hw_headfall', p, { volume: 1 });
    if (d.canSting?.()) {
      d.lastStingAt = d.time;
      d.game.audio?.play?.('hw_sting', { volume: 0.7 });
      d.jolt?.({ glitch: 0.3, hold: 0.05, kick: 5 });
    }
    d._lastReact = -99;
    d.react?.(0.2, { gasp: 0.85, heart: 0.75 });
  };
}

function tickTopple(h, dt) {
  const k = h.toppling;
  k.t += dt;
  const u = Math.min(1, k.t / TIP), ease = u * u; // slow, then it goes
  const o = h.obj.position;
  o.x = k.from.x + (k.to.x - k.from.x) * ease;
  o.z = k.from.z + (k.to.z - k.from.z) * ease;
  o.y = k.from.y - 0.03 * ease;
  h.obj.rotation.x = k.rx + 1.1 * ease; // tips over, face first, towards you
  if (u < 1) return;
  h.toppling = null;
  // over the edge: the heads' own physics take it from here (fall, thud, bounce, roll towards you)
  h.state = 'fall';
  h.vx = k.dx * 0.9;
  h.vz = k.dz * 0.9;
  h.vy = -0.4;
  h.spin.set(4 + h.rnd() * 2, (h.rnd() - 0.5) * 2, (h.rnd() - 0.5) * 2);
  h.roll = { x: k.dx * 0.75, z: k.dz * 0.75 };
}

/**
 * The desk head keeps watching you. After you have had a look at it and looked away, it turns (out of view) to
 * face you; the first time you see it turned, a swell and the boy's gasp. After that it is facing you every time
 * you look back.
 */
export function tickDeskHeads(d, dt) {
  const e = d.gaze?.eye;
  if (!e) return;
  for (const h of d.heads.list) {
    if (h.toppling) {
      tickTopple(h, dt);
      continue;
    }
    if (!h.desk) continue;
    const o = h.obj.position;
    const t = d.gaze.test({ x: o.x, y: 0, z: o.z }, { heights: [o.y] });
    const seen = t.perceived && t.dist < 12;
    h.tSeen = (h.tSeen || 0) + (seen ? dt : 0);
    h.tAway = seen ? 0 : (h.tAway || 0) + dt;
    if (seen) {
      // turned, seen, and now you walk up to it: it comes off the desk at you (not on top of another scare)
      if (h.turned === 2 && t.dist < 2.4 && h.tSeen - (h.turnedSeenAt ?? h.tSeen) > 1.2 && !d.fg && !d.bo?.active && !d._glimpsing) {
        topple(d, h);
        continue;
      }
      if (h.turned === 1 && t.dist < 10) {
        h.turned = 2;
        h.turnedSeenAt = h.tSeen;
        d.sound?.('hw_swell', { x: o.x, y: o.y, z: o.z }, { volume: 0.5 });
        d.react?.(0.3, { gasp: 0.6, heart: 0.55 });
        d._log?.('desk_head', 'turned');
      }
      continue;
    }
    // out of view (not just behind a wall: out of the frame), you have seen it, and you are in the room with it
    if (h.tSeen > 0.7 && h.tAway > 1.2 && !t.inFrustum && t.dist > 1.5 && t.dist < 9) {
      const yaw = Math.atan2(e.x - o.x, e.z - o.z);
      if (Math.abs(Math.atan2(Math.sin(yaw - h.obj.rotation.y), Math.cos(yaw - h.obj.rotation.y))) > 0.35) {
        h.obj.rotation.y = yaw;
        if (!h.turned) h.turned = 1;
      }
    }
  }
}

/** The classroom nearest `from` (not `not`) with a free teacher's desk, or null. */
export function nearestDeskRoom(d, from, { not = null, max = 40 } = {}) {
  const w = d.game.world;
  let best = null, bd = max;
  for (const r of w.rooms) {
    if (!r || r.isCorridor || r.id === not || (r.floor || 0) !== 0) continue;
    const desk = teacherDesk(w, r.id);
    if (!desk || deskTaken(d, desk)) continue;
    const dd = Math.hypot(desk.x - from.x, desk.z - from.z);
    if (dd < bd) {
      bd = dd;
      best = r;
    }
  }
  return best;
}
