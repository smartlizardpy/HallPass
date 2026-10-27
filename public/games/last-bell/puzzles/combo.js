// LAST BELL — puzzles/combo.js: Puzzle 5, the 3-wheel combination locks (puzzle-systems.md §7).
// Owned by the GAME workstream.
//
// A close-up of a locker door with a cheap brass 3-wheel padlock through the hasp. Roll a wheel by
// dragging or swiping it up/down, or tap its ▲/▼, or use ←/→ (or Tab) to pick a wheel and ↑/↓ (or type a
// digit) to turn it. Each notch clicks. The lock opens by itself when the code is right; wrong codes cost
// nothing. Like a real lock, the wheels reset when you walk away.
//
//   ctx: { id: 'staff'|'north'|'cabinet', door: 'locker'|'cabinet', tag: 'MS LENNOX', note: one line on a
//          sticker, act('open', { code: '143' }) → { ok } }

import { Panel, el, svg, grimeDefs, screw, stainLayer, torchLight, COND, HAND, MONO } from './panel.js';

const P = 'pzc';
const W = 900;
const H = 560;
const WHEEL_X = [372, 450, 528];
const WHEEL_Y = 352;
const NOTCH = 30; // px of drag per digit

export class ComboPanel extends Panel {
  constructor(game) {
    super(game, 'combo', { label: 'Combination lock', hint: 'Turn the wheels: drag or tap ▲ ▼ (arrow keys, or type the digits).' });
  }

