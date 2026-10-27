// LAST BELL — chat.js: text chat for co-op (Second Floor update, multiplayer.md §4). Owned by NET.
//
//   T or Enter opens it (desktop), the speech-bubble button next to Pause (touch). Enter sends, Esc (or
//   Enter on an empty box) closes. Closed, the last three lines fade out over the inventory.
//
// Routing (host-validated; nothing is trusted from the sender's payload but the text):
//   guest → host  game.net.request('chat', { text, announce })
//   host          sender id from the SDK link → a player in this run (or a verified Director, who may
//                 only send "announced" lines, shown as "[HallPass staff]") → clean (≤ CHAT.maxLen, no
//                 control / zero-width / bidi characters) → token bucket (CHAT.ratePerSec, burst CHAT.burst;
//                 over it: CHAT.cooldown s of "slow down") → duplicate block (same text within CHAT.dupWindow s)
//                 → word filter (masks with •••) → game.net.broadcast('chatmsg', { id, from, name, text, t, staff })
//   everyone      renders with textContent only (never HTML). The name comes from the host's roster.
//
// Session-isolated: messages live only in this tab's memory while you're in the room. Nothing is sent
// to a server or stored. Local mute (chat + voice) and Report live in playerlist.js's peer menu; the
// host can remove a player there too.
//
// Exports: Chat, cleanText(s), filterText(s) → { text, flagged }, skeleton(s) (tests use them).

import { CHAT } from './config.js';

// ------------------------------------------------------------------------------- text cleaning
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;
// zero-width, joiners, bidi controls and isolates, the BOM, invisible operators, tag characters
const INVISIBLE = /[­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ]|\udb40[\udc00-\udc7f]/g;
const MARKS = /\p{M}/u;

/** Trim a chat line to something safe to show: no control / invisible / bidi characters, no "zalgo"
 *  stacks (at most two combining marks per letter), single spaces, CHAT.maxLen characters. */
export function cleanText(s, max = CHAT.maxLen) {
  let t = String(s ?? '').normalize('NFC').replace(CONTROL, ' ').replace(INVISIBLE, '');
  let out = '';
  let marks = 0;
  for (const ch of t) {
    if (MARKS.test(ch)) {
      if (++marks > 2) continue;
    } else marks = 0;
    out += ch;
  }
  t = out.replace(/\s+/g, ' ').trim();
  const chars = Array.from(t);
  return chars.length > max ? chars.slice(0, max).join('').trimEnd() : t;
}

// ------------------------------------------------------------------------------- the word filter
// A short built-in list of slurs and the worst profanity (HallPass keeps its own lists server-only on
// purpose, so the game ships its own; multiplayer.md §4). Stored ROT13 so the source isn't a wall of
// slurs. 's' = matches inside a word, 'w' = the whole word (optionally +s), 'j' = also checked across
// the whole message with the spaces taken out.
const LIST = [
  ['avttre', 's'], ['avttn', 's'], ['snttbg', 's'], ['snt', 'w'], ['ergneq', 'w'], ['ergneqrq', 'w'], ['genaal', 'w'],
  ['puvax', 'w'], ['fcvp', 'w'], ['xvxr', 'w'], ['jrgonpx', 's'], ['cnxv', 'w'], ['qlxr', 'w'], ['pbba', 'w'],
  ['tbbx', 'w'], ['enturnq', 's'], ['phag', 'w'], ['shpx', 's'], ['juber', 'w'], ['fyhg', 'w'], ['ovgpu', 's'],
  ['encr', 'w'], ['encrq', 'w'], ['encvfg', 'w'], ['xlf', 'w'],
  ['xvyylbhefrys', 'j'], ['avttre', 'j'], ['snttbg', 'j'], ['zbgureshpxre', 'j'],
];
const rot13 = (s) => s.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 84) % 26) + 97));
/** "fuuuck" still matches "fuck": every run of a letter in the root may repeat. */
function pattern(root) {
  let p = '';
  for (let i = 0; i < root.length; ) {
    let j = i;
    while (j < root.length && root[j] === root[i]) j++;
    p += `${root[i]}{${j - i},}`;
    i = j;
  }
  return p;
}
const RULES = LIST.map(([w, mode]) => {
  const p = pattern(rot13(w));
  return { mode, re: new RegExp(mode === 'w' ? `^${p}s*$` : p) };
});

