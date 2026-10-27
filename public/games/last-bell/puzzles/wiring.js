// LAST BELL — puzzles/wiring.js: Puzzle 1, the security-circuit junction box (puzzle-systems.md §3).
// Owned by the GAME workstream.
//
// A grey wall box with its lid open: four cable ends hang out of the trunking on the left (red, blue,
// yellow, green), four terminals sit on the DIN rail on the right with coloured collars. Drag a cable
// onto its terminal (it sags like a real cable), or tap a cable and then a terminal, or press 1–4 for a
// cable and 1–4 for a terminal. Each correct connection is committed to the host straight away (so
// progress survives closing, running or being caught); a wrong one buzzes, flashes the fault lamp,
// springs back and makes a noise. All four: sparks, the supply lamp goes green, the panel closes.
//
//   ctx: { cables: ['red',…] (top→bottom), terminals: ['blue',…] (top→bottom), done: { red: true, … },
//          solved: bool, box: 'south-west' | 'north-east', act('wire', { color, terminal }) }

import { Panel, svg, grimeDefs, screw, stainLayer, torchLight, COND, MONO, HAND } from './panel.js';

const P = 'pzw';
const W = 900;
const H = 560;
const ROWS = [208, 288, 368, 448];
const EXIT_X = 150; // where the cables leave the trunking
const REST_X = 226; // a loose cable's copper end (it hangs down from the trunking)
const REST_DROP = 44;
const TERM_X = 652; // a terminal's entry hole
export const WIRE_COLORS = {
  red: { fill: '#b8231f', dark: '#5e0f0c', hi: '#ef6a5c', name: 'Red' },
  blue: { fill: '#2a4fb6', dark: '#101f52', hi: '#7393ec', name: 'Blue' },
  yellow: { fill: '#d9ad22', dark: '#6a4f07', hi: '#ffe27a', name: 'Yellow' },
  green: { fill: '#2f8a3c', dark: '#0f3d17', hi: '#7bd086', name: 'Green' },
};

/** A cable from (x0, y0) to (x1, y1) that sags under its own weight (hanging: it just droops). Returns the
 *  path and the angle (degrees) the copper end points along. */
function cablePath(x0, y0, x1, y1, hanging) {
  const dx = x1 - x0;
  let c1x, c1y, c2x, c2y;
  if (hanging) {
    c1x = x0 + 34;
    c1y = y0 + 2;
    c2x = x1 - 34;
    c2y = y1 - 14;
  } else {
    const sag = 26 + Math.min(120, Math.hypot(dx, y1 - y0) * 0.18);
    c1x = x0 + dx * 0.35;
    c1y = y0 + sag;
    c2x = x1 - dx * 0.3;
    c2y = y1 + sag * 0.8;
  }
  const ang = (Math.atan2(y1 - c2y, x1 - c2x) * 180) / Math.PI;
  return { d: `M${x0} ${y0} C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`, ang };
}

export class WiringPanel extends Panel {
  constructor(game) {
    super(game, 'wiring', { label: 'Junction box', hint: 'Drag each cable to its terminal. Or tap a cable, then a terminal (keys 1–4).' });
  }

