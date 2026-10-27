// LAST BELL - collision (circle vs AABB), line-of-sight grid and navigation grid. Owned by S1 (World).
import { NAV_RES } from './config.js';

export const LOS_RES = 0.25;
const BUCKET = 2.0;

/**
 * Collider = { minX, minZ, maxX, maxZ, h, kind: 'wall'|'window'|'prop'|'door'|'entrance', door?: Door, owner }
 *   h: blocking height for line of sight (99 = full height).
 *   door colliders are only solid while door.isOpen === false.
 */
export class Colliders {
  constructor(minX, minZ, maxX, maxZ) {
    this.minX = minX;
    this.minZ = minZ;
    this.bw = Math.ceil((maxX - minX) / BUCKET) + 1;
    this.bh = Math.ceil((maxZ - minZ) / BUCKET) + 1;
    this.buckets = Array.from({ length: this.bw * this.bh }, () => []);
    this.byOwner = new Map();
    this.stamp = 1;
    this.count = 0;
  }

  set(owner, list) {
    this.remove(owner);
    if (!list || !list.length) return;
    for (const c of list) {
      c.owner = owner;
      c._stamp = 0;
      this._insert(c);
    }
    this.byOwner.set(owner, list);
    this.count += list.length;
  }

  remove(owner) {
    const list = this.byOwner.get(owner);
    if (!list) return;
    for (const c of list) this._erase(c);
    this.byOwner.delete(owner);
    this.count -= list.length;
  }

  get(owner) { return this.byOwner.get(owner) || null; }

  _range(c) {
    const bx0 = Math.max(0, Math.floor((c.minX - this.minX) / BUCKET));
    const bz0 = Math.max(0, Math.floor((c.minZ - this.minZ) / BUCKET));
    const bx1 = Math.min(this.bw - 1, Math.floor((c.maxX - this.minX) / BUCKET));
    const bz1 = Math.min(this.bh - 1, Math.floor((c.maxZ - this.minZ) / BUCKET));
    return [bx0, bz0, bx1, bz1];
  }

  _insert(c) {
    const [bx0, bz0, bx1, bz1] = this._range(c);
    for (let z = bz0; z <= bz1; z++) for (let x = bx0; x <= bx1; x++) this.buckets[z * this.bw + x].push(c);
  }

  _erase(c) {
    const [bx0, bz0, bx1, bz1] = this._range(c);
    for (let z = bz0; z <= bz1; z++) {
      for (let x = bx0; x <= bx1; x++) {
        const b = this.buckets[z * this.bw + x];
        const i = b.indexOf(c);
        if (i >= 0) b.splice(i, 1);
      }
    }
  }

  /** Calls fn(c) once for each collider whose bucket overlaps the rect (no allocation). Return true from fn to stop. */
  forEach(minX, minZ, maxX, maxZ, fn) {
    const st = ++this.stamp;
    const bx0 = Math.max(0, Math.floor((minX - this.minX) / BUCKET));
    const bz0 = Math.max(0, Math.floor((minZ - this.minZ) / BUCKET));
    const bx1 = Math.min(this.bw - 1, Math.floor((maxX - this.minX) / BUCKET));
    const bz1 = Math.min(this.bh - 1, Math.floor((maxZ - this.minZ) / BUCKET));
    for (let z = bz0; z <= bz1; z++) {
      for (let x = bx0; x <= bx1; x++) {
        const b = this.buckets[z * this.bw + x];
        for (let i = 0; i < b.length; i++) {
          const c = b[i];
          if (c._stamp === st) continue;
          c._stamp = st;
          if (c.maxX < minX || c.minX > maxX || c.maxZ < minZ || c.minZ > maxZ) continue;
          if (fn(c)) return true;
        }
      }
    }
    return false;
  }

  all(fn) {
    for (const list of this.byOwner.values()) for (const c of list) fn(c);
  }
}

export function solid(c) {
  return c.kind !== 'door' || !c.door.isOpen;
}

// ------------------------------------------------------------------------------------------- circle movement

/**
 * Resolve a circle against solid colliders, in place on the {x,z} scratch object.
 * Returns true if anything pushed.
 */