// look-alikes → letters: digits and symbols (l33t), accents, Cyrillic / Greek homoglyphs
const LEET = {
  0: 'o', 1: 'i', 2: 'z', 3: 'e', 4: 'a', 5: 's', 6: 'g', 7: 't', 8: 'b', 9: 'g',
  '!': 'i', '|': 'i', '@': 'a', $: 's', '+': 't', '€': 'e', '£': 'l', '¡': 'i',
  а: 'a', в: 'b', е: 'e', ё: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x',
  і: 'i', ї: 'i', ј: 'j', ѕ: 's', ԁ: 'd', ɡ: 'g', α: 'a', β: 'b', ε: 'e', ι: 'i', κ: 'k', ν: 'v', ο: 'o',
  ρ: 'p', τ: 't', υ: 'u', χ: 'x', ω: 'w',
};
/** The letters a word is made of, the way a filter dodger means them: "N!66@" → "nigga". */
export function skeleton(word) {
  let out = '';
  for (const ch of String(word).normalize('NFKD').toLowerCase()) {
    if (MARKS.test(ch)) continue;
    const c = LEET[ch] ?? ch;
    if (c >= 'a' && c <= 'z') out += c;
  }
  return out;
}

const hit = (sk, modes) => !!sk && RULES.some((r) => modes.includes(r.mode) && r.re.test(sk));

/** Mask blocked words with •••. Also catches spaced-out letters ("f u c k") and a few long ones written
 *  across words. Returns { text, flagged }. */
export function filterText(text) {
  const parts = String(text).split(/(\s+)/);
  const words = [];
  for (let i = 0; i < parts.length; i++) if (parts[i] && !/^\s+$/.test(parts[i])) words.push({ i, sk: skeleton(parts[i]) });
  let flagged = false;
  const mask = (w) => {
    parts[w.i] = '•••';
    flagged = true;
  };
  for (const w of words) if (hit(w.sk, 'sw')) mask(w);
  // s p a c e d   o u t: runs of 3+ one-letter words
  for (let a = 0; a < words.length; ) {
    let b = a;
    while (b < words.length && words[b].sk.length === 1) b++;
    if (b - a >= 3) {
      const run = words.slice(a, b);
      if (hit(run.map((w) => w.sk).join(''), 'swj')) run.forEach(mask);
    }
    a = Math.max(b, a + 1);
  }
  if (!flagged && hit(words.map((w) => w.sk).join(''), 'j')) return { text: '•••', flagged: true };
  return { text: parts.join(''), flagged };
}

// ------------------------------------------------------------------------------- keys
// Our text boxes ([data-social-input]) own every key while focused: a window capture listener that is
// registered when this module loads — before ui.js adds its own in the UI constructor — so typing "p"
// never pauses, WASD never walks and M/V never toggle. Typing itself is the default action, unaffected.
addEventListener(
  'keydown',
  (e) => {
    const t = e.target;
    const box = t instanceof Element ? t.closest('[data-social-input]') : null;
    if (!box) return;
    e.stopImmediatePropagation();
    t.__socialKey?.(e);
  },
  true,
);

const STAFF_NAME = '[HallPass staff]';
const ERR = {
  slow: (r) => `Slow down: wait ${Math.max(1, Math.ceil(r.wait || CHAT.cooldown))} s.`,
  duplicate: () => 'You just said that.',
  hidden: () => 'Directors can only send announced messages.',
  'not-in-game': () => 'Only players in this game can chat.',
  timeout: () => 'The host didn’t answer. Try again.',
  rate: () => 'Slow down.',
};

export class Chat {
  constructor(game, coop) {
    this.game = game;
    this.coop = coop;
    this.history = []; // { id, from, name, text, t, staff, sys }
    this.isOpen = false;
    this._seq = 0;
    this._buckets = new Map(); // host: sender → { tokens, t, until }
    this._last = new Map(); // host: sender → { key, t }
    this._tick = 0;
    this._built = false;
    game.net?.handle('chat', (d, from) => this.hostReceive(d, from));
    game.net?.on('chatmsg', (m, from) => this._onMsg(m, from));
    game.events?.on('overlay:close', ({ name } = {}) => name === 'chat' && this._hide());
    game.events?.on('game:state', () => this._sync());
    addEventListener('keydown', (e) => this._onKey(e));
  }

  /** Is chat available right now (a co-op run, playing, not at the pause menu)? */
  get available() {
    const g = this.game;
    return !!this.coop.active && g.state === 'playing' && !g.coopPaused && !g.schoolnet?.isOpen;
  }