  build(stage) {
    const s = svg('svg', { class: 'pz__svg', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Open junction box: four loose cables and four terminals' });
    this.svgEl = s;
    s.append(grimeDefs(P));
    // the enclosure (powder-coated steel) and its back plate
    s.append(
      svg('rect', { x: 34, y: 16, width: W - 68, height: H - 32, rx: 16, fill: '#767c78', stroke: '#22251f', 'stroke-width': 3 }),
      svg('rect', { x: 34, y: 16, width: W - 68, height: H - 32, rx: 16, fill: `url(#${P}-grime)`, opacity: 0.9 }),
      svg('rect', { x: 64, y: 46, width: W - 128, height: H - 92, rx: 6, fill: '#4b514d', stroke: '#2a2e2a', 'stroke-width': 2 }),
      svg('rect', { x: 64, y: 46, width: W - 128, height: H - 92, rx: 6, fill: `url(#${P}-grime)` }),
      svg('path', { d: `M66 ${H - 48}h${W - 132}`, stroke: '#2a2e2a', 'stroke-width': 4, opacity: 0.6 }),
    );
    for (const [x, y] of [[50, 32], [W - 50, 32], [50, H - 32], [W - 50, H - 32]]) s.append(screw(x, y, 8, P, 20 + x));
    // the label on the inside of the lid, and the warning sticker
    const lab = svg('g', { transform: 'translate(90 64) rotate(-0.8)' });
    lab.append(
      svg('rect', { width: 270, height: 70, rx: 3, fill: '#d6ccaa', stroke: '#7d7458', 'stroke-width': 1.5 }),
      svg('rect', { width: 270, height: 70, rx: 3, fill: `url(#${P}-grime)`, opacity: 0.8 }),
      svg('text', { x: 14, y: 40, 'font-family': COND, 'font-weight': 600, 'font-size': 38, fill: '#1e1d18', 'letter-spacing': 1 }, 'DB-2F'),
      svg('text', { x: 118, y: 30, 'font-family': COND, 'font-weight': 600, 'font-size': 16, fill: '#2a2820', 'letter-spacing': 2.5 }, 'SECURITY'),
      svg('text', { x: 118, y: 49, 'font-family': COND, 'font-weight': 600, 'font-size': 16, fill: '#2a2820', 'letter-spacing': 2.5 }, 'CIRCUIT'),
    );
    this.boxLabel = svg('text', { x: 14, y: 62, 'font-family': MONO, 'font-size': 11, fill: '#5a5340' }, '');
    lab.append(this.boxLabel);
    s.append(lab);
    const warn = svg('g', { transform: 'translate(392 70) rotate(3)' });
    warn.append(
      svg('path', { d: 'M30 0L60 52H0Z', fill: '#e8c12a', stroke: '#1d1a10', 'stroke-width': 3, 'stroke-linejoin': 'round' }),
      svg('path', { d: 'M33 12L22 32h9l-4 15 13-21h-9l4-14z', fill: '#1d1a10' }),
      svg('text', { x: 30, y: 72, 'text-anchor': 'middle', 'font-family': COND, 'font-weight': 600, 'font-size': 13, fill: '#e8c12a', 'letter-spacing': 1 }, '230 V'),
    );
    s.append(warn);
    // status lamps: FAULT (red) and SUPPLY (green)
    const lamp = (x, label) => {
      const g = svg('g', { transform: `translate(${x} 78)` });
      g.append(
        svg('circle', { r: 19, fill: '#26282a', stroke: '#111', 'stroke-width': 2 }),
        svg('circle', { r: 13, fill: `url(#${P}-lampOff)`, class: 'pzw__lamp' }),
        svg('text', { y: 36, 'text-anchor': 'middle', 'font-family': COND, 'font-weight': 600, 'font-size': 13, fill: '#c9c4b2', 'letter-spacing': 1.5 }, label),
      );
      s.append(g);
      return g.querySelector('.pzw__lamp');
    };
    this.faultLamp = lamp(706, 'FAULT');
    this.supplyLamp = lamp(782, 'SUPPLY');
    // the trunking the cables come out of
    s.append(
      svg('rect', { x: 92, y: 150, width: 60, height: 344, rx: 3, fill: '#b5b1a3', stroke: '#4e4b42', 'stroke-width': 2 }),
      svg('rect', { x: 92, y: 150, width: 60, height: 344, rx: 3, fill: `url(#${P}-grime)` }),
      svg('path', { d: 'M100 150v344M144 150v344', stroke: '#8b877a', 'stroke-width': 1.5 }),
    );
    // the DIN rail and the terminal block
    s.append(
      svg('rect', { x: 690, y: 150, width: 34, height: 344, fill: '#a7aba9', stroke: '#4b4f4d', 'stroke-width': 1.5 }),
      svg('path', { d: 'M697 150v344M717 150v344', stroke: '#6f7472', 'stroke-width': 2 }),
    );
    for (let y = 160; y < 494; y += 22) s.append(svg('rect', { x: 702, y, width: 10, height: 12, rx: 2, fill: '#5b605e' }));
    // what was already in the box: the security relay, its grey cables, cable ties, a gland, a cobweb
    const relay = svg('g', { transform: 'translate(478 62)' });
    relay.append(
      svg('rect', { width: 120, height: 74, rx: 4, fill: '#2f3437', stroke: '#111', 'stroke-width': 2, filter: `url(#${P}-drop)` }),
      svg('rect', { x: 8, y: 8, width: 104, height: 22, rx: 2, fill: '#c9c2a7' }),
      svg('text', { x: 60, y: 24, 'text-anchor': 'middle', 'font-family': MONO, 'font-weight': 700, 'font-size': 13, fill: '#26241d' }, 'K1  SEC 24V'),
      svg('rect', { x: 14, y: 40, width: 30, height: 24, rx: 2, fill: '#1a1d1f' }),
      svg('rect', { x: 50, y: 40, width: 30, height: 24, rx: 2, fill: '#1a1d1f' }),
      svg('rect', { x: 86, y: 40, width: 24, height: 24, rx: 2, fill: '#1a1d1f' }),
      screw(29, 52, 6, P, 10), screw(65, 52, 6, P, 70), screw(98, 52, 6, P, 130),
    );
    s.append(relay);
    const grey = (d, w = 12) => {
      s.append(
        svg('path', { d, fill: 'none', stroke: '#1b1d1c', 'stroke-width': w + 4, 'stroke-linecap': 'round' }),
        svg('path', { d, fill: 'none', stroke: '#6c706e', 'stroke-width': w, 'stroke-linecap': 'round' }),
        svg('path', { d, fill: 'none', stroke: '#9a9e9b', 'stroke-width': 2.5, 'stroke-linecap': 'round', transform: 'translate(0 -3)', opacity: 0.7 }),
      );
    };
    grey('M122 150C122 142 140 144 200 144S450 146 478 120');
    grey('M598 112C650 112 707 118 707 150');
    grey('M122 494C122 520 122 540 122 572', 18);
    grey('M707 494C707 520 712 540 724 572', 14);
    for (const [x, y] of [[260, 144], [395, 145]]) s.append(svg('rect', { x: x - 3, y: y - 10, width: 6, height: 20, rx: 2, fill: '#e8e4d6' }));
    s.append(
      svg('rect', { x: 100, y: 488, width: 44, height: 18, rx: 4, fill: '#232523', stroke: '#0c0d0c' }),
      svg('rect', { x: 684, y: 488, width: 46, height: 16, rx: 4, fill: '#232523', stroke: '#0c0d0c' }),
      svg('path', { d: 'M66 48l46 4M66 48l40 26M66 48l18 44M80 50c4 8 6 14 4 20M92 52c2 10 0 18-8 26', stroke: '#d8d4c6', 'stroke-width': 0.8, fill: 'none', opacity: 0.45 }),
    );
    // soot round the third terminal: it has sparked before
    const soot = svg('radialGradient', { id: `${P}-soot` });
    soot.append(svg('stop', { offset: 0, 'stop-color': '#0b0907', 'stop-opacity': 0.55 }), svg('stop', { offset: 1, 'stop-color': '#0b0907', 'stop-opacity': 0 }));
    s.querySelector('defs').append(soot);
    s.append(svg('ellipse', { cx: 636, cy: ROWS[2] - 10, rx: 58, ry: 40, fill: `url(#${P}-soot)` }));
    // a strip of electrical tape over the label's corner, with an old pencilled note
    s.append(
      svg('rect', { x: 330, y: 58, width: 46, height: 16, fill: '#1c1c1c', opacity: 0.92, transform: 'rotate(18 353 66)' }),
      svg('text', { x: 244, y: 176, 'font-family': HAND, 'font-size': 14, fill: '#d9d4c2', opacity: 0.7, transform: 'rotate(-1.5 244 176)' }, 'match the collars  —J.'),
    );
    this.cableLayer = svg('g');
    this.termLayer = svg('g');
    this.fxLayer = svg('g', { 'pointer-events': 'none' });
    s.append(this.termLayer, this.cableLayer,
      stainLayer('wiring', 34, 16, W - 68, H - 32, { w: 210, h: 128, seed: 31, stains: 12, drips: 6, rust: 0.6 }, 0.85),
      torchLight(P, W, H, 0.4, 0.42), this.fxLayer);
    stage.append(s);
    this.sel = null; // selected cable colour (tap-to-place / keys)
    this.drag = null;
    this.pending = new Set();
    this._listen(s);
  }

  onOpen() {
    const c = this.ctx;
    this.boxLabel.textContent = c.box === 'north-east' ? 'NORTH HALL · EAST END' : 'SOUTH HALL · WEST END';
    this._buildTerminals();
    this._buildCables();
  }

  _buildTerminals() {
    const L = this.termLayer;
    L.textContent = '';
    this.terms = [];
    this.ctx.terminals.forEach((color, i) => {
      const y = ROWS[i];
      const C = WIRE_COLORS[color];
      const g = svg('g', { class: 'pzw__term', 'data-term': String(i), transform: `translate(0 ${y})` });
      g.append(
        svg('rect', { x: 618, y: -34, width: 128, height: 68, fill: 'transparent' }), // generous hit area
        svg('rect', { x: 626, y: -27, width: 116, height: 54, rx: 4, fill: '#8f918b', stroke: '#363833', 'stroke-width': 2, filter: `url(#${P}-drop)` }),
        svg('rect', { x: 626, y: -27, width: 116, height: 54, rx: 4, fill: `url(#${P}-grime)` }),
        svg('rect', { x: 626, y: -27, width: 22, height: 54, rx: 3, fill: C.fill, stroke: C.dark, 'stroke-width': 1.5 }),
        svg('rect', { x: 628, y: -25, width: 6, height: 50, fill: C.hi, opacity: 0.35 }),
        svg('circle', { cx: TERM_X, cy: 0, r: 11, fill: '#141512', stroke: '#2e302b', 'stroke-width': 2 }),
        screw(700, 0, 11, P, 40 + i * 25),
        svg('text', { x: 736, y: 34 - 6, 'text-anchor': 'end', 'font-family': MONO, 'font-size': 12, fill: '#2d2f2a' }, String(i + 1)),
      );
      const lampBg = svg('circle', { cx: 770, cy: 0, r: 12, fill: '#202220', stroke: '#0e0f0d', 'stroke-width': 2 });
      const lamp = svg('circle', { cx: 770, cy: 0, r: 8, fill: `url(#${P}-lampOff)` });
      g.append(lampBg, lamp);
      L.append(g);
      this.terms.push({ g, color, y, lamp });
    });
  }

  _buildCables() {
    const L = this.cableLayer;
    L.textContent = '';
    this.cables = [];
    this.ctx.cables.forEach((color, i) => {
      const y = ROWS[i];
      const C = WIRE_COLORS[color];
      const g = svg('g', { class: 'pzw__cable', 'data-cable': color });
      const shadow = svg('path', { fill: 'none', stroke: '#000', 'stroke-width': 22, 'stroke-linecap': 'round', opacity: 0.35, transform: 'translate(3 6)' });
      const outline = svg('path', { fill: 'none', stroke: C.dark, 'stroke-width': 22, 'stroke-linecap': 'round' });
      const body = svg('path', { fill: 'none', stroke: C.fill, 'stroke-width': 16, 'stroke-linecap': 'round' });
      const hi = svg('path', { fill: 'none', stroke: C.hi, 'stroke-width': 4, 'stroke-linecap': 'round', opacity: 0.6, transform: 'translate(0 -4)' });
      const tip = svg('g', { class: 'pzw__tip' });
      tip.append(
        svg('rect', { x: -4, y: -9, width: 12, height: 18, rx: 2, fill: '#2b2b28' }), // the ferrule's sleeve
        svg('rect', { x: 8, y: -5, width: 22, height: 10, rx: 2, fill: '#c98945', stroke: '#6b3d12', 'stroke-width': 1.5 }),
        svg('path', { d: 'M10 -2h18M10 2h18', stroke: '#f0bd7a', 'stroke-width': 1, opacity: 0.8 }),
      );
      const num = svg('text', { x: 104, y: y + 5, 'text-anchor': 'middle', 'font-family': MONO, 'font-size': 13, fill: '#3b392f' }, String(i + 1));
      const hit = svg('path', { fill: 'none', stroke: 'transparent', 'stroke-width': 54, 'stroke-linecap': 'round', class: 'pzw__hit' });
      g.append(shadow, outline, body, hi, tip, hit);
      L.append(num, g);
      const cab = { color, i, y, g, paths: [shadow, outline, body, hi, hit], tip, end: { x: REST_X, y: y + REST_DROP }, spring: null };
      this.cables.push(cab);
    });
    this.render();
  }

  // ------------------------------------------------------------------------------ drawing
  render() {
    if (!this.cables) return;
    const c = this.ctx;
    for (const cab of this.cables) {
      const done = !!c.done?.[cab.color];
      const t = this.terms.findIndex((x) => x.color === cab.color);
      if (done && t >= 0) {
        cab.end = { x: TERM_X - 2, y: ROWS[t] };
        cab.spring = null;
      } else if (!this.drag || this.drag.cable !== cab) {
        if (!cab.spring) cab.end = { x: REST_X, y: cab.y + REST_DROP };
      }
      cab.g.classList.toggle('is-done', done);
      cab.g.classList.toggle('is-sel', this.sel === cab.color);
      this._drawCable(cab);
    }
    for (const t of this.terms) {
      const on = !!c.done?.[t.color];
      t.lamp.setAttribute('fill', `url(#${P}-${on ? 'lampA' : 'lampOff'})`);
      t.g.classList.toggle('is-done', on);
      t.g.classList.toggle('is-target', !!this.sel && !on);
    }
    this.supplyLamp.setAttribute('fill', `url(#${P}-${c.solved ? 'lampG' : 'lampOff'})`);
    this.root?.classList.toggle('is-solved', !!c.solved);
  }

  _drawCable(cab) {
    const done = !!this.ctx.done?.[cab.color];
    const hanging = !done && !cab.spring && !(this.drag && this.drag.cable === cab && this.drag.moved) && !this.pending.has(cab.color);
    // the bare copper reaches `end`; the insulation stops 24 units before it, along the cable's last stretch
    const a = done ? 0 : cablePath(EXIT_X - 6, cab.y, cab.end.x, cab.end.y, hanging).ang;
    const k = Math.PI / 180;
    const px = cab.end.x - Math.cos(a * k) * 24;
    const py = cab.end.y - Math.sin(a * k) * 24;
    const { d } = cablePath(EXIT_X - 6, cab.y, px, py, hanging);
    for (const p of cab.paths) p.setAttribute('d', d);
    cab.tip.setAttribute('transform', `translate(${(px - Math.cos(a * k) * 6).toFixed(1)} ${(py - Math.sin(a * k) * 6).toFixed(1)}) rotate(${a.toFixed(1)})`);
  }

  // ------------------------------------------------------------------------------ input
  _listen(s) {
    s.addEventListener('pointerdown', (e) => {
      if (this.busy || this.ctx?.solved) return;
      const cabEl = e.target.closest?.('.pzw__cable');
      const termEl = e.target.closest?.('.pzw__term');
      if (cabEl) {
        const cab = this.cables.find((c) => c.color === cabEl.dataset.cable);
        if (!cab || this.ctx.done?.[cab.color] || this.pending.has(cab.color)) return;
        e.preventDefault();
        try {
          s.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        this.drag = { cable: cab, id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: false };
        this.activity();
        this.sfx('cloth', { volume: 0.35 });
      } else if (termEl && this.sel) {
        e.preventDefault();
        this._attempt(this.cables.find((c) => c.color === this.sel), Number(termEl.dataset.term));
      } else if (!termEl && this.sel) {
        this.sel = null;
        this.render();
      }
    });
    s.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 7) {
        d.moved = true;
        this.sel = null;
        d.cable.g.classList.add('is-drag');
      }
      if (!d.moved) return;
      const p = this.toSvg(s, e.clientX, e.clientY);
      d.cable.end = { x: Math.max(160, Math.min(W - 60, p.x)), y: Math.max(60, Math.min(H - 50, p.y)) };
      this._drawCable(d.cable);
      for (const t of this.terms) t.g.classList.toggle('is-hot', this._termAt(p) === t);
    });
    const end = (e) => {
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      this.drag = null;
      d.cable.g.classList.remove('is-drag');
      for (const t of this.terms) t.g.classList.remove('is-hot');
      if (e.type === 'pointercancel') {
        this._springBack(d.cable);
        return;
      }
      if (!d.moved) {
        // a tap: select this cable (tap again to put it down)
        this.sel = this.sel === d.cable.color ? null : d.cable.color;
        this.render();
        return;
      }
      const p = this.toSvg(s, e.clientX, e.clientY);
      const t = this._termAt(p);
      if (t) this._attempt(d.cable, this.terms.indexOf(t));
      else this._springBack(d.cable);
    };
    s.addEventListener('pointerup', end);
    s.addEventListener('pointercancel', end);
  }

