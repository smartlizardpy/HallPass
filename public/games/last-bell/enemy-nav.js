// LAST BELL — enemy navigation helpers (S2): A* over the World NavGrid (CONTRACTS §6).
//
// * 8-connected grid, no corner cutting (a diagonal step needs both orthogonal neighbours passable)
// * binary-heap open set (lazy deletion) on typed arrays, generation stamps instead of clearing,
//   iteration cap with a partial path to the closest node found
// * string-pulling path smoothing with grid line-walkability checks
// * locked doors are never passable (checked live through world.doors), plus temporary blocks
//
// No allocations per search once the buffers are sized for the grid.

const SQRT2 = Math.SQRT2;
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DZ = [0, 0, 1, -1, 1, -1, 1, -1];

export class NavPathfinder {
  constructor() {
    this.nav = null;
    this.doors = null; // world.doors (for isLocked)
    this.size = 0;
    this.iterCap = 24000;
    this.stamp = 0;
    this.lastIterations = 0;
    this.lastPartial = false;
    this.lastLength = 0;
    this.heapCap = 0;
  }

  /** Bind to a nav grid (re-allocates only when the grid size changes). */
  setNav(nav, doors) {
    this.nav = nav;
    this.doors = doors || null;
    const n = nav.cols * nav.rows;
    if (n !== this.size) {
      this.size = n;
      this.g = new Float32Array(n);
      this.parent = new Int32Array(n);
      this.openStamp = new Uint32Array(n);
      this.closedStamp = new Uint32Array(n);
      this.blocked = new Uint8Array(n);
      this.raw = new Int32Array(n);
      this.heapCap = Math.max(1024, n * 2);
      this.heap = new Int32Array(this.heapCap);
      this.heapF = new Float32Array(this.heapCap);
      this.stamp = 0;
    } else {
      this.blocked.fill(0);
    }
  }

  // ------------------------------------------------------------------ cell helpers
  col(x) {
    return Math.floor((x - this.nav.originX) / this.nav.res);
  }

  row(z) {
    return Math.floor((z - this.nav.originZ) / this.nav.res);
  }

  index(x, z) {
    const c = this.col(x);
    const r = this.row(z);
    if (c < 0 || r < 0 || c >= this.nav.cols || r >= this.nav.rows) return -1;
    return r * this.nav.cols + c;
  }

  cx(idx) {
    return this.nav.originX + ((idx % this.nav.cols) + 0.5) * this.nav.res;
  }

  cz(idx) {
    return this.nav.originZ + (Math.floor(idx / this.nav.cols) + 0.5) * this.nav.res;
  }

  passable(idx) {
    const nav = this.nav;
    if (idx < 0 || idx >= this.size || !nav.walkable[idx] || this.blocked[idx]) return false;
    const d = nav.door ? nav.door[idx] : 0;
    if (d > 0 && this.doors) {
      const door = this.doors[d - 1];
      if (door && door.isLocked) return false;
    }
    return true;
  }

  passableXZ(x, z) {
    return this.passable(this.index(x, z));
  }

  /** Door index+1 at world position (0 = none). */
  doorAt(x, z) {
    const i = this.index(x, z);
    return i < 0 || !this.nav.door ? 0 : this.nav.door[i];
  }

  /** Temporarily block every cell belonging to door `doorIdx` (0-based), e.g. found locked. */
  blockDoor(doorIdx, on = true) {
    const d = this.nav.door;
    if (!d) return;
    for (let i = 0; i < this.size; i++) if (d[i] === doorIdx + 1) this.blocked[i] = on ? 1 : 0;
  }

  clearBlocks() {
    if (this.blocked) this.blocked.fill(0);
  }

