// LAST BELL - tablet / touch controls. Owned by the main agent.
//
// Active when the device's primary pointer is touch (iPad, Android tablets), or with ?touch=1
// (?touch=0 forces it off). Adds `touch` to <html> (CSS shows the touch UI and hides key hints).
//
//   left half   a joystick appears under the thumb: move; push it to the rim to run
//   right half  drag to look
//   buttons     Use (E), Torch (F), Crouch (C), Breath (hold, only while hidden), Pause
//
// No pointer lock on touch: Player.setTouchMode(true) makes lockPointer() a no-op and allows
// look input without a lock, so the "Click to resume" overlay never appears. The first start /
// resume tap also asks for fullscreen (ignored where the browser refuses).

export const TOUCH_MODE = (() => {
  try {
    const q = new URLSearchParams(location.search).get('touch');
    if (q === '1') return true;
    if (q === '0') return false;
    return matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0;
  } catch {
    return false;
  }
})();

const STICK_R = 62; // px: joystick travel
const DEAD = 0.12;
const RUN_AT = 0.95; // of STICK_R
const LOOK_GAIN = 1.35; // touch px -> the player's mouse-px look units

const ICON = {
  use: '<svg viewBox="0 0 32 32"><path d="M11 17V8.5a2 2 0 0 1 4 0V15m0-1.5a2 2 0 0 1 4 0V16m0-1a2 2 0 0 1 4 0v3c0 5-3 9-8 9h-1c-3 0-5-2-7-5l-3-5a2 2 0 0 1 3.4-2.1L11 17"/></svg>',
  torch: '<svg viewBox="0 0 32 32"><path d="M5 13.5h12l4-3v11l-4-3H5z"/><path d="M21 10.5h2.5v11H21"/><path d="M25.5 12.5l4-2.5M26 16h4M25.5 19.5l4 2.5"/></svg>',
  crouch: '<svg viewBox="0 0 32 32"><circle cx="16" cy="7" r="3"/><path d="M16 10.5v7l-6 3.5 3 6M16 17.5l6 2-1 7M11 13.5l5-1 5 2"/></svg>',
  breath: '<svg viewBox="0 0 32 32"><path d="M6 12h13a3 3 0 1 0-3-3M6 17h18a3 3 0 1 1-3 3M6 22h8"/></svg>',
  pause: '<svg viewBox="0 0 32 32"><path d="M11 8v16M21 8v16"/></svg>',
};

export class TouchControls {
  constructor(game) {
    this.game = game;
    this.active = TOUCH_MODE;
    if (!this.active) return;
    document.documentElement.classList.add('touch');
    game.player?.setTouchMode?.(true);
    this._stick = null; // { id, ox, oy }
    this._look = null; // { id, x, y }
    this._breath = null; // pointer id holding the breath button
    this._build();
    this._bind();
  }

  _build() {
    const root = document.createElement('div');
    root.id = 'touch-ui';
    root.className = 'touch-ui';
    root.hidden = true;
    root.innerHTML = `
      <div class="touch-stick" aria-hidden="true"><span class="touch-stick__knob"></span></div>
      <button class="touch-btn touch-btn--pause" data-touch="pause" aria-label="Pause">${ICON.pause}</button>
      <button class="touch-btn touch-btn--use" data-touch="use" aria-label="Use">${ICON.use}<span>Use</span></button>
      <button class="touch-btn touch-btn--torch" data-touch="torch" aria-label="Torch">${ICON.torch}<span>Torch</span></button>
      <button class="touch-btn touch-btn--crouch" data-touch="crouch" aria-label="Crouch">${ICON.crouch}<span>Crouch</span></button>
      <button class="touch-btn touch-btn--breath" data-touch="breath" aria-label="Hold breath" hidden>${ICON.breath}<span>Hold</span></button>
      <button class="touch-btn touch-btn--gadget" data-touch="gadget" aria-label="Put down Kaan's PlayStation" hidden><b>PS</b><span>Drop</span></button>
    `;
    const rotate = document.createElement('div');
    rotate.id = 'touch-rotate';
    rotate.className = 'touch-rotate';
    rotate.innerHTML = '<p><strong>Turn your tablet sideways</strong>LAST BELL plays in landscape.</p>';
    const host = document.getElementById('ui') || document.body;
    host.append(root, rotate);
    this.root = root;
    this.stickEl = root.querySelector('.touch-stick');
    this.knobEl = root.querySelector('.touch-stick__knob');
    this.btn = {};
    for (const b of root.querySelectorAll('[data-touch]')) this.btn[b.dataset.touch] = b;
  }