export function resolveCircle(cols, p, r) {
  let pushedAny = false;
  for (let it = 0; it < 4; it++) {
    let pushed = false;
    const x0 = p.x - r, x1 = p.x + r, z0 = p.z - r, z1 = p.z + r;
    const st = ++cols.stamp;
    const bx0 = Math.max(0, Math.floor((x0 - cols.minX) / BUCKET));
    const bz0 = Math.max(0, Math.floor((z0 - cols.minZ) / BUCKET));
    const bx1 = Math.min(cols.bw - 1, Math.floor((x1 - cols.minX) / BUCKET));
    const bz1 = Math.min(cols.bh - 1, Math.floor((z1 - cols.minZ) / BUCKET));
    for (let bz = bz0; bz <= bz1; bz++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        const b = cols.buckets[bz * cols.bw + bx];
        for (let i = 0; i < b.length; i++) {
          const c = b[i];
          if (c._stamp === st) continue;
          c._stamp = st;
          if (c.kind === 'door' && c.door.isOpen) continue;
          if (c.noCollide) continue;
          const cx = p.x < c.minX ? c.minX : p.x > c.maxX ? c.maxX : p.x;
          const cz = p.z < c.minZ ? c.minZ : p.z > c.maxZ ? c.maxZ : p.z;
          const dx = p.x - cx;
          const dz = p.z - cz;
          const d2 = dx * dx + dz * dz;
          if (d2 >= r * r) continue;
          if (d2 > 1e-12) {
            const d = Math.sqrt(d2);
            const k = (r - d) / d;
            p.x += dx * k;
            p.z += dz * k;
          } else {
            const l = p.x - c.minX, rr = c.maxX - p.x, t = p.z - c.minZ, bb = c.maxZ - p.z;
            const m = Math.min(l, rr, t, bb);
            if (m === l) p.x = c.minX - r;
            else if (m === rr) p.x = c.maxX + r;
            else if (m === t) p.z = c.minZ - r;
            else p.z = c.maxZ + r;
          }
          pushed = true;
        }
      }
    }
    if (!pushed) break;
    pushedAny = true;
  }
  return pushedAny;
}

// ------------------------------------------------------------------------------------------- door leaves
// A door's leaf collides at its *current* angle (Second Floor update, enemy-ai.md §2 row 3b): a thin
// segment from the hinge to the leaf tip, kept in door.leafSeg by world.js whenever the leaf moves.
// The doorway AABB above is unchanged (solid while !isOpen); the leaf only matters once it has left
// the doorway line (door.leafSolid). Leaves live outside the Colliders buckets on purpose: LOS, nav
// and every AABB consumer keep treating doors exactly as before.
export const LEAF_HALF = 0.05; // half thickness incl. the handle

/** Circle vs one leaf segment. Writes the push into p and returns true if it overlapped. */
function pushOffLeaf(s, p, r) {
  const rr = r + LEAF_HALF;
  if (p.x + rr < s.minX || p.x - rr > s.maxX || p.z + rr < s.minZ || p.z - rr > s.maxZ) return false;
  const ex = s.bx - s.ax, ez = s.bz - s.az;
  const l2 = ex * ex + ez * ez;
  let t = l2 > 1e-9 ? ((p.x - s.ax) * ex + (p.z - s.az) * ez) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  let dx = p.x - (s.ax + ex * t), dz = p.z - (s.az + ez * t);
  const d2 = dx * dx + dz * dz;
  if (d2 >= rr * rr) return false;
  const d = Math.sqrt(d2);
  if (d < 1e-6) {
    // dead on the leaf: leave ahead of it as it opens (s.nx/nz = the opening direction)
    p.x += s.nx * rr;
    p.z += s.nz * rr;
    return true;
  }
  const k = (rr - d) / d;
  p.x += dx * k;
  p.z += dz * k;
  return true;
}

/** Resolve a circle against every solid leaf in `doors` (Door[] with leafSeg / leafSolid). */
export function resolveLeaves(doors, p, r) {
  let pushed = false;
  for (let i = 0; i < doors.length; i++) {
    const d = doors[i];
    if (d.leafSeg && d.leafSolid && pushOffLeaf(d.leafSeg, p, r)) pushed = true;
  }
  return pushed;
}

/** Does a circle overlap a solid leaf? */
export function leafBlocked(doors, x, z, r) {
  for (let i = 0; i < doors.length; i++) {
    const d = doors[i];
    if (!d.leafSeg || !d.leafSolid) continue;
    _lp.x = x;
    _lp.z = z;
    if (pushOffLeaf(d.leafSeg, _lp, r)) return true;
  }
  return false;
}
const _lp = { x: 0, z: 0 };