  /** Closest passable cell to idx within `maxR` cells (ring search), or -1. */
  nearestPassable(x, z, maxR = 8) {
    const nav = this.nav;
    const c0 = this.col(x);
    const r0 = this.row(z);
    const i0 = r0 * nav.cols + c0;
    if (c0 >= 0 && r0 >= 0 && c0 < nav.cols && r0 < nav.rows && this.passable(i0)) return i0;
    let best = -1;
    let bestD = Infinity;
    for (let r = 1; r <= maxR; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          const c = c0 + dx;
          const rr = r0 + dz;
          if (c < 0 || rr < 0 || c >= nav.cols || rr >= nav.rows) continue;
          const i = rr * nav.cols + c;
          if (!this.passable(i)) continue;
          const ddx = this.cx(i) - x;
          const ddz = this.cz(i) - z;
          const d = ddx * ddx + ddz * ddz;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /** True if the straight segment stays on passable cells (sampled at ~res/3). */
  lineWalkable(x0, z0, x1, z1) {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.sqrt(dx * dx + dz * dz);
    const step = this.nav.res * 0.33;
    const n = Math.max(1, Math.ceil(len / step));
    let last = -2;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const idx = this.index(x0 + dx * t, z0 + dz * t);
      if (idx === last) continue;
      last = idx;
      if (!this.passable(idx)) return false;
    }
    return true;
  }

  // ------------------------------------------------------------------ heap
  _push(node, f) {
    if (this.heapSize >= this.heapCap) {
      // grow (rare): keeps correctness on pathological grids
      const cap = this.heapCap * 2;
      const h = new Int32Array(cap);
      const hf = new Float32Array(cap);
      h.set(this.heap);
      hf.set(this.heapF);
      this.heap = h;
      this.heapF = hf;
      this.heapCap = cap;
    }
    const heap = this.heap;
    const hf = this.heapF;
    let i = this.heapSize++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hf[p] <= f) break;
      heap[i] = heap[p];
      hf[i] = hf[p];
      i = p;
    }
    heap[i] = node;
    hf[i] = f;
  }

  _pop() {
    const heap = this.heap;
    const hf = this.heapF;
    const top = heap[0];
    const n = --this.heapSize;
    if (n > 0) {
      const node = heap[n];
      const f = hf[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && hf[c + 1] < hf[c]) c++;
        if (hf[c] >= f) break;
        heap[i] = heap[c];
        hf[i] = hf[c];
        i = c;
      }
      heap[i] = node;
      hf[i] = f;
    }
    return top;
  }

  // ------------------------------------------------------------------ A*
  /**
   * Find a path from (sx,sz) to (tx,tz). Writes smoothed waypoints as x,z pairs into `out`
   * (Float32Array, capacity maxPts*2) and returns the number of waypoints (0 = no path).
   * The first waypoint is the first corner after the start (the start itself is omitted).
   * this.lastPartial is true if the goal was not reached (path to the closest node instead).
   */
  findPath(sx, sz, tx, tz, out, maxPts = 128) {
    const nav = this.nav;
    if (!nav) return 0;
    const cols = nav.cols;
    const rows = nav.rows;
    const start = this.nearestPassable(sx, sz, 6);
    const goal = this.nearestPassable(tx, tz, 10);
    this.lastPartial = false;
    this.lastIterations = 0;
    if (start < 0 || goal < 0) return 0;

    if (++this.stamp >= 0xfffffff0) {
      this.openStamp.fill(0);
      this.closedStamp.fill(0);
      this.stamp = 1;
    }
    const stamp = this.stamp;
    const g = this.g;
    const parent = this.parent;
    const openStamp = this.openStamp;
    const closedStamp = this.closedStamp;
    const gc = goal % cols;
    const gr = (goal / cols) | 0;
    const h = (i) => {
      const dx = Math.abs((i % cols) - gc);
      const dz = Math.abs(((i / cols) | 0) - gr);
      return (dx + dz + (SQRT2 - 2) * (dx < dz ? dx : dz)) * 1.001;
    };

    this.heapSize = 0;
    g[start] = 0;
    parent[start] = -1;
    openStamp[start] = stamp;
    this._push(start, h(start));
    let best = start;
    let bestH = h(start);
    let found = false;
    let iter = 0;
    const doorArr = nav.door;

    while (this.heapSize > 0) {
      const cur = this._pop();
      if (closedStamp[cur] === stamp) continue;
      closedStamp[cur] = stamp;
      if (cur === goal) {
        found = true;
        break;
      }
      if (++iter > this.iterCap) break;
      const hc = h(cur);
      if (hc < bestH) {
        bestH = hc;
        best = cur;
      }
      const c = cur % cols;
      const r = (cur / cols) | 0;
      const gcur = g[cur];
      for (let k = 0; k < 8; k++) {
        const nc = c + DX[k];
        const nr = r + DZ[k];
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const ni = nr * cols + nc;
        if (closedStamp[ni] === stamp || !this.passable(ni)) continue;
        let cost = 1;
        if (k >= 4) {
          // no corner cutting
          if (!this.passable(r * cols + nc) || !this.passable(nr * cols + c)) continue;
          cost = SQRT2;
        }
        if (doorArr && doorArr[ni]) cost += 0.15; // slight preference for not loitering in doorways
        const ng = gcur + cost;
        if (openStamp[ni] !== stamp || ng < g[ni]) {
          g[ni] = ng;
          parent[ni] = cur;
          openStamp[ni] = stamp;
          this._push(ni, ng + h(ni));
        }
      }
    }
    this.lastIterations = iter;
    const end = found ? goal : best;
    this.lastPartial = !found;
    if (!found && end === start) return 0;

    // reconstruct (reversed into raw)
    let n = 0;
    for (let i = end; i !== -1 && n < this.size; i = parent[i]) this.raw[n++] = i;
    // raw[n-1] = start ... raw[0] = end

    // string pulling
    let count = 0;
    let ax = sx;
    let az = sz;
    if (!this.passableXZ(ax, az)) {
      ax = this.cx(start);
      az = this.cz(start);
      out[count * 2] = ax;
      out[count * 2 + 1] = az;
      count++;
    }
    const endX = found && this.passableXZ(tx, tz) && this.lineWalkable(this.cx(goal), this.cz(goal), tx, tz) ? tx : this.cx(end);
    const endZ = endX === tx ? tz : this.cz(end);
    let lastOkX = ax;
    let lastOkZ = az;
    for (let k = n - 2; k >= 0; k--) {
      const px = k === 0 ? endX : this.cx(this.raw[k]);
      const pz = k === 0 ? endZ : this.cz(this.raw[k]);
      if (this.lineWalkable(ax, az, px, pz)) {
        lastOkX = px;
        lastOkZ = pz;
        continue;
      }
      if (count >= maxPts - 1) break;
      // corner: commit the last visible point
      out[count * 2] = lastOkX;
      out[count * 2 + 1] = lastOkZ;
      count++;
      ax = lastOkX;
      az = lastOkZ;
      lastOkX = px;
      lastOkZ = pz;
    }
    out[count * 2] = endX;
    out[count * 2 + 1] = endZ;
    count++;

    let len = Math.hypot(out[0] - sx, out[1] - sz);
    for (let i = 1; i < count; i++) len += Math.hypot(out[i * 2] - out[i * 2 - 2], out[i * 2 + 1] - out[i * 2 - 1]);
    this.lastLength = len;
    return count;
  }

  /** Pick a random passable point within `radius` of (x,z); writes into outVec (x,z). Returns bool. */
  randomPointNear(x, z, radius, outVec, rand = Math.random, tries = 24) {
    for (let i = 0; i < tries; i++) {
      const a = rand() * Math.PI * 2;
      const r = radius * Math.sqrt(rand());
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      const idx = this.index(px, pz);
      if (this.passable(idx)) {
        outVec.x = this.cx(idx);
        outVec.z = this.cz(idx);
        return true;
      }
    }
    return false;
  }
}
