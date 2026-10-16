// LAST BELL - the SCHOOLNET 95 screen (DOM). Owned by the main agent.
//
// Opened from a computer (computers.js). The game keeps running underneath: the caretaker walks, the
// clock ticks, keys click (he can hear typing up close). The mouse is freed (no pointer lock) and the
// player stops; Esc logs out. A session lasts computers.sessionLength() seconds and then the account
// locks (one login per computer per run). If the game pauses, the screen hides and the session waits.
//
// It looks like a mid-90s school PC: a teal desktop, grey bevelled windows with navy title bars, a
// taskbar with a Start menu and the session clock in the tray. Its own name and bell logo (no real
// product's). Everything is drawn here and in style.css (.sn*); the icons are the small SVGs below.
//
//   login      "Welcome to SchoolNet": user + password from the sticky note (3 wrong = locked)
//   menu       the desktop + a Welcome window listing the five programs (keys 1-5, the icons, Start)
//   cameras    4 live night-vision corridor feeds (cctv.js), paged
//   announce   PA System: pick a sound (an announcement or a song, audio.songs) and a place on the school
//              map; he goes to check (once per computer)
//   inventory  where the items are (also updates the HUD checklist)
//   election   vote; your candidate's promise comes true; rigged results with Mr Hasan P.
//   mail       staff mail (one leaks another login; one says what his next rounds are)

import * as C from './schoolnet-content.js';
import { SONGS } from './audio.js';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const SVG_NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => {
  const e = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
};