/** Fill seg (hinge → tip at yaw `rot`, length len) incl. its bbox and the swing normal (sign = swing dir). */
export function setLeafSegment(seg, hx, hz, rot, len, sign) {
  const ux = Math.cos(rot), uz = -Math.sin(rot);
  seg.ax = hx; seg.az = hz;
  seg.bx = hx + ux * len; seg.bz = hz + uz * len;
  // direction the leaf moves when its angle grows by `sign`: d/dθ of (cos, -sin) = (-sin, -cos)
  seg.nx = -Math.sin(rot) * sign; seg.nz = -Math.cos(rot) * sign;
  seg.minX = Math.min(seg.ax, seg.bx) - LEAF_HALF; seg.maxX = Math.max(seg.ax, seg.bx) + LEAF_HALF;
  seg.minZ = Math.min(seg.az, seg.bz) - LEAF_HALF; seg.maxZ = Math.max(seg.az, seg.bz) + LEAF_HALF;
  return seg;
}

export function circleBlocked(cols, x, z, r, ignoreDoors = false) {
  return cols.forEach(x - r, z - r, x + r, z + r, (c) => {
    if (c.noCollide) return false;
    if (c.kind === 'door' && (ignoreDoors || c.door.isOpen)) return false;
    const cx = x < c.minX ? c.minX : x > c.maxX ? c.maxX : x;
    const cz = z < c.minZ ? c.minZ : z > c.maxZ ? c.maxZ : z;
    const dx = x - cx;
    const dz = z - cz;
    if (r <= 0) return x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ;
    return dx * dx + dz * dz < r * r;
  });
}

// ------------------------------------------------------------------------------------------- LOS grid

export class LosGrid {
  constructor(minX, minZ, maxX, maxZ) {
    this.res = LOS_RES;
    this.ox = minX;
    this.oz = minZ;
    this.cols = Math.ceil((maxX - minX) / this.res);
    this.rows = Math.ceil((maxZ - minZ) / this.res);
    const n = this.cols * this.rows;
    this.h = new Float32Array(n); // blocking height (0 = clear, 99 = wall)
    this.win = new Uint8Array(n); // window span (blocks only below sill / above head)
    this.door = new Int16Array(n); // door index + 1
  }

  rasterize(cols, doors, rx0, rz0, rx1, rz1) {
    const r = this.res;
    const c0 = Math.max(0, Math.floor((rx0 - this.ox) / r));
    const r0 = Math.max(0, Math.floor((rz0 - this.oz) / r));
    const c1 = Math.min(this.cols - 1, Math.floor((rx1 - this.ox) / r));
    const r1 = Math.min(this.rows - 1, Math.floor((rz1 - this.oz) / r));
    for (let z = r0; z <= r1; z++) {
      const base = z * this.cols;
      for (let x = c0; x <= c1; x++) {
        this.h[base + x] = 0;
        this.win[base + x] = 0;
        this.door[base + x] = 0;
      }
    }
    cols.forEach(rx0, rz0, rx1, rz1, (c) => {
      if (c.noLos) return false;
      if (c.kind === 'door') {
        this._fill(c, c0, r0, c1, r1, (i) => { this.door[i] = c.door.index + 1; });
        return false;
      }
      if (c.kind === 'window') {
        this._fill(c, c0, r0, c1, r1, (i) => { this.win[i] = 1; });
        return false;
      }
      if (c.kind === 'prop' && c.h < 1.0) return false;
      const hh = c.kind === 'prop' ? c.h : 99;
      this._fill(c, c0, r0, c1, r1, (i) => { if (this.h[i] < hh) this.h[i] = hh; });
      return false;
    });
  }

