// LAST BELL — minimap (easy; on normal only once everything is found). A small floor plan in the HUD sidebar: the school's rooms and walls,
// you as an arrow (it turns with your view), the main entrance, and your teammates in co-op. Rooms you
// have not walked into yet are dim; corridors are always shown. It does not show the caretaker (the
// distance meter beside it does that) and keeps Room 000 off until it opens.
//
//   const mm = new Minimap(game, canvas);   mm.update(dt)   (called by the UI each frame; cheap)
//
// The plan is drawn once into an offscreen canvas and redrawn when the building changes (a transform)
// or when you enter a new room; each frame only the arrow and the dots are painted on top.

import { NavPathfinder } from './enemy-nav.js';

const CELLM = 4; // metres per layout cell
const PX = 220; // canvas size (CSS scales it)

export class Minimap {
  constructor(game, canvas) {
    this.game = game;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    canvas.width = canvas.height = PX;
    this.base = document.createElement('canvas');
    this.base.width = this.base.height = PX;
    this._key = '';
    this._visited = new Set();
    this._lastTime = Infinity;
    this._view = null;
    this._route = new Float32Array(256);
    this._routeN = 0;
    this._routeAt = -9;
    this._pf = new NavPathfinder(); // its own pathfinder: works the same for guests and with the caretaker off
    this._pfRef = null;
    this._pfVer = -1;
  }

  /** Easy: the map all run. Normal: it appears once everything is found, to show the route. Hard: never. */
  get enabled() {
    const g = this.game;
    return g.settings?.difficulty === 'easy' || (!!g.exitHelp && !!g.difficulty?.exitRoute);
  }

  update() {
    const g = this.game;
    const w = g.world;
    const p = g.player;
    if (!this.enabled || !w?.rooms?.length || !p) return false;
    if ((g.time ?? 0) < this._lastTime) this._visited.clear(); // a new run
    this._lastTime = g.time ?? 0;
    const here = w.getRoomAt(p.position.x, p.position.z);
    if (here && !this._visited.has(here.id)) {
      this._visited.add(here.id);
      this._key = '';
    }
    const key = `${g.transforms || 0}|${w.room000Revealed ? 1 : 0}|${w.layoutSeed}|${w.rooms.length}`;
    if (key !== this._key) {
      this._key = key;
      this._drawBase();
    }
    this._updateRoute(p);
    this._paint(p);
    return true;
  }

