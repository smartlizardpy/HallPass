// LAST BELL — achievements. Each one is earned from a game "moment" (the same names game.js sends to HallPass
// as beta moments) or a game event, then unlocked with HallPass.unlock(key) and shown as an in-game toast.
//
//   game.ach.moment(name, data)   called by game.js's hpMoment() for every moment
//   game.ach.unlock(key)          earn one directly
//
// HallPass only records unlocks for signed-in players and only for keys an admin has provisioned for the game
// (ACHIEVEMENTS.sql has the catalogue). So the toast does not wait on HallPass: a local record
// (localStorage lastbell.ach.v1) says what this browser has earned, and each key is sent to HallPass once per
// page load (unlock() is idempotent on their side).

export const CATALOGUE = [
  { key: 'first-escape', name: 'Last Out', description: 'Escape the school.', icon: '🔔', points: 10 },
  { key: 'quick-escape', name: 'Early Bell', description: 'Escape with at least half your time left.', icon: '⏱️', points: 20 },
  { key: 'hard-escape', name: 'Hard Detention', description: 'Escape on Hard.', icon: '💀', points: 30 },
  { key: 'full-set', name: 'Full Set', description: 'Collect the keycard, the fuse and the exit key.', icon: '🎒', points: 10 },
  { key: 'detention', name: 'Detention', description: 'Get caught and dragged to Room 000.', icon: '🚪', points: 10 },
  { key: 'out-of-breath', name: 'Out of Breath', description: 'Outrun him until he has to stop and wheeze.', icon: '😮‍💨', points: 15 },
  { key: 'on-the-tannoy', name: 'On the Tannoy', description: 'Use a SchoolNet computer to broadcast over the PA.', icon: '📻', points: 10 },
  { key: 'signed-out', name: 'Signed Out', description: 'Sign the Room 000 register and call off the hunt.', icon: '🖊️', points: 15 },
  { key: 'nobody-left-behind', name: 'Nobody Left Behind', description: 'Let a friend out of Room 000.', icon: '🤝', points: 20 },
  { key: 'all-out-together', name: 'All Out Together', description: 'Everyone in the team escapes.', icon: '👥', points: 25 },
  { key: 'doner-kebab', name: 'Unfunded Policy', description: 'Vote Ozzy, find the döner shop and eat the döner.', icon: '🥙', points: 15 },
  { key: 'egemen-was-here', name: 'Egemen Was Here', description: 'Spot the glowing tag in the dark.', icon: '🔦', points: 15, secret: true },
  { key: 'down-bad', name: 'Down Bad', description: 'Get caught by the lunch monitor.', icon: '🍎', points: 10, secret: true },
  { key: 'enormous-burp', name: 'Enormous Burp', description: 'Get close enough to hear it.', icon: '💨', points: 10, secret: true },
];
const BY_KEY = new Map(CATALOGUE.map((a) => [a.key, a]));
const STORE_KEY = 'lastbell.ach.v1';

function load() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    return new Set(Array.isArray(v) ? v.filter((k) => BY_KEY.has(k)) : []);
  } catch {
    return new Set();
  }
}

export class Achievements {
  constructor(game) {
    this.game = game;
    this.earned = load();
    this._sent = new Set(); // keys already sent to HallPass this page load
    this._queue = [];
    this._showing = false;
    this._el = null;
  }

  /** A game moment (game.js hpMoment). `data`: t, left, items, diff, … plus the moment's own fields. */
  moment(name, d = {}) {
    const g = this.game;
    switch (name) {
      case 'escaped': {
        this.unlock('first-escape');
        const limit = g.difficulty?.timeLimit || 420;
        if ((Number(d.left) || 0) >= limit / 2) this.unlock('quick-escape');
        if (d.diff === 'hard') this.unlock('hard-escape');
        break;
      }
      case 'item-collected':
        if ((Number(d.items) || 0) >= 3) this.unlock('full-set');
        break;
      case 'doner-eaten':
        this.unlock('doner-kebab');
        break;
      case 'captured':
        this.unlock('detention');
        break;
      case 'easter-egg':
        if (!d.egg || d.egg === 'egemen') this.unlock('egemen-was-here');
        break;
      case 'pa-broadcast':
        this.unlock('on-the-tannoy');
        break;
      case 'register':
        this.unlock('signed-out');
        break;
      case 'rescue':
        this.unlock('nobody-left-behind');
        break;
      case 'team-escape':
        this.unlock('all-out-together');
        break;
      case 'winded':
        this.unlock('out-of-breath');
        break;
      case 'down-bad':
        this.unlock('down-bad');
        break;
      case 'big-burp':
        this.unlock('enormous-burp');
        break;
    }
  }

  unlock(key) {
    const a = BY_KEY.get(key);
    if (!a) return;
    if (!this._sent.has(key)) {
      this._sent.add(key);
      try {
        const p = window.HallPass?.unlock?.(key);
        if (p && p.catch) p.catch(() => {});
      } catch {
        /* the SDK is optional */
      }
    }
    if (this.earned.has(key)) return;
    this.earned.add(key);
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify([...this.earned]));
    } catch {
      /* storage blocked: it just shows again next time */
    }
    this._queue.push(a);
    this._next();
  }

  _next() {
    if (this._showing || !this._queue.length) return;
    const a = this._queue.shift();
    this._showing = true;
    const el = (this._el ||= this._build());
    el.querySelector('.ach__icon').textContent = a.icon;
    el.querySelector('.ach__name').textContent = a.name;
    el.querySelector('.ach__desc').textContent = a.description;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('is-on'));
    try {
      this.game.audio?.play?.('ui_select');
    } catch {
      /* silent */
    }
    setTimeout(() => {
      el.classList.remove('is-on');
      setTimeout(() => {
        el.hidden = true;
        this._showing = false;
        this._next();
      }, 450);
    }, 4600);
  }

  _build() {
    const el = document.createElement('div');
    el.className = 'ach';
    el.hidden = true;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<span class="ach__icon" aria-hidden="true"></span><span class="ach__text"><b class="ach__kicker">Achievement unlocked</b><b class="ach__name"></b><small class="ach__desc"></small></span>';
    document.body.append(el);
    return el;
  }
}