  _bind() {
    const g = this.game;
    const ev = g.events;
    const p = () => g.player;
    ev?.on('game:state', ({ state } = {}) => {
      this.root.hidden = !this._wanted(state);
      if (state !== 'playing') this._releaseAll();
    });
    // fullscreen needs a user gesture: ui:start / ui:resume are emitted inside the tap
    const full = () => {
      const el = document.documentElement;
      if (document.fullscreenElement || document.webkitFullscreenElement) return;
      try {
        const r = (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el, { navigationUI: 'hide' });
        r?.catch?.(() => {});
      } catch { /* not allowed here */ }
    };
    // at a SCHOOLNET computer the screen takes the taps (and the on-screen keyboard)
    ev?.on('schoolnet:open', () => {
      this.root.hidden = true;
      this._releaseAll();
    });
    ev?.on('schoolnet:close', () => {
      this.root.hidden = !this._wanted(g.state);
    });
    ev?.on('schoolnet:gadget', ({ has } = {}) => {
      this.btn.gadget.hidden = !has;
    });
    ev?.on('ui:start', full);
    ev?.on('ui:resume', full);
    ev?.on('ui:restart', full);

    // buttons act on touch-down (no 300 ms click delay, works while the other thumb is moving)
    const press = (name, e) => {
      e.preventDefault();
      e.stopPropagation();
      const pl = p();
      if (!pl || g.state !== 'playing') return;
      if (name === 'use') pl._keyPressed?.('KeyE');
      else if (name === 'torch') pl._keyPressed?.('KeyF');
      else if (name === 'crouch') pl._keyPressed?.('KeyC');
      else if (name === 'gadget') pl._keyPressed?.('KeyG');
      else if (name === 'pause') ev?.emit('ui:pause', {});
      else if (name === 'breath') {
        this._breath = e.pointerId;
        pl.setTouchBreath?.(true);
      }
    };
    for (const [name, b] of Object.entries(this.btn)) {
      b.addEventListener('pointerdown', (e) => press(name, e));
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    const r = this.root;
    r.addEventListener('pointerdown', (e) => {
      if (e.target.closest('[data-touch]')) return;
      e.preventDefault();
      const left = e.clientX < window.innerWidth * 0.45;
      if (left && !this._stick) {
        this._stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
        this.stickEl.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
        this.stickEl.classList.add('is-on');
        this.knobEl.style.transform = 'translate(0px, 0px)';
      } else if (!left && !this._look) {
        this._look = { id: e.pointerId, x: e.clientX, y: e.clientY };
      }
      try { r.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    });
    r.addEventListener('pointermove', (e) => {
      if (this._stick && e.pointerId === this._stick.id) {
        let dx = e.clientX - this._stick.ox;
        let dy = e.clientY - this._stick.oy;
        const d = Math.hypot(dx, dy);
        if (d > STICK_R) {
          dx *= STICK_R / d;
          dy *= STICK_R / d;
        }
        this.knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
        let x = dx / STICK_R;
        let y = -dy / STICK_R;
        const m = Math.hypot(x, y);
        if (m < DEAD) x = y = 0;
        const run = d >= STICK_R * RUN_AT;
        this.stickEl.classList.toggle('is-run', run);
        p()?.setTouchMove?.(x, y, run);
      } else if (this._look && e.pointerId === this._look.id) {
        const dx = e.clientX - this._look.x;
        const dy = e.clientY - this._look.y;
        this._look.x = e.clientX;
        this._look.y = e.clientY;
        p()?.addLook?.(dx * LOOK_GAIN, dy * LOOK_GAIN);
      }
    });
    const end = (e) => {
      if (this._stick && e.pointerId === this._stick.id) {
        this._stick = null;
        this.stickEl.classList.remove('is-on', 'is-run');
        p()?.setTouchMove?.(0, 0, false);
      }
      if (this._look && e.pointerId === this._look.id) this._look = null;
    };
    r.addEventListener('pointerup', end);
    r.addEventListener('pointercancel', end);
    // the breath button is held: release wherever the finger lifts
    const endBreath = (e) => {
      if (this._breath !== null && e.pointerId === this._breath) {
        this._breath = null;
        p()?.setTouchBreath?.(false);
      }
    };
    window.addEventListener('pointerup', endBreath);
    window.addEventListener('pointercancel', endBreath);
  }

  _releaseAll() {
    this._stick = null;
    this._look = null;
    this._breath = null;
    this.stickEl?.classList.remove('is-on', 'is-run');
    this.game.player?.setTouchMove?.(0, 0, false);
    this.game.player?.setTouchBreath?.(false);
  }

  /**
   * Whether the controls belong on screen: only while playing, not at a SCHOOLNET computer, and not
   * in co-op's pause menu (co-op never leaves 'playing', so game:state alone misses that menu, and
   * the controls, which cover the whole screen, would take every tap meant for its buttons).
   */
  _wanted(state = this.game.state) {
    const g = this.game;
    return state === 'playing' && !g.coopPaused && !g.schoolnet?.isOpen;
  }

  /** Per frame: co-op's pause menu comes and goes; button states follow the player. */
  update() {
    if (!this.active) return;
    const coopPaused = !!this.game.coopPaused;
    if (coopPaused !== !!this._coopPaused) {
      this._coopPaused = coopPaused;
      this.root.hidden = !this._wanted();
      if (coopPaused) this._releaseAll();
    }
    if (this.root.hidden) return;
    const pl = this.game.player;
    if (!pl) return;
    const hidden = !!pl.isHidden;
    const key = `${!!pl.focused && !hidden}|${hidden}|${!!pl.flashlightOn}|${!!pl.isCrouching}|${!!pl.holdingBreath}`;
    if (key === this._key) return;
    this._key = key;
    this.btn.use.classList.toggle('is-ready', (!!pl.focused && !hidden) || hidden);
    this.btn.use.querySelector('span').textContent = hidden ? 'Leave' : 'Use';
    this.btn.breath.hidden = !hidden;
    this.btn.breath.classList.toggle('is-on', !!pl.holdingBreath);
    this.btn.torch.classList.toggle('is-on', !!pl.flashlightOn);
    this.btn.torch.hidden = hidden;
    this.btn.crouch.classList.toggle('is-on', !!pl.isCrouching);
    this.btn.crouch.hidden = hidden;
  }
}
