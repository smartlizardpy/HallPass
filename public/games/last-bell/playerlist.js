// LAST BELL — playerlist.js: who's in the game (Second Floor update, multiplayer.md §3). Owned by NET.
//
//   Desktop: hold Tab to look at it (it never takes the mouse or the keys). Touch: the two-people button
//   next to Pause toggles it; it doesn't block movement. While chat is open (desktop) it shows beside it
//   and you can click a name.
//   Rows: look chip, name, status (playing · upstairs / downstairs / on the stairs · hiding · caught ·
//   in Room 000 / the Art room · out · left), connection (ok / reconnecting / left, ping), voice badge,
//   host and you markers. Hidden Directors are never listed (a Director sees everyone).
//   Source: the live room (room.players: connection, ping, voice) joined with the host's statuses ('rs').
//   Solo: just you.
//
//   The peer menu (a name in the list or in chat): Mute / Unmute (chat + voice, this session only),
//   Report (copies a short report to the clipboard and opens HallPass's conduct rules: HallPass has no
//   endpoint games may report to yet; hallpass-request.md item 4), Remove (host only, asks first).

import { lookColors } from './coop.js';
import { floorBand } from './coop-avatars.js';

const REPORT_URL = 'https://www.hallpass.games/terms#conduct';
const REPORT_EMAIL = 'legal@hallpass.games';

function hexCss(hex) {
  return '#' + (hex >>> 0).toString(16).padStart(6, '0').slice(-6);
}

export class PlayerList {
  constructor(game, coop) {
    this.game = game;
    this.coop = coop;
    this.muted = new Set(); // this session only: never stored
    this._peek = false; // Tab held
    this._open = false; // toggled (touch) — interactive
    this._withChat = false; // shown beside open chat (desktop) — interactive
    this._built = false;
    this._t = 0;
    addEventListener('keydown', (e) => this._onKey(e, true));
    addEventListener('keyup', (e) => this._onKey(e, false));
    addEventListener('blur', () => this.peek(false));
    game.events?.on('overlay:close', ({ name } = {}) => name === 'players' && this._setOpen(false, true));
    game.events?.on('game:state', ({ state } = {}) => state !== 'playing' && this.hide());
    setInterval(() => this.visible && this.refresh(), 1000); // ping, positions
  }

  get visible() {
    return this._peek || this._open || this._withChat;
  }

  get interactive() {
    return this._open || this._withChat;
  }

  isMuted(id) {
    return this.muted.has(id);
  }

  setMuted(id, on) {
    if (!id || id === this.coop.selfId) return;
    if (on) this.muted.add(id);
    else this.muted.delete(id);
    this.coop.setMuted(id, on);
    this.coop.chat?._render?.();
    this.refresh();
  }

  // ------------------------------------------------------------------------------- showing
  _onKey(e, down) {
    if (e.code !== 'Tab') return;
    const g = this.game;
    if (down) {
      if (g.state !== 'playing' || g.coopPaused || g.isTyping?.() || g.schoolnet?.isOpen) return;
      e.preventDefault(); // keep the browser's focus where it is
      if (!e.repeat) this.peek(true);
    } else if (this._peek) {
      e.preventDefault();
      this.peek(false);
    }
  }

  peek(on) {
    on = !!on && this.game.state === 'playing';
    if (on === this._peek) return;
    this._peek = on;
    this._show();
  }

  /** Touch button: toggle the list (an overlay that captures nothing and blocks nothing). */
  toggle() {
    this._setOpen(!this._open);
  }

  _setOpen(on, fromEvent = false) {
    if (on === this._open) return;
    this._open = on;
    const g = this.game;
    if (!fromEvent) {
      if (on) g.openOverlay?.('players', { capturesKeys: false, releasesPointer: !g.touch?.active, blocksMovement: false });
      else if (g.overlays?.has?.('players')) g.closeOverlay?.('players', { relock: !g.touch?.active });
    }
    this._show();
  }

  /** chat.js: chat opened / closed (desktop: the list sits beside it, clickable). */
  chatOpened(on) {
    this._withChat = !!on && !this.game.touch?.active;
    this._show();
  }

  hide() {
    this._peek = false;
    this._withChat = false;
    if (this._open) this._setOpen(false);
    this._show();
    this.closeMenu();
  }

  _build() {
    if (this._built) return;
    const root = document.getElementById('social-root') || document.body;
    const el = document.createElement('section');
    el.className = 'plist';
    el.setAttribute('aria-label', 'Players');
    el.hidden = true;
    el.innerHTML = `
      <header class="plist__head"><span class="plist__title">Players</span><span class="plist__room"></span>
        <button type="button" class="plist__x" aria-label="Close">✕</button></header>
      <ul class="plist__rows"></ul>
      <p class="plist__foot"></p>`;
    root.append(el);
    this.el = el;
    this.rows = el.querySelector('.plist__rows');
    this.roomEl = el.querySelector('.plist__room');
    this.foot = el.querySelector('.plist__foot');
    el.querySelector('.plist__x').addEventListener('click', () => this._setOpen(false));
    this.rows.addEventListener('click', (e) => {
      const row = e.target.closest?.('[data-peer]');
      if (row && this.interactive) this.openMenu(row.dataset.peer, row);
    });
    // the peer menu
    const menu = document.createElement('div');
    menu.className = 'peer-menu';
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    root.append(menu);
    this.menu = menu;
    addEventListener('pointerdown', (e) => {
      if (!menu.hidden && !menu.contains(e.target) && !e.target.closest?.('[data-peer]')) this.closeMenu();
    }, true);
    this._built = true;
  }