// 32x32 icons in the 16-colour palette of the time (black, greys, white, navy, teal, red, yellow).
const icon = (body) => `<svg viewBox="0 0 32 32" aria-hidden="true" shape-rendering="crispEdges">${body}</svg>`;
const ICONS = {
  cameras: icon(
    '<rect x="3" y="9" width="20" height="11" fill="#000"/><rect x="4" y="10" width="18" height="9" fill="#c0c0c0"/>' +
      '<rect x="4" y="10" width="18" height="2" fill="#fff"/><rect x="4" y="17" width="18" height="2" fill="#808080"/>' +
      '<rect x="23" y="10" width="6" height="9" fill="#000"/><rect x="24" y="11" width="4" height="7" fill="#000080"/>' +
      '<rect x="25" y="12" width="2" height="2" fill="#5f9fff"/><rect x="6" y="13" width="2" height="2" fill="#f00"/>' +
      '<rect x="11" y="20" width="3" height="5" fill="#000"/><rect x="12" y="20" width="1" height="5" fill="#808080"/>' +
      '<rect x="5" y="25" width="15" height="3" fill="#000"/><rect x="6" y="26" width="13" height="1" fill="#808080"/>',
  ),
  announce: icon(
    '<rect x="3" y="12" width="7" height="9" fill="#000"/><rect x="4" y="13" width="5" height="7" fill="#c0c0c0"/>' +
      '<polygon points="10,12 20,5 20,28 10,21" fill="#000" shape-rendering="auto"/>' +
      '<polygon points="11,13 19,7 19,26 11,20" fill="#808080" shape-rendering="auto"/>' +
      '<polygon points="11,13 19,7 19,11 11,15" fill="#fff" shape-rendering="auto"/>' +
      '<rect x="22" y="13" width="2" height="7" fill="#000080"/><rect x="26" y="10" width="2" height="13" fill="#000080"/>',
  ),
  inventory: icon(
    '<rect x="11" y="6" width="10" height="2" fill="#000"/><rect x="11" y="6" width="2" height="6" fill="#000"/>' +
      '<rect x="19" y="6" width="2" height="6" fill="#000"/><rect x="3" y="11" width="26" height="16" fill="#000"/>' +
      '<rect x="4" y="12" width="24" height="14" fill="#c00000"/><rect x="4" y="12" width="24" height="2" fill="#ff5a5a"/>' +
      '<rect x="4" y="17" width="24" height="1" fill="#800000"/><rect x="14" y="16" width="4" height="3" fill="#c0c0c0"/>' +
      '<rect x="14" y="16" width="4" height="1" fill="#fff"/>',
  ),
  election: icon(
    '<rect x="3" y="13" width="26" height="15" fill="#000"/><rect x="4" y="14" width="24" height="13" fill="#000080"/>' +
      '<rect x="4" y="14" width="24" height="2" fill="#4a4ad0"/><rect x="11" y="20" width="10" height="4" fill="#fff"/>' +
      '<rect x="9" y="15" width="14" height="2" fill="#000"/><rect x="11" y="3" width="11" height="13" fill="#000"/>' +
      '<rect x="12" y="4" width="9" height="12" fill="#fff"/><rect x="13" y="6" width="6" height="1" fill="#808080"/>' +
      '<rect x="13" y="8" width="5" height="1" fill="#808080"/><path d="M13.5 11.5l2 2 3.5-4.5" stroke="#c00000" stroke-width="1.6" fill="none" shape-rendering="auto"/>',
  ),
  mail: icon(
    '<rect x="3" y="8" width="26" height="17" fill="#000"/><rect x="4" y="9" width="24" height="15" fill="#fff"/>' +
      '<rect x="4" y="22" width="24" height="2" fill="#c0c0c0"/>' +
      '<polyline points="4,9.5 16,18.5 28,9.5" fill="none" stroke="#000" stroke-width="1.2" shape-rendering="auto"/>' +
      '<rect x="22" y="11" width="4" height="4" fill="#c00000"/>',
  ),
  key: icon(
    '<circle cx="10" cy="13" r="6.5" fill="#000" shape-rendering="auto"/><circle cx="10" cy="13" r="5.3" fill="#ffd800" shape-rendering="auto"/>' +
      '<circle cx="10" cy="13" r="2" fill="#000" shape-rendering="auto"/><rect x="15" y="11" width="14" height="4" fill="#000"/>' +
      '<rect x="16" y="12" width="12" height="2" fill="#ffd800"/><rect x="22" y="15" width="3" height="4" fill="#000"/>' +
      '<rect x="26" y="15" width="3" height="6" fill="#000"/><rect x="23" y="15" width="1" height="3" fill="#ffd800"/>' +
      '<rect x="27" y="15" width="1" height="5" fill="#ffd800"/><rect x="7" y="10" width="2" height="2" fill="#fff8b0"/>',
  ),
  error: icon(
    '<circle cx="16" cy="16" r="13" fill="#000" shape-rendering="auto"/><circle cx="16" cy="16" r="11.8" fill="#f00" shape-rendering="auto"/>' +
      '<path d="M11 11l10 10M21 11l-10 10" stroke="#fff" stroke-width="3" shape-rendering="auto"/>',
  ),
  info: icon(
    '<circle cx="16" cy="15" r="12" fill="#000" shape-rendering="auto"/><circle cx="16" cy="15" r="10.8" fill="#fff" shape-rendering="auto"/>' +
      '<rect x="14" y="13" width="4" height="9" fill="#000080"/><rect x="14" y="7" width="4" height="4" fill="#000080"/>',
  ),
  tip: icon(
    '<circle cx="16" cy="12" r="8" fill="#000" shape-rendering="auto"/><circle cx="16" cy="12" r="6.8" fill="#ffff80" shape-rendering="auto"/>' +
      '<rect x="13" y="8" width="2" height="5" fill="#fff"/><rect x="12" y="19" width="8" height="7" fill="#000"/>' +
      '<rect x="13" y="19" width="6" height="6" fill="#c0c0c0"/><rect x="13" y="21" width="6" height="1" fill="#808080"/>' +
      '<rect x="13" y="23" width="6" height="1" fill="#808080"/><rect x="14" y="26" width="4" height="2" fill="#000"/>',
  ),
  bell: icon(
    '<path d="M16 3c-6 0-8.5 6-8.5 12v5.5L4 25h24l-3.5-4.5V15C24.5 9 22 3 16 3z" fill="#000" shape-rendering="auto"/>' +
      '<path d="M16 5c-4.6 0-6.5 5-6.5 10v6.2L7.6 23.5h16.8l-1.9-2.3V15c0-5-1.9-10-6.5-10z" fill="#ffd800" shape-rendering="auto"/>' +
      '<rect x="11" y="9" width="2" height="11" fill="#fff8a0"/><circle cx="16" cy="27" r="2.6" fill="#000" shape-rendering="auto"/>',
  ),
  user: icon(
    '<circle cx="16" cy="10" r="6" fill="#000" shape-rendering="auto"/><circle cx="16" cy="10" r="4.8" fill="#ffcc99" shape-rendering="auto"/>' +
      '<path d="M5 29c0-7 5-11 11-11s11 4 11 11z" fill="#000" shape-rendering="auto"/><path d="M6.4 28c.5-5.6 4.6-8.8 9.6-8.8s9.1 3.2 9.6 8.8z" fill="#000080" shape-rendering="auto"/>',
  ),
  logoff: icon(
    '<rect x="5" y="4" width="16" height="24" fill="#000"/><rect x="6" y="5" width="14" height="22" fill="#808080"/>' +
      '<rect x="6" y="5" width="2" height="22" fill="#c0c0c0"/><rect x="16" y="15" width="2" height="3" fill="#ffd800"/>' +
      '<polygon points="21,11 29,16 21,21" fill="#008000" shape-rendering="auto"/>',
  ),
};
const iconEl = (name, cls = 'sn__icon') => {
  const s = el('span', cls);
  s.innerHTML = ICONS[name] || '';
  return s;
};
const SHORT = { cameras: 'Cameras', announce: 'PA System', inventory: 'Maintenance', election: 'Election', mail: 'Mail' };
const TITLES = {
  cameras: 'Security Cameras',
  announce: 'PA System',
  inventory: 'Maintenance - Inventory',
  election: 'Student Council Election',
  mail: 'Inbox - SchoolMail',
};
const DID_YOU_KNOW = [
  'The session ends when the clock in the corner of the taskbar runs out. Then this login is locked.',
  'He can hear the keys clicking if he comes close. Esc logs you off at once.',
  'One broadcast per computer. Send it somewhere far away and he walks over to check.',
  'People write their passwords on sticky notes. Other people read their mail.',
];

export class SchoolNet {
  constructor(game) {
    this.game = game;
    this.isOpen = false;
    this.pc = null;
    this.view = 'login';
    this._camPage = 0;
    this._feed = 0;
    this._timeoutT = 0;
    this._read = new Set(); // mail you have opened (bold = unread)
    this._build();
    this._bind();
  }