  _termAt(p) {
    for (const t of this.terms) if (Math.abs(p.x - (TERM_X + 40)) < 92 && Math.abs(p.y - t.y) < 38) return t;
    return null;
  }

  onBlur() {
    if (this.drag) {
      const c = this.drag.cable;
      this.drag = null;
      c.g.classList.remove('is-drag');
      this._springBack(c);
    }
  }

  onKey(e) {
    const m = /^(?:Digit|Numpad)([1-4])$/.exec(e.code);
    if (m) {
      if (this.busy || this.ctx.solved) return true;
      const i = Number(m[1]) - 1;
      if (!this.sel) {
        const cab = this.cables[i];
        if (cab && !this.ctx.done?.[cab.color]) {
          this.sel = cab.color;
          this.sfx('cloth', { volume: 0.3 });
          this.render();
        }
      } else this._attempt(this.cables.find((c) => c.color === this.sel), i);
      return true;
    }
    if ((e.code === 'Backspace' || e.code === 'Digit0') && this.sel) {
      this.sel = null;
      this.render();
      return true;
    }
    return false;
  }

  onClose() {
    this.drag = null;
    this.sel = null;
    this.cables = null;
    this.terms = null;
    this.svgEl = null;
    this.pending.clear();
  }

  // ------------------------------------------------------------------------------ connect
  async _attempt(cab, ti) {
    if (!cab || !this.terms?.[ti] || this.ctx.done?.[cab.color] || this.pending.has(cab.color)) return;
    const term = this.terms[ti];
    if (this.ctx.done?.[term.color]) {
      this._springBack(cab); // that terminal already has its cable
      return;
    }
    this.sel = null;
    this.pending.add(cab.color);
    cab.end = { x: TERM_X - 2, y: term.y };
    this._drawCable(cab);
    const r = await this.act('wire', { color: cab.color, terminal: ti });
    if (!this.isOpen) return;
    this.pending.delete(cab.color);
    if (r.ok) {
      this.ctx.done = { ...(this.ctx.done || {}), [cab.color]: true };
      if (r.solved) this.ctx.solved = true;
      this.sfx('wire_connect');
      this._spark(TERM_X, term.y, 0.6);
      this.render();
      if (this.ctx.solved) this._solved();
      return;
    }
    if (r.error === 'wrong') {
      this.sfx('wire_wrong');
      this.noise(8);
      this._spark(TERM_X, term.y, 1);
      this.faultLamp.setAttribute('fill', `url(#${P}-lampR)`);
      this.root?.classList.add('is-fault');
      this.later(400, () => {
        this.faultLamp?.setAttribute('fill', `url(#${P}-lampOff)`);
        this.root?.classList.remove('is-fault');
      });
    } else if (r.error) {
      this.setHint(r.error === 'busy' ? 'Someone else is using this panel.' : 'Nothing happens. Try again.');
    }
    this._springBack(cab);
  }

