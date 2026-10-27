// LAST BELL — UI (S3). Implements CONTRACTS.md §10.
//
//   const ui = new UI(game);   // binds the markup in index.html (#ui), loads persisted settings
//                              // into game.settings (in place) and emits 'settings:change' once.
//
// Public API (contract + extensions marked *):
//   showLoading(p, label) / hideLoading()
//   showMenu() / hideMenu()
//   showIntro()* / hideIntro()*            story card; its "Click to begin" emits ui:start
//   showInstructions()* / showSettings()* / showCredits()*
//   showPause() / hidePause()
//   showHUD() / hideHUD()
//   update(dt, game)                        timer, stamina, inventory, prompt, threat, hiding
//   showVictory(stats) / showGameOver(reason, stats)   stats: { time, items, difficulty, seed }
//   showSubtitle(text, duration = auto, speaker)
//   flash(type)                             'item' | 'transform' | 'damage' | 'white'*
//   showNotice(text, seconds, { warning })*  short line under the clock
//   showResumeOverlay()* / hideResumeOverlay()*   "Click to resume" (pointer-lock recovery)
//   showError(message)*                     fatal error card (e.g. WebGL unavailable)
//   hideAll()*                              hide every screen + HUD
//   get activeScreen*                       'menu'|'intro'|'pause'|...|null
//
// Events emitted (always synchronously inside the click / keydown handler, so game.js can use
// the gesture for pointer lock + audio unlock):
//   ui:start {difficulty}, ui:resume, ui:restart, ui:quit, ui:pause, settings:change {settings},
//   ui:intro* {difficulty} (story card shown; game.js may pre-generate the level here)
// Events consumed: subtitle, announcement, enemy:voice, item:collected, inventory:changed,
//   world:transform-warning, world:transform, world:room000, exit:locked, exit:unlocked,
//   hide:enter, hide:exit, game:state, settings:change, player:lock*, player:lock-failed*
//
// The UI also reacts to 'game:state' on its own (menu → menu screen, paused → pause screen,
// playing → HUD), so game.js may either call the show*/hide* methods or just change state.
// Settings extension key: voiceSynth (bool, default true) — speechSynthesis stand-in voice.

import { DEFAULT_SETTINGS, SETTINGS_KEY, DIFFICULTY, ITEM_IDS, ITEM_NAMES } from './config.js';
import { VOICE_LINES, ANNOUNCEMENTS, ASSISTANT_LINES } from './audio.js';
import { TIPS } from './schoolnet-content.js';
import { Minimap } from './minimap.js';

export const SETTINGS_DEFAULTS = { ...DEFAULT_SETTINGS, voiceSynth: true };

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen'];
const DIFFICULTY_ORDER = ['easy', 'normal', 'hard'];
const DIFFICULTY_LABEL = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };
const DIFFICULTY_NOTE = {
  easy: 'minutes. He is slower, and a little deaf.',
  normal: 'minutes. He hears most things.',
  hard: 'minutes. He hears everything.',
};
const ITEM_SHORT = { keycard: 'security keycard', fuse: 'maintenance fuse', key: 'exit key' };

// Caretaker distance meter: level 0..5 by walking distance (see _renderProximity)
const TIPS_KEY = 'lastbell.tips.v1'; // first-time tips already shown to this player
const FUSE_HINT_AFTER = 90; // s into the run before the checklist names the fuse's room
const PROX_WORDS = ['Far away', 'Distant', 'Not far', 'Nearby', 'Close', 'Very close'];
const PROX_STATES = {
  PATROL: 'Patrolling',
  SUSPICIOUS: 'Heard something',
  INVESTIGATE: 'Checking a noise',
  SEARCH: 'Searching for you',
  CHASE: 'Hunting you',
  CAPTURE: 'Has you',
  IDLE: 'Standing still',
};

/** Sentences grouped into subtitle cues of at most ~70 characters. */
function splitCues(text) {
  const sentences = String(text).match(/[^.!?]+[.!?]+["”’]?\s*/g) || [String(text)];
  const cues = [];
  for (const s of sentences.map((x) => x.trim()).filter(Boolean)) {
    const last = cues.length - 1;
    if (last >= 0 && cues[last].length + s.length + 1 <= 70) cues[last] += ' ' + s;
    else cues.push(s);
  }
  return cues;
}

const capitalise = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** mm:ss (or m:ss) */
export function formatTime(seconds) {
  const s = Math.max(0, Math.ceil(seconds || 0));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function sanitizeSettings(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, def] of Object.entries(SETTINGS_DEFAULTS)) {
    const v = raw[k];
    if (v === undefined) continue;
    if (typeof def === 'number' && typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof def === 'boolean' && typeof v === 'boolean') out[k] = v;
    else if (typeof def === 'string' && typeof v === 'string') out[k] = v;
  }
  if (out.quality && !['low', 'medium', 'high'].includes(out.quality)) delete out.quality;
  if (out.difficulty && !DIFFICULTY[out.difficulty]) delete out.difficulty;
  if ('sensitivity' in out) out.sensitivity = clamp(out.sensitivity, 0.2, 3);
  if ('fov' in out) out.fov = clamp(out.fov, 60, 100);
  for (const k of ['masterVolume', 'musicVolume', 'sfxVolume', 'voiceVolume', 'chatVolume']) if (k in out) out[k] = clamp(out[k], 0, 1);
  return out;
}

/** Merge persisted settings into `target` (in place) and return it. Never throws. */
export function loadSettings(target = {}) {
  let stored = null;
  try {
    stored = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || 'null');
  } catch {
    stored = null;
  }
  for (const [k, v] of Object.entries(SETTINGS_DEFAULTS)) if (target[k] === undefined) target[k] = v;
  Object.assign(target, sanitizeSettings(stored));
  return target;
}

export function saveSettings(settings) {
  try {
    const out = {};
    for (const k of Object.keys(SETTINGS_DEFAULTS)) out[k] = settings[k];
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(out));
    return true;
  } catch {
    return false;
  }
}

const SCREENS = ['loading', 'warning', 'hwwarning', 'menu', 'intro', 'instructions', 'settings', 'credits', 'pause', 'victory', 'gameover', 'error', 'coop'];
const MENU_LIKE = new Set(['warning', 'menu', 'intro', 'instructions', 'settings', 'credits', 'pause', 'victory', 'gameover', 'error', 'loading', 'coop']);
const WARNING_KEY = 'lastbell.photosensitivity.v1';