  _fill(c, c0, r0, c1, r1, fn) {
    const r = this.res;
    const x0 = Math.max(c0, Math.floor((c.minX - this.ox) / r + 1e-6));
    const x1 = Math.min(c1, Math.floor((c.maxX - this.ox) / r - 1e-6));
    const z0 = Math.max(r0, Math.floor((c.minZ - this.oz) / r + 1e-6));
    const z1 = Math.min(r1, Math.floor((c.maxZ - this.oz) / r - 1e-6));
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) fn(z * this.cols + x);
  }

  /**
   * DDA through the grid. doorsArr: Door[] (closed doors block).
   * strict (AI perception, Second Floor update): no soft zone for doors at either end, props only
   * ignored in the last 0.3 m before the target, and a door only lets sight through once its leaf
   * has actually swung open (door.blocksSight) — not the moment open() is called.
   */
  query(ax, ay, az, bx, by, bz, doorsArr, strict = false) {
    if (ay < 0.3 && by < 0.3) ay = by = 1.5;
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return true;
    const r = this.res;
    let cx = Math.floor((ax - this.ox) / r);
    let cz = Math.floor((az - this.oz) / r);
    const ex = Math.floor((bx - this.ox) / r);
    const ez = Math.floor((bz - this.oz) / r);
    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
    const tDX = stepX ? Math.abs(r / dx) : Infinity;
    const tDZ = stepZ ? Math.abs(r / dz) : Infinity;
    let tMX = stepX ? ((stepX > 0 ? (cx + 1) * r + this.ox - ax : ax - (cx * r + this.ox)) / Math.abs(dx)) : Infinity;
    let tMZ = stepZ ? ((stepZ > 0 ? (cz + 1) * r + this.oz - az : az - (cz * r + this.oz)) / Math.abs(dz)) : Infinity;
    const softA = strict ? -1 : 0.45 / len; // ignore props/doors this close to either endpoint (interaction targets)
    const softB = strict ? 1 - 0.3 / len : 1 - 0.6 / len;
    let t = 0;
    const maxSteps = this.cols + this.rows + 4;
    for (let s = 0; s < maxSteps; s++) {
      if (cx >= 0 && cz >= 0 && cx < this.cols && cz < this.rows) {
        const i = cz * this.cols + cx;
        const y = ay + (by - ay) * t;
        const hh = this.h[i];
        if (hh >= 90) return false;
        const soft = t < softA || t > softB;
        if (!soft && hh > 0 && y < hh) return false;
        const d = this.door[i];
        if (d && doorsArr[d - 1]) {
          const door = doorsArr[d - 1];
          if (strict ? door.blocksSight !== false : !soft && !door.isOpen) return false;
        }
        if (this.win[i] && (y < 1.0 || y > 2.28)) return false;
      } else return false;
      if (cx === ex && cz === ez) break;
      if (tMX < tMZ) {
        t = tMX;
        tMX += tDX;
        cx += stepX;
      } else {
        t = tMZ;
        tMZ += tDZ;
        cz += stepZ;
      }
      if (t > 1) break;
    }
    return true;
  }
}

// ------------------------------------------------------------------------------------------- nav grid

export class NavGridBuilder {
  /** Origin is offset by half a cell so cell centres land on multiples of NAV_RES (doorway centres). */
  constructor(maxX, maxZ) {
    const res = NAV_RES;
    this.nav = {
      res,
      originX: -res / 2,
      originZ: -res / 2,
      cols: Math.ceil((maxX + res) / res) + 1,
      rows: Math.ceil((maxZ + res) / res) + 1,
      walkable: null,
      door: null,
      zone: null, // 1 = stair flight / half landing (enemies treat it as blocked; set by world-stairs.js)
      version: 0,
    };
    const n = this.nav.cols * this.nav.rows;
    this.nav.walkable = new Uint8Array(n);
    this.nav.door = new Int16Array(n);
    this.nav.zone = new Uint8Array(n);
  }

