// LAST BELL — puzzles/panel.js: the shared base for the Floor 2 puzzle overlays (Second Floor update).
// Owned by the GAME workstream. Design: docs/last-bell-update/puzzle-systems.md §2.
//
// A panel is a DOM overlay over the (still running) game: a close-up of a piece of school hardware drawn
// in one SVG. It opens through game.openOverlay(name) (movement off, pointer free, keys captured) and
// closes through game.closeOverlay(name); it also tears itself down on every 'overlay:close' for its
// name (capture, the run ending, a Director takeover: game.closeAllOverlays). Nothing it creates
// outlives a close: the DOM is built on open and removed on close, window listeners are tracked.
//
//   const p = new WiringPanel(game);
//   p.open(ctx)      ctx: { position (Vector3), floor, act(type, data) → Promise<{ ok, … }>,
//                           activity(), onClosed(reason), watch: bool, …panel-specific fields }
//   p.sync(view)     the host state changed: redraw from it (no-op while closed)
//   p.setBusy(text)  someone else holds the lease: input off + a banner (null = yours again)
//   p.close(reason)  'user' (Esc / ✕ / E) | 'solved' | 'force'
//
// Subclasses implement build(stage), and optionally onOpen(), onClose(reason), onKey(e, typing) → bool,
// render(). They use this.listen(target, type, fn, opts) for anything outside their own DOM, this.later(ms, fn)
// for timers, this.sfx(id) and this.noise(radius) for feedback (the noise carries `floor` and
// source 'panel', so The Assistant comes to "help").

export const SVG_NS = 'http://www.w3.org/2000/svg';
export const HAND = "'Marker Felt', 'Chalkboard SE', 'Comic Sans MS', 'Segoe Print', cursive";
export const COND = "'Barlow Condensed', 'Arial Narrow', Arial, sans-serif";
export const MONO = "'Courier Prime', 'Courier New', monospace";

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

export function svg(tag, attrs, text) {
  const e = document.createElementNS(SVG_NS, tag);
  if (attrs) for (const k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
  if (text !== undefined) e.textContent = text;
  return e;
}

const rng = (seed) => {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
};

// A fine speckle texture (no blotches, so the repeat doesn't show), used as an SVG pattern on metal and
// plastic. Generated once per page, cached as a data URL.
let _grime = null;
export function grimeURL() {
  if (_grime !== null) return _grime;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const r = rng(0x2f6e2b1);
    for (let i = 0; i < 520; i++) {
      const a = 0.05 + r() * 0.2;
      g.fillStyle = r() < 0.78 ? `rgba(0,0,0,${a})` : `rgba(255,250,235,${a * 0.55})`;
      g.fillRect((r() * 64) | 0, (r() * 64) | 0, 1, 1);
    }
    _grime = c.toDataURL('image/png');
  } catch {
    _grime = '';
  }
  return _grime;
}

