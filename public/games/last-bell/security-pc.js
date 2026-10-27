// LAST BELL — security-pc.js: Puzzle 4, the SCHOOLNET 2000 Security Workstation (puzzle-systems.md §6).
// Owned by the GAME workstream.
//
// A DOM overlay over the running game, like SCHOOLNET 95 but its own early-2000s look: a putty CRT, a
// grassy playing-field wallpaper drawn in CSS, rounded blue title bars, a slate taskbar with a Start
// button and a clock. The world never pauses. Each key clicks and makes a small noise.
//
//   NO SIGNAL     until the security circuit has power (wiring + breakers)
//   boot (2 s)    the first time it's opened with power, per client
//   log on        user "security" (remembered) + the seeded password. Wrong tries make a noise, never lock.
//                 Once anyone has logged on, the team skips this screen.
//   desktop       My Documents (explorer; Tools → Folder Options → Show hidden files → Personnel/
//                 assistant_application.txt), Access Control (Stairwell A [RELEASE] → the host opens Stair A)
//
//   ctx: { powered, loggedIn, released, stairB, doors: { security, office }, position, floor,
//          act('login', { user, pass }) → { ok }, act('release') → { ok }, onRead(fileName) }
//   pc.update(dt) every frame while open (floor2.js): the taskbar clock.

import { Panel, el } from './puzzles/panel.js';
import * as S from './security-content.js';

const BOOT_MS = 2000;
const NOISE_EVERY = 0.6; // s between typing noises
const DESIGN_W = 880;
const DESIGN_H = 680;