  // ================================================================== open / close
  open(pc) {
    const g = this.game;
    if (this.isOpen || g.state !== 'playing' || !pc || pc.state === 'locked') return false;
    this.pc = pc;
    this.isOpen = true;
    this._timeoutT = 0;
    this.view = pc.state === 'open' ? 'menu' : 'login';
    this._loginMsg = '';
    this._open = null;
    this._sound = null;
    this._area = -1;
    this._played = null;
    this._camPage = 0;
    this._welcomeClosed = false;
    this._startMenu(false);
    g.player.enabled = false;
    g.player.focused = null;
    g.player.unlockPointer?.();
    this.root.hidden = false;
    this.root.classList.remove('is-off');
    g.audio?.play?.('crt_on', { position: pc.pos });
    this._render();
    g.events?.emit('schoolnet:open', {});
    g.events?.emit('tip', { id: 'terminal' });
    return true;
  }

  /** reason: 'logout' | 'timeout' | 'force' (capture, menu...) */
  close(reason = 'logout') {
    if (!this.isOpen) return;
    const g = this.game;
    const pc = this.pc;
    if (pc && pc.state === 'open') g.computers?.lock(pc); // a session, once started, uses up the login
    this.isOpen = false;
    this.pc = null;
    this.root.hidden = true;
    this.body.textContent = '';
    this._startMenu(false);
    if (pc) g.audio?.play?.('crt_off', { position: pc.pos });
    if (g.state === 'playing') {
      g.player.enabled = true;
      if (reason !== 'force') g.player.lockPointer?.();
    }
    g.events?.emit('schoolnet:close', { reason });
  }

  /** Per frame (game loop, playing only): the session clock. */
  update(dt) {
    if (!this.isOpen || !this.pc) return;
    const pc = this.pc;
    if (this._timeoutT > 0) {
      this._timeoutT -= dt;
      if (this._timeoutT <= 0) this.close('timeout');
      return;
    }
    if (pc.state === 'open') {
      pc.sessionLeft -= dt;
      const s = Math.max(0, Math.ceil(pc.sessionLeft));
      if (s !== this._shownS) {
        this._shownS = s;
        this.timer.textContent = `Session 0:${String(s).padStart(2, '0')}`;
        this.timer.classList.toggle('is-low', s <= 10);
      }
      if (pc.sessionLeft <= 0) {
        this.game.computers?.lock(pc);
        this.view = 'timeout';
        this._timeoutT = 1.6;
        this._render();
      }
    }
  }

  /** After the frame is drawn: one security-camera feed per frame while the cameras app is open. */
  afterRender() {
    if (!this.isOpen || this.view !== 'cameras' || this.root.hidden || !this._canvases) return;
    const rigs = this.game.computers?.cctv?.rigs || [];
    if (!rigs.length) return;
    const k = this._feed++ % this._canvases.length;
    const rig = rigs[this._camPage * 4 + k];
    if (rig) this.game.computers.cctv.render(rig, this._canvases[k]);
  }

  // ================================================================== DOM
  _build() {
    const root = el('div', 'sn');
    root.id = 'schoolnet';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'SCHOOLNET computer');
    const bezel = el('div', 'sn__bezel');
    const screen = el('div', 'sn__screen');

    // the desktop: program icons, one window, the Start menu
    const desk = el('div', 'sn__desk');
    this.icons = el('nav', 'sn__icons');
    this.icons.setAttribute('aria-label', 'Programs');
    for (const app of C.APPS) {
      const b = this._button('', () => this._go(app.id), 'sn__dicon');
      b.dataset.app = app.id;
      b.title = `${app.key}  ${app.name}`;
      b.append(iconEl(app.id), el('span', '', SHORT[app.id] || app.name));
      this.icons.append(b);
    }
    this.win = el('section', 'sn__win');
    const bar = el('header', 'sn__titlebar');
    this.winIcon = el('span', 'sn__ticon');
    this.title = el('span', 'sn__ttext', '');
    this.winClose = this._button('', () => this._closeWindow(), 'sn__tbtn');
    this.winClose.setAttribute('aria-label', 'Close');
    this.winClose.innerHTML = '<svg viewBox="0 0 8 7" aria-hidden="true" shape-rendering="crispEdges"><path d="M0 0h2v1h1v1h2V1h1V0h2v1H7v1H6v1H5v1h1v1h1v1h1v1H6V6H5V5H3v1H2v1H0V6h1V5h1V4h1V3H2V2H1V1H0z"/></svg>';
    bar.append(this.winIcon, this.title, this.winClose);
    this.body = el('main', 'sn__body');
    this.foot = el('footer', 'sn__foot', '');
    this.win.append(bar, this.body, this.foot);
    this.start = el('div', 'sn__startmenu');
    this.start.hidden = true;
    desk.append(this.icons, this.win, this.start);