  _show() {
    if (!this.visible && !this._built) return;
    this._build();
    const on = this.visible;
    this.el.hidden = !on;
    this.el.classList.toggle('is-interactive', this.interactive);
    this.el.classList.toggle('is-with-chat', this._withChat);
    this.el.classList.toggle('is-touch', !!this.game.touch?.active);
    if (!on) this.closeMenu();
    if (on) this.refresh();
  }

  // ------------------------------------------------------------------------------- rows
  /** The rows, in order: [{ id, name, look, host, self, status, conn, ping, vc, muted, director }]. */
  rowsData() {
    const c = this.coop;
    const g = this.game;
    const room = c.room;
    const out = [];
    if (!room) {
      out.push({ id: 'local', name: c.name, look: c.look, host: false, self: true, status: this._soloStatus(), conn: '', ping: null, vc: 'off' });
      return out;
    }
    const amDir = c.amDirector || c.status === 'director';
    const live = new Map(room.players.map((p) => [p.id, p]));
    const seen = new Set();
    const push = (id, p, r) => {
      if (seen.has(id)) return;
      seen.add(id);
      const director = c.isDirector(id) || (p && c._hiddenPeer(p));
      if (director && !amDir) return; // hidden Directors never show to players
      const self = id === c.selfId;
      let conn = 'left';
      let ping = null;
      if (p) {
        const st = p.connection?.state;
        conn = self ? 'ok' : st === 'connected' ? 'ok' : st === 'reconnecting' ? 'reconnecting' : 'connecting';
        ping = self ? null : Number.isFinite(p.connection?.rttMs) ? p.connection.rttMs : null;
      }
      out.push({
        id,
        name: r?.name || (p ? (self ? c.name : p.name) : 'Student'),
        look: r?.look || (self ? c.look : p?.meta?.look),
        host: id === room.hostId,
        self,
        director,
        status: director ? 'Director (hidden)' : this._status(id, r, p),
        conn,
        ping,
        vc: p ? c._vcState(p) : 'off',
        muted: this.muted.has(id),
      });
    };
    if (c.active) {
      const rows = [...c.roster.values()].sort((a, b) => a.slot - b.slot);
      for (const r of rows) push(r.id, live.get(r.id), r);
    }
    for (const p of room.players) push(p.id, p, null);
    return out;
  }

  _soloStatus() {
    const g = this.game;
    if (g.state !== 'playing') return '';
    const pos = g.player?.position;
    return this._where(pos, !!g.player?.isHidden);
  }

  _where(pos, hidden) {
    if (!pos) return 'playing';
    const band = floorBand(pos.y || 0);
    const f = band < 0 ? 'on the stairs' : band === 1 ? 'upstairs' : 'downstairs';
    return `playing · ${f}${hidden ? ' · hiding' : ''}`;
  }

  _status(id, r, p) {
    const c = this.coop;
    if (!c.active) return p?.meta?.ready ? 'ready' : 'in the lobby';
    if (!r) return 'watching';
    const self = id === c.selfId;
    const st = self ? c.status : r.status;
    if (st === 'alive') {
      const info = c.playerInfo(id);
      return this._where(info?.position, !!info?.hidden);
    }
    if (st === 'captured') return 'caught';
    if (st === 'trapped') return c.statusWord(self ? { ...r, at: c._trapAt || r.at } : r, 'trapped');
    if (st === 'escaping' || st === 'escaped') return 'out';
    if (st === 'left') return 'left';
    return st || '';
  }

