// LAST BELL — puzzles/keycard.js: Puzzle 2, the door card readers (puzzle-systems.md §4).
// Owned by the GAME workstream.
//
// A wall-mounted reader beside the door: a beige box with a swipe slot and a little green LCD
// ("PRESENT CARD"). If you carry a card it sits at the bottom of the panel. Drag it down through the slot
// in one smooth stroke (top to bottom within 1.5 s), or press "Swipe card" / Enter. The staff card opens
// the door for good (for everyone); the Visitor pass or no card gets ACCESS DENIED. No lockout.
//
//   ctx: { reader: 'security' | 'office', doorName, card: 'staff' | 'visitor' | null,
//          unlocked: bool, act('swipe', { reader }) → { ok, denied } }

import { Panel, el, svg, grimeDefs, screw, stainLayer, torchLight, COND, HAND, MONO } from './panel.js';

const P = 'pzk';
const W = 900;
const H = 560;
const SLOT_X = 556; // centre of the slot
const SLOT_TOP = 150;
const SLOT_BOT = 404;
const SWIPE_MS = 1500;
const CARD_W = 220;
const CARD_H = 138;
const HOME = { x: 220, y: 446 }; // the card's centre while it waits in your hand

export class KeycardPanel extends Panel {
  constructor(game) {
    super(game, 'keycard', { label: 'Card reader', hint: 'Swipe your card down through the slot in one stroke.' });
  }