  // ===================================================================================== host
  /** Host handler for 'chat' requests. Trusts nothing but the text (and the announce flag, which only a
   *  verified Director may use); the sender comes from the SDK link. */
  hostReceive(d, from) {
    const c = this.coop;
    if (!c.active || !c.isHost) return { ok: false, error: 'offline' };
    const staff = c.isDirector(from);
    if (!staff && !c._isPlayer(from)) return { ok: false, error: 'not-in-game' };
    if (staff && !d?.announce) return { ok: false, error: 'hidden' }; // a Director never chats as a player
    const text = cleanText(typeof d?.text === 'string' ? d.text.slice(0, 2000) : '');
    if (!text) return { ok: false, error: 'empty' };
    const now = performance.now();
    let b = this._buckets.get(from);
    if (!b) this._buckets.set(from, (b = { tokens: CHAT.burst, t: now, until: 0 }));
    if (now < b.until) return { ok: false, error: 'slow', wait: (b.until - now) / 1000 };
    b.tokens = Math.min(CHAT.burst, b.tokens + ((now - b.t) / 1000) * CHAT.ratePerSec);
    b.t = now;
    if (b.tokens < 1) {
      b.until = now + CHAT.cooldown * 1000;
      return { ok: false, error: 'slow', wait: CHAT.cooldown };
    }
    const key = skeleton(text) || text.toLowerCase();
    const last = this._last.get(from);
    if (last && last.key === key && now - last.t < CHAT.dupWindow * 1000) return { ok: false, error: 'duplicate' };
    b.tokens -= 1;
    this._last.set(from, { key, t: now });
    const f = filterText(text);
    const name = staff ? STAFF_NAME : c.roster.get(from)?.name || 'Student';
    const msg = { id: ++this._seq, from, name, text: f.text, t: Date.now(), staff: staff ? 1 : 0 };
    if (staff) c.director?.hostLog?.('announce', from, { text: f.text });
    this.game.net.broadcast('chatmsg', msg);
    return { ok: true, id: msg.id };
  }

  // ===================================================================================== everyone
  _onMsg(m, from) {
    const c = this.coop;
    const hostId = c.room?.hostId;
    if (!c.active || !m || typeof m !== 'object' || (hostId ? from !== hostId : from !== 'local')) return;
    if (typeof m.text !== 'string' || typeof m.name !== 'string' || typeof m.from !== 'string') return;
    const msg = {
      id: Number.isInteger(m.id) ? m.id : 0,
      from: m.from.slice(0, 32),
      name: m.staff ? STAFF_NAME : cleanText(m.name, 24),
      staff: !!m.staff,
      text: cleanText(m.text),
      t: performance.now(),
    };
    if (!msg.text) return;
    this._push(msg);
    if (!this.isOpen && msg.from !== c.selfId) this.unread = true;
    if (msg.staff) this.game.ui?.showNotice?.(`${STAFF_NAME} ${msg.text}`, 6);
    else if (msg.from !== c.selfId && !c.plist.isMuted(msg.from)) this.game.audio?.play?.('ui_toggle', { volume: 0.25 });
  }

  /** A line only you see (slow down, report copied…). */
  system(text) {
    this._push({ id: 0, from: '', name: '', text: String(text), t: performance.now(), sys: true });
  }

  _push(msg) {
    this.history.push(msg);
    if (this.history.length > CHAT.history) this.history.shift();
    this._render();
  }

  /** Leaving the room: forget everything (nothing is kept anywhere). */
  reset() {
    this.close('force');
    this.history.length = 0;
    this.unread = false;
    this._buckets.clear();
    this._last.clear();
    this._render();
  }