    // the taskbar: Start, the open window, the tray (who is logged on + the session clock)
    this.taskbar = el('footer', 'sn__taskbar');
    this.startBtn = this._button('', () => this._startMenu(this.start.hidden), 'sn__startbtn');
    this.startBtn.append(iconEl('bell', 'sn__sicon'), el('b', '', 'Start'));
    this.task = el('span', 'sn__task');
    const tray = el('span', 'sn__tray');
    this.who = el('span', 'sn__who', '');
    this.timer = el('span', 'sn__timer', '');
    this.timer.title = 'Time left in this session';
    tray.append(this.who, this.timer);
    this.taskbar.append(this.startBtn, this.task, tray);
    screen.append(desk, this.taskbar);

    this.sticky = el('div', 'sn__sticky');
    this.sticky.hidden = true;
    const plate = el('div', 'sn__plate', 'Maintained by Mr Ahmet Hoca, Computing');
    const logout = el('button', 'sn__off', 'Log out');
    logout.type = 'button';
    logout.addEventListener('click', () => this.close('logout'));
    bezel.append(screen, this.sticky, plate, logout);
    root.append(bezel);
    (document.getElementById('ui') || document.body).append(root);
    this.root = root;
    // a click anywhere else closes the Start menu
    root.addEventListener('pointerdown', (e) => {
      if (!this.start.hidden && !this.start.contains(e.target) && !this.startBtn.contains(e.target)) this._startMenu(false);
    });
  }

  _bind() {
    const g = this.game;
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen || this.root.hidden) return;
      if (this.pc) g.computers?.keyNoise(this.pc);
      if (e.code === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation(); // or game.js would pause right after we log out
        if (!this.start.hidden) return this._startMenu(false);
        this.close('logout');
        return;
      }
      const typing = e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName);
      if (typing) return;
      if (this.view === 'menu' && /^Digit[1-5]$/.test(e.code)) {
        e.preventDefault();
        this._go(C.APPS[Number(e.code.slice(5)) - 1].id);
      } else if (e.code === 'Backspace' && this.view !== 'menu' && this.view !== 'login') {
        e.preventDefault();
        this._go('menu');
      }
    });
    this.root.addEventListener('pointerdown', () => this.pc && g.computers?.keyNoise(this.pc));
    g.events?.on('game:state', ({ state } = {}) => {
      if (!this.isOpen) return;
      if (state === 'playing') {
        // back from pause: same session, mouse stays free
        this.root.hidden = false;
        g.player.enabled = false;
        g.player.unlockPointer?.();
      } else if (state === 'paused') {
        this.root.hidden = true;
      } else {
        this.close('force');
      }
    });
  }

  _go(view) {
    this._startMenu(false);
    if (view === 'menu') this._welcomeClosed = false;
    this.view = view;
    this._render();
  }

  /** The window's × button: programs go back to the desktop; the logon dialog walks away. */
  _closeWindow() {
    if (this.view === 'login' || this.view === 'timeout') return this.close('logout');
    if (this.view === 'menu') {
      this._welcomeClosed = true;
      return this._render();
    }
    this._go('menu');
  }

  _startMenu(open) {
    if (!this.start) return;
    this.start.hidden = !open;
    this.startBtn?.classList.toggle('is-down', !!open);
    if (!open || !this.pc) return;
    const s = this.start;
    s.textContent = '';
    const banner = el('div', 'sn__banner');
    banner.append(el('b', '', 'SchoolNet'), el('span', '', '95'));
    const items = el('div', 'sn__sitems');
    for (const app of C.APPS) {
      const b = this._button('', () => this._go(app.id), 'sn__sitem');
      b.append(iconEl(app.id, 'sn__sicon'), el('span', '', app.name));
      items.append(b);
    }
    items.append(el('hr', 'sn__sep'));
    const off = this._button('', () => this.close('logout'), 'sn__sitem');
    off.append(iconEl('logoff', 'sn__sicon'), el('span', '', `Log Off ${this.pc.owner?.user || ''}...`));
    items.append(off);
    s.append(banner, items);
  }

  /** Sets up the one window: kind 'dialog' | 'welcome' | 'app', its title and icon. */
  _frame(kind, title, iconName) {
    this.win.className = `sn__win sn__win--${kind}`;
    this.win.hidden = false;
    this.title.textContent = title;
    this.winIcon.innerHTML = ICONS[iconName] || '';
    this.task.textContent = '';
    if (title) this.task.append(iconEl(iconName, 'sn__sicon'), el('span', '', title));
    this.task.hidden = !title;
  }

  _render() {
    const pc = this.pc;
    if (!pc) return;
    this.body.textContent = '';
    this.foot.textContent = '';
    this._canvases = null;
    const session = pc.state === 'open';
    this.root.classList.toggle('is-session', session || this.view === 'timeout');
    this.icons.hidden = !session;
    this.taskbar.hidden = !session;
    this.who.textContent = session ? pc.owner.user : '';
    this.who.prepend(iconEl('user', 'sn__sicon'));
    this._shownS = -1;
    this.timer.textContent = session ? `Session 0:${String(Math.max(0, Math.ceil(pc.sessionLeft))).padStart(2, '0')}` : '';
    // the reminder people stick on their monitors
    this.sticky.hidden = !(pc.noteRead && this.view === 'login');
    if (!this.sticky.hidden) this.sticky.textContent = `user: ${pc.owner.user}\npass: ${pc.owner.pass}`;
    const B = this.body;
    switch (this.view) {
      case 'login':
        this._login(B);
        break;
      case 'menu':
        this._menu(B);
        break;
      case 'cameras':
        this._cameras(B);
        break;
      case 'announce':
        this._announce(B);
        break;
      case 'inventory':
        this._inventory(B);
        break;
      case 'election':
        this._election(B);
        break;
      case 'mail':
        this._mail(B);
        break;
      case 'timeout':
        this._frame('dialog', 'SCHOOLNET', 'error');
        B.append(this._message('error', 'SESSION TIMED OUT', 'This account is now locked. Log in somewhere else.'));
        this._buttons(B, [this._button('OK', () => this.close('timeout'), 'sn__btn--default')]);
        break;
      default:
        break;
    }
  }

  _button(label, onClick, cls = '') {
    const b = el('button', `sn__btn ${cls}`.trim(), label);
    b.type = 'button';
    b.addEventListener('click', (e) => {
      e.preventDefault();
      onClick();
    });
    return b;
  }

  /** A row of buttons at the bottom right of a window. */
  _buttons(B, list) {
    const row = el('div', 'sn__btnrow');
    row.append(...list);
    B.append(row);
    return row;
  }

  _back(B) {
    this._buttons(B, [this._button('Close', () => this._go('menu'), 'sn__back')]);
  }

  /** An icon and a message, like a message box. */
  _message(iconName, big, text) {
    const m = el('div', 'sn__msgbox');
    const t = el('div', '');
    t.append(el('p', 'sn__big', big));
    if (text) t.append(el('p', '', text));
    m.append(iconEl(iconName, 'sn__icon sn__icon--big'), t);
    return m;
  }

  _status(...panes) {
    this.foot.textContent = '';
    for (const p of panes) this.foot.append(el('span', '', p));
  }

  // ------------------------------------------------------------------ login
  _login(B) {
    const pc = this.pc;
    this._frame('dialog', 'Welcome to SchoolNet', 'key');
    const wrap = el('div', 'sn__logon');
    const left = el('div', 'sn__logon-main');
    left.append(el('p', '', 'Type a user name and password to log on to SCHOOLNET.'), el('p', 'sn__sub', `Computer: ${pc.room.name}`));
    const form = el('form', 'sn__form');
    form.autocomplete = 'off';
    const row = (label, type) => {
      const l = el('label', 'sn__field');
      l.append(el('span', '', label));
      const i = el('input');
      i.type = type;
      i.autocomplete = 'off';
      i.spellcheck = false;
      i.setAttribute('autocapitalize', 'off');
      i.setAttribute('autocorrect', 'off');
      l.append(i);
      form.append(l);
      return i;
    };
    const user = row('User name:', 'text');
    const pass = row('Password:', 'password');
    const go = el('button', 'sn__btn sn__btn--default', 'OK');
    go.type = 'submit';
    const cancel = this._button('Cancel', () => this.close('logout'));
    const btns = el('div', 'sn__logon-btns');
    btns.append(go, cancel);
    form.append(btns);
    const msg = el('p', 'sn__msg', this._loginMsg || '');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const r = this.game.computers.tryLogin(pc, user.value, pass.value);
      if (r.ok) {
        this._go('menu');
        return;
      }
      this._loginMsg = r.msg;
      if (r.locked) {
        this.view = 'timeout';
        this._timeoutT = 1.8;
        this._render();
        this.body.querySelector('.sn__big').textContent = 'ACCOUNT LOCKED';
        return;
      }
      msg.textContent = r.msg;
      pass.value = '';
      pass.focus();
    });
    left.append(form, msg);
    left.append(
      el(
        'p',
        'sn__hint',
        pc.noteRead
          ? 'Your sticky note is on the screen frame.'
          : 'Forgotten your password? Everyone writes it on a sticky note. (Look around this room.)',
      ),
    );
    wrap.append(iconEl('key', 'sn__icon sn__icon--big'), left);
    B.append(wrap);
    this._status('Enter: log on · Esc: walk away', 'One login per computer');
    setTimeout(() => {
      if (this.isOpen && this.view === 'login') user.focus({ preventScroll: true });
    }, 30);
  }

  // ------------------------------------------------------------------ the desktop (menu)
  _menu(B) {
    const pc = this.pc;
    if (this._welcomeClosed) {
      this.win.hidden = true;
      this.task.hidden = true;
      return;
    }
    this._frame('welcome', 'Welcome', 'bell');
    const head = el('div', 'sn__welcome');
    const logo = el('p', 'sn__logo');
    logo.append(el('span', '', 'Welcome to '), el('b', '', 'SchoolNet'), el('i', '', '95'));
    head.append(logo, el('p', 'sn__sub', `Logged on as ${pc.owner.name} (${pc.owner.role})`));
    B.append(head);
    const cols = el('div', 'sn__welcome-cols');
    const list = el('div', 'sn__apps');
    for (const app of C.APPS) {
      const b = this._button('', () => this._go(app.id), 'sn__app');
      const t = el('span', 'sn__app-text');
      t.append(el('b', '', `${app.key}  ${app.name}`), el('span', '', app.desc));
      b.append(iconEl(app.id), t);
      if (app.id === 'announce' && pc.broadcastUsed) b.classList.add('is-used');
      if (app.id === 'election' && this.game.computers.voted) b.classList.add('is-used');
      list.append(b);
    }
    const tip = el('aside', 'sn__dyk');
    const tt = el('div', '');
    tt.append(el('b', '', 'Did you know...'), el('p', '', DID_YOU_KNOW[(this.game.computers.list.indexOf(pc) + 4) % DID_YOU_KNOW.length]));
    tip.append(iconEl('tip'), tt);
    cols.append(list, tip);
    B.append(cols);
    this._status('1-5: open a program · Esc: log off', 'The session ends when the clock runs out');
  }

  // ------------------------------------------------------------------ cameras
  _cameras(B) {
    const rigs = this.game.computers.cctv.rigs;
    const pages = Math.max(1, Math.ceil(rigs.length / 4));
    this._camPage = Math.min(this._camPage, pages - 1);
    this._frame('app', `${TITLES.cameras} - Live`, 'cameras');
    const tools = el('div', 'sn__toolbar');
    if (pages > 1) {
      tools.append(
        this._button('< Prev', () => {
          this._camPage = (this._camPage + pages - 1) % pages;
          this._render();
        }),
        this._button('Next >', () => {
          this._camPage = (this._camPage + 1) % pages;
          this._render();
        }),
      );
    }
    tools.append(el('span', 'sn__sub', `Page ${this._camPage + 1} of ${pages}`));
    B.append(tools);
    const grid = el('div', 'sn__cams');
    this._canvases = [];
    for (let k = 0; k < 4; k++) {
      const rig = rigs[this._camPage * 4 + k];
      const cv = el('canvas', 'sn__cam');
      cv.width = 192;
      cv.height = 144;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#020a04';
      ctx.fillRect(0, 0, 192, 144);
      if (!rig) {
        ctx.fillStyle = '#2e6a3a';
        ctx.font = '12px monospace';
        ctx.fillText('NO SIGNAL', 66, 76);
      } else this._canvases.push(cv);
      grid.append(cv); // (each feed prints its own camera number and place)
    }
    B.append(grid);
    this._back(B);
    this._status('Live. He shows up pale on infra-red.', 'Backspace: desktop');
  }

  // ------------------------------------------------------------------ announcements: the PA system
  _announce(B) {
    const pc = this.pc;
    const c = this.game.computers;
    this._frame('app', TITLES.announce, 'announce');
    if (pc.broadcastUsed) {
      const p = this._played;
      B.append(
        p
          ? this._message('info', 'BROADCASTING', `Now playing ${p.what} in the ${p.where}. Listen: you'll hear it echo. He's going to check.`)
          : this._message('info', 'ALREADY USED', 'This computer has already made its broadcast. (One per computer.)'),
      );
      this._back(B);
      this._status('One broadcast per computer', 'Backspace: desktop');
      return;
    }
    const songs = this.game.audio?.songs || SONGS;
    const sounds = [
      { id: 'announcement', kind: 'announcement', title: 'Announcement', sub: 'Office voice' },
      ...songs.map((s) => ({ id: s.id, kind: 'song', title: s.title, sub: s.custom ? 'Your song' : 'Music box' })),
    ];
    if (!sounds.some((s) => s.id === this._sound)) this._sound = 'announcement';
    const areas = c.broadcastAreas(pc, { all: true });
    if (!areas[this._area]) this._area = -1;

    const wrap = el('div', 'sn__pa');
    const side = el('div', 'sn__pa-side');
    // what to play
    const soundBox = el('fieldset', 'sn__group');
    soundBox.append(el('legend', '', 'Play'));
    const soundList = el('div', 'sn__lb sn__lb--sounds');
    for (const s of sounds) {
      const b = this._button('', () => {
        this._sound = s.id;
        if (s.kind === 'song') this.game.audio?.prepareSong?.(s.id);
        sync();
      }, 'sn__lbrow');
      b.dataset.sound = s.id;
      b.append(el('span', 'sn__lbmark', s.kind === 'song' ? '♪' : '▸'), el('span', '', s.title), el('small', '', s.sub));
      soundList.append(b);
    }
    soundBox.append(soundList);
    // where (the same places as the map)
    const placeBox = el('fieldset', 'sn__group sn__group--places');
    placeBox.append(el('legend', '', 'Where'));
    const placeList = el('div', 'sn__lb sn__lb--places');
    areas.forEach((a, i) => {
      const b = this._button('', () => {
        this._area = i;
        sync();
      }, 'sn__lbrow');
      b.dataset.area = String(i);
      b.append(el('span', '', a.name), el('small', '', `${Math.round(a.dist)} m`));
      b.addEventListener('pointerenter', () => hot(i, true));
      b.addEventListener('pointerleave', () => hot(i, false));
      placeList.append(b);
    });
    placeBox.append(placeList);
    side.append(soundBox, placeBox);
    // the map
    const mapBox = el('div', 'sn__map');
    const svg = this._mapSvg(areas, (i) => {
      this._area = i;
      sync();
    }, hot);
    mapBox.append(svg);
    wrap.append(mapBox, side);
    B.append(wrap);
    const info = el('p', 'sn__pa-info');
    B.append(info);
    const play = this._button('Play', () => {
      const s = sounds.find((x) => x.id === this._sound);
      const a = areas[this._area];
      if (!s || !a) return;
      c.broadcast(pc, s.kind, a, s.kind === 'song' ? s.id : undefined);
      this._played = { what: s.kind === 'song' ? `"${s.title}"` : 'the announcement', where: a.name };
      this._render();
    }, 'sn__btn--default sn__play');
    this._buttons(B, [play, this._button('Close', () => this._go('menu'), 'sn__back')]);
    this._status('Pick a sound and a place on the map. He goes there to check.', 'One broadcast per computer');

    function hot(i, on) {
      for (const n of wrap.querySelectorAll(`[data-area="${i}"]`)) n.classList.toggle('is-hot', on);
    }
    const sync = () => {
      for (const b of soundList.children) b.classList.toggle('is-sel', b.dataset.sound === this._sound);
      for (const n of wrap.querySelectorAll('[data-area]')) n.classList.toggle('is-sel', Number(n.dataset.area) === this._area);
      const s = sounds.find((x) => x.id === this._sound);
      const a = areas[this._area];
      play.disabled = !a;
      if (!a) info.textContent = 'Click a place on the map (a speaker), or pick one from the list.';
      else {
        const far = a.dist > 30 ? 'far away' : a.dist > 15 ? 'not far' : 'close by';
        info.textContent = `${s.kind === 'song' ? `"${s.title}"` : 'The announcement'} in the ${a.name}: ${far} (${Math.round(a.dist)} m).`;
      }
    };
    sync();
  }

  /** The school's floor plan as an SVG: every room, the walls between them, a speaker in each place you
   *  can broadcast to (click = pick), and "you are here". Room 000 stays off the plan. */
  _mapSvg(areas, onPick, onHot) {
    const w = this.game.world;
    const pc = this.pc;
    const CELLM = 4;
    const rooms = w.rooms.filter((r) => r.type !== 'room000');
    const owner = new Map();
    for (const r of rooms) for (const c of r.cells) owner.set(`${c.cx},${c.cz}`, r);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const r of rooms) {
      x0 = Math.min(x0, r.bounds.minX);
      z0 = Math.min(z0, r.bounds.minZ);
      x1 = Math.max(x1, r.bounds.maxX);
      z1 = Math.max(z1, r.bounds.maxZ);
    }
    const svg = svgEl('svg', { viewBox: `${x0 - 3} ${z0 - 3} ${x1 - x0 + 6} ${z1 - z0 + 6}`, preserveAspectRatio: 'xMidYMid meet', role: 'img', 'aria-label': 'School floor plan' });
    const pickOf = new Map(areas.map((a, i) => [a.room, i]));
    const walls = [];
    for (const r of rooms) {
      const i = pickOf.get(r);
      const g = svgEl('g', { class: `sn__mroom${r.isCorridor ? ' is-corr' : ''}${i !== undefined ? ' is-pick' : ''}${r === pc.room ? ' is-here' : ''}` });
      if (i !== undefined) {
        g.dataset.area = String(i);
        g.addEventListener('click', () => onPick(i));
        g.addEventListener('pointerenter', () => onHot(i, true));
        g.addEventListener('pointerleave', () => onHot(i, false));
      }
      const t = svgEl('title');
      t.textContent = i !== undefined ? `${r.name} (${Math.round(areas[i].dist)} m)` : r.name;
      g.append(t);
      for (const c of r.cells) {
        const x = c.cx * CELLM, z = c.cz * CELLM;
        g.append(svgEl('rect', { x, y: z, width: CELLM + 0.02, height: CELLM + 0.02 }));
        // a wall wherever the next cell belongs to another room (or nothing)
        if (owner.get(`${c.cx},${c.cz - 1}`) !== r) walls.push(`M${x} ${z}h${CELLM}`);
        if (owner.get(`${c.cx},${c.cz + 1}`) !== r) walls.push(`M${x} ${z + CELLM}h${CELLM}`);
        if (owner.get(`${c.cx - 1},${c.cz}`) !== r) walls.push(`M${x} ${z}v${CELLM}`);
        if (owner.get(`${c.cx + 1},${c.cz}`) !== r) walls.push(`M${x + CELLM} ${z}v${CELLM}`);
      }
      svg.append(g);
    }
    svg.append(svgEl('path', { class: 'sn__mwalls', d: walls.join('') }));
    // labels for rooms wide enough to hold one, and a speaker in every place you can pick
    for (const r of rooms) {
      const i = pickOf.get(r);
      const wM = r.bounds.maxX - r.bounds.minX;
      const cx = r.center.x, cz = r.center.z;
      if (!r.isCorridor && wM >= 8 && r !== pc.room) { // (your own room says YOU)
        const label = svgEl('text', { x: cx, y: i !== undefined ? cz + 2.6 : cz + 0.6, class: 'sn__mlabel' });
        const fit = Math.floor(wM / 0.86); // characters that fit across the room
        label.textContent = r.name.length > fit ? `${r.name.slice(0, Math.max(3, fit - 1)).trimEnd()}…` : r.name;
        svg.append(label);
      }
      if (i !== undefined) {
        const sp = svgEl('g', { class: 'sn__mspk', transform: `translate(${cx} ${cz - (r.isCorridor ? 0 : 0.6)})` });
        sp.dataset.area = String(i);
        sp.append(svgEl('circle', { r: 1.45 }), svgEl('path', { d: 'M-0.8 -0.4h0.5l0.75 -0.6v2l-0.75 -0.6h-0.5z M0.75 -0.55q0.45 0.55 0 1.1' }));
        sp.addEventListener('click', () => onPick(i));
        svg.append(sp);
      }
    }
    // you are here
    const you = svgEl('g', { class: 'sn__you', transform: `translate(${pc.pos.x} ${pc.pos.z})` });
    you.append(svgEl('circle', { r: 1.1 }), Object.assign(svgEl('text', { y: -1.8 }), { textContent: 'YOU' }));
    svg.append(you);
    return svg;
  }

  // ------------------------------------------------------------------ inventory
  _inventory(B) {
    this._frame('app', TITLES.inventory, 'inventory');
    const lv = el('div', 'sn__lv');
    const head = el('div', 'sn__lvhead');
    head.append(el('span', '', 'Item'), el('span', '', 'Location'));
    const t = el('table', 'sn__table');
    for (const r of this.game.computers.inventoryRows()) {
      const tr = el('tr');
      tr.append(el('td', '', r.item), el('td', '', r.where));
      t.append(tr);
    }
    lv.append(head, t);
    B.append(lv, el('p', 'sn__hint', 'Copied to your checklist.'));
    this._back(B);
    this._status(`${t.rows.length} object(s)`, 'Backspace: desktop');
  }

  // ------------------------------------------------------------------ election
  _election(B) {
    const c = this.game.computers;
    this._frame('app', TITLES.election, 'election');
    if (!c.voted) {
      B.append(el('p', 'sn__big', 'Cast your vote'), el('p', '', 'One vote. Whoever you vote for, their promise comes true for you.'));
      const list = el('div', 'sn__apps sn__apps--ballot');
      for (const cand of c.ballot()) {
        const b = this._button('', () => {
          this._results = c.vote(cand.key);
          this._render();
        }, 'sn__app');
        const t = el('span', 'sn__app-text');
        t.append(el('b', '', `Vote ${cand.name}`), el('span', '', `"${cand.slogan}"  →  ${cand.promise.effect}`));
        b.append(iconEl('election'), t);
        list.append(b);
      }
      B.append(list);
    } else {
      B.append(el('p', 'sn__big', 'Results (final)'));
      const res = [
        ['Muhammed Tövbe… (write-in)', 99.7],
        ['Mia Tran', 0.2],
        ['Chloe Lim', 0.1],
      ];
      for (const [name, pct] of res) {
        const row = el('div', 'sn__bar');
        const meter = el('span', 'sn__progress');
        const fill = el('i');
        fill.style.width = `${Math.max(1, pct)}%`;
        meter.append(fill);
        row.append(el('span', '', `${name}  ${pct}%`), meter);
        B.append(row);
      }
      const news = el('div', 'sn__news');
      news.append(el('p', 'sn__sub', C.COVERAGE.intro));
      const lines = this._results?.lines || [C.COVERAGE.byVote[c.voted], ...C.COVERAGE.lines];
      for (const l of lines) news.append(el('p', 'sn__quote', l));
      B.append(news, el('p', 'sn__hint', `Your vote: ${C.PROMISES[c.voted].effect}`));
    }
    this._back(B);
    this._status(c.voted ? 'Thank you for voting' : 'One vote per student', 'Backspace: desktop');
  }

  // ------------------------------------------------------------------ mail
  _mail(B) {
    const c = this.game.computers;
    const mail = c.mailFor(this.pc);
    this._frame('app', TITLES.mail, 'mail');
    if (this._open) {
      const m = mail.find((x) => x.id === this._open) || mail[0];
      this._read.add(m.id);
      const tools = el('div', 'sn__toolbar');
      tools.append(this._button('< Inbox', () => {
        this._open = null;
        this._render();
      }));
      const head = el('div', 'sn__mailhead');
      for (const [k, v] of [['From:', m.from], ['To:', m.to], ['Subject:', m.subject]]) head.append(el('span', '', k), el('b', k === 'Subject:' ? 'sn__subject' : '', v));
      B.append(tools, head, el('pre', 'sn__mailbody', m.body));
      if (m.id === 'stickies') {
        c.learnLeak(this.pc);
        B.append(el('p', 'sn__hint', 'That login is in your Tools list now.'));
      }
      this._status(m.subject, 'Backspace: desktop');
      return;
    }
    const lv = el('div', 'sn__lv');
    const head = el('div', 'sn__lvhead sn__lvhead--mail');
    head.append(el('span', '', 'From'), el('span', '', 'Subject'));
    const list = el('div', 'sn__list sn__maillist');
    for (const m of mail) {
      const b = this._button('', () => {
        this._open = m.id;
        this._render();
      }, `sn__mail${this._read.has(m.id) ? '' : ' is-new'}`);
      b.append(el('b', '', m.subject), el('span', '', m.from));
      list.append(b);
    }
    lv.append(head, list);
    B.append(lv);
    this._back(B);
    const unread = mail.filter((m) => !this._read.has(m.id)).length;
    this._status(`${mail.length} message(s), ${unread} unread`, 'Backspace: desktop');
  }
}