  refresh() {
    if (!this.visible || !this._built) return;
    const c = this.coop;
    const data = this.rowsData();
    this.roomEl.textContent = c.room ? `Room ${c.room.code}` : 'Solo';
    this.rows.replaceChildren();
    for (const d of data) {
      const li = document.createElement('li');
      li.className = 'plist__row';
      li.dataset.conn = d.conn || 'ok';
      if (d.self) li.classList.add('is-self');
      if (d.muted) li.classList.add('is-muted');
      if (d.director) li.classList.add('is-director');
      if (!d.self && d.conn !== 'left' && c.room) li.dataset.peer = d.id;
      const chip = document.createElement('span');
      chip.className = 'plist__chip';
      const look = lookColors(d.look);
      chip.style.setProperty('--blazer', hexCss(look.blazer));
      chip.style.setProperty('--hair', hexCss(look.hair));
      const name = document.createElement('b');
      name.className = 'plist__name';
      name.textContent = d.name;
      const tags = document.createElement('span');
      tags.className = 'plist__tags';
      tags.textContent = [d.host ? 'host' : '', d.self ? 'you' : '', d.muted ? 'muted' : ''].filter(Boolean).join(' · ');
      const st = document.createElement('small');
      st.className = 'plist__status';
      st.textContent = d.status;
      const conn = document.createElement('small');
      conn.className = 'plist__conn';
      conn.textContent = d.self || !c.room ? '' : d.conn === 'ok' ? (d.ping != null ? `${d.ping} ms` : 'ok') : d.conn;
      const vc = c._vcBadge ? c._vcBadge(d.id, d.vc) : document.createElement('span');
      li.append(chip, name, vc, tags, st, conn);
      this.rows.append(li);
    }
    const n = data.filter((d) => !d.director && d.conn !== 'left').length;
    this.foot.textContent = !c.room
      ? 'Solo game: just you.'
      : this.interactive
        ? `${n} playing. ${this.game.touch?.active ? 'Tap' : 'Click'} a name to mute or report.`
        : `${n} playing. Open chat (T) to mute or report someone.`;
  }

  // ------------------------------------------------------------------------------- peer menu
  openMenu(id, anchor) {
    const c = this.coop;
    if (!id || id === c.selfId || !c.room) return;
    this._build();
    const p = c.room.players.find((x) => x.id === id);
    const r = c.roster.get(id);
    const name = r?.name || p?.name || 'this player';
    const m = this.menu;
    m.replaceChildren();
    const title = document.createElement('p');
    title.className = 'peer-menu__title';
    title.textContent = name;
    m.append(title);
    const btn = (label, fn, cls = '') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `peer-menu__btn ${cls}`;
      b.textContent = label;
      b.setAttribute('role', 'menuitem');
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        fn();
      });
      m.append(b);
      return b;
    };
    const muted = this.muted.has(id);
    btn(muted ? 'Unmute' : 'Mute (chat and voice)', () => {
      this.setMuted(id, !muted);
      this.closeMenu();
    });
    btn('Report…', () => {
      this.report(id, name);
      this.closeMenu();
    });
    if (c.isHost && !c.isDirector(id)) {
      const rm = btn('Remove from the room', () => {
        if (rm.dataset.sure) {
          c.hostKick(id, 'The host removed you from the room.');
          this.game.ui?.showNotice?.(`${name} was removed.`, 3);
          this.closeMenu();
        } else {
          rm.dataset.sure = '1';
          rm.textContent = `Remove ${name}? Tap again`;
        }
      }, 'is-danger');
    }
    btn('Cancel', () => this.closeMenu(), 'is-quiet');
    m.hidden = false;
    const a = anchor?.getBoundingClientRect?.();
    const w = 220;
    const x = a ? Math.min(innerWidth - w - 8, Math.max(8, a.left)) : 16;
    const y = a ? Math.min(innerHeight - 200, a.bottom + 4) : 80;
    m.style.left = `${Math.round(x)}px`;
    m.style.top = `${Math.round(Math.max(8, y))}px`;
  }

  closeMenu() {
    if (this.menu) this.menu.hidden = true;
  }

  /** Report: HallPass has no game-frame report endpoint yet (hallpass-request.md item 4), so the report
   *  is copied for an email to HallPass, and their conduct rules open in a new tab. When the SDK offers
   *  room.report (requested, not in 1.2.0) it is sent there instead. */
  async report(id, name) {
    const c = this.coop;
    const said = (c.chat?.history || []).filter((m) => m.from === id && !m.sys).slice(-5).map((m) => String(m.text).slice(0, 140));
    if (typeof c.room?.report === 'function') {
      try {
        await c.room.report(id, { reason: 'conduct', lines: said });
        this.game.ui?.showNotice?.(`Reported ${name} to HallPass.`, 5);
        c.chat?.system?.(`Report about ${name}: sent to HallPass.`);
        return;
      } catch {
        /* fall back to the copied report */
      }
    }
    const lines = said.map((t) => `  - ${t}`);
    const text = [
      'LAST BELL co-op report',
      `When: ${new Date().toISOString()}`,
      `Room code: ${c.room?.code || '-'}`,
      `Player: "${name}" (session id ${id}; it changes every game and isn't linked to an account)`,
      'What happened: ',
      lines.length ? `Their last chat lines:\n${lines.join('\n')}` : 'No chat lines from them.',
      `Send to: ${REPORT_EMAIL}`,
    ].join('\n');
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      copied = false;
    }
    this.game.ui?.showNotice?.(copied ? `Report copied. Paste it into an email to ${REPORT_EMAIL}.` : `Email ${REPORT_EMAIL} with the room code ${c.room?.code || ''} and what happened.`, 7);
    try {
      window.open(REPORT_URL, '_blank', 'noopener');
    } catch {
      /* popup blocked: the notice says what to do */
    }
    c.chat?.system?.(`Report about ${name}: ${copied ? 'copied to the clipboard' : 'not copied'}. HallPass: ${REPORT_EMAIL}`);
  }
}