export class UI {
  constructor(game) {
    this.game = game;
    this.events = game.events;
    this.settings = game.settings || (game.settings = {});
    loadSettings(this.settings);

    const $ = (id) => document.getElementById(id);
    this.$ = $;
    this.root = $('ui');
    if (!this.root) throw new Error('[ui] #ui markup missing (index.html)');
    this.screens = {};
    for (const name of SCREENS) this.screens[name] = $(`screen-${name}`);

    this.el = {
      hud: $('hud'),
      threat: $('hud-threat'),
      hide: $('hud-hide'),
      clock: $('hud-clock'),
      time: $('hud-time'),
      timeBar: $('hud-time-bar'),
      notice: $('hud-notice'),
      dot: $('hud-dot'),
      prompt: $('hud-prompt'),
      promptKey: $('hud-prompt-key'),
      promptText: $('hud-prompt-text'),
      hint: $('hud-hint'),
      inventory: $('hud-inventory'),
      stamina: $('hud-stamina'),
      staminaBar: $('hud-stamina-bar'),
      torch: $('hud-torch'),
      mic: $('hud-mic'),
      torchLabel: $('hud-torch-label'),
      side: $('hud-side'),
      map: $('hud-map'),
      mapCanvas: $('hud-map-canvas'),
      prox: $('hud-prox'),
      proxWord: $('hud-prox-word'),
      proxM: $('hud-prox-m'),
      proxState: $('hud-prox-state'),
      goals: $('hud-goals'),
      tools: $('hud-tools'),
      toolsList: $('hud-tools-list'),
      card: $('hud-card'),
      tip: $('hud-tip'),
      subtitles: $('subtitles'),
      flash: $('flash'),
      loadingBar: $('loading-bar'),
      loadingLabel: $('loading-label'),
      difficultyValue: $('difficulty-value'),
      difficultyNote: $('difficulty-note'),
      introText: $('intro-text'),
      pauseStatus: $('pause-status'),
      resume: $('resume-overlay'),
      errorText: $('error-text'),
    };
    this.slots = {};
    for (const li of this.el.inventory.querySelectorAll('.slot')) this.slots[li.dataset.item] = li;

    this.active = null;            // current menu-like screen name
    this._returnTo = 'menu';       // where Back goes from instructions/settings/credits
    this._hudVisible = false;
    this._timers = new Set();
    this._lastTimeText = '';
    this._lastPrompt = undefined;
    this._lastHidden = null;
    this._lastHideType = '';
    this._threat = 0;
    this._noticeT = 0;
    this._invKey = '';
    this._introShownAt = 0;
    this._timeLimit = 0;
    this._subs = [];
    /** CSS threat vignette (heartbeat-synced darkening). postfx.js already tints edges red from
     *  threat, so this one stays subtle; set false to rely on the post pass only. */
    this.threatVignette = true;

    this._bindMenus();
    this._bindSettings();
    this._bindKeys();
    this._bindEvents();
    this.applySettings();
    this.refreshDifficulty();
    this._renderInventory(this._inventoryItems(), false);
    this.events?.emit('settings:change', { settings: this.settings });
  }

  // =================================================================== screens ==
  get activeScreen() {
    return this.active;
  }

  _show(name, { focus = true } = {}) {
    for (const [n, el] of Object.entries(this.screens)) {
      if (!el) continue;
      if (n === name) {
        if (el.hidden) {
          el.hidden = false;
          // restart the entrance animation
          el.style.animation = 'none';
          void el.offsetWidth;
          el.style.animation = '';
        }
      } else el.hidden = true;
    }
    this.active = name;
    this.root.classList.toggle('has-screen', MENU_LIKE.has(name));
    this.root.classList.toggle('on-paper', name === 'victory' || name === 'gameover');
    if (name !== 'pause' && name !== 'intro') this.hideResumeOverlay();
    if (focus) this._focusFirst(this.screens[name]);
  }

  _hide(name) {
    const el = this.screens[name];
    if (el) el.hidden = true;
    if (this.active === name) {
      this.active = null;
      this.root.classList.remove('has-screen');
    }
  }

  hideAll() {
    for (const n of SCREENS) this._hide(n);
    this.hideHUD();
    this.hideResumeOverlay();
  }

  showLoading(progress = 0, label) {
    if (this.active !== 'loading') this._show('loading', { focus: false });
    const p = clamp(Number(progress) || 0, 0, 1);
    this.el.loadingBar.style.transform = `scaleX(${p})`;
    if (label) this.el.loadingLabel.textContent = label;
  }
  hideLoading() {
    this._hide('loading');
  }

  showMenu() {
    this.hideHUD();
    this.clearSubtitles();
    this.refreshDifficulty();
    // photosensitivity warning, once per browser, before the first menu
    let seen = !!this._warningClosed;
    try { seen = seen || localStorage.getItem(WARNING_KEY) === 'seen'; } catch { /* storage blocked: once per session */ }
    if (!seen) {
      if (this.active !== 'warning') this._show('warning');
      return;
    }
    this._show('menu');
  }

  _closeWarning(reduce) {
    this._warningClosed = true;
    try { localStorage.setItem(WARNING_KEY, 'seen'); } catch { /* ignore */ }
    if (reduce && !this.settings.reducedEffects) {
      this.settings.reducedEffects = true;
      this.refreshSettings();
      this._commitSettings();
    }
    this._sound('ui_select');
    this._show('menu');
  }
  hideMenu() {
    this._hide('menu');
  }

  showIntro() {
    this.hideHUD();
    this._show('intro', { focus: false });
    this._introShownAt = performance.now();
    const screen = this.screens.intro;
    const text = this.el.introText;
    // the second-floor start is the default; ?start=floor1 keeps the classic story
    let classic = false;
    try { classic = new URLSearchParams(location.search).get('start') === 'floor1'; } catch { /* default story */ }
    const hw = this._introMode === 'halloween'; // The Halloween Shift has its own story (halloween/)
    for (const p of text.querySelectorAll('p[data-intro]')) {
      p.hidden = hw ? p.dataset.intro !== 'halloween' : p.dataset.intro === 'halloween' || (p.dataset.intro === 'classic') !== classic;
    }
    screen.classList.toggle('intro--hw', hw);
    const paras = [...text.querySelectorAll('p')].filter((p) => !p.hidden);
    screen.classList.remove('is-ready');
    text.classList.remove('is-complete');
    for (const t of this._introTimers || []) clearTimeout(t);
    this._introTimers = [];
    const instant = this._reduced();
    paras.forEach((p, i) => {
      p.classList.toggle('is-shown', instant);
      if (!instant) this._introTimers.push(setTimeout(() => p.classList.add('is-shown'), 250 + i * 850));
    });
    const done = () => {
      paras.forEach((p) => p.classList.add('is-shown'));
      text.classList.add('is-complete');
      screen.classList.add('is-ready');
    };
    if (instant) done();
    else this._introTimers.push(setTimeout(done, 250 + paras.length * 850));
    this.$('intro-begin').focus({ preventScroll: true });
    this.events?.emit('ui:intro', { difficulty: this.settings.difficulty });
  }
  /** The Halloween Shift's menu entry (halloween/config.js decides when). Seasonal styling: halloween/halloween.css. */
  setHalloween(on) {
    on = !!on;
    const menu = this.screens.menu;
    if (!menu) return;
    if (on && !document.getElementById('hw-css')) {
      const link = document.createElement('link');
      link.id = 'hw-css';
      link.rel = 'stylesheet';
      link.href = 'halloween/halloween.css';
      document.head.appendChild(link);
    }
    menu.classList.toggle('menu--hw', on);
    for (const el of document.querySelectorAll('[data-hw]')) el.hidden = !on; // menu entry, board row, settings
    const begin = menu.querySelector('[data-action="begin"]');
    if (begin) begin.textContent = on ? 'Play normal' : 'Begin';
  }
  hideIntro() {
    for (const t of this._introTimers || []) clearTimeout(t);
    this._hide('intro');
  }

  showInstructions(from) {
    this._returnTo = from || (this.active === 'pause' ? 'pause' : this.active === 'menu' ? 'menu' : this._returnTo);
    this._show('instructions');
  }
  showSettings(from) {
    this._returnTo = from || (this.active === 'pause' ? 'pause' : this.active === 'menu' ? 'menu' : this._returnTo);
    this.refreshSettings();
    this._show('settings');
  }
  showCredits(from) {
    this._returnTo = from || (this.active === 'pause' ? 'pause' : 'menu');
    this._show('credits');
  }