  _drawBase() {
    const w = this.game.world;
    const c = this.base.getContext('2d');
    c.clearRect(0, 0, PX, PX);
    const rooms = w.rooms.filter((r) => r.type !== 'room000' || w.room000Revealed);
    if (!rooms.length) return;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const r of rooms) {
      x0 = Math.min(x0, r.bounds.minX);
      z0 = Math.min(z0, r.bounds.minZ);
      x1 = Math.max(x1, r.bounds.maxX);
      z1 = Math.max(z1, r.bounds.maxZ);
    }
    const pad = 3;
    const s = (PX - 2 * 6) / Math.max(x1 - x0 + 2 * pad, z1 - z0 + 2 * pad);
    const ox = (PX - (x1 - x0) * s) / 2 - x0 * s;
    const oz = (PX - (z1 - z0) * s) / 2 - z0 * s;
    this._view = { s, ox, oz };
    const owner = new Map();
    for (const r of rooms) for (const cell of r.cells) owner.set(`${cell.cx},${cell.cz}`, r);
    const cs = CELLM * s;
    for (const r of rooms) {
      const seen = r.isCorridor || this._visited.has(r.id);
      c.fillStyle = r.type === 'room000' ? 'rgba(150,30,40,.55)' : seen ? (r.isCorridor ? 'rgba(232,227,211,.26)' : 'rgba(232,227,211,.42)') : 'rgba(232,227,211,.16)';
      for (const cell of r.cells) c.fillRect(cell.cx * cs + ox, cell.cz * cs + oz, cs + 0.6, cs + 0.6);
    }
    c.strokeStyle = 'rgba(0,0,0,.85)';
    c.lineWidth = 1.2;
    c.beginPath();
    for (const r of rooms) {
      for (const cell of r.cells) {
        const x = cell.cx * cs + ox, z = cell.cz * cs + oz;
        if (owner.get(`${cell.cx},${cell.cz - 1}`) !== r) (c.moveTo(x, z), c.lineTo(x + cs, z));
        if (owner.get(`${cell.cx},${cell.cz + 1}`) !== r) (c.moveTo(x, z + cs), c.lineTo(x + cs, z + cs));
        if (owner.get(`${cell.cx - 1},${cell.cz}`) !== r) (c.moveTo(x, z), c.lineTo(x, z + cs));
        if (owner.get(`${cell.cx + 1},${cell.cz}`) !== r) (c.moveTo(x + cs, z), c.lineTo(x + cs, z + cs));
      }
    }
    c.stroke();
    // the main entrance: the middle of reception's outer wall (a green door with an EXIT label)
    const ei = w.layout?.entranceEdge >= 0 ? w.layout.edgeInfo(w.layout.entranceEdge) : null;
    if (ei) {
      const x = ei.mx * s + ox, z = ei.mz * s + oz;
      c.fillStyle = '#7ed67e';
      c.fillRect(x - 9, z - 2.5, 18, 5);
      c.strokeStyle = '#000';
      c.lineWidth = 1;
      c.strokeRect(x - 9, z - 2.5, 18, 5);
      c.font = '600 11px sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'top';
      c.lineWidth = 3;
      c.strokeStyle = '#000';
      c.strokeText('EXIT', x, z + 5);
      c.fillStyle = '#7ed67e';
      c.fillText('EXIT', x, z + 5);
    }
  }

  /** Easy, once everything is found: the walkable way from you to the main entrance (the caretaker's nav grid). */
  _updateRoute(p) {
    const g = this.game;
    if (!g.exitHelp || !g.world?.exit?.position) {
      this._routeN = 0;
      return;
    }
    const now = g.time ?? 0;
    const moved = Math.hypot(p.position.x - (this._rx ?? 1e9), p.position.z - (this._rz ?? 1e9));
    if (now - this._routeAt < 0.5 && moved < 2 && this._rk === this._key) return;
    this._routeAt = now;
    this._rx = p.position.x;
    this._rz = p.position.z;
    this._rk = this._key;
    const e = g.world.exit.position;
    try {
      const w = g.world;
      const nav = w.getNav?.();
      if (nav && (nav !== this._pfRef || nav.version !== this._pfVer || this._pf.doors !== w.doors)) {
        this._pf.setNav(nav, w.doors);
        this._pfRef = nav;
        this._pfVer = nav.version;
      }
      this._routeN = this._pf.findPath(p.position.x, p.position.z, e.x, e.z, this._route, 128) || 0;
    } catch {
      this._routeN = 0;
    }
  }

  _paint(p) {
    const c = this.ctx;
    const v = this._view;
    c.clearRect(0, 0, PX, PX);
    c.drawImage(this.base, 0, 0);
    if (!v) return;
    // the route to the entrance (easy, after everything is found): a dashed line along the walkable way
    if (this._routeN > 0) {
      c.save();
      c.beginPath();
      c.moveTo(p.position.x * v.s + v.ox, p.position.z * v.s + v.oz);
      for (let i = 0; i < this._routeN; i++) c.lineTo(this._route[i * 2] * v.s + v.ox, this._route[i * 2 + 1] * v.s + v.oz);
      c.setLineDash([5, 4]);
      c.lineDashOffset = -((this.game.time || 0) * 14);
      c.lineJoin = 'round';
      c.strokeStyle = '#000';
      c.lineWidth = 4.5;
      c.stroke();
      c.strokeStyle = '#7ed67e';
      c.lineWidth = 2.2;
      c.stroke();
      c.restore();
    }
    // teammates
    const co = this.game.coop;
    if (co?.active) {
      for (const [id, pr] of co.proxies) {
        const st = co.roster.get(id)?.status;
        if (!pr?.position || st === 'escaped' || st === 'left') continue;
        c.fillStyle = st === 'alive' ? '#6fb7ff' : '#d6577a';
        c.beginPath();
        c.arc(pr.position.x * v.s + v.ox, pr.position.z * v.s + v.oz, 3.4, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = '#000';
        c.lineWidth = 1;
        c.stroke();
      }
    }
    // you: an arrow along your view (forward = (-sin yaw, -cos yaw))
    const x = p.position.x * v.s + v.ox, z = p.position.z * v.s + v.oz;
    const a = Math.atan2(-Math.cos(p.yaw), -Math.sin(p.yaw));
    c.save();
    c.translate(x, z);
    c.rotate(a);
    c.beginPath();
    c.moveTo(11, 0);
    c.lineTo(-7, 7);
    c.lineTo(-3, 0);
    c.lineTo(-7, -7);
    c.closePath();
    c.fillStyle = '#ffd966';
    c.fill();
    c.strokeStyle = '#000';
    c.lineWidth = 1.2;
    c.stroke();
    c.restore();
  }
}