// 16×16 icons, drawn for this machine (a later, rounder palette than SCHOOLNET 95's)
const ico = (body, size = 32) => `<svg viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true">${body}</svg>`;
const ICONS = {
  docs:
    '<path d="M3 8h10l3 3h13v16H3z" fill="#e8b93a" stroke="#7a5a10"/><path d="M3 13h26v14H3z" fill="#f7d36a" stroke="#7a5a10"/>' +
    '<rect x="8" y="5" width="13" height="9" fill="#fff" stroke="#888"/><path d="M10 8h9M10 10h7" stroke="#88a"/>',
  folder: '<path d="M3 8h10l3 3h13v16H3z" fill="#e8b93a" stroke="#7a5a10"/><path d="M3 13h26v14H3z" fill="#f7d36a" stroke="#7a5a10"/>',
  access:
    '<rect x="7" y="13" width="18" height="15" rx="2" fill="#f2c94c" stroke="#7a5a10"/><path d="M11 13V9a5 5 0 0 1 10 0v4" fill="none" stroke="#5d6670" stroke-width="3"/>' +
    '<circle cx="16" cy="19" r="2.2" fill="#3a2a05"/><rect x="15" y="20" width="2" height="5" fill="#3a2a05"/>',
  cam: '<rect x="4" y="9" width="17" height="12" rx="2" fill="#5d6670" stroke="#2b3138"/><circle cx="12" cy="15" r="4" fill="#10261a" stroke="#9fe0b0"/><path d="M21 13l7-3v12l-7-3z" fill="#7b8590" stroke="#2b3138"/>',
  bin:
    '<path d="M8 9h16l-2 19H10z" fill="#cfe0ee" stroke="#4d6478"/><rect x="6" y="6" width="20" height="3" rx="1" fill="#9fb4c6" stroke="#4d6478"/>' +
    '<path d="M12 12v13M16 12v13M20 12v13" stroke="#8aa0b4"/>',
  txt: '<path d="M7 3h13l6 6v20H7z" fill="#fff" stroke="#666"/><path d="M20 3v6h6" fill="#ddd" stroke="#666"/><path d="M10 13h12M10 16h12M10 19h12M10 22h8" stroke="#99a"/>',
  doc:
    '<path d="M7 3h13l6 6v20H7z" fill="#fff" stroke="#666"/><path d="M20 3v6h6" fill="#ddd" stroke="#666"/><rect x="4" y="12" width="13" height="12" rx="1" fill="#2a5db0"/>' +
    '<path d="M6.5 14.5l1.6 7 1.9-5 1.9 5 1.6-7" stroke="#fff" stroke-width="1.4" fill="none"/>',
  xls:
    '<path d="M7 3h13l6 6v20H7z" fill="#fff" stroke="#666"/><path d="M20 3v6h6" fill="#ddd" stroke="#666"/><rect x="4" y="12" width="13" height="12" rx="1" fill="#2e8b47"/>' +
    '<path d="M7 15l7 6M14 15l-7 6" stroke="#fff" stroke-width="1.6"/>',
  sys: '<path d="M7 3h13l6 6v20H7z" fill="#eee" stroke="#888"/><path d="M20 3v6h6" fill="#ccc" stroke="#888"/><circle cx="16" cy="19" r="5" fill="none" stroke="#777" stroke-width="2.4"/><circle cx="16" cy="19" r="1.6" fill="#777"/>',
  user: '<circle cx="16" cy="11" r="6" fill="#f0c49a" stroke="#6b4a2a"/><path d="M5 29c0-7 5-11 11-11s11 4 11 11z" fill="#2a5db0" stroke="#173a73"/>',
  info: '<circle cx="16" cy="16" r="13" fill="#2a6fd6" stroke="#123c80"/><rect x="14" y="13" width="4" height="10" fill="#fff"/><rect x="14" y="7" width="4" height="4" fill="#fff"/>',
  error: '<circle cx="16" cy="16" r="13" fill="#d8322b" stroke="#7a1410"/><path d="M11 11l10 10M21 11l-10 10" stroke="#fff" stroke-width="3.2"/>',
  bell:
    '<path d="M16 4c-5.5 0-7.5 5.5-7.5 11v5L5 24.5h22L23.5 20v-5C23.5 9.5 21.5 4 16 4z" fill="#ffd34d" stroke="#7a5a10"/><circle cx="16" cy="27" r="2.6" fill="#7a5a10"/>' +
    '<path d="M12 9c-1 2-1.5 4-1.5 7" stroke="#fff6c8" stroke-width="1.6" fill="none"/>',
};
const icon = (name, size) => {
  const s = el('span', 'spc__ico');
  s.innerHTML = ico(ICONS[name] || '', size);
  return s;
};
const btn = (label, cls, onClick) => {
  const b = el('button', cls, label);
  b.type = 'button';
  if (onClick) b.addEventListener('click', onClick);
  return b;
};

export class SecurityPC extends Panel {
  constructor(game) {
    super(game, 'security-pc', { label: 'SCHOOLNET 2000 Security Workstation', hint: 'The school keeps going while you type. Esc to step away.' });
    this.booted = false; // this client has seen the boot screen this run
    this.showHidden = false;
  }

  /** New run. */
  reset() {
    this.booted = false;
    this.showHidden = false;
    if (this.isOpen) this.close('force');
  }

  build(stage) {
    const mon = el('div', 'spc');
    this.mon = mon;
    const bezel = el('div', 'spc__bezel');
    this.screen = el('div', 'spc__screen');
    this.view = el('div', 'spc__view');
    this.screen.append(this.view, el('div', 'spc__glass'));
    const chin = el('div', 'spc__chin');
    const led = el('span', 'spc__led');
    this.led = led;
    chin.append(el('span', 'spc__brand', 'SCHOOLNET 2000'), el('span', 'spc__model', 'SECURITY'), el('span', 'spc__knobs'), led);
    const tape = el('span', 'spc__tape', 'DO NOT SWITCH OFF — CCTV RECORDING');
    bezel.append(this.screen, chin, tape);
    mon.append(bezel);
    stage.append(mon);
    this._fit = () => {
      const w = window.innerWidth;
      const h = window.innerHeight - 64;
      const k = Math.min(1.15, w / DESIGN_W, h / DESIGN_H);
      mon.style.setProperty('--k', String(Math.max(0.3, k)));
    };
  }