  build(stage) {
    const s = svg('svg', { class: 'pz__svg', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'A three-wheel combination padlock on a locker' });
    this.svgEl = s;
    s.append(grimeDefs(P,
      `<linearGradient id="${P}-brass" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#f3d27a"/><stop offset=".45" stop-color="#c5952f"/><stop offset="1" stop-color="#6e4d12"/></linearGradient>` +
      `<linearGradient id="${P}-drum" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#0d0c0a"/><stop offset=".22" stop-color="#5b574d"/><stop offset=".5" stop-color="#e6e0cc"/><stop offset=".78" stop-color="#5b574d"/><stop offset="1" stop-color="#0d0c0a"/></linearGradient>` +
      `<linearGradient id="${P}-steel" x1="0" x2="1"><stop offset="0" stop-color="#8d918f"/><stop offset=".5" stop-color="#d5d8d6"/><stop offset="1" stop-color="#7a7e7c"/></linearGradient>` +
      `<clipPath id="${P}-win"><rect x="-26" y="-50" width="52" height="100" rx="4"/></clipPath>`));
    const cabinet = this.ctx?.door === 'cabinet';
    // the door: teal locker steel (or dark varnished wood for the principal's cabinet)
    const door = svg('g');
    // the neighbours: the next locker doors along (or the cabinet's carcass), in shadow
    door.append(
      svg('rect', { x: 0, y: 0, width: W, height: H, fill: cabinet ? '#24170d' : '#253838' }),
      svg('rect', { x: 0, y: 0, width: W, height: H, fill: `url(#${P}-grime)` }),
    );
    if (!cabinet) for (const x of [40, 812]) for (let k = 0; k < 6; k++) door.append(svg('rect', { x, y: 34 + k * 18, width: 48, height: 7, rx: 3.5, fill: '#101919', stroke: '#3d5757', 'stroke-width': 1 }));
    door.append(
      svg('rect', { x: 120, y: 0, width: 660, height: H, fill: cabinet ? '#4a2f1c' : '#3d5a5a' }),
      svg('rect', { x: 120, y: 0, width: 660, height: H, fill: `url(#${P}-grime)` }),
      svg('path', { d: `M120 0v${H}M780 0v${H}`, stroke: '#151a1a', 'stroke-width': 6 }),
    );
    if (!cabinet) {
      for (let k = 0; k < 6; k++) door.append(svg('rect', { x: 330, y: 34 + k * 18, width: 240, height: 7, rx: 3.5, fill: '#192626', stroke: '#5b7d7d', 'stroke-width': 1 }));
      door.append(svg('path', { d: 'M610 210q14 22 2 48', stroke: '#2b4242', 'stroke-width': 3, fill: 'none', opacity: 0.6 })); // a dent
    } else {
      for (let k = 0; k < 14; k++) door.append(svg('path', { d: `M${130 + k * 47} 0q${8 - (k % 3) * 5} ${H / 2} 0 ${H}`, stroke: '#33200f', 'stroke-width': 2, fill: 'none', opacity: 0.55 }));
      door.append(svg('rect', { x: 300, y: 40, width: 300, height: 120, rx: 4, fill: '#1c140c', opacity: 0.55 })); // a glass panel, dark
    }
    if (!cabinet) {
      // years of stickers, peeled off
      door.append(
        svg('rect', { x: 186, y: 290, width: 92, height: 40, rx: 4, fill: '#c9c1a2', opacity: 0.22, transform: 'rotate(-7 232 310)' }),
        svg('rect', { x: 640, y: 380, width: 70, height: 70, rx: 35, fill: '#c9c1a2', opacity: 0.16 }),
        svg('rect', { x: 196, y: 404, width: 64, height: 26, fill: '#b23a3a', opacity: 0.5, transform: 'rotate(4 228 417)' }),
        svg('path', { d: 'M168 470l26 -8M171 478l30 -10M175 486l18 -6', stroke: '#93b3b0', 'stroke-width': 1.5, opacity: 0.5 }), // scratches
      );
    }
    s.append(door);
    // the name tag holder and the one-line sticker
    const tag = svg('g', { transform: 'translate(146 150)' });
    tag.append(
      svg('rect', { x: -8, y: -6, width: 196, height: 50, rx: 3, fill: cabinet ? '#b8933f' : '#9aa09c', stroke: '#20231f', 'stroke-width': 1.5 }),
      svg('rect', { x: 0, y: 0, width: 180, height: 38, fill: '#ebe4cd' }),
      svg('rect', { x: 0, y: 0, width: 180, height: 38, fill: `url(#${P}-grime)` }),
    );
    this.tagText = svg('text', { x: 90, y: 26, 'text-anchor': 'middle', 'font-family': cabinet ? COND : HAND, 'font-weight': cabinet ? 600 : 400, 'font-size': 18, fill: '#1f2a5f', 'letter-spacing': cabinet ? 1.5 : 0 }, '');
    tag.append(this.tagText);
    s.append(tag);
    this.note = svg('text', { x: 450, y: 520, 'text-anchor': 'middle', 'font-family': HAND, 'font-size': 18, fill: '#f1e9c4' }, '');
    const noteBg = svg('rect', { x: 230, y: 494, width: 440, height: 38, rx: 3, fill: '#1c2222', opacity: 0.55 });
    s.append(noteBg, this.note);
    this.noteBg = noteBg;
    // the hasp
    s.append(
      svg('rect', { x: 600, y: 250, width: 120, height: 64, rx: 6, fill: `url(#${P}-steel)`, stroke: '#2b2e2c', 'stroke-width': 2 }),
      screw(624, 268, 6, P), screw(624, 296, 6, P, 80), screw(696, 268, 6, P, 10), screw(696, 296, 6, P, 50),
      svg('rect', { x: 560, y: 262, width: 60, height: 40, rx: 8, fill: `url(#${P}-steel)`, stroke: '#2b2e2c', 'stroke-width': 2 }),
    );
    // the padlock: shackle + brass body + three wheels
    this.shackle = svg('path', { d: 'M392 262v-56a58 58 0 0 1 116 0v56', fill: 'none', stroke: `url(#${P}-steel)`, 'stroke-width': 18, 'stroke-linecap': 'round', class: 'pzc__shackle' });
    const shackleEdge = svg('path', { d: 'M392 262v-56a58 58 0 0 1 116 0v56', fill: 'none', stroke: '#2b2e2c', 'stroke-width': 22, 'stroke-linecap': 'round', opacity: 0.6, class: 'pzc__shackle' });
    this.shackleEdge = shackleEdge;
    s.append(shackleEdge, this.shackle);
    s.append(
      svg('rect', { x: 318, y: 252, width: 264, height: 206, rx: 22, fill: `url(#${P}-brass)`, stroke: '#4a3208', 'stroke-width': 3, filter: `url(#${P}-drop)` }),
      svg('rect', { x: 318, y: 252, width: 264, height: 206, rx: 22, fill: `url(#${P}-grime)`, opacity: 0.7 }),
      svg('text', { x: 450, y: 446, 'text-anchor': 'middle', 'font-family': COND, 'font-weight': 600, 'font-size': 14, fill: '#4a3208', 'letter-spacing': 3 }, 'HARDENED'),
    );
    this.wheels = [];
    for (let i = 0; i < 3; i++) {
      const g = svg('g', { class: 'pzc__wheel', 'data-w': String(i), transform: `translate(${WHEEL_X[i]} ${WHEEL_Y})` });
      const up = svg('g', { class: 'pzc__arrow', 'data-dir': '1', transform: 'translate(0 -82)' });
      up.append(svg('rect', { x: -26, y: -18, width: 52, height: 36, rx: 6, fill: '#3a2a08', opacity: 0.001 }), svg('path', { d: 'M-12 8L0 -8L12 8Z', fill: '#2b1d04' }));
      const dn = svg('g', { class: 'pzc__arrow', 'data-dir': '-1', transform: 'translate(0 82)' });
      dn.append(svg('rect', { x: -26, y: -18, width: 52, height: 36, rx: 6, fill: '#3a2a08', opacity: 0.001 }), svg('path', { d: 'M-12 -8L0 8L12 -8Z', fill: '#2b1d04' }));
      const frame = svg('rect', { x: -32, y: -56, width: 64, height: 112, rx: 7, fill: '#2a1d05', stroke: '#1a1203', 'stroke-width': 2 });
      const win = svg('g', { 'clip-path': `url(#${P}-win)` });
      const drum = svg('rect', { x: -26, y: -50, width: 52, height: 100, fill: `url(#${P}-drum)` });
      const digits = svg('g', { class: 'pzc__digits' });
      for (let k = -2; k <= 2; k++) digits.append(svg('text', { x: 0, y: k * 34 + 13, 'text-anchor': 'middle', 'font-family': MONO, 'font-weight': 700, 'font-size': 36, fill: '#15130e' }, ''));
      const ridge = svg('path', { d: 'M-26 -50h52M-26 50h52', stroke: '#000', 'stroke-width': 3 });
      win.append(drum, digits, ridge);
      const focus = svg('rect', { x: -36, y: -60, width: 72, height: 120, rx: 9, fill: 'none', stroke: '#fff3c2', 'stroke-width': 3, class: 'pzc__focus' });
      const hit = svg('rect', { x: -34, y: -60, width: 68, height: 120, fill: 'transparent', class: 'pzc__hit' });
      g.append(frame, win, focus, hit, up, dn);
      s.append(g);
      this.wheels.push({ g, digits, value: 0, offset: 0 });
    }
    s.append(stainLayer(cabinet ? 'combo-cab' : 'combo', 0, 0, W, H, { w: 225, h: 140, seed: cabinet ? 5 : 19, stains: 10, drips: cabinet ? 0 : 5, rust: cabinet ? 0.1 : 0.6, edge: 0.8 }, 0.8),
      torchLight(P, W, H, 0.5, 0.55));
    stage.append(s);
    this._listen(s);
  }