  /** Rasterize walkability in a world rect. insideFn(x,z) -> bool (inside the building / allowed). */
  rasterize(cols, doors, radius, insideFn, rx0, rz0, rx1, rz1) {
    const nav = this.nav;
    const res = nav.res;
    const c0 = Math.max(0, Math.floor((rx0 - nav.originX) / res));
    const r0 = Math.max(0, Math.floor((rz0 - nav.originZ) / res));
    const c1 = Math.min(nav.cols - 1, Math.floor((rx1 - nav.originX) / res));
    const r1 = Math.min(nav.rows - 1, Math.floor((rz1 - nav.originZ) / res));
    const rr = radius + 0.02;
    for (let z = r0; z <= r1; z++) {
      for (let x = c0; x <= c1; x++) {
        const i = z * nav.cols + x;
        const wx = nav.originX + (x + 0.5) * res;
        const wz = nav.originZ + (z + 0.5) * res;
        nav.door[i] = 0;
        if (!insideFn(wx, wz)) {
          nav.walkable[i] = 0;
          continue;
        }
        const blocked = cols.forEach(wx - rr, wz - rr, wx + rr, wz + rr, (c) => {
          if (c.noCollide) return false;
          if (c.kind === 'door' && !c.door.isLocked) return false;
          const cx = wx < c.minX ? c.minX : wx > c.maxX ? c.maxX : wx;
          const cz = wz < c.minZ ? c.minZ : wz > c.maxZ ? c.maxZ : wz;
          const dx = wx - cx;
          const dz = wz - cz;
          return dx * dx + dz * dz < rr * rr;
        });
        nav.walkable[i] = blocked ? 0 : 1;
      }
    }
    for (const d of doors) {
      if (!d.active) continue;
      // doorway rect: +-0.6 m along the wall and +-0.6 m across it (3 cells through the wall)
      const x0 = d.position.x - 0.6, x1 = d.position.x + 0.6;
      const z0 = d.position.z - 0.6, z1 = d.position.z + 0.6;
      if (x1 < rx0 || x0 > rx1 || z1 < rz0 || z0 > rz1) continue;
      const dc0 = Math.max(0, Math.floor((x0 - nav.originX) / res));
      const dc1 = Math.min(nav.cols - 1, Math.floor((x1 - nav.originX) / res));
      const dr0 = Math.max(0, Math.floor((z0 - nav.originZ) / res));
      const dr1 = Math.min(nav.rows - 1, Math.floor((z1 - nav.originZ) / res));
      for (let z = dr0; z <= dr1; z++) {
        for (let x = dc0; x <= dc1; x++) {
          const wx = nav.originX + (x + 0.5) * res;
          const wz = nav.originZ + (z + 0.5) * res;
          if (wx < x0 - 1e-6 || wx > x1 + 1e-6 || wz < z0 - 1e-6 || wz > z1 + 1e-6) continue;
          nav.door[z * nav.cols + x] = d.index + 1;
        }
      }
    }
  }

  cellOf(x, z) {
    const nav = this.nav;
    const c = Math.floor((x - nav.originX) / nav.res);
    const r = Math.floor((z - nav.originZ) / nav.res);
    if (c < 0 || r < 0 || c >= nav.cols || r >= nav.rows) return -1;
    return r * nav.cols + c;
  }

  /** Nearest walkable cell index to (x,z) within maxDist metres (ring search), or -1. */
  nearestWalkable(x, z, maxDist = 1.5) {
    const nav = this.nav;
    const c = Math.floor((x - nav.originX) / nav.res);
    const r = Math.floor((z - nav.originZ) / nav.res);
    const R = Math.ceil(maxDist / nav.res);
    let best = -1;
    let bestD = Infinity;
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const cc = c + dx;
        const rr = r + dz;
        if (cc < 0 || rr < 0 || cc >= nav.cols || rr >= nav.rows) continue;
        const i = rr * nav.cols + cc;
        if (!nav.walkable[i]) continue;
        const wx = nav.originX + (cc + 0.5) * nav.res - x;
        const wz = nav.originZ + (rr + 0.5) * nav.res - z;
        const d = wx * wx + wz * wz;
        if (d < bestD && d <= maxDist * maxDist) {
          bestD = d;
          best = i;
        }
      }
    }
    return best;
  }

  /** 4-connected flood fill from cell indices. Returns Uint8Array mark (1 = reached). */
  flood(starts, out) {
    const nav = this.nav;
    const n = nav.cols * nav.rows;
    const mark = out && out.length === n ? out.fill(0) : new Uint8Array(n);
    const q = new Int32Array(n);
    let h = 0;
    let t = 0;
    for (const s of starts) {
      if (s >= 0 && nav.walkable[s] && !mark[s]) {
        mark[s] = 1;
        q[t++] = s;
      }
    }
    const W = nav.cols;
    while (h < t) {
      const i = q[h++];
      const x = i % W;
      const nb0 = x > 0 ? i - 1 : -1;
      const nb1 = x < W - 1 ? i + 1 : -1;
      const nb2 = i - W;
      const nb3 = i + W;
      if (nb0 >= 0 && nav.walkable[nb0] && !mark[nb0]) { mark[nb0] = 1; q[t++] = nb0; }
      if (nb1 >= 0 && nav.walkable[nb1] && !mark[nb1]) { mark[nb1] = 1; q[t++] = nb1; }
      if (nb2 >= 0 && nav.walkable[nb2] && !mark[nb2]) { mark[nb2] = 1; q[t++] = nb2; }
      if (nb3 < n && nav.walkable[nb3] && !mark[nb3]) { mark[nb3] = 1; q[t++] = nb3; }
    }
    return mark;
  }
}