  build(stage) {
    const s = svg('svg', { class: 'pz__svg', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'A door card reader with a swipe slot' });
    this.svgEl = s;
    s.append(grimeDefs(P,
      `<linearGradient id="${P}-body" x1="0" x2="1"><stop offset="0" stop-color="#b8b09a"/><stop offset=".55" stop-color="#d4ccb4"/><stop offset="1" stop-color="#a39b84"/></linearGradient>` +
      `<linearGradient id="${P}-lcd" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#1f3a1c"/><stop offset="1" stop-color="#11220f"/></linearGradient>`));
    // the wall: green-grey paint over cream, and the edge of the door frame on the left
    s.append(
      svg('rect', { x: 0, y: 0, width: W, height: H, fill: '#6f7a68' }),
      svg('rect', { x: 0, y: 360, width: W, height: 200, fill: '#b9b08f' }),
      svg('rect', { x: 0, y: 352, width: W, height: 10, fill: '#4e5649' }),
      svg('rect', { x: 0, y: 0, width: W, height: H, fill: `url(#${P}-grime)` }),
      svg('rect', { x: 60, y: 0, width: 110, height: H, fill: '#5a3e27', stroke: '#2a1c10', 'stroke-width': 3 }),
      svg('rect', { x: 60, y: 0, width: 110, height: H, fill: `url(#${P}-grime)` }),
      svg('rect', { x: 150, y: 0, width: 20, height: H, fill: '#3b2919' }),
    );
    // the door sign
    this.sign = svg('text', { x: 300, y: 92, 'text-anchor': 'middle', 'font-family': COND, 'font-weight': 600, 'font-size': 22, fill: '#efe9d6', 'letter-spacing': 2 }, '');
    s.append(svg('rect', { x: 196, y: 58, width: 208, height: 70, rx: 3, fill: '#1d3b6e', stroke: '#0f1f3a', 'stroke-width': 2 }), this.sign,
      svg('text', { x: 300, y: 116, 'text-anchor': 'middle', 'font-family': COND, 'font-weight': 600, 'font-size': 14, fill: '#cdd7ea', 'letter-spacing': 3 }, 'STAFF ONLY'));
    // the reader
    const body = svg('g', { filter: `url(#${P}-drop)` });
    body.append(
      svg('rect', { x: 452, y: 70, width: 150, height: 380, rx: 14, fill: `url(#${P}-body)`, stroke: '#5f5846', 'stroke-width': 2 }),
      svg('rect', { x: 452, y: 70, width: 150, height: 380, rx: 14, fill: `url(#${P}-grime)` }),
    );
    s.append(body, screw(527, 88, 5, P), screw(527, 434, 5, P, 70));
    // the LCD and the two LEDs
    s.append(svg('rect', { x: 468, y: 104, width: 70, height: 46, rx: 3, fill: '#2b2a24' }));
    this.lcdBg = svg('rect', { x: 472, y: 108, width: 62, height: 38, rx: 2, fill: `url(#${P}-lcd)` });
    this.lcd1 = svg('text', { x: 503, y: 124, 'text-anchor': 'middle', 'font-family': MONO, 'font-weight': 700, 'font-size': 10.5, fill: '#8cff7a' }, '');
    this.lcd2 = svg('text', { x: 503, y: 139, 'text-anchor': 'middle', 'font-family': MONO, 'font-weight': 700, 'font-size': 10.5, fill: '#8cff7a' }, '');
    s.append(this.lcdBg, this.lcd1, this.lcd2);
    this.ledR = svg('circle', { cx: 482, cy: 176, r: 6, fill: `url(#${P}-lampOff)` });
    this.ledG = svg('circle', { cx: 506, cy: 176, r: 6, fill: `url(#${P}-lampOff)` });
    s.append(this.ledR, this.ledG,
      svg('text', { x: 494, y: 330, 'text-anchor': 'middle', 'font-family': COND, 'font-weight': 600, 'font-size': 12, fill: '#5f5846', 'letter-spacing': 2, transform: 'rotate(-90 494 330)' }, 'ACCESS CONTROL'));
    // the slot: a dark channel down the right side, with a "swipe" arrow
    s.append(
      svg('rect', { x: SLOT_X - 12, y: SLOT_TOP - 30, width: 24, height: SLOT_BOT - SLOT_TOP + 60, rx: 10, fill: '#181713', stroke: '#3c3a31', 'stroke-width': 2 }),
      svg('rect', { x: SLOT_X - 3, y: SLOT_TOP - 22, width: 6, height: SLOT_BOT - SLOT_TOP + 44, rx: 3, fill: '#050504' }),
      svg('path', { d: `M${SLOT_X + 26} ${SLOT_TOP + 20}v150m-9 -12l9 14l9 -14`, stroke: '#5f5846', 'stroke-width': 3, fill: 'none', 'stroke-linecap': 'round', class: 'pzk__arrow' }),
    );
    // your card
    this.cardG = svg('g', { class: 'pzk__card' });
    this.cardFace = svg('g');
    this.cardG.append(this.cardFace);
    // the card goes in front of the slot's near edge, but behind its far lip (drawn after)
    s.append(this.cardG, svg('rect', { x: SLOT_X + 4, y: SLOT_TOP - 26, width: 10, height: SLOT_BOT - SLOT_TOP + 52, rx: 4, fill: '#a39b84', opacity: 0.85 }));
    // stickers on the wall: the fire exit plan, and someone's bit of chewing gum on the reader
    s.append(
      svg('rect', { x: 680, y: 150, width: 150, height: 112, fill: '#efeadb', stroke: '#7b765f', 'stroke-width': 2, transform: 'rotate(1.5 755 206)' }),
      svg('rect', { x: 680, y: 150, width: 150, height: 22, fill: '#2f7d3d', transform: 'rotate(1.5 755 206)' }),
      svg('text', { x: 755, y: 166, 'text-anchor': 'middle', 'font-family': COND, 'font-weight': 600, 'font-size': 12, fill: '#fff', 'letter-spacing': 1.5, transform: 'rotate(1.5 755 206)' }, 'FIRE EXIT PLAN · 2F'),
      svg('path', { d: 'M696 196h40v24h30v-24h40M716 196v44h70M766 220v20', stroke: '#575345', 'stroke-width': 2, fill: 'none', transform: 'rotate(1.5 755 206)' }),
      svg('path', { d: 'M700 236l14 -8M700 236l14 8', stroke: '#2f7d3d', 'stroke-width': 3, fill: 'none', transform: 'rotate(1.5 755 206)' }),
      svg('text', { x: 732, y: 252, 'font-family': HAND, 'font-size': 11, fill: '#b8322b', transform: 'rotate(1.5 755 206)' }, 'you are here'),
      svg('ellipse', { cx: 590, cy: 420, rx: 7, ry: 5, fill: '#d97aa2', opacity: 0.8 }),
      stainLayer('keycard', 0, 0, W, H, { w: 225, h: 140, seed: 53, stains: 13, drips: 6, rust: 0.3, edge: 0.7 }, 0.8),
      torchLight(P, W, H, 0.55, 0.45),
    );
    this.empty = svg('text', { x: HOME.x, y: HOME.y + 8, 'text-anchor': 'middle', 'font-family': COND, 'font-weight': 600, 'font-size': 20, fill: '#2f2b20', 'letter-spacing': 1 }, '');
    s.append(this.empty);
    stage.append(s);
    // the accessible alternative
    const btn = el('button', 'pz__btn pzk__swipe', 'Swipe card');
    btn.type = 'button';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      this._autoSwipe();
    });
    this.btn = btn;
    stage.append(btn);
    this._listen(s);
  }

  onOpen() {
    const c = this.ctx;
    this.sign.textContent = c.doorName || 'SECURITY OFFICE';
    this._drawCard();
    this.pos = { ...HOME };
    this.state = c.unlocked ? 'granted' : 'idle';
    this._lcd(c.unlocked ? ['DOOR', 'UNLOCKED'] : ['PRESENT', 'CARD'], c.unlocked ? 'ok' : '');
    this.render();
  }

  _drawCard() {
    const f = this.cardFace;
    f.textContent = '';
    const kind = this.ctx.card;
    this.empty.textContent = kind ? '' : 'You have no card.';
    this.btn.textContent = kind ? 'Swipe card' : 'Try the reader';
    if (!kind) return;
    const staff = kind === 'staff';
    f.append(
      svg('rect', { x: -CARD_W / 2, y: -CARD_H / 2, width: CARD_W, height: CARD_H, rx: 10, fill: '#ecebe4', stroke: '#6d6b61', 'stroke-width': 2, filter: `url(#${P}-drop)` }),
      svg('rect', { x: -CARD_W / 2, y: -CARD_H / 2, width: CARD_W, height: 34, rx: 10, fill: staff ? '#1d3b6e' : '#b8322b' }),
      svg('rect', { x: -CARD_W / 2, y: -CARD_H / 2 + 22, width: CARD_W, height: 12, fill: staff ? '#1d3b6e' : '#b8322b' }),
      svg('text', { x: -CARD_W / 2 + 14, y: -CARD_H / 2 + 24, 'font-family': COND, 'font-weight': 600, 'font-size': 18, fill: '#fff', 'letter-spacing': 2.5 }, staff ? 'STAFF ACCESS' : 'VISITOR'),
      svg('rect', { x: -CARD_W / 2 + 14, y: -14, width: 46, height: 56, rx: 3, fill: staff ? '#8d9399' : '#c9c2ae' }),
      svg('rect', { x: CARD_W / 2 - 22, y: -CARD_H / 2 + 34, width: 12, height: CARD_H - 34, fill: '#232323' }), // the magnetic stripe
      svg('text', { x: -CARD_W / 2 + 70, y: -2, 'font-family': MONO, 'font-size': 12, fill: '#2b2b28' }, staff ? 'NAME: ____________' : 'PLEASE SIGN IN'),
      svg('text', { x: -CARD_W / 2 + 70, y: 16, 'font-family': MONO, 'font-size': 12, fill: '#2b2b28' }, staff ? 'DEPT: SITE STAFF' : 'AT RECEPTION'),
      svg('text', { x: -CARD_W / 2 + 70, y: 34, 'font-family': MONO, 'font-size': 12, fill: '#2b2b28' }, staff ? 'NO. 0333' : 'NO ACCESS'),
    );
    if (staff) f.append(svg('path', { d: `M${-CARD_W / 2 + 22} 26q15 -18 30 0`, stroke: '#4b5056', 'stroke-width': 3, fill: 'none' })); // the photo's been rubbed out
  }

  render() {
    if (!this.cardG) return;
    const p = this.pos || HOME;
    const engaged = this.drag?.engaged || this.anim;
    // engaged in the slot: the card turns on its side and slides down the channel
    const rot = engaged ? 90 : this.drag ? -4 : -8;
    const scale = engaged ? 0.7 : 1;
    this.cardG.setAttribute('transform', `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${rot}) scale(${scale})`);
    this.cardG.style.display = this.ctx.card ? '' : 'none';
    this.root?.classList.toggle('is-granted', this.state === 'granted');
    this.root?.classList.toggle('is-denied', this.state === 'denied');
    if (this.btn) this.btn.disabled = !!this.busy || this.state === 'granted' || !!this.anim || this.state === 'wait';
  }

  _lcd([a, b], tone = '') {
    this.lcd1.textContent = a;
    this.lcd2.textContent = b;
    const col = tone === 'ok' ? '#8cff7a' : tone === 'bad' ? '#ff6d5e' : '#8cff7a';
    this.lcd1.setAttribute('fill', col);
    this.lcd2.setAttribute('fill', col);
    this.lcdBg.setAttribute('fill', tone === 'bad' ? '#3a1210' : `url(#${P}-lcd)`);
    this.ledG.setAttribute('fill', `url(#${P}-${tone === 'ok' ? 'lampG' : 'lampOff'})`);
    this.ledR.setAttribute('fill', `url(#${P}-${tone === 'bad' ? 'lampR' : 'lampOff'})`);
  }

  _listen(s) {
    s.addEventListener('pointerdown', (e) => {
      if (this.busy || this.anim || this.state === 'granted' || this.state === 'wait' || !this.ctx.card) return;
      if (!e.target.closest?.('.pzk__card')) return;
      e.preventDefault();
      try {
        s.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      const p = this.toSvg(s, e.clientX, e.clientY);
      this.drag = { id: e.pointerId, dx: this.pos.x - p.x, dy: this.pos.y - p.y, engaged: false, tTop: 0, maxY: 0 };
      this.activity();
      this.render();
    });
    s.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      const p = this.toSvg(s, e.clientX, e.clientY);
      let x = p.x + d.dx;
      let y = p.y + d.dy;
      if (!d.engaged && Math.abs(x - SLOT_X) < 70 && y < SLOT_TOP + 70 && y > SLOT_TOP - 120) {
        d.engaged = true; // in the slot: the card snaps into the channel
        d.tTop = 0;
        d.dx = SLOT_X - p.x;
      }
      if (d.engaged) {
        x = SLOT_X;
        if (Math.abs(p.x + (d.dx || 0) - SLOT_X) > 110) {
          d.engaged = false; // pulled out sideways
          d.dx = this.pos.x - p.x;
        }
        y = Math.max(SLOT_TOP - 40, Math.min(SLOT_BOT + 40, y));
        if (!d.tTop && y <= SLOT_TOP + 24) d.tTop = performance.now();
        if (y < d.maxY - 40) d.tTop = y <= SLOT_TOP + 24 ? performance.now() : 0; // went back up: start again
        d.maxY = Math.max(d.maxY, y);
        if (d.tTop && y >= SLOT_BOT - 10) {
          const ms = performance.now() - d.tTop;
          this.drag = null;
          this.pos = { x, y };
          if (ms <= SWIPE_MS) this._swiped();
          else this._tooSlow();
          return;
        }
      }
      this.pos = { x, y };
      this.render();
    });
    const end = (e) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      this.drag = null;
      this._home();
    };
    s.addEventListener('pointerup', end);
    s.addEventListener('pointercancel', end);
  }

  onKey(e) {
    if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') {
      if (!e.repeat) this._autoSwipe();
      return true;
    }
    return false;
  }

  onBlur() {
    if (this.drag) {
      this.drag = null;
      this._home();
    }
  }

  onClose() {
    this.drag = null;
    this.anim = null;
    this.cardG = null;
    this.btn = null;
    this.svgEl = null;
  }

  _home() {
    if (!this.isOpen) return;
    this._tween(this.pos, HOME, 260, () => this.render());
  }

  _tween(from, to, ms, done) {
    const t0 = performance.now();
    const f = { ...from };
    this.anim = true;
    const step = () => {
      if (!this.isOpen) return;
      const k = Math.min(1, (performance.now() - t0) / ms);
      const e = k * k * (3 - 2 * k);
      this.pos = { x: f.x + (to.x - f.x) * e, y: f.y + (to.y - f.y) * e };
      this.render();
      if (k < 1) requestAnimationFrame(step);
      else {
        this.anim = null;
        done?.();
      }
    };
    requestAnimationFrame(step);
  }

  /** "Swipe card" / Enter: the same swipe, done for you. */
  _autoSwipe() {
    if (this.busy || this.anim || this.drag || this.state === 'granted' || this.state === 'wait') return;
    if (!this.ctx.card) {
      // nothing to swipe: a tap on the reader still gets told off
      this.sfx('access_denied');
      this.state = 'denied';
      this._lcd(['NO CARD', 'PRESENTED'], 'bad');
      this.render();
      this.later(1300, () => this._reset());
      return;
    }
    this._tween(this.pos, { x: SLOT_X, y: SLOT_TOP - 30 }, 260, () => {
      this.anim = true;
      this._tween({ x: SLOT_X, y: SLOT_TOP - 30 }, { x: SLOT_X, y: SLOT_BOT + 10 }, 420, () => this._swiped());
      this.anim = true;
    });
    this.anim = true;
    this.render();
  }

  _tooSlow() {
    this.sfx('card_swipe', { rate: 0.6 });
    this.state = 'denied';
    this._lcd(['READ ERROR', 'SWIPE FASTER'], 'bad');
    this.sfx('access_denied', { delay: 0.25 });
    this._home();
    this.later(1300, () => this._reset());
  }

  async _swiped() {
    this.sfx('card_swipe');
    this.state = 'wait';
    this._lcd(['READING', '. . .'], '');
    this.render();
    const r = await this.act('swipe', { reader: this.ctx.reader, card: this.ctx.card });
    if (!this.isOpen) return;
    if (r.ok) {
      this.state = 'granted';
      this.sfx('access_granted', { delay: 0.05 });
      this._lcd(['ACCESS', 'GRANTED'], 'ok');
      this.setHint('The door unlocks with a clunk.');
      this._home();
      this.later(1200, () => this.close('solved'));
    } else {
      this.state = 'denied';
      this.sfx('access_denied', { delay: 0.05 });
      this._lcd(['ACCESS', 'DENIED'], 'bad');
      if (this.ctx.card === 'visitor') this.setHint('VISITOR. It doesn’t open anything.');
      this._home();
      this.later(1500, () => this._reset());
    }
    this.render();
  }

  _reset() {
    if (this.state === 'granted') return;
    this.state = 'idle';
    this._lcd(['PRESENT', 'CARD'], '');
    this.setHint(this.hintText);
    this.render();
  }
}