// One unique, low-resolution layer of dirt for a whole panel: soft stains, rust drips, scuffs, edge grime
// and a dithered speckle, upscaled with nearest-neighbour so it reads as the game's chunky PS1 textures.
// It never repeats (it covers the whole close-up). Cached per key.
const _stains = new Map();
export function stainURL(key, { w = 225, h = 140, seed = 7, stains = 9, drips = 4, scratches = 14, edge = 0.5, rust = 0.5 } = {}) {
  if (_stains.has(key)) return _stains.get(key);
  let url = '';
  try {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    const r = rng(seed);
    const img = g.createImageData(w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = r();
      if (v < 0.22) {
        d[i] = d[i + 1] = d[i + 2] = 0;
        d[i + 3] = 12 + r() * 22;
      } else if (v > 0.95) {
        d[i] = 255;
        d[i + 1] = 248;
        d[i + 2] = 230;
        d[i + 3] = 8 + r() * 12;
      }
    }
    g.putImageData(img, 0, 0);
    for (let i = 0; i < stains; i++) {
      const x = r() * w, y = r() * h, rad = 5 + r() * Math.min(w, h) * 0.22;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      const rusty = r() < rust;
      gr.addColorStop(0, rusty ? `rgba(92,52,20,${0.16 + r() * 0.16})` : `rgba(10,8,4,${0.14 + r() * 0.16})`);
      gr.addColorStop(0.6, rusty ? 'rgba(92,52,20,.06)' : 'rgba(10,8,4,.05)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.ellipse(x, y, rad, rad * (0.5 + r() * 0.6), r() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
    for (let i = 0; i < drips; i++) {
      const x = r() * w, y = r() * h * 0.6, len = 8 + r() * h * 0.35;
      const gr = g.createLinearGradient(0, y, 0, y + len);
      gr.addColorStop(0, `rgba(80,44,16,${0.22 + r() * 0.15})`);
      gr.addColorStop(1, 'rgba(80,44,16,0)');
      g.fillStyle = gr;
      g.fillRect(x | 0, y | 0, 1 + (r() < 0.4 ? 1 : 0), len);
    }
    for (let i = 0; i < scratches; i++) {
      g.strokeStyle = r() < 0.6 ? `rgba(255,252,240,${0.08 + r() * 0.12})` : `rgba(0,0,0,${0.12 + r() * 0.12})`;
      g.lineWidth = 1;
      g.beginPath();
      const x = r() * w, y = r() * h;
      g.moveTo(x, y);
      g.lineTo(x + (r() - 0.5) * 50, y + (r() - 0.5) * 16);
      g.stroke();
    }
    if (edge > 0) {
      const e = Math.min(w, h) * 0.16;
      for (const [x0, y0, x1, y1, rx, ry, rw, rh] of [
        [0, 0, 0, e, 0, 0, w, e], [0, h, 0, h - e, 0, h - e, w, e], [0, 0, e, 0, 0, 0, e, h], [w, 0, w - e, 0, w - e, 0, e, h],
      ]) {
        const gr = g.createLinearGradient(x0, y0, x1, y1);
        gr.addColorStop(0, `rgba(12,9,5,${0.35 * edge})`);
        gr.addColorStop(1, 'rgba(12,9,5,0)');
        g.fillStyle = gr;
        g.fillRect(rx, ry, rw, rh);
      }
    }
    url = c.toDataURL('image/png');
  } catch {
    url = '';
  }
  _stains.set(key, url);
  return url;
}

/** The dirt layer as an <image> covering (x, y, w, h) of an SVG (no input). */
export function stainLayer(key, x, y, w, h, opts, opacity = 1) {
  const url = stainURL(key, opts);
  const i = svg('image', { x, y, width: w, height: h, preserveAspectRatio: 'none', opacity, 'pointer-events': 'none' });
  if (url) i.setAttribute('href', url);
  i.style.imageRendering = 'pixelated';
  return i;
}

/** Your torch on the hardware: a warm pool of light, falling off into the dark. */
export function torchLight(p, W, H, cx = 0.42, cy = 0.4) {
  const g = svg('g', { 'pointer-events': 'none' });
  g.innerHTML =
    `<radialGradient id="${p}-torch" cx="${cx}" cy="${cy}" r=".75"><stop offset="0" stop-color="#fff1cf" stop-opacity=".1"/>` +
    `<stop offset=".45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></radialGradient>` +
    `<rect width="${W}" height="${H}" fill="url(#${p}-torch)"/>`;
  return g;
}

/** <defs> for an SVG: the grime pattern (id `${p}-grime`) and a soft drop shadow (`${p}-drop`). */
export function grimeDefs(p, extra = '') {
  const url = grimeURL();
  const defs = svg('defs');
  defs.innerHTML =
    `<pattern id="${p}-grime" width="192" height="192" patternUnits="userSpaceOnUse">` +
    (url ? `<image href="${url}" width="192" height="192" style="image-rendering:pixelated"/>` : '') +
    `</pattern>` +
    `<filter id="${p}-drop" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="3" stdDeviation="2.5" flood-color="#000" flood-opacity=".55"/></filter>` +
    `<radialGradient id="${p}-lampG"><stop offset="0" stop-color="#9dff9f"/><stop offset=".55" stop-color="#2fd36a"/><stop offset="1" stop-color="#0d4a22"/></radialGradient>` +
    `<radialGradient id="${p}-lampR"><stop offset="0" stop-color="#ffb3a6"/><stop offset=".55" stop-color="#e2332a"/><stop offset="1" stop-color="#4d0c09"/></radialGradient>` +
    `<radialGradient id="${p}-lampA"><stop offset="0" stop-color="#fff0b8"/><stop offset=".55" stop-color="#f2a524"/><stop offset="1" stop-color="#5a3305"/></radialGradient>` +
    `<radialGradient id="${p}-lampOff"><stop offset="0" stop-color="#5a5a52"/><stop offset="1" stop-color="#1c1c19"/></radialGradient>` +
    `<radialGradient id="${p}-screw"><stop offset="0" stop-color="#d9d4c4"/><stop offset=".7" stop-color="#8a8576"/><stop offset="1" stop-color="#3b3830"/></radialGradient>` +
    extra;
  return defs;
}

/** A slotted screw head at (x, y). */
export function screw(x, y, r = 7, p = 'pz', angle = 30) {
  const g = svg('g', { transform: `translate(${x} ${y}) rotate(${angle})` });
  g.append(
    svg('circle', { r, fill: `url(#${p}-screw)`, stroke: '#26241f', 'stroke-width': 1 }),
    svg('rect', { x: -r * 0.75, y: -1.1, width: r * 1.5, height: 2.2, fill: '#2a2822' }),
  );
  return g;
}

const floorOfY = (y) => (Number(y) > 1.8 ? 1 : 0);

export class Panel {
  /**
   * @param {object} game
   * @param {string} name   overlay name (also the CSS modifier: .pz--<name>)
   * @param {{ label?: string, hint?: string }} opts
   */
  constructor(game, name, opts = {}) {
    this.game = game;
    this.name = name;
    this.label = opts.label || name;
    this.hintText = opts.hint || '';
    this.isOpen = false;
    this.root = null;
    this.ctx = null;
    this.busy = null;
    this._offs = [];
    this._timers = new Set();
    this._openedAt = 0;
  }

  get position() {
    return this.ctx?.position || null;
  }

  // ------------------------------------------------------------------------------ open / close
  open(ctx = {}) {
    const g = this.game;
    if (this.isOpen) return false;
    if (g.state !== 'playing') return false;
    if (g.activeOverlay && g.activeOverlay !== this.name) return false;
    this.ctx = ctx;
    this.isOpen = true;
    this.busy = null;
    this._openedAt = performance.now();
    const root = el('div', `pz pz--${this.name}`);
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', this.label);
    root.tabIndex = -1;
    const stage = el('div', 'pz__stage');
    this.stage = stage;
    root.append(el('div', 'pz__shade'), stage);
    this.build(stage);
    const bar = el('div', 'pz__bar');
    this.hintEl = el('p', 'pz__hint', this.hintText);
    const close = el('button', 'pz__close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.innerHTML = '<span aria-hidden="true">✕</span><kbd class="no-touch">Esc</kbd>';
    close.addEventListener('click', (e) => {
      e.preventDefault();
      this.close('user');
    });
    bar.append(this.hintEl, close);
    this.busyEl = el('div', 'pz__busy');
    this.busyEl.hidden = true;
    root.append(bar, this.busyEl);
    // a click on the dim edge (outside the hardware) closes the panel too
    root.firstElementChild.addEventListener('click', (e) => {
      e.preventDefault();
      this.close('user');
    });
    (document.getElementById('ui') || document.body).append(root);
    this.root = root;
    g.openOverlay?.(this.name, { capturesKeys: true, releasesPointer: true, blocksMovement: true });
    // ui.js pauses on Esc / P from a window capture listener registered long before ours; re-queue it behind ours
    // so a panel sees Esc first (we stop it), otherwise closing a panel with Esc also paused the game.
    const uiKey = g.ui?._onKey;
    if (uiKey) window.removeEventListener('keydown', uiKey, true);
    this.listen(window, 'keydown', (e) => this._key(e), true);
    if (uiKey) window.addEventListener('keydown', uiKey, true);
    this.listen(window, 'blur', () => this.onBlur?.());
    this._offs.push(
      g.events.on('overlay:close', ({ name, reason } = {}) => {
        if (name === this.name) this._teardown(reason || 'user');
      }),
    );
    try {
      root.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
    if (ctx.watch) this.setBusy(ctx.watch === true ? 'Someone else is using this panel.' : ctx.watch);
    this.onOpen?.();
    this.render?.();
    g.events.emit('puzzle:open', { name: this.name });
    return true;
  }

  /** reason: 'user' | 'solved' | 'force' */
  close(reason = 'user') {
    if (!this.isOpen) return;
    const g = this.game;
    // a close from a key or a click is a user gesture: take the mouse back (not after a forced close)
    if (g.overlays?.has?.(this.name)) g.closeOverlay(this.name, { relock: reason !== 'force' });
    if (this.isOpen) this._teardown(reason);
  }

  _teardown(reason) {
    if (!this.isOpen) return;
    this.isOpen = false;
    try {
      this.onClose?.(reason);
    } catch (err) {
      console.warn(`[${this.name}] close hook failed`, err);
    }
    for (const off of this._offs.splice(0)) {
      try {
        off();
      } catch {
        /* ignore */
      }
    }
    for (const t of this._timers) clearTimeout(t);
    this._timers.clear();
    this.root?.remove();
    this.root = null;
    this.stage = null;
    this.hintEl = null;
    this.busyEl = null;
    const ctx = this.ctx;
    this.ctx = null;
    this.game.events.emit('puzzle:close', { name: this.name, reason });
    try {
      ctx?.onClosed?.(reason);
    } catch (err) {
      console.warn(`[${this.name}] onClosed failed`, err);
    }
  }

  _key(e) {
    if (!this.isOpen) return;
    const typing = !!e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if (e.code === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation(); // or game.js would pause right after we close
      if (this.onEscape?.()) return;
      this.close('user');
      return;
    }
    if (e.code === 'KeyE' && !typing) {
      e.preventDefault();
      e.stopImmediatePropagation(); // or the player's E would reopen it at once
      if (!e.repeat && performance.now() - this._openedAt > 300) this.close('user');
      return;
    }
    if (e.code === 'KeyP') e.stopImmediatePropagation(); // typing a p must not pause the game (default action stays)
    if (this.busy && !typing) return;
    if (this.onKey?.(e, typing)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }

  // ------------------------------------------------------------------------------ helpers
  /** addEventListener that is removed on close. */
  listen(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this._offs.push(() => target.removeEventListener(type, fn, opts));
  }

  later(ms, fn) {
    const t = setTimeout(() => {
      this._timers.delete(t);
      if (this.isOpen) fn();
    }, ms);
    this._timers.add(t);
    return t;
  }

  setHint(text) {
    if (this.hintEl) this.hintEl.textContent = text;
  }

  /** Someone else holds this panel's lease (text), or it's ours again (null). */
  setBusy(text) {
    this.busy = text || null;
    if (!this.busyEl) return;
    this.busyEl.hidden = !this.busy;
    this.busyEl.textContent = this.busy || '';
    this.root?.classList.toggle('is-busy', !!this.busy);
  }

  sync(view) {
    if (!this.isOpen) return;
    if (view) Object.assign(this.ctx, view);
    this.render?.();
  }

  sfx(id, opts = {}) {
    try {
      this.game.audio?.play?.(id, { position: this.ctx?.position, ...opts });
    } catch {
      /* audio is optional */
    }
  }

  /** A positional noise at the panel (The Assistant counts panel noises ×1.6 and comes to "help"). */
  noise(radius) {
    const p = this.ctx?.position;
    if (!p) return;
    const position = typeof p.clone === 'function' ? p.clone() : { x: p.x, y: p.y, z: p.z };
    const floor = this.ctx.floor ?? this.game.world?.floorOf?.(position) ?? floorOfY(position.y);
    this.game.events.emit('noise', { position, radius, source: 'panel', panel: this.name, floor });
  }

  activity() {
    try {
      this.ctx?.activity?.();
    } catch {
      /* ignore */
    }
  }

  /** Ask the host (through floor2.js). Always resolves. */
  async act(type, data = {}) {
    this.activity();
    try {
      const r = await this.ctx?.act?.(type, data);
      return r || { ok: false, error: 'no-reply' };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }

  /** Client point → SVG user space for this panel's main svg. */
  toSvg(svgEl, clientX, clientY) {
    const m = svgEl.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const inv = m.inverse();
    return { x: inv.a * clientX + inv.c * clientY + inv.e, y: inv.b * clientX + inv.d * clientY + inv.f };
  }
}