  onOpen() {
    const c = this.ctx;
    this.tagText.textContent = c.tag || '';
    this.note.textContent = c.note || '';
    this.noteBg.style.display = c.note ? '' : 'none';
    this.focusW = 0;
    this.opened = !!c.opened;
    for (const w of this.wheels) {
      w.value = 0;
      w.offset = 0;
    }
    this.render();
  }

  render() {
    if (!this.wheels) return;
    this.wheels.forEach((w, i) => {
      // five digits on the drum: two above, the current one, two below; offset is the drag in progress
      const kids = w.digits.children;
      for (let k = -2; k <= 2; k++) kids[k + 2].textContent = String((((w.value - k) % 10) + 10) % 10);
      w.digits.setAttribute('transform', `translate(0 ${(w.offset * 34) / NOTCH})`);
      w.g.classList.toggle('is-focus', i === this.focusW);
    });
    this.root?.classList.toggle('is-open', !!this.opened);
  }

  code() {
    return this.wheels.map((w) => w.value).join('');
  }

  _turn(i, dir) {
    const w = this.wheels?.[i];
    if (!w || this.opened || this.busy) return;
    w.value = (((w.value + dir) % 10) + 10) % 10;
    this.sfx('combo_click', { rate: 0.92 + Math.random() * 0.16 });
    this.activity();
    this._noiseN = (this._noiseN || 0) + 1;
    if (this._noiseN % 4 === 0) this.noise(2.5);
    this.render();
    this._check();
  }

