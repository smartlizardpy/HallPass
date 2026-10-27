// LAST BELL — puzzles/breakers.js: Puzzle 3, the maintenance-room breaker panel (puzzle-systems.md §5).
// Owned by the GAME workstream.
//
// Eight circuit breakers on a DIN rail behind an open steel door, each labelled on faded masking tape.
// Click or tap a breaker to flip it (keys 1–8), then pull the red TEST handle (Enter). The switch
// positions are physical: they are host state, everyone sees them, and they stay where you left them.
// The right set (from the torn "CIRCUIT MAP: SECURITY" sheet) turns the SECURITY lamp green. A wrong
// test pops, buzzes, dips the corridor lights for a second and makes a loud noise (14 m).
//
//   ctx: { set: [0|1 ×8], solved: bool, act('flip', { i, on }) / act('test') }

import { Panel, svg, grimeDefs, screw, stainLayer, torchLight, COND, HAND, MONO } from './panel.js';

const P = 'pzb';
const W = 900;
const H = 560;
export const BREAKER_LABELS = ['CORRIDOR N', 'SEC. OFFICE', 'LAB', 'FIRE ALARM', 'SEC. CCTV', 'ART', 'LIBRARY', 'SPARE'];
const X0 = 108;
const STEP = 76;
const TOP = 196;

export class BreakerPanel extends Panel {
  constructor(game) {
    super(game, 'breakers', { label: 'Breaker panel', hint: 'Flip the breakers (keys 1–8), then pull TEST (Enter).' });
  }