  showPause() {
    const g = this.game;
    const left = Number.isFinite(g.timeLeft) ? `${formatTime(g.timeLeft)} left.` : '';
    const n = this._inventoryItems().length;
    const coop = g.coop?.active;
    this.el.pauseStatus.textContent = `${left} ${n} of ${ITEM_IDS.length} items found.${coop ? ' Co-op never pauses: the others are still playing.' : ''}`.trim();
    const restart = this.screens.pause?.querySelector('[data-action="restart"]');
    if (restart) restart.hidden = !!coop && !g.coop.isHost;
    this.el.prompt.classList.remove('is-on');
    this._show('pause');
  }
  hidePause() {
    if (['pause', 'instructions', 'settings', 'credits'].includes(this.active) && this._returnTo === 'pause') {
      this._hide(this.active);
    }
    this._hide('pause');
  }

  showHUD() {
    this._hudVisible = true;
    this.el.hud.hidden = false;
    this._lastPrompt = undefined;
    this._lastTimeText = '';
    this._goalsKey = undefined; // fresh checklist each run, without the "new" flash
    this._torchKey = undefined;
    this._torchLvl = undefined;
    this._proxKey = undefined;
    this._proxT = 0;
  }
  hideHUD() {
    this._hudVisible = false;
    this.el.hud.hidden = true;
    this.el.prompt.classList.remove('is-on');
  }

  showVictory(stats = {}) {
    this.hideHUD();
    this.clearSubtitles();
    this.$('victory-date').textContent = this._dateLine();
    this._fillStats(this.$('victory-stats'), stats, true);
    this._show('victory');
  }

  showGameOver(reason = 'captured', stats = {}) {
    this.hideHUD();
    this.clearSubtitles();
    const r = String(reason || '').toLowerCase();
    let title = 'Kept behind.';
    let text = 'The caretaker found you.';
    if (['time', 'timeout', 'time_up', 'timeup', 'time-up', 'sealed'].includes(r)) {
      title = 'Locked in.';
      text = 'The clock ran out and the doors sealed for the night.';
    } else if (!['captured', 'caught', 'capture', ''].includes(r)) {
      text = String(reason);
    }
    this.$('gameover-title').textContent = title;
    this.$('gameover-reason').textContent = text;
    this.$('gameover-date').textContent = this._dateLine();
    this._fillStats(this.$('gameover-stats'), stats, false);
    this._show('gameover');
  }

  showError(message) {
    this.hideHUD();
    this.el.errorText.textContent = message || 'Something went wrong while starting the game.';
    this._show('error', { focus: false });
  }

  showResumeOverlay() {
    this.el.resume.hidden = false;
    this.el.resume.focus({ preventScroll: true });
  }
  hideResumeOverlay() {
    if (this.el?.resume) this.el.resume.hidden = true;
  }

  _dateLine() {
    try {
      return new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    } catch {
      return '';
    }
  }

  _fillStats(dl, stats, won) {
    const rows = [];
    const items = Array.isArray(stats.items) ? stats.items : null;
    const count = items ? items.length : Number.isFinite(stats.items) ? stats.items : this._inventoryItems().length;
    if (Number.isFinite(stats.time)) rows.push(['Time inside', formatTime(stats.time)]);
    if (won && Number.isFinite(stats.timeLeft)) rows.push(['Time to spare', formatTime(stats.timeLeft)]);
    const names = items && items.length ? ` (${items.map((i) => ITEM_SHORT[i] || i).join(', ')})` : '';
    rows.push(['Items found', `${count} of ${ITEM_IDS.length}${won ? '' : names}`]);
    const diff = stats.difficulty || this.settings.difficulty;
    if (diff) rows.push(['Difficulty', DIFFICULTY_LABEL[diff] || capitalise(String(diff))]);
    if (Number.isFinite(stats.transforms)) rows.push(['Times the school shifted', String(stats.transforms)]);
    if (stats.seed !== undefined && stats.seed !== null) rows.push(['School layout', `No. ${stats.seed}`]);
    if (stats.coop) {
      rows.unshift(['Got out', stats.coop.out.length ? stats.coop.out.join(', ') : 'Nobody']);
      if (stats.coop.behind.length) rows.splice(1, 0, ['Left behind', stats.coop.behind.join(', ')]);
    }
    dl.replaceChildren();
    for (const [k, v] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      dl.append(dt, dd);
    }
  }

  _focusFirst(screen) {
    if (!screen) return;
    const el = screen.querySelector('.menu-item, button, input');
    if (el) el.focus({ preventScroll: true });
  }

  _focusables() {
    const screen = this.active ? this.screens[this.active] : null;
    if (!screen || screen.hidden) return [];
    return [...screen.querySelectorAll('button, input')].filter((e) => !e.disabled && e.offsetParent !== null);
  }

  _reduced() {
    return !!this.settings.reducedEffects || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  }

  _sound(id) {
    try {
      this.game.audio?.play?.(id);
    } catch {
      /* audio is optional */
    }
  }