  // ===================================================================================== UI
  _build() {
    if (this._built) return;
    const root = document.getElementById('social-root') || document.body;
    const el = document.createElement('section');
    el.className = 'chat is-ticker';
    el.setAttribute('aria-label', 'Chat');
    el.hidden = true;
    el.innerHTML = `
      <ol class="chat__log" aria-live="polite"></ol>
      <form class="chat__form" autocomplete="off" hidden>
        <input class="chat__input" data-social-input maxlength="${CHAT.maxLen * 2}" spellcheck="false" enterkeyhint="send" aria-label="Message">
        <span class="chat__count" aria-hidden="true">0/${CHAT.maxLen}</span>
        <button type="submit" class="chat__btn chat__send">Send</button>
        <button type="button" class="chat__btn chat__x" aria-label="Close chat">✕</button>
      </form>
      <p class="chat__hint" hidden></p>`;
    root.append(el);
    this.el = el;
    this.log = el.querySelector('.chat__log');
    this.form = el.querySelector('.chat__form');
    this.input = el.querySelector('.chat__input');
    this.count = el.querySelector('.chat__count');
    this.hint = el.querySelector('.chat__hint');
    this.input.__socialKey = (e) => {
      if (e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        this._submit(true);
      } else if (e.key === 'Escape' || e.code === 'Escape') {
        e.preventDefault();
        this.close('key');
      }
    };
    this.input.addEventListener('input', () => this._count());
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      this._submit(false);
    });
    el.querySelector('.chat__x').addEventListener('click', () => this.close('click'));
    this.log.addEventListener('click', (e) => {
      const name = e.target.closest?.('[data-peer]');
      if (name && this.isOpen) this.coop.plist.openMenu(name.dataset.peer, name);
    });
    this._built = true;
  }

  _count() {
    const n = Array.from(this.input.value).length;
    this.count.textContent = `${Math.min(n, 999)}/${CHAT.maxLen}`;
    this.count.classList.toggle('is-over', n > CHAT.maxLen);
  }

  _render() {
    if (!this._built) return;
    const log = this.log;
    log.replaceChildren();
    const muted = (id) => this.coop.plist?.isMuted?.(id);
    for (const m of this.history) {
      if (!m.sys && !m.staff && muted(m.from)) continue;
      const li = document.createElement('li');
      li.dataset.t = String(m.t);
      if (m.sys) li.className = 'is-system';
      if (m.staff) li.className = 'is-staff';
      if (m.name) {
        const b = document.createElement('b');
        b.className = 'chat__name';
        b.textContent = m.name;
        if (!m.staff && m.from && m.from !== this.coop.selfId) b.dataset.peer = m.from;
        li.append(b);
      }
      const span = document.createElement('span');
      span.className = 'chat__text';
      span.textContent = m.text;
      li.append(span);
      log.append(li);
    }
    this._age(true);
    if (this.isOpen) log.scrollTop = log.scrollHeight;
  }

  /** The ticker: closed, only the last 3 lines show, fading after 10 s. */
  _age(force) {
    if (!this._built) return;
    const now = performance.now();
    const items = [...this.log.children];
    items.forEach((li, i) => {
      const old = items.length - i > 3 || now - Number(li.dataset.t) > 10000;
      if (force || li.classList.contains('is-old') !== old) li.classList.toggle('is-old', old);
    });
  }

  _sync() {
    if (!this._built) {
      if (!this.coop.active) return;
      this._build();
    }
    const show = this.available || (this.isOpen && this.coop.active);
    this.el.hidden = !show;
    if (!show && this.isOpen) this.close('force');
  }

  /** Per frame from coop.update. */
  update(dt) {
    this._tick -= dt;
    if (this._tick > 0) return;
    this._tick = 0.5;
    this._sync();
    if (!this.isOpen) this._age(false);
  }

  open() {
    if (this.isOpen || !this.available) return false;
    this._build();
    const g = this.game;
    this.isOpen = true;
    this.unread = false;
    g.openOverlay?.('chat', { capturesKeys: true, releasesPointer: true, blocksMovement: true });
    this.el.hidden = false;
    this.el.classList.remove('is-ticker');
    this.el.classList.add('is-open');
    this.form.hidden = false;
    const staff = this.coop.status === 'director';
    this.hint.hidden = false;
    this.hint.textContent = staff
      ? `Director: lines go out as ${STAFF_NAME}, to everyone.`
      : g.touch?.active
        ? 'Tap a name to mute or report.'
        : 'Enter sends · Esc closes · click a name to mute or report';
    this.input.placeholder = staff ? 'Announce as HallPass staff…' : 'Say something…';
    this._count();
    this._render();
    // (a key or a tap opened it: focus now, so the soft keyboard comes up on touch screens)
    try {
      this.input.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
    this.coop.plist.chatOpened?.(true);
    return true;
  }

  /** how: 'key' | 'click' (a user gesture: the mouse can be locked again) | 'force'. */
  close(how = 'force') {
    if (!this.isOpen) return;
    this._hide();
    const g = this.game;
    if (g.overlays?.has?.('chat')) g.closeOverlay?.('chat', { relock: how !== 'force' && !g.touch?.active });
  }

  _hide() {
    if (!this.isOpen) return;
    this.isOpen = false;
    if (!this._built) return;
    this.input.blur();
    this.form.hidden = true;
    this.hint.hidden = true;
    this.el.classList.add('is-ticker');
    this.el.classList.remove('is-open');
    this.coop.plist.chatOpened?.(false);
    this._sync();
    this._age(true);
  }

  async _submit(viaKey) {
    const text = cleanText(this.input.value);
    if (!text) {
      if (viaKey) this.close('key');
      return;
    }
    const r = await this.send(text, { announce: this.coop.status === 'director' });
    if (r?.ok) {
      this.input.value = '';
      this._count();
    }
  }

  /** Send a line (a Director: announce = true). → the host's answer ({ ok, id } or { ok: false, error, wait? }). */
  async send(text, { announce = false } = {}) {
    if (!this.coop.active) return { ok: false, error: 'offline' };
    const r = await this.game.net.request('chat', { text: String(text).slice(0, 2000), announce: !!announce });
    if (!r?.ok && r?.error && r.error !== 'empty') this.system((ERR[r.error] || (() => 'Not sent.'))(r));
    return r;
  }

  _onKey(e) {
    if (e.defaultPrevented || e.repeat || this.isOpen) return;
    if (e.code !== 'KeyT' && e.code !== 'Enter' && e.code !== 'NumpadEnter') return;
    const g = this.game;
    if (!this.available || g.isTyping?.() || g.activeOverlay) return;
    e.preventDefault(); // (so the "t" isn't typed into the box we're about to focus)
    this.open();
  }
}