  build(stage) {
    const s = svg('svg', { class: 'pz__svg', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Breaker panel with eight switches and a test handle' });
    this.svgEl = s;
    s.append(grimeDefs(P,
      `<linearGradient id="${P}-mod" x1="0" x2="1"><stop offset="0" stop-color="#cfc9b6"/><stop offset=".5" stop-color="#e4dfcf"/><stop offset="1" stop-color="#b9b3a0"/></linearGradient>` +
      `<linearGradient id="${P}-red" x1="0" x2="1"><stop offset="0" stop-color="#7e0f12"/><stop offset=".45" stop-color="#d0272a"/><stop offset="1" stop-color="#6d0b0e"/></linearGradient>`));
    // the cabinet: a heavy grey steel box, its door swung open to the left (only its edge is visible)
    s.append(
      svg('rect', { x: 26, y: 14, width: W - 52, height: H - 28, rx: 10, fill: '#5d625f', stroke: '#1c1e1c', 'stroke-width': 3 }),
      svg('rect', { x: 26, y: 14, width: W - 52, height: H - 28, rx: 10, fill: `url(#${P}-grime)` }),
      svg('rect', { x: 54, y: 42, width: W - 108, height: H - 84, rx: 4, fill: '#8e938d', stroke: '#3a3d3a', 'stroke-width': 2 }),
      svg('rect', { x: 54, y: 42, width: W - 108, height: H - 84, rx: 4, fill: `url(#${P}-grime)` }),
      svg('path', { d: `M26 30v${H - 60}`, stroke: '#2f322f', 'stroke-width': 10, 'stroke-linecap': 'round' }),
    );
    for (const [x, y] of [[70, 58], [W - 70, 58], [70, H - 58], [W - 70, H - 58]]) s.append(screw(x, y, 7, P, x * 0.7));
    // the board's plate and the lamps
    const plate = svg('g', { transform: 'translate(84 66)' });
    plate.append(
      svg('rect', { width: 330, height: 44, rx: 2, fill: '#20231f', stroke: '#0e0f0d' }),
      svg('text', { x: 14, y: 29, 'font-family': COND, 'font-weight': 600, 'font-size': 20, fill: '#d9d4c2', 'letter-spacing': 2.2 }, 'SUB-BOARD 2F · MAINTENANCE'),
    );
    s.append(plate);
    const lamp = (x, label) => {
      const g = svg('g', { transform: `translate(${x} 88)` });
      g.append(
        svg('circle', { r: 18, fill: '#1f211f', stroke: '#0d0e0c', 'stroke-width': 2 }),
        svg('circle', { r: 12, fill: `url(#${P}-lampOff)` }),
        svg('text', { y: 38, 'text-anchor': 'middle', 'font-family': COND, 'font-weight': 600, 'font-size': 13, fill: '#23251f', 'letter-spacing': 1.5 }, label),
      );
      s.append(g);
      return g.children[1];
    };
    this.mainsLamp = lamp(600, 'MAINS');
    this.secLamp = lamp(670, 'SECURITY');
    this.mainsLamp.setAttribute('fill', `url(#${P}-lampA)`);
    // the DIN rail and its eight breakers
    s.append(svg('rect', { x: 84, y: TOP + 52, width: 8 * STEP + 18, height: 36, fill: '#b9bcba', stroke: '#585c5a', 'stroke-width': 1.5 }));
    this.mods = [];
    for (let i = 0; i < 8; i++) {
      const x = X0 + i * STEP;
      const g = svg('g', { class: 'pzb__mod', 'data-i': String(i), transform: `translate(${x} ${TOP})`, tabindex: -1 });
      g.append(
        svg('rect', { x: -6, y: -40, width: 70, height: 290, fill: 'transparent' }),
        svg('text', { x: 29, y: -14, 'text-anchor': 'middle', 'font-family': MONO, 'font-weight': 700, 'font-size': 18, fill: '#1f211d' }, String(i + 1)),
        svg('rect', { x: 0, y: 0, width: 58, height: 140, rx: 4, fill: `url(#${P}-mod)`, stroke: '#5f5a4b', 'stroke-width': 1.5, filter: `url(#${P}-drop)` }),
        svg('rect', { x: 0, y: 0, width: 58, height: 140, rx: 4, fill: `url(#${P}-grime)`, opacity: 0.8 }),
        svg('text', { x: 29, y: 18, 'text-anchor': 'middle', 'font-family': COND, 'font-weight': 600, 'font-size': 11, fill: '#57524a' }, 'C16'),
        svg('rect', { x: 15, y: 34, width: 28, height: 74, rx: 3, fill: '#2a2925' }), // the toggle's slot
        svg('text', { x: 29, y: 31, 'text-anchor': 'middle', 'font-family': COND, 'font-weight': 600, 'font-size': 11, fill: '#3b3830' }, 'I'),
        svg('text', { x: 29, y: 121, 'text-anchor': 'middle', 'font-family': COND, 'font-weight': 600, 'font-size': 11, fill: '#3b3830' }, 'O'),
      );
      const lever = svg('g', { class: 'pzb__lever' });
      lever.append(
        svg('rect', { x: 17, y: 0, width: 24, height: 32, rx: 3, fill: '#151513', stroke: '#000', 'stroke-width': 1 }),
        svg('rect', { x: 19, y: 2, width: 20, height: 6, rx: 2, fill: '#3a3934' }),
      );
      const flag = svg('rect', { x: 22, y: 126, width: 14, height: 8, rx: 1, fill: '#2f8a3c' });
      g.append(lever, flag);
      // the masking-tape label, written by hand years ago
      const tape = svg('g', { transform: `translate(29 182) rotate(${(i % 3) - 1 + (i === 3 ? 2 : 0)})` });
      tape.append(
        svg('rect', { x: -36, y: -15, width: 72, height: 30, rx: 2, fill: '#d8cc9e', opacity: 0.92 }),
        svg('rect', { x: -36, y: -15, width: 72, height: 30, rx: 2, fill: `url(#${P}-grime)` }),
        svg('text', { x: 0, y: 5, 'text-anchor': 'middle', 'font-family': HAND, 'font-size': BREAKER_LABELS[i].length > 9 ? 11.5 : 13.5, fill: '#2a2f6a', opacity: 0.85 }, BREAKER_LABELS[i]),
      );
      g.append(tape);
      s.append(g);
      this.mods.push({ g, lever, flag });
    }
    // the circuit chart pocket: the chart itself is long gone, but someone left a note where it was
    const chart = svg('g', { transform: 'translate(96 470) rotate(-0.6)' });
    chart.append(
      svg('rect', { width: 360, height: 52, rx: 2, fill: '#2a2d2a', stroke: '#111' }),
      svg('rect', { x: 8, y: 6, width: 344, height: 40, fill: '#e6e0cc' }),
      svg('rect', { x: 8, y: 6, width: 344, height: 40, fill: `url(#${P}-grime)` }),
      svg('text', { x: 18, y: 22, 'font-family': COND, 'font-weight': 600, 'font-size': 12, fill: '#4a463c', 'letter-spacing': 1.6 }, 'CIRCUIT CHART'),
      svg('text', { x: 18, y: 39, 'font-family': HAND, 'font-size': 14, fill: '#2a2f6a', opacity: 0.85 }, 'took it to copy. staffroom? prep room? office?'),
    );
    const warn = svg('g', { transform: 'translate(484 470)' });
    warn.append(
      svg('rect', { width: 178, height: 52, rx: 3, fill: '#e9c435', stroke: '#2a2410', 'stroke-width': 2 }),
      svg('rect', { width: 178, height: 52, rx: 3, fill: `url(#${P}-grime)` }),
      svg('text', { x: 89, y: 22, 'text-anchor': 'middle', 'font-family': COND, 'font-weight': 600, 'font-size': 13, fill: '#1b1708', 'letter-spacing': 1 }, 'A WRONG SETTING WILL'),
      svg('text', { x: 89, y: 40, 'text-anchor': 'middle', 'font-family': COND, 'font-weight': 600, 'font-size': 13, fill: '#1b1708', 'letter-spacing': 1 }, 'TRIP THE WHOLE FLOOR'),
    );
    s.append(chart, warn);
    // the TEST handle: a big red rotary lever on the right
    const tg = svg('g', { class: 'pzb__test', transform: 'translate(778 330)' });
    tg.append(
      svg('rect', { x: -60, y: -150, width: 120, height: 290, fill: 'transparent' }),
      svg('rect', { x: -46, y: -126, width: 92, height: 180, rx: 6, fill: '#2b2e2b', stroke: '#111', 'stroke-width': 2 }),
      svg('text', { x: 0, y: -100, 'text-anchor': 'middle', 'font-family': COND, 'font-weight': 600, 'font-size': 20, fill: '#e3d9b5', 'letter-spacing': 3 }, 'TEST'),
      svg('circle', { cx: 0, cy: -20, r: 26, fill: '#3b3e3b', stroke: '#0c0d0c', 'stroke-width': 2 }),
    );
    this.handle = svg('g', { class: 'pzb__handle', transform: 'translate(0 -20) rotate(-35)' });
    this.handle.append(
      svg('rect', { x: -13, y: -12, width: 26, height: 96, rx: 9, fill: `url(#${P}-red)`, stroke: '#3d0507', 'stroke-width': 2 }),
      svg('circle', { r: 17, fill: '#b71f22', stroke: '#3d0507', 'stroke-width': 2 }),
      svg('circle', { r: 6, fill: '#2b2e2b' }),
    );
    tg.append(this.handle, svg('text', { x: 0, y: 40, 'text-anchor': 'middle', 'font-family': MONO, 'font-size': 12, fill: '#9c9a90' }, '[Enter]'));
    s.append(tg, stainLayer('breakers', 26, 14, W - 52, H - 28, { w: 216, h: 126, seed: 77, stains: 11, drips: 5, rust: 0.55 }, 0.8), torchLight(P, W, H, 0.45, 0.45));
    this.testG = tg;
    stage.append(s);
    s.addEventListener('click', (e) => {
      if (this.busy) return;
      const mod = e.target.closest?.('.pzb__mod');
      if (mod) return this._flip(Number(mod.dataset.i));
      if (e.target.closest?.('.pzb__test')) this._test();
    });
  }

  render() {
    if (!this.mods) return;
    const set = this.ctx.set || [];
    this.mods.forEach((m, i) => {
      const on = !!set[i];
      m.lever.setAttribute('transform', `translate(0 ${on ? 36 : 74})`);
      m.flag.setAttribute('fill', on ? '#c8262a' : '#2f8a3c');
      m.g.classList.toggle('is-on', on);
    });
    this.secLamp.setAttribute('fill', `url(#${P}-${this.ctx.solved ? 'lampG' : this._faultT ? 'lampR' : 'lampOff'})`);
    this.root?.classList.toggle('is-solved', !!this.ctx.solved);
  }

  onKey(e) {
    const m = /^(?:Digit|Numpad)([1-8])$/.exec(e.code);
    if (m) {
      if (!e.repeat) this._flip(Number(m[1]) - 1);
      return true;
    }
    if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') {
      if (!e.repeat) this._test();
      return true;
    }
    return false;
  }

  onClose() {
    this.mods = null;
    this.svgEl = null;
    this._testing = false;
    this._faultT = null;
  }

  async _flip(i) {
    if (this.busy || this.ctx.solved || this._testing || !this.mods?.[i]) return;
    const on = !this.ctx.set?.[i];
    // the switch moves under your finger; the host's state confirms it a moment later
    const set = (this.ctx.set || []).slice();
    set[i] = on ? 1 : 0;
    this.ctx.set = set;
    this.render();
    this.sfx('breaker_switch', { rate: 0.94 + Math.random() * 0.12 });
    this.noise(4);
    const r = await this.act('flip', { i, on });
    if (!this.isOpen) return;
    if (!r.ok && r.set) {
      this.ctx.set = r.set;
      this.render();
    }
  }

  async _test() {
    if (this.busy || this.ctx.solved || this._testing) return;
    this._testing = true;
    this.handle.setAttribute('transform', 'translate(0 -20) rotate(35)');
    this.sfx('breaker_switch', { rate: 0.7, volume: 1.2 });
    const r = await this.act('test');
    if (!this.isOpen) return;
    if (r.ok) {
      this.ctx.solved = true;
      this.sfx('power_on', { delay: 0.15 });
      this.setHint(r.power ? 'Power restored to the Security Office.' : 'SECURITY circuit live. The junction box still needs wiring.');
      this.render();
      this.later(1400, () => this.close('solved'));
      return;
    }
    // a fault: pop, fizz, the lights dip
    this.sfx('breaker_fault');
    this.noise(14);
    this.game.events.emit('lights:flicker', { intensity: 0.75, duration: 1 });
    this._faultT = true;
    this.root?.classList.add('is-fault');
    this.render();
    this.setHint(r.error === 'wrong' ? 'FAULT. The breakers stay where you put them.' : 'Nothing happens.');
    this.later(1000, () => {
      this._faultT = null;
      this.root?.classList.remove('is-fault');
      this.handle?.setAttribute('transform', 'translate(0 -20) rotate(-35)');
      this._testing = false;
      this.render();
      this.later(1600, () => this.setHint(this.hintText));
    });
  }
}