  onOpen() {
    this._fit();
    this.listen(window, 'resize', this._fit);
    this.mode = null;
    this.wins = [];
    this._noiseT = 0;
    this._clockS = -1;
    this._msg = '';
    this.listen(this.root, 'keydown', (e) => this._typing(e));
    this.listen(this.root, 'pointerdown', (e) => {
      if (this.menu && !this.menu.contains(e.target) && !e.target.closest?.('.spc__menubtn, .spc__start')) this._closeMenus();
    });
    if (this.ctx.powered) this.sfx('crt_on');
    this._route();
  }

  onClose() {
    this.wins = [];
    this.menu = null;
    this.mon = null;
  }

  onKey(e, typing) {
    if (this.mode === 'desk' && !typing) {
      // Enter opens the selected file; Backspace goes up a folder
      const ex = this._top('docs');
      if (ex && e.code === 'Enter' && ex.sel) {
        this._openFile(ex.sel);
        return true;
      }
      if (ex && e.code === 'Backspace' && ex.folder) {
        this._explorer(ex, '');
        return true;
      }
    }
    return false;
  }

  /** Every key on this keyboard clicks; now and then it's loud enough to hear. */
  _typing(e) {
    if (e.repeat || e.code === 'Escape') return;
    this.sfx('keyboard_key', { volume: 0.7, rate: 0.9 + Math.random() * 0.25 });
    const t = performance.now() / 1000;
    if (t - this._noiseT > NOISE_EVERY) {
      this._noiseT = t;
      this.noise(4);
    }
    this.activity();
  }

  // ------------------------------------------------------------------------------ state → screen
  render() {
    if (!this.view) return;
    this._route();
    this.led.classList.toggle('is-on', !!this.ctx.powered);
    // live bits of an open Access Control window
    const ac = this._top('access');
    if (ac) this._accessRows(ac);
  }

  _route() {
    const c = this.ctx;
    let want;
    if (!c.powered) want = 'off';
    else if (!this.booted) want = 'boot';
    else if (!c.loggedIn) want = 'login';
    else want = 'desk';
    if (want === this.mode) return;
    this.mode = want;
    this.view.textContent = '';
    this.view.className = `spc__view is-${want}`;
    this.wins = [];
    this.menu = null;
    if (want === 'off') this._off();
    else if (want === 'boot') this._boot();
    else if (want === 'login') this._login();
    else this._desk();
  }

  _off() {
    const box = el('div', 'spc__nosig');
    box.append(el('b', '', S.PC.noSignal), el('span', '', 'Input 1 · D-SUB'));
    this.view.append(box);
    this.setHint(S.PC.noPower);
  }

  _boot() {
    const v = this.view;
    const logo = el('div', 'spc__bootlogo');
    logo.append(icon('bell', 64), el('b', '', 'SCHOOLNET'), el('i', '', '2000'));
    const bar = el('div', 'spc__bootbar');
    bar.append(el('span'), el('span'), el('span'));
    v.append(logo, el('div', 'spc__bootsub', S.PC.edition), bar, el('div', 'spc__bootfoot', 'Starting up…'));
    this.sfx('power_on', { volume: 0.5 });
    this.setHint('It’s booting.');
    this.later(BOOT_MS, () => {
      this.booted = true;
      this.render();
    });
  }

  _wallpaper() {
    const w = el('div', 'spc__wall');
    w.append(el('div', 'spc__cloud spc__cloud--a'), el('div', 'spc__cloud spc__cloud--b'), el('div', 'spc__hill spc__hill--back'), el('div', 'spc__hill spc__hill--front'));
    return w;
  }