  async _check() {
    if (this.opened || this._checking) return;
    const code = this.code();
    if (code === this._lastTried) return;
    if (!this.ctx.quick?.(code)) return; // the lock only "gives" on the right code (cheap local check)
    this._checking = true;
    this._lastTried = code;
    const r = await this.act('open', { code });
    this._checking = false;
    if (!this.isOpen) return;
    if (r.ok) {
      this.opened = true;
      this.sfx('locker_unlock');
      this.noise(5);
      this.render();
      this.setHint('Open.');
      this.later(900, () => this.close('solved'));
    }
  }

  _listen(s) {
    s.addEventListener('pointerdown', (e) => {
      if (this.busy || this.opened) return;
      const arrow = e.target.closest?.('.pzc__arrow');
      const wheelEl = e.target.closest?.('.pzc__wheel');
      if (!wheelEl) return;
      const i = Number(wheelEl.dataset.w);
      this.focusW = i;
      e.preventDefault();
      if (arrow) {
        this._turn(i, Number(arrow.dataset.dir));
        return;
      }
      try {
        s.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      this.drag = { i, id: e.pointerId, y: this.toSvg(s, e.clientX, e.clientY).y, acc: 0 };
      this.render();
    });
    s.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      const y = this.toSvg(s, e.clientX, e.clientY).y;
      d.acc += y - d.y;
      d.y = y;
      const w = this.wheels[d.i];
      // dragging down rolls the drum down: the digit above comes into view (value + 1)
      while (d.acc >= NOTCH) {
        d.acc -= NOTCH;
        this._turn(d.i, 1);
      }
      while (d.acc <= -NOTCH) {
        d.acc += NOTCH;
        this._turn(d.i, -1);
      }
      w.offset = d.acc;
      this.render();
    });
    const end = (e) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      this.drag = null;
      const w = this.wheels?.[d.i];
      if (!w) return;
      // let go past half a notch: it clicks on to the next digit
      if (Math.abs(d.acc) > NOTCH / 2) this._turn(d.i, d.acc > 0 ? 1 : -1);
      w.offset = 0;
      this.render();
    };
    s.addEventListener('pointerup', end);
    s.addEventListener('pointercancel', end);
    s.addEventListener('wheel', (e) => {
      const wheelEl = e.target.closest?.('.pzc__wheel');
      if (!wheelEl) return;
      e.preventDefault();
      const i = Number(wheelEl.dataset.w);
      this.focusW = i;
      this._turn(i, e.deltaY > 0 ? 1 : -1);
    }, { passive: false });
  }

  onKey(e) {
    if (!this.wheels) return false;
    if (e.code === 'ArrowLeft' || (e.code === 'Tab' && e.shiftKey)) {
      this.focusW = (this.focusW + 2) % 3;
      this.render();
      return true;
    }
    if (e.code === 'ArrowRight' || e.code === 'Tab') {
      this.focusW = (this.focusW + 1) % 3;
      this.render();
      return true;
    }
    if (e.code === 'ArrowUp') {
      this._turn(this.focusW, 1);
      return true;
    }
    if (e.code === 'ArrowDown') {
      this._turn(this.focusW, -1);
      return true;
    }
    const m = /^(?:Digit|Numpad)([0-9])$/.exec(e.code);
    if (m && !this.opened) {
      // typing a digit rolls the wheel there notch by notch (you hear every click), then moves on
      const w = this.wheels[this.focusW];
      const target = Number(m[1]);
      const i = this.focusW;
      const steps = (target - w.value + 10) % 10;
      for (let k = 0; k < steps; k++) this.later(k * 45, () => this._turn(i, 1));
      this.focusW = (this.focusW + 1) % 3;
      this.render();
      return true;
    }
    return false;
  }

  onClose() {
    this.drag = null;
    this.wheels = null;
    this.svgEl = null;
    this._lastTried = null;
    this._checking = false;
  }
}