  _springBack(cab) {
    if (!cab || !this.isOpen) return;
    const from = { ...cab.end };
    const to = { x: REST_X, y: cab.y + REST_DROP };
    const t0 = performance.now();
    cab.spring = true;
    const step = () => {
      if (!this.isOpen || !this.cables || cab.spring !== true) return;
      const k = Math.min(1, (performance.now() - t0) / 380);
      // a little overshoot, like a stiff cable flopping back
      const e = 1 - Math.pow(1 - k, 3) + Math.sin(k * Math.PI) * 0.12;
      cab.end = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
      this._drawCable(cab);
      if (k < 1) requestAnimationFrame(step);
      else cab.spring = null;
    };
    requestAnimationFrame(step);
    this.render();
  }

  _spark(x, y, size = 1) {
    const L = this.fxLayer;
    if (!L) return;
    const g = svg('g', { class: 'pzw__spark', transform: `translate(${x} ${y}) scale(${size})` });
    let d = '';
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2 + Math.random() * 0.4;
      const r0 = 6 + Math.random() * 6;
      const r1 = 22 + Math.random() * 26;
      d += `M${(Math.cos(a) * r0).toFixed(1)} ${(Math.sin(a) * r0).toFixed(1)}L${(Math.cos(a) * r1).toFixed(1)} ${(Math.sin(a) * r1).toFixed(1)}`;
    }
    g.append(svg('circle', { r: 10, fill: '#fff6c8', opacity: 0.9 }), svg('path', { d, stroke: '#ffe38a', 'stroke-width': 3, 'stroke-linecap': 'round' }));
    L.append(g);
    this.later(320, () => g.remove());
  }

  _solved() {
    this.sfx('spark');
    this.sfx('power_on', { delay: 0.25 });
    for (const t of this.terms) this._spark(TERM_X, t.y, 0.8);
    this.setHint('Power restored to the security circuit.');
    this.later(1000, () => this.close('solved'));
  }
}