  // ============================================================ menu binding ==
  _bindMenus() {
    this.root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn || !this.root.contains(btn)) return;
      this._action(btn.dataset.action, btn, e);
    });
    // whole intro screen is a click target ("click to begin")
    this.screens.intro.addEventListener('click', (e) => {
      if (e.target.closest('[data-action]')) return;
      this._action('start', null, e);
    });
    // hover moves focus, like a game menu
    this.root.addEventListener('mouseover', (e) => {
      const item = e.target.closest('.menu-item');
      if (item && document.activeElement !== item && !item.closest('[hidden]')) item.focus({ preventScroll: true });
    });
    this.root.addEventListener('focusin', (e) => {
      if (e.target.closest('.menu-item, .toggle, .choice button, input')) this._sound('ui_hover');
    });
  }

  _action(action) {
    switch (action) {
      case 'begin':
        this._sound('ui_select');
        this._introMode = 'normal';
        this.showIntro();
        break;
      case 'halloween':
        // The Halloween Shift: its content warning first (13+, jump scares, censored gore, flicker)
        this._sound('ui_select');
        this._show('hwwarning');
        break;
      case 'hw-warning-ok':
      case 'hw-warning-mild':
        if (action === 'hw-warning-mild' && this.settings.scareIntensity !== 'mild') {
          this.settings.scareIntensity = 'mild';
          this.refreshSettings();
          this._commitSettings();
        }
        this._sound('ui_select');
        this._introMode = 'halloween';
        this.showIntro();
        break;
      case 'hw-warning-back':
        this.back();
        break;
      case 'warning-ok':
        this._closeWarning(false);
        break;
      case 'warning-reduce':
        this._closeWarning(true);
        break;
      case 'start': {
        // guard against the second click of a double-click on "Begin"
        if (this._introShownAt > 0 && performance.now() - this._introShownAt < 350) return;
        this._sound('ui_select');
        this.hideIntro();
        this.events?.emit('ui:start', { difficulty: this.settings.difficulty, mode: this._introMode === 'halloween' ? 'halloween' : 'normal' });
        break;
      }
      case 'difficulty':
        this.cycleDifficulty(1);
        break;
      case 'instructions':
        this._sound('ui_select');
        this.showInstructions();
        break;
      case 'settings':
        this._sound('ui_select');
        this.showSettings();
        break;
      case 'credits':
        this._sound('ui_select');
        this.showCredits();
        break;
      case 'back':
        this.back();
        break;
      case 'resume':
        this._sound('ui_select');
        this.hidePause();
        this.events?.emit('ui:resume', {});
        break;
      case 'resume-lock':
        // still 'playing' (lock was refused): re-request the lock inside this gesture
        this.hideResumeOverlay();
        try {
          this.game.player?.lockPointer?.();
        } catch {
          /* ignore */
        }
        this.events?.emit('ui:resume', {});
        break;
      case 'restart':
        this._sound('ui_select');
        this._hide(this.active);
        this.events?.emit('ui:restart', {});
        break;
      case 'quit':
        this._sound('ui_back');
        this.events?.emit('ui:quit', {});
        if (this.active !== 'menu') this.showMenu();
        break;
      case 'reset-settings':
        this._sound('ui_toggle');
        this.resetSettings();
        break;
      default:
        // co-op lobby (coop.js): 'coop' opens it, 'coop-*' are its buttons
        if (typeof action === 'string' && action.startsWith('coop')) this.events?.emit('ui:coop', { action });
        break;
    }
  }

  back() {
    if (this.active === 'coop') {
      this.events?.emit('ui:coop', { action: 'coop-back' });
      return true;
    }
    if (this.active === 'hwwarning') {
      this._sound('ui_back');
      this.showMenu();
      return true;
    }
    if (['instructions', 'settings', 'credits'].includes(this.active)) {
      this._sound('ui_back');
      const to = this._returnTo === 'pause' ? 'pause' : 'menu';
      if (to === 'pause') this.showPause();
      else this.showMenu();
      return true;
    }
    if (this.active === 'intro') {
      this._sound('ui_back');
      this.hideIntro();
      this.showMenu();
      return true;
    }
    return false;
  }

  cycleDifficulty(dir = 1) {
    const i = DIFFICULTY_ORDER.indexOf(this.settings.difficulty);
    const next = DIFFICULTY_ORDER[(Math.max(0, i) + dir + DIFFICULTY_ORDER.length) % DIFFICULTY_ORDER.length];
    this.settings.difficulty = next;
    this.game.difficulty = DIFFICULTY[next];
    this._sound('ui_toggle');
    this.refreshDifficulty();
    this._commitSettings();
  }

  refreshDifficulty() {
    const d = DIFFICULTY[this.settings.difficulty] ? this.settings.difficulty : 'normal';
    this.el.difficultyValue.textContent = DIFFICULTY_LABEL[d];
    const mins = Math.round((DIFFICULTY[d].timeLimit || 0) / 60);
    const word = NUMBER_WORDS[mins] ? capitalise(NUMBER_WORDS[mins]) : String(mins);
    this.el.difficultyNote.textContent = `${word} ${DIFFICULTY_NOTE[d]}`;
  }

  // ======================================================== settings binding ==
  _bindSettings() {
    this._settingEls = [];
    for (const row of this.root.querySelectorAll('.setting')) {
      const key = row.dataset.setting;
      const kind = row.dataset.kind;
      const entry = { row, key, kind };
      if (kind === 'range') {
        const input = row.querySelector('input');
        input.min = row.dataset.min;
        input.max = row.dataset.max;
        input.step = row.dataset.step;
        entry.input = input;
        entry.output = row.querySelector('output');
        input.addEventListener('input', () => {
          this.settings[key] = parseFloat(input.value);
          this._paintRange(entry);
          this._commitSettings();
        });
        input.addEventListener('change', () => this._sound('ui_toggle'));
      } else if (kind === 'toggle') {
        const btn = row.querySelector('.toggle');
        entry.button = btn;
        btn.addEventListener('click', () => {
          this.settings[key] = !this.settings[key];
          this._sound('ui_toggle');
          this._paintToggle(entry);
          this._commitSettings();
        });
      } else if (kind === 'choice') {
        entry.buttons = [...row.querySelectorAll('[role=radio]')];
        for (const b of entry.buttons) {
          b.addEventListener('click', () => {
            this.settings[key] = b.dataset.value;
            this._sound('ui_toggle');
            this._paintChoice(entry);
            this._commitSettings();
          });
        }
      }
      this._settingEls.push(entry);
    }
    this.refreshSettings();
  }

  _paintRange(e) {
    const v = Number(this.settings[e.key]);
    if (document.activeElement !== e.input || String(e.input.value) !== String(v)) e.input.value = v;
    const min = Number(e.input.min);
    const max = Number(e.input.max);
    e.input.style.setProperty('--fill', `${((v - min) / (max - min)) * 100}%`);
    const f = e.row.dataset.format;
    e.output.textContent = f === 'pct' ? `${Math.round(v * 100)}%` : f === 'deg' ? `${Math.round(v)}°` : `${v.toFixed(2)}×`;
  }
  _paintToggle(e) {
    const on = !!this.settings[e.key];
    e.button.setAttribute('aria-checked', String(on));
    e.button.textContent = on ? 'On' : 'Off';
  }
  _paintChoice(e) {
    for (const b of e.buttons) {
      const on = b.dataset.value === this.settings[e.key];
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
  }

  refreshSettings() {
    for (const e of this._settingEls || []) {
      if (e.kind === 'range') this._paintRange(e);
      else if (e.kind === 'toggle') this._paintToggle(e);
      else if (e.kind === 'choice') this._paintChoice(e);
    }
    this.applySettings();
  }

  resetSettings() {
    const keepDifficulty = this.settings.difficulty;
    Object.assign(this.settings, SETTINGS_DEFAULTS, { difficulty: keepDifficulty });
    this.refreshSettings();
    this._commitSettings();
  }

  /** UI-side effects of settings (reduced effects flag, subtitles). */
  applySettings() {
    this.root.dataset.reduced = String(!!this.settings.reducedEffects);
    if (!this.settings.subtitles) this.clearSubtitles();
  }

  _commitSettings() {
    this.applySettings();
    saveSettings(this.settings);
    this._emittingSettings = true;
    this.events?.emit('settings:change', { settings: this.settings });
    this._emittingSettings = false;
  }

  // ============================================================== keyboard ==
  _bindKeys() {
    this._onKey = (e) => {
      const g = this.game;
      if (this.active && this.active !== 'loading') {
        const r = this._menuKey(e);
        if (r === true) e.preventDefault();
        if (r) e.stopPropagation(); // 'stop': keep browser shortcuts, but keep game listeners out
        return;
      }
      // at a SCHOOLNET computer every key belongs to the screen (typing a "p" must not pause)
      if (g.schoolnet?.isOpen) return;
      // a puzzle panel, the chat box or any text field owns the keyboard (its own Esc closes it)
      if (g.activeOverlay || g.isTyping?.()) return;
      if (!this.el.resume.hidden && (e.code === 'Enter' || e.code === 'Space')) {
        e.preventDefault();
        e.stopPropagation();
        this._action('resume-lock');
        return;
      }
      // the upstairs opening cutscene takes every key (cutscene-f2.js): Esc / P skip it, they do not pause
      if (g.cutscene?.active) return;
      // in game: P (and Esc when the pointer isn't locked) pauses
      if ((e.code === 'KeyP' || e.code === 'Escape') && g.state === 'playing') {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) this.events?.emit('ui:pause', {});
      }
    };
    // capture phase: menu keys are handled (and stopped) before game.js / player listeners see them
    window.addEventListener('keydown', this._onKey, true);
  }

  _menuKey(e) {
    const a = this.active;
    const target = document.activeElement;
    // typing in a text field (co-op name / room code): only Esc, Tab and up/down are menu keys
    if (target?.tagName === 'INPUT' && !['Escape', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.code)) return false;
    if (e.code === 'Escape' || (e.code === 'KeyP' && a === 'pause') || (e.code === 'Backspace' && a !== 'pause')) {
      if (e.repeat) return true;
      if (a === 'pause') {
        this._action('resume');
        return true;
      }
      return this.back();
    }
    if (a === 'intro' && (e.code === 'Enter' || e.code === 'Space') && target?.id !== 'intro-begin') {
      this._action('start');
      return true;
    }
    if (e.code === 'ArrowDown' || e.code === 'ArrowUp' || e.code === 'Tab') {
      const list = this._focusables();
      if (!list.length) return true;
      // radio groups count as one stop
      const stops = list.filter((el) => el.getAttribute('role') !== 'radio' || el.getAttribute('aria-checked') === 'true');
      let i = stops.indexOf(target);
      if (i < 0 && target?.getAttribute('role') === 'radio') i = stops.findIndex((s) => s.parentElement === target.parentElement);
      const dir = e.code === 'ArrowUp' || (e.code === 'Tab' && e.shiftKey) ? -1 : 1;
      const next = stops[(i + dir + stops.length) % stops.length] || stops[0];
      next.focus({ preventScroll: false });
      return true;
    }
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      const dir = e.code === 'ArrowLeft' ? -1 : 1;
      if (target?.dataset?.action === 'difficulty') {
        this.cycleDifficulty(dir);
        return true;
      }
      if (target?.getAttribute('role') === 'radio') {
        const group = [...target.parentElement.querySelectorAll('[role=radio]')];
        const j = clamp(group.indexOf(target) + dir, 0, group.length - 1);
        group[j].focus();
        group[j].click();
        return true;
      }
      if (target?.classList.contains('toggle')) {
        const want = dir > 0;
        const key = target.closest('.setting').dataset.setting;
        if (!!this.settings[key] !== want) target.click();
        return true;
      }
      return false; // range inputs adjust natively
    }
    // keep game listeners out while a menu is open (Enter/Space activate the focused button natively)
    return ['Enter', 'Space', 'NumpadEnter'].includes(e.code) ? false : 'stop';
  }

  // ================================================================ events ==
  _bindEvents() {
    const ev = this.events;
    if (!ev) return;
    const on = (t, fn) => this._subs.push(ev.on(t, fn));
    on('subtitle', ({ text, duration, speaker } = {}) => this.showSubtitle(text, duration, speaker));
    on('announcement', ({ id, text } = {}) => {
      const t = text || ANNOUNCEMENTS[id];
      if (!t) return;
      // the PA chime plays first; let the words land with the voice. Long announcements are
      // split into sentence-sized cues spread over the speech, so no line sits on screen as a wall.
      const total = Number(this.game.audio?.speechDuration?.(id, t)) || t.length * 0.07;
      const cues = splitCues(t);
      const chars = cues.reduce((n, c) => n + c.length, 0);
      let at = 1400;
      for (const c of cues) {
        const d = Math.max(1.8, (total * c.length) / chars);
        this._later(() => this.showSubtitle(c, cues.length > 1 ? d + 0.4 : undefined, 'PA'), at);
        at += d * 1000;
      }
    });
    on('enemy:voice', ({ line, position, text, big, who } = {}) => {
      if (who === 'assistant') {
        const t = text || ASSISTANT_LINES[line];
        const p = this.game.player?.position;
        if (!t || (position && p && typeof p.distanceTo === 'function' && p.distanceTo(position) > 28)) return;
        this.showSubtitle(t, undefined, 'The Assistant');
        return;
      }
      let t = text || (big && line === 'burp' ? '[enormous burp]' : VOICE_LINES[line]);
      // the wheeze only has words once the recorded line is installed
      if (!text && line === 'wheeze' && !this.game.audio?.hasFile?.('caretaker_wheeze')) t = '[wheezing]';
      // until his own recording is in, pulling you out of a hiding place uses "There you are."
      if (!text && line === 'found_hiding' && !this.game.audio?.hasFile?.('caretaker_found_hiding')) t = VOICE_LINES.found_you;
      if (!t) return;
      const p = this.game.player?.position;
      if (position && p && typeof p.distanceTo === 'function' && p.distanceTo(position) > 28) return;
      this.showSubtitle(t, undefined, 'Caretaker');
    });
    on('item:collected', () => this.flash('item'));
    on('inventory:changed', ({ items } = {}) => this._renderInventory(items || [], true));
    on('world:transform-warning', ({ secondsLeft } = {}) => {
      this.showNotice('The walls are shifting.', Math.max(2.5, Number(secondsLeft) || 5), { warning: true });
    });
    on('world:transform', ({ description } = {}) => {
      this.flash('transform');
      if (description) this.showNotice(description, 5);
      else this.el.notice.classList.remove('is-on', 'is-warning');
    });
    // game.js narrates Room 000 and the locked exit with subtitles; the HUD only marks the unlock
    on('exit:unlocked', () => this.showNotice('The main entrance is open.', 4));
    on('player:lock-failed', () => {
      if (this.game.state === 'playing' && !this.active) this.showResumeOverlay();
    });
    on('player:lock', ({ locked } = {}) => {
      if (locked) this.hideResumeOverlay();
    });
    // SCHOOLNET and the things you can use (computers.js)
    on('tip', ({ id } = {}) => this._showTip(id));
    on('schoolnet:tools', ({ tools } = {}) => this._renderTools(tools || []));
    on('schoolnet:inventory', (h = {}) => {
      this._invHints = h.reset ? null : { keycard: h.keycard || null, fuse: h.fuse || null };
      this._goalsKey = undefined;
    });
    on('schoolnet:open', () => this.hideCard());
    on('settings:change', () => {
      if (this._emittingSettings) return;
      this.refreshSettings();
      this.refreshDifficulty();
    });
    on('game:state', ({ state } = {}) => {
      switch (state) {
        case 'menu':
          if (this.active !== 'menu') this.showMenu();
          break;
        case 'playing':
          if (['pause', 'menu', 'intro'].includes(this.active) || (this._returnTo === 'pause' && ['settings', 'instructions'].includes(this.active))) {
            this._hide(this.active);
          }
          this.showHUD();
          break;
        case 'paused':
          if (!['pause', 'settings', 'instructions', 'credits'].includes(this.active)) this.showPause();
          this.hideResumeOverlay();
          break;
        case 'captured':
        case 'escaping':
          this.el.prompt.classList.remove('is-on');
          this.hideResumeOverlay();
          break;
        default:
          break;
      }
    });
  }

  _later(fn, ms) {
    const t = setTimeout(() => {
      this._timers.delete(t);
      fn();
    }, ms);
    this._timers.add(t);
    return t;
  }

  // ============================================================= subtitles ==
  showSubtitle(text, duration, speaker) {
    if (!text || !this.settings.subtitles) return;
    // no subtitles over the menu or the end slips (pause keeps them, hidden by CSS until resume)
    if (['menu', 'victory', 'gameover', 'loading', 'error'].includes(this.active)) return;
    const box = this.el.subtitles;
    const dur = Number.isFinite(duration) && duration > 0 ? duration : clamp(1.6 + String(text).length * 0.055, 2.2, 9);
    // de-duplicate: same text already on screen → just extend it
    for (const p of box.children) {
      if (p.dataset.text === text) {
        clearTimeout(p._t);
        p.classList.remove('is-out');
        p._t = setTimeout(() => this._dropSub(p), dur * 1000);
        return;
      }
    }
    const p = document.createElement('p');
    p.className = 'subtitle';
    p.dataset.text = text;
    const sp = speaker ? String(speaker) : '';
    if (/^pa$/i.test(sp)) p.classList.add('subtitle--pa');
    if (/caretaker/i.test(sp)) p.classList.add('subtitle--caretaker');
    if (sp) {
      const s = document.createElement('span');
      s.className = 'subtitle__speaker';
      s.textContent = sp === 'PA' ? 'Tannoy' : sp;
      p.append(s);
    }
    p.append(document.createTextNode(text));
    box.append(p);
    while (box.children.length > 3) box.firstElementChild.remove();
    p._t = setTimeout(() => this._dropSub(p), dur * 1000);
  }

  _dropSub(p) {
    p.classList.add('is-out');
    setTimeout(() => p.remove(), 520);
  }

  clearSubtitles() {
    for (const p of [...(this.el?.subtitles?.children || [])]) {
      clearTimeout(p._t);
      p.remove();
    }
  }

  // ========================================================= flash / notice ==
  flash(type = 'item') {
    const f = this.el.flash;
    f.className = 'flash';
    void f.offsetWidth;
    f.classList.add(`flash--${type}`);
    clearTimeout(this._flashT);
    this._flashT = setTimeout(() => (f.className = 'flash'), 1700);
  }

  showNotice(text, seconds = 4, { warning = false } = {}) {
    const n = this.el.notice;
    n.textContent = text;
    n.classList.toggle('is-warning', !!warning);
    n.classList.add('is-on');
    this._noticeT = seconds;
    clearTimeout(this._noticeTimer);
    this._noticeTimer = setTimeout(() => n.classList.remove('is-on', 'is-warning'), seconds * 1000);
  }

  /** A paper card on screen (sticky note, the register): { title, lines[], footer, anchor }. */
  showCard({ kind = '', title = '', lines = [], footer = '', anchor = null, image = '' } = {}) {
    const c = this.el.card;
    if (!c) return;
    c.className = `hud-card hud-card--${kind}`;
    c.querySelector('.hud-card__title').textContent = title;
    const box = c.querySelector('.hud-card__lines');
    box.textContent = '';
    c.querySelector('.hud-card__img')?.remove();
    if (image) {
      const im = document.createElement('img');
      im.className = 'hud-card__img';
      im.src = image;
      im.alt = '';
      box.before(im);
    }
    for (const l of lines) {
      const p = document.createElement('p');
      p.textContent = l;
      if (/ABSENT$/.test(l)) p.className = 'is-absent';
      box.append(p);
    }
    c.querySelector('.hud-card__foot').textContent = footer;
    c.hidden = false;
    this._card = { t: 20, anchor: anchor ? { x: anchor.x, z: anchor.z } : null };
  }

  hideCard() {
    if (this.el.card) this.el.card.hidden = true;
    this._card = null;
  }

  /** First-time tips: each one is shown once per player, ever (localStorage). */
  _showTip(id) {
    const tip = TIPS[id];
    if (!tip || !this.el.tip) return;
    let seen = [];
    try {
      seen = JSON.parse(localStorage.getItem(TIPS_KEY) || '[]');
    } catch { /* private mode etc.: show it anyway */ }
    if (seen.includes(id) || this._tipsShown?.has(id)) return;
    (this._tipsShown = this._tipsShown || new Set()).add(id);
    try {
      localStorage.setItem(TIPS_KEY, JSON.stringify([...seen, id]));
    } catch { /* ignore */ }
    const t = this.el.tip;
    t.querySelector('.hud-tip__title').textContent = tip.title;
    t.querySelector('.hud-tip__text').textContent = tip.text;
    t.hidden = false;
    t.classList.remove('is-in');
    void t.offsetWidth;
    t.classList.add('is-in');
    clearTimeout(this._tipT);
    this._tipT = setTimeout(() => (t.hidden = true), 7500);
  }

  /** The Tools list in the sidebar: things you can use right now, and how. */
  _renderTools(tools) {
    const sec = this.el.tools;
    const ul = this.el.toolsList;
    if (!sec || !ul) return;
    const key = tools.map((t) => `${t.id}:${t.how}`).join('|');
    if (key === this._toolsKey) return;
    const before = new Set((this._toolsKey || '').split('|').map((k) => k.split(':')[0]));
    this._toolsKey = key;
    ul.textContent = '';
    for (const t of tools) {
      const li = document.createElement('li');
      const b = document.createElement('b');
      b.textContent = t.name;
      const small = document.createElement('small');
      small.textContent = t.how;
      li.append(b, small);
      if (!before.has(t.id)) li.classList.add('is-new');
      ul.append(li);
    }
    sec.hidden = tools.length === 0;
  }

  // ============================================================= inventory ==
  _inventoryItems() {
    const inv = this.game.player?.inventory || this.game.inventory;
    return inv?.items ? [...inv.items] : [];
  }

  _renderInventory(items, animate) {
    const key = items.join(',');
    const prev = new Set(this._invKey ? this._invKey.split(',') : []);
    this._invKey = key;
    for (const id of ITEM_IDS) {
      const slot = this.slots[id];
      if (!slot) continue;
      const owned = items.includes(id);
      slot.classList.toggle('is-owned', owned);
      slot.setAttribute('aria-label', `${ITEM_NAMES[id]}: ${owned ? 'found' : 'missing'}`);
      if (animate && owned && !prev.has(id)) {
        slot.classList.remove('is-new');
        void slot.offsetWidth;
        slot.classList.add('is-new');
      }
    }
    if (animate) {
      this.el.inventory.classList.add('is-revealed');
      clearTimeout(this._invT);
      this._invT = setTimeout(() => this.el.inventory.classList.remove('is-revealed'), 3200);
    }
  }

  // =============================================================== sidebar ==
  _updateSide(dt, game, inv) {
    const showProx = this.settings.showProximity !== false;
    const showGoals = this.settings.showObjectives !== false;
    const { side, prox, goals } = this.el;
    if (prox.hidden === showProx) prox.hidden = !showProx;
    if (goals.hidden === showGoals) goals.hidden = !showGoals;
    side.classList.toggle('is-empty', !showProx && !showGoals);
    if (showProx) {
      this._proxT = (this._proxT || 0) - dt;
      if (this._proxT <= 0) {
        this._proxT = 0.3;
        this._renderProximity(game);
      }
    }
    if (showGoals) {
      // upstairs (Second Floor update): Floor 2's chain until someone reaches the ground floor
      const f2 = !game.floor1Reached ? game.floor2?.objectives?.() : null;
      this._renderFloor2Goals(f2?.length ? f2 : null);
    }
    if (showGoals && !this._f2GoalsOn) {
      const items = inv?.items ? [...inv.items] : [];
      const revealed = !!game.world?.room000Revealed;
      const escaped = game.state === 'escaping' || game.state === 'won';
      const fuseHint = this._fuseHint(game, items);
      const key = `${items.sort().join(',')}|${revealed}|${escaped}|${fuseHint}|${this._invHints?.keycard || ''}`;
      if (key !== this._goalsKey) {
        const first = this._goalsKey === undefined;
        this._goalsKey = key;
        this._renderGoals(items, revealed, escaped, !first, fuseHint);
      }
    }
  }

  /**
   * The fuse was hard to find (beta). After FUSE_HINT_AFTER seconds without it, the checklist names
   * its room ("In the Caretaker's Store"); the corridor signs carry a fuse sticker pointing there.
   */
  _fuseHint(game, items) {
    if (items.includes('fuse')) return '';
    if (this._invHints?.fuse) return `In the ${this._invHints.fuse} (SCHOOLNET)`;
    const limit = game.difficulty?.timeLimit;
    if (!Number.isFinite(limit) || !Number.isFinite(game.timeLeft) || limit - game.timeLeft < FUSE_HINT_AFTER) return '';
    const room = game.world?.itemRooms?.fuse;
    if (!room?.name) return '';
    const same = (game.world.rooms || []).filter((r) => r.name === room.name).length;
    return same > 1 ? `In a ${room.name}. Follow the fuse signs` : `In the ${room.name}`;
  }

  /** Walking distance (around walls, through doors) from the caretaker to the player. */
  _caretakerDistance(enemy, player) {
    const a = enemy.position;
    const b = player.position;
    const straight = Math.hypot(a.x - b.x, a.z - b.z);
    const nav = enemy.nav;
    if (straight < 3 || !nav?.nav) return straight;
    this._proxPath ||= new Float32Array(256);
    const n = nav.findPath(a.x, a.z, b.x, b.z, this._proxPath, 128);
    return n && !nav.lastPartial && Number.isFinite(nav.lastLength) ? Math.max(straight, nav.lastLength) : straight * 1.4;
  }

  _renderProximity(game) {
    const player = game.player;
    const el = this.el;
    // the card follows the enemy on the player's own floor (Caretaker downstairs, the lunch monitor upstairs)
    const pf = player?.floor ?? game.world?.floorOf?.(player?.position) ?? 0;
    const upstairs = pf === 1 && !!game.assistant;
    const enemy = upstairs ? game.assistant : game.enemy;
    const title = upstairs ? 'The lunch monitor' : 'Caretaker';
    if (this._proxTitle !== title) {
      this._proxTitle = title;
      const t = el.prox.querySelector('.hud-side__title');
      if (t) t.textContent = title;
      el.prox.setAttribute('aria-label', title);
    }
    let level = 0;
    let word = 'Somewhere in the building';
    let metres = '';
    let state = '';
    let hunting = false;
    if (enemy?.enabled && player?.position && enemy.position) {
      const d = this._caretakerDistance(enemy, player);
      level = d < 6 ? 5 : d < 12 ? 4 : d < 20 ? 3 : d < 32 ? 2 : d < 48 ? 1 : 0;
      word = PROX_WORDS[level];
      metres = `${Math.round(d)} m`;
      const s = enemy.state;
      hunting = s === 'CHASE' || s === 'CAPTURE';
      if (s === 'PATROL' && enemy.isStalking) state = 'Watching you';
      else if (s === 'CHASE' && enemy.winded) state = 'Out of breath. Run!';
      else state = PROX_STATES[s] || '';
    } else if (game.state === 'playing') {
      state = 'Not moving yet';
    }
    // the other floor's enemy, in a word: footsteps through the ceiling should have an owner (beta)
    const other = upstairs ? game.enemy : pf === 0 ? game.assistant : null;
    if (other?.enabled && game.state === 'playing') state = state ? `${state} · ${upstairs ? 'Caretaker: downstairs' : 'Lunch monitor: upstairs'}` : upstairs ? 'Caretaker: downstairs' : 'Lunch monitor: upstairs';
    const key = `${level}|${word}|${metres}|${state}|${hunting}|${title}`;
    if (key === this._proxKey) return;
    this._proxKey = key;
    el.prox.dataset.level = String(level);
    el.prox.classList.toggle('is-hunting', hunting);
    el.proxWord.textContent = word;
    el.proxM.textContent = metres;
    el.proxState.textContent = state;
  }

  /** The HUD checklist while upstairs: game.floor2.objectives() replaces the ground-floor list. */
  /** Draw the eye to the checklist for a moment (the opening beat on Floor 2). */
  flashGoals() {
    const box = this.el?.goals;
    if (!box) return;
    box.classList.remove('is-flash');
    void box.offsetWidth;
    box.classList.add('is-flash');
    clearTimeout(this._flashT);
    this._flashT = setTimeout(() => box.classList.remove('is-flash'), 4200);
  }

  _renderFloor2Goals(list) {
    const box = this.el.goals;
    if (!box) return;
    const classic = box.querySelector('.hud-goals__list:not(.hud-goals__list--f2)');
    let ul = box.querySelector('.hud-goals__list--f2');
    const on = !!list;
    if (on !== !!this._f2GoalsOn) {
      this._f2GoalsOn = on;
      if (classic) classic.hidden = on;
      if (ul) ul.hidden = !on;
      if (!on) this._goalsKey = undefined; // the classic list redraws (and animates) from scratch
    }
    if (!on) return;
    const key = list.map((g) => `${g.id}:${g.done ? 1 : 0}${g.active ? 1 : 0}:${g.text}:${g.hint || ''}`).join('|');
    if (key === this._f2Key) return;
    const first = this._f2Key === undefined || !ul;
    this._f2Key = key;
    if (!ul) {
      ul = document.createElement('ul');
      ul.className = 'hud-goals__list hud-goals__list--f2';
      box.appendChild(ul);
    }
    const old = new Map([...ul.children].map((li) => [li.dataset.goal, li]));
    ul.textContent = '';
    for (const g of list) {
      const li = document.createElement('li');
      li.dataset.goal = g.id;
      const boxEl = document.createElement('span');
      boxEl.className = 'hud-goals__box';
      const text = document.createElement('span');
      text.className = 'hud-goals__text';
      const b = document.createElement('b');
      b.textContent = g.text;
      const small = document.createElement('small');
      small.textContent = g.hint || '';
      text.append(b, small);
      li.append(boxEl, text);
      li.classList.toggle('is-done', !!g.done);
      li.classList.toggle('is-active', !g.done && !!g.active);
      li.classList.toggle('is-locked', !g.done && !g.active);
      const prev = old.get(g.id);
      const changed = !prev || prev.classList.contains('is-done') !== !!g.done || prev.classList.contains('is-active') !== (!g.done && !!g.active);
      if (!first && changed && (g.done || g.active)) li.classList.add('is-new');
      ul.appendChild(li);
    }
  }

  _renderGoals(items, revealed, escaped, animate, fuseHint = '') {
    const has = (id) => items.includes(id);
    const all = ITEM_IDS.every(has);
    const goals = {
      keycard: { done: has('keycard'), active: true, hint: this._invHints?.keycard ? `In the ${this._invHints.keycard} (SCHOOLNET)` : 'Library or reception' },
      fuse: { done: has('fuse'), active: true, hint: fuseHint || 'Storage room or science lab' },
      key: { done: has('key'), active: revealed, hint: revealed ? 'Inside Room 000' : 'Room 000 opens after two items' },
      exit: { done: escaped, active: all, hint: all ? 'Go to reception and use the doors' : 'In reception. Needs all three.' },
    };
    for (const li of this.el.goals.querySelectorAll('li[data-goal]')) {
      const g = goals[li.dataset.goal];
      if (!g) continue;
      const wasDone = li.classList.contains('is-done');
      const wasActive = li.classList.contains('is-active');
      li.classList.toggle('is-done', g.done);
      li.classList.toggle('is-active', !g.done && g.active);
      li.classList.toggle('is-locked', !g.done && !g.active);
      let hintChanged = false;
      if (g.hint) {
        const small = li.querySelector('small');
        hintChanged = small.textContent !== g.hint;
        if (hintChanged) small.textContent = g.hint;
      }
      if (animate && ((g.done && !wasDone) || (!g.done && g.active && (!wasActive || hintChanged)))) {
        li.classList.remove('is-new');
        void li.offsetWidth;
        li.classList.add('is-new');
      }
    }
  }

  // ================================================================ update ==
  update(dt, game = this.game) {
    if (!this._hudVisible) return;
    const p = game.player;
    // a note / the register card closes when you walk away from it (or after a while)
    if (this._card) {
      this._card.t -= dt;
      const a = this._card.anchor;
      if (this._card.t <= 0 || (a && p && Math.hypot(p.position.x - a.x, p.position.z - a.z) > 2.8) || game.state !== 'playing') this.hideCard();
    }

    // --- easy mode: the minimap
    if (this.el.mapCanvas) {
      this._minimap ||= new Minimap(game, this.el.mapCanvas);
      const on = this._minimap.update();
      if (this.el.map.hidden === on) this.el.map.hidden = !on;
    }

    // --- clock
    if (Number.isFinite(game.timeLeft)) {
      if (this.el.clock.hidden) this.el.clock.hidden = false;
      const txt = formatTime(game.timeLeft);
      const limit = game.difficulty?.timeLimit || DIFFICULTY[this.settings.difficulty]?.timeLimit || 420;
      if (txt !== this._lastTimeText) {
        this._lastTimeText = txt;
        this.el.time.textContent = txt;
        this.el.timeBar.style.transform = `scaleX(${clamp(game.timeLeft / limit, 0, 1)})`;
        this.el.clock.classList.toggle('is-low', game.timeLeft <= 60);
      }
    } else if (!this.el.clock.hidden) this.el.clock.hidden = true;

    // --- your microphone, while the caretaker can hear it
    const mic = game.mic;
    const micOn = !!(mic?.enabled && game.state === 'playing');
    if (this.el.mic && this.el.mic.hidden === micOn) this.el.mic.hidden = !micOn;
    if (micOn) {
      const lv = Math.round(mic.level * 20) / 20;
      if (lv !== this._micLv) {
        this._micLv = lv;
        this.el.mic.style.setProperty('--lv', lv);
      }
      if (mic.heard !== this._micHeard) {
        this._micHeard = mic.heard;
        this.el.mic.classList.toggle('is-heard', mic.heard);
      }
    }

    // --- inventory (in case an event was missed; cheap length check first)
    const inv = p?.inventory || game.inventory;
    if (inv?.items && inv.items.length !== this._invLen) {
      this._invLen = inv.items.length;
      const items = [...inv.items];
      if (items.join(',') !== this._invKey) this._renderInventory(items, true);
    }

    // --- sidebar: caretaker distance + escape checklist
    this._updateSide(dt, game, inv);

    // --- torch slot: on/off, battery level; the label shows briefly at the start and on changes
    if (p) {
      const on = !!p.flashlightOn && !p.isHidden;
      const lvl = p.torchLevel || 1;
      const key = `${on}|${lvl}`;
      if (key !== this._torchKey) {
        const first = this._torchKey === undefined;
        const upgraded = this._torchLvl !== undefined && lvl > this._torchLvl;
        this._torchKey = key;
        this._torchLvl = lvl;
        const t = this.el.torch;
        t.classList.toggle('is-on', on);
        t.classList.toggle('is-upgraded', lvl >= 2);
        this.el.torchLabel.textContent = lvl >= 2 ? (on ? 'Torch · bright' : 'Torch · off') : on ? 'Torch' : 'Torch · off';
        t.setAttribute('aria-label', `Torch: ${on ? 'on' : 'off'}${lvl >= 2 ? ', fresh batteries' : ''}`);
        if (upgraded) {
          t.classList.remove('is-new');
          void t.offsetWidth;
          t.classList.add('is-new');
        }
        if (first || upgraded || !on) {
          t.classList.add('is-revealed');
          clearTimeout(this._torchT);
          this._torchT = setTimeout(() => t.classList.remove('is-revealed'), first ? 6000 : 2500);
        }
      }
    }

    if (!p) return;

    // --- hiding overlay + crosshair + prompt
    const hidden = !!p.isHidden;
    const hideType = hidden ? p.hidingSpot?.type || 'locker' : this._lastHideType;
    if (hidden !== this._lastHidden || hideType !== this._lastHideType) {
      this._lastHidden = hidden;
      this._lastHideType = hideType;
      this.el.hide.dataset.type = ['locker', 'cupboard', 'desk'].includes(hideType) ? hideType : 'locker';
      this.el.hide.classList.toggle('is-on', hidden);
      this.el.dot.classList.toggle('is-hidden', hidden);
      this._renderHint(hidden, p);
      this._lastPrompt = undefined;
    }
    if (hidden) {
      const holding = !!p.holdingBreath;
      if (holding !== this._lastHolding) {
        this._lastHolding = holding;
        this._renderHint(true, p);
      }
    }

    let prompt = null;
    if (!hidden && game.state !== 'captured' && game.state !== 'escaping') {
      try {
        prompt = p.focused?.getPrompt?.(game) ?? null;
      } catch {
        prompt = null;
      }
    }
    if (prompt !== this._lastPrompt) {
      this._lastPrompt = prompt;
      if (prompt) {
        this.el.promptText.textContent = prompt;
        const disabled = /^locked\b|^(it's |it is )?locked/i.test(prompt) && !/^unlock/i.test(prompt);
        this.el.prompt.classList.toggle('is-disabled', disabled);
        this.el.prompt.classList.add('is-on');
        this.el.dot.classList.add('is-active');
      } else {
        this.el.prompt.classList.remove('is-on');
        this.el.dot.classList.remove('is-active');
      }
    }

    // --- stamina (or, while hidden, the breath you have left)
    const breathMode = hidden && (p.holdingBreath || (Number.isFinite(p.breath) && p.breath < 0.995));
    const st = breathMode ? p.breath : Number.isFinite(p.stamina) ? p.stamina : 1;
    const showSt = breathMode || (st < 0.995 && !hidden);
    const cls = this.el.stamina.classList;
    cls.toggle('is-on', showSt);
    cls.toggle('is-breath', breathMode);
    cls.toggle('is-low', breathMode && st < 0.3);
    cls.toggle('is-exhausted', !breathMode && !!p.exhausted);
    const stTxt = clamp(st, 0, 1).toFixed(3);
    if (stTxt !== this._lastSt) {
      this.el.staminaBar.style.transform = `scaleX(${stTxt})`;
      this._lastSt = stTxt;
    }

    // --- threat vignette
    let threat = 0;
    try {
      threat = clamp(Number(game.enemy?.getThreat?.()) || 0, 0, 1);
    } catch {
      threat = 0;
    }
    if (game.state === 'captured') threat = 1;
    if (!this.threatVignette) threat = 0;
    const k = 1 - Math.exp(-(dt || 0.016) * 4);
    this._threat += (threat - this._threat) * k;
    const t = this._threat;
    const op = t < 0.15 ? 0 : 0.7 * Math.min(1, ((t - 0.15) / 0.85) ** 0.9);
    const opTxt = op.toFixed(2);
    if (opTxt !== this._lastThreatOp) {
      this._lastThreatOp = opTxt;
      this.el.threat.style.opacity = opTxt;
    }
    const pulsing = t > 0.45;
    if (pulsing !== this._lastPulsing) {
      this._lastPulsing = pulsing;
      this.el.threat.classList.toggle('is-pulsing', pulsing);
    }
    if (pulsing) {
      const beat = (1.1 - 0.62 * t).toFixed(2);
      if (beat !== this._lastBeat) {
        this._lastBeat = beat;
        this.el.threat.style.setProperty('--pulse', `${beat}s`);
      }
    }
  }

  _renderHint(hidden, p) {
    const h = this.el.hint;
    if (!hidden) {
      h.classList.remove('is-on');
      return;
    }
    const where = p.hidingSpot?.type === 'desk' ? 'Crawl out' : 'Step out';
    const holding = !!p.holdingBreath;
    h.innerHTML = '';
    const a = document.createElement('span');
    a.innerHTML = `<kbd>E</kbd>${where}`;
    const b = document.createElement('span');
    b.innerHTML = holding ? '<kbd>Space</kbd>Holding your breath' : '<kbd>Space</kbd>Hold to hold your breath';
    if (holding) b.classList.add('is-active');
    h.append(a, b);
    h.classList.add('is-on');
  }

  dispose() {
    window.removeEventListener('keydown', this._onKey);
    for (const off of this._subs) off();
    for (const t of this._timers) clearTimeout(t);
  }
}