  _login() {
    const v = this.view;
    v.append(this._wallpaper());
    const box = el('form', 'spc__win spc__logon');
    box.setAttribute('autocomplete', 'off');
    const head = el('div', 'spc__logonhead');
    const brand = el('div', 'spc__logonbrand');
    brand.append(icon('bell', 40), el('b', '', 'SCHOOLNET'), el('i', '', '2000'));
    head.append(brand, el('span', '', S.PC.edition));
    const body = el('div', 'spc__logonbody');
    const row = (label, input) => {
      const l = el('label', 'spc__field');
      l.append(el('span', '', label), input);
      return l;
    };
    const user = el('input', 'spc__input');
    user.value = S.SEC_USER; // the last user to log on is remembered
    user.spellcheck = false;
    user.setAttribute('autocapitalize', 'off');
    const pass = el('input', 'spc__input');
    pass.type = 'password';
    pass.setAttribute('autocapitalize', 'off');
    pass.setAttribute('aria-label', 'Password');
    this.msgEl = el('p', 'spc__logonmsg', '');
    this.msgEl.setAttribute('role', 'alert');
    const ok = btn('OK', 'spc__btn spc__btn--def');
    ok.type = 'submit';
    const cancel = btn('Cancel', 'spc__btn', () => this.close('user'));
    const btns = el('div', 'spc__btns');
    btns.append(ok, cancel);
    body.append(el('p', 'spc__logonintro', 'Type a user name and password to log on to this workstation.'), row('User name:', user), row('Password:', pass), this.msgEl, btns);
    box.append(head, body);
    v.append(box);
    box.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (this.busy || this._trying) return;
      this._trying = true;
      ok.disabled = true;
      const r = await this.act('login', { user: user.value.trim().toLowerCase(), pass: pass.value.trim() });
      this._trying = false;
      if (!this.isOpen) return;
      ok.disabled = false;
      if (r.ok) {
        this.sfx('access_granted', { volume: 0.6 });
        this.ctx.loggedIn = true;
        this.render();
      } else {
        this.sfx('access_denied', { volume: 0.8 });
        this.noise(7);
        this.msgEl.textContent = r.error === 'busy' ? 'Someone else is using this workstation.' : S.PC.wrongPass;
        pass.value = '';
        pass.focus();
        box.classList.remove('is-shake');
        void box.offsetWidth;
        box.classList.add('is-shake');
      }
    });
    this.setHint('Log on: user “security” and the password (it’s written down somewhere upstairs).');
    if (!matchMedia?.('(pointer: coarse)').matches) this.later(30, () => pass.focus({ preventScroll: true }));
  }

  // ------------------------------------------------------------------------------ the desktop
  _desk() {
    const v = this.view;
    v.append(this._wallpaper());
    const desk = el('div', 'spc__desk');
    this.desk = desk;
    const icons = el('nav', 'spc__icons');
    const dicon = (name, label, fn) => {
      const b = btn('', 'spc__dicon', fn);
      b.append(icon(name, 34), el('span', '', label));
      return b;
    };
    icons.append(
      dicon('docs', 'My Documents', () => this._open('docs')),
      dicon('access', 'Access Control', () => this._open('access')),
      dicon('cam', 'Cameras', () => this._open('cams')),
      dicon('bin', 'Recycle Bin', () => this._msgBox('Recycle Bin', 'info', 'The Recycle Bin is empty. Someone empties it every night.')),
    );
    desk.append(icons);
    // the taskbar
    const bar = el('div', 'spc__taskbar');
    const start = btn('', 'spc__start', () => this._startMenu());
    start.append(icon('bell', 18), el('b', '', 'Start'));
    this.tasks = el('div', 'spc__tasks');
    const tray = el('div', 'spc__tray');
    tray.append(el('span', 'spc__trayuser', S.SEC_USER));
    this.clock = el('span', 'spc__clock', '3:33 AM');
    tray.append(this.clock);
    bar.append(start, this.tasks, tray);
    v.append(desk, bar);
    this.setHint('Access Control releases Stairwell A.');
    this._open('access');
  }

  _startMenu() {
    if (this.menu?.classList.contains('spc__startmenu')) {
      this._closeMenus();
      return;
    }
    this._closeMenus();
    const m = el('div', 'spc__startmenu');
    const side = el('div', 'spc__startside', 'SCHOOLNET 2000');
    const list = el('div', 'spc__startlist');
    const item = (name, label, fn) => {
      const b = btn('', 'spc__mitem', () => {
        this._closeMenus();
        fn();
      });
      b.append(icon(name, 24), el('span', '', label));
      list.append(b);
    };
    item('docs', 'My Documents', () => this._open('docs'));
    item('access', 'Access Control', () => this._open('access'));
    item('cam', 'Cameras', () => this._open('cams'));
    list.append(el('hr'));
    item('user', `Log Off ${S.SEC_USER}…`, () => this.close('user'));
    m.append(side, list);
    this.desk.append(m);
    this.menu = m;
  }

  _closeMenus() {
    this.menu?.remove();
    this.menu = null;
  }

  /** The window for an app (re-focused if it's open). Windows stack; the top one is active. */
  _open(kind, data) {
    this._closeMenus();
    let w = this.wins.find((x) => x.kind === kind && (kind !== 'file' || x.data === data));
    if (!w) {
      w = this._window(kind, data);
      if (!w) return null;
      this.wins.push(w);
      this.desk.append(w.el);
    } else {
      this.wins.splice(this.wins.indexOf(w), 1);
      this.wins.push(w);
      this.desk.append(w.el);
    }
    this._stack();
    return w;
  }

  _closeWin(w) {
    const i = this.wins.indexOf(w);
    if (i < 0) return;
    this.wins.splice(i, 1);
    w.el.remove();
    this._stack();
  }

  _stack() {
    this.wins.forEach((w, i) => {
      w.el.classList.toggle('is-active', i === this.wins.length - 1);
      w.el.style.zIndex = String(10 + i);
    });
    if (!this.tasks) return;
    this.tasks.textContent = '';
    for (const w of this.wins) {
      if (w.modal) continue;
      const b = btn('', 'spc__task', () => this._open(w.kind, w.data));
      b.append(icon(w.icon, 16), el('span', '', w.title));
      b.classList.toggle('is-active', w === this.wins.at(-1));
      this.tasks.append(b);
    }
  }

  _top(kind) {
    return this.wins?.find((w) => w.kind === kind) || null;
  }

  _frame(kind, title, iconName, cls = '') {
    const w = { kind, title, icon: iconName, el: el('section', `spc__win spc__app ${cls}`) };
    const bar = el('header', 'spc__title');
    bar.append(icon(iconName, 16), el('span', 'spc__ttext', title));
    const x = btn('', 'spc__x', () => this._closeWin(w));
    x.setAttribute('aria-label', 'Close');
    x.innerHTML = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.8"/></svg>';
    bar.append(x);
    w.body = el('div', 'spc__body');
    w.el.append(bar, w.body);
    w.el.addEventListener('pointerdown', () => {
      if (this.wins.at(-1) !== w && this.wins.includes(w)) {
        this.wins.splice(this.wins.indexOf(w), 1);
        this.wins.push(w);
        this._stack();
      }
    });
    return w;
  }

  _window(kind, data) {
    if (kind === 'docs') {
      const w = this._frame('docs', 'My Documents', 'docs', 'spc__app--docs');
      this._explorer(w, '');
      return w;
    }
    if (kind === 'file') return this._viewer(data);
    if (kind === 'access') return this._accessWin();
    if (kind === 'cams') return this._camsWin();
    if (kind === 'options') return this._options();
    return null;
  }

  // ---- My Documents
  _explorer(w, folder) {
    w.folder = folder;
    w.sel = null;
    const b = w.body;
    b.textContent = '';
    w.el.querySelector('.spc__ttext').textContent = folder || 'My Documents';
    w.title = folder || 'My Documents';
    // the menu bar: only Tools does anything much
    const mb = el('div', 'spc__menubar');
    const menu = (label, items) => {
      const m = btn(label, 'spc__menubtn', (e) => {
        e.stopPropagation();
        const was = this.menu && this.menu._owner === m;
        this._closeMenus();
        if (was) return;
        const dd = el('div', 'spc__dropdown');
        dd._owner = m;
        for (const [text, fn] of items) {
          const it = btn(text, 'spc__mitem', () => {
            this._closeMenus();
            fn?.();
          });
          if (!fn) it.disabled = true;
          dd.append(it);
        }
        dd.style.left = `${m.offsetLeft}px`;
        dd.style.top = `${m.offsetTop + m.offsetHeight}px`;
        w.el.append(dd);
        this.menu = dd;
      });
      mb.append(m);
    };
    menu('File', [['Open', () => w.sel && this._openFile(w.sel)], ['Close', () => this._closeWin(w)]]);
    menu('Edit', [['Select All', null]]);
    menu('View', [['✓ Details', null], ['Refresh', () => this._explorer(w, w.folder)]]);
    menu('Tools', [['Folder Options…', () => this._open('options')]]);
    menu('Help', [['About SCHOOLNET 2000', () => this._msgBox('About', 'info', 'SCHOOLNET 2000 · Security Workstation. Maintained by the computing department. Please do not eat at this desk.')]]);
    const addr = el('div', 'spc__addr');
    const up = btn('Up', 'spc__btn spc__btn--sm', () => this._explorer(w, ''));
    up.disabled = !folder;
    addr.append(up, el('span', '', 'Address'), el('span', 'spc__addrbox', `C:\\My Documents${folder ? `\\${folder}` : ''}`));
    const main = el('div', 'spc__explorer');
    const tree = el('div', 'spc__tree');
    const node = (name, label, f) => {
      const n = btn('', `spc__node${f === folder ? ' is-sel' : ''}`, () => this._explorer(w, f));
      n.append(icon(name, 16), el('span', '', label));
      tree.append(n);
    };
    node('docs', 'My Documents', '');
    node('folder', 'Personnel', 'Personnel');
    const list = el('div', 'spc__files');
    list.setAttribute('role', 'listbox');
    const head = el('div', 'spc__frow spc__frow--head');
    head.append(el('span', '', 'Name'), el('span', '', 'Size'), el('span', '', 'Modified'));
    list.append(head);
    const rows = [];
    if (!folder) rows.push({ name: 'Personnel', type: 'folder', size: '', modified: '01/09/2004 07:30' });
    for (const f of S.FILES) if (f.folder === folder && (!f.hidden || this.showHidden)) rows.push(f);
    for (const f of rows) {
      const r = btn('', `spc__frow${f.hidden ? ' is-hidden' : ''}`, () => {
        if (f.type === 'folder') this._explorer(w, f.name);
        else this._openFile(f);
      });
      r.setAttribute('role', 'option');
      const nm = el('span', 'spc__fname');
      nm.append(icon(f.type === 'folder' ? 'folder' : f.type, 16), el('span', '', f.name));
      r.append(nm, el('span', '', f.size), el('span', '', f.modified));
      r.addEventListener('focus', () => (w.sel = f.type === 'folder' ? null : f));
      list.append(r);
    }
    main.append(tree, list);
    const status = el('div', 'spc__status', `${rows.length} object(s)${this.showHidden ? '' : ' (plus hidden files)'}`);
    b.append(mb, addr, main, status);
  }

  _openFile(f) {
    if (f.type === 'sys') {
      this._msgBox('Thumbs.db', 'error', 'Thumbs.db is a system file and cannot be opened. (It holds 1,206 thumbnails of the same photo of the dinner hall.)');
      return;
    }
    this._open('file', f);
    try {
      this.ctx.onRead?.(f.name);
    } catch {
      /* ignore */
    }
  }

  _viewer(f) {
    const app = f.type === 'xls' ? 'SchoolSheet' : f.type === 'doc' ? 'SchoolWrite' : 'SchoolPad';
    const w = this._frame('file', `${f.name} - ${app}`, f.type, `spc__app--view spc__app--${f.type}`);
    w.data = f;
    const b = w.body;
    if (f.type === 'xls') {
      const t = el('table', 'spc__sheet');
      f.table.forEach((row, i) => {
        const tr = el('tr');
        tr.append(el('th', '', String(i + 1)));
        for (const cell of row) tr.append(el(i === 0 ? 'th' : 'td', '', cell));
        t.append(tr);
      });
      const wrap = el('div', 'spc__sheetwrap');
      wrap.append(t);
      b.append(wrap);
    } else {
      const page = el('pre', `spc__page${f.type === 'doc' ? ' is-doc' : ''}`, f.text);
      page.tabIndex = 0;
      const wrap = el('div', 'spc__pagewrap');
      wrap.append(page);
      b.append(wrap);
    }
    return w;
  }

  _options() {
    const w = this._frame('options', 'Folder Options', 'folder', 'spc__app--dialog');
    w.modal = true;
    const b = w.body;
    const tabs = el('div', 'spc__tabs');
    tabs.append(el('span', 'is-sel', 'View'));
    const box = el('fieldset', 'spc__group');
    box.append(el('legend', '', 'Hidden files and folders'));
    const mk = (label, checked) => {
      const l = el('label', 'spc__radio');
      const i = el('input');
      i.type = 'radio';
      i.name = 'spc-hidden';
      i.checked = checked;
      l.append(i, el('span', '', label));
      box.append(l);
      return i;
    };
    const no = mk('Do not show hidden files and folders', !this.showHidden);
    const yes = mk('Show hidden files and folders', this.showHidden);
    void no;
    const btns = el('div', 'spc__btns');
    const apply = () => {
      this.showHidden = yes.checked;
      const ex = this._top('docs');
      if (ex) this._explorer(ex, ex.folder);
    };
    btns.append(
      btn('OK', 'spc__btn spc__btn--def', () => {
        apply();
        this._closeWin(w);
      }),
      btn('Cancel', 'spc__btn', () => this._closeWin(w)),
      btn('Apply', 'spc__btn', apply),
    );
    b.append(tabs, box, btns);
    return w;
  }

  _msgBox(title, iconName, text) {
    const w = this._frame('msg', title, iconName, 'spc__app--dialog spc__app--msg');
    w.modal = true;
    const row = el('div', 'spc__msgrow');
    row.append(icon(iconName, 32), el('p', '', text));
    const btns = el('div', 'spc__btns');
    btns.append(btn('OK', 'spc__btn spc__btn--def', () => this._closeWin(w)));
    w.body.append(row, btns);
    this.wins.push(w);
    this.desk.append(w.el);
    this._stack();
    if (iconName === 'error') this.sfx('access_denied', { volume: 0.5 });
  }

  // ---- Access Control
  // ---- Cameras: the Floor 2 CCTV rigs, about 4 fps, only while this window is open
  _camsWin() {
    const api = this.ctx?.cctv;
    const w = this._frame('cams', 'Cameras', 'cam', 'spc__app--cams');
    const rigs = api?.rigs?.() || [];
    if (!rigs.length) {
      w.body.append(el('div', 'spc__status', 'No cameras are connected.'));
      return w;
    }
    let i = 0;
    const cv = document.createElement('canvas');
    cv.className = 'spc__cam';
    cv.width = 192;
    cv.height = 144;
    const label = el('span', 'spc__camname', '');
    const go = (d) => {
      i = (i + d + rigs.length) % rigs.length;
      label.textContent = `${i + 1}/${rigs.length}  ${rigs[i].name}`;
    };
    const bar = el('div', 'spc__camrow');
    bar.append(btn('◀', 'spc__btn spc__btn--sm', () => go(-1)), label, btn('▶', 'spc__btn spc__btn--sm', () => go(1)));
    go(0);
    w.body.append(cv, bar, el('div', 'spc__status', 'Live feed. Recorded to tape. Nobody watches the tapes.'));
    const tick = () => {
      if (!this.isOpen || !this.wins.includes(w)) return;
      if (!this.busy) {
        try {
          api.render(rigs[i], cv);
        } catch {
          /* a bad feed just freezes */
        }
      }
      this.later(250, tick);
    };
    this.later(60, tick);
    return w;
  }

  _accessWin() {
    const w = this._frame('access', 'Access Control', 'access', 'spc__app--access');
    const t = el('div', 'spc__doors');
    w.rows = {};
    const head = el('div', 'spc__drow spc__drow--head');
    head.append(el('span', '', 'Door'), el('span', '', 'Type'), el('span', '', 'Status'), el('span', '', ''));
    t.append(head);
    for (const d of S.ACCESS_DOORS) {
      const r = el('div', 'spc__drow');
      const st = el('span', 'spc__dstat', d.fixed || '');
      const act = el('span', 'spc__dact');
      r.append(el('span', 'spc__dname', d.name), el('span', 'spc__dkind', d.kind), st, act);
      w.rows[d.id] = { st, act };
      t.append(r);
    }
    w.log = el('pre', 'spc__log');
    w.body.append(w.log, t, el('div', 'spc__status', 'Fire doors and the main entrance are on manual and cannot be changed here.'));
    this._accessRows(w);
    return w;
  }

  _accessRows(w) {
    const c = this.ctx;
    const set = (id, text, tone) => {
      const r = w.rows[id];
      if (!r) return;
      r.st.textContent = text;
      r.st.dataset.tone = tone || '';
    };
    set('stairA', c.released ? 'RELEASED' : 'SECURED', c.released ? 'ok' : 'bad');
    set('stairB', c.stairB ? 'OPEN (CHAIN LIFTED)' : 'CHAINED (GROUND FLOOR SIDE)', c.stairB ? 'ok' : 'warn');
    set('security', c.doors?.security ? 'UNLOCKED' : 'LOCKED', c.doors?.security ? 'ok' : 'bad');
    set('office', c.doors?.office ? 'UNLOCKED' : 'LOCKED', c.doors?.office ? 'ok' : 'bad');
    set('fire', 'ON MANUAL', 'warn');
    set('main', 'ON MANUAL', 'warn');
    if (w.log) w.log.textContent = (c.released ? S.PC.releasedLog : S.PC.lockdownLog).join('\n');
    w.log?.classList.toggle('is-ok', !!c.released);
    const a = w.rows.stairA.act;
    if (!a.firstChild || a._released !== !!c.released) {
      a.textContent = '';
      a._released = !!c.released;
      if (!c.released) {
        const b = btn('RELEASE', 'spc__btn spc__btn--go', async () => {
          if (this._releasing || this.busy) return;
          this._releasing = true;
          b.disabled = true;
          const r = await this.act('release');
          this._releasing = false;
          if (!this.isOpen) return;
          b.disabled = false;
          if (r.ok) {
            this.sfx('access_granted');
            this.ctx.released = true;
            this.setHint('Stairwell A is open. Go downstairs.');
            this.render();
          } else {
            this.sfx('access_denied');
            this._msgBox('Access Control', 'error', r.error === 'busy' ? 'Someone else is using this workstation.' : 'The maglock did not respond. Try again.');
          }
        });
        a.append(b);
      } else a.append(el('span', 'spc__ok', '✓'));
    }
  }

  // ------------------------------------------------------------------------------ per frame
  update(dt) {
    if (!this.isOpen) return;
    if (this.clock) {
      const s = Math.floor(this.game.time || 0);
      const m = 33 + Math.floor(s / 60);
      if (m !== this._clockS) {
        this._clockS = m;
        this.clock.textContent = `${3 + Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} AM`;
      }
    }

  }
}
