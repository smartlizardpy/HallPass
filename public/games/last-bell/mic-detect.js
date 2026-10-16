// LAST BELL - the microphone as something the caretaker can hear. Opt-in: settings.micHearing (off by
// default). Owned by the main agent.
//
// Switching it on asks for the microphone. The sound never leaves this device: it is only measured.
// Echo cancellation keeps the game's own sound (through the speakers) out of it, a voice-band filter
// (MIC.lowHz..MIC.highHz) ignores rumble and hiss, and a noise floor that follows the room keeps a fan
// or a busy room from counting. Sound that stands MIC.overFloor dB above that floor and is louder than
// MIC.quiet dBFS, for at least MIC.minMs (gaps shorter than MIC.holdMs don't count as silence, so a
// sentence is one sound), becomes a 'noise' event at the player (source 'voice'), at most every
// MIC.every seconds. Its radius grows with the loudest moment since the last one:
//   a whisper: nothing · talking: about 6–9 m (walking is 6) · raised voice: ~12 m · shouting: MIC.radiusMax m
// (his hearing still scales it by difficulty, and walls by 0.7). Inside a hiding place × MIC.hiddenMul.
// Co-op: separate from voice chat, so muting your voice chat doesn't hide you from him; a guest's
// noise reaches the host's caretaker the way footsteps do (coop.js forwards 'noise').
//
//   const mic = new MicHearing(game)
//   mic.setEnabled(bool)       follows the setting; asks for the mic (if refused, the setting goes off)
//   mic.update(dt)             per frame, while playing
//   mic.level / mic.heard      0..1 for the HUD meter / true while he could hear you
//
// Emits: noise { position, radius, source: 'voice' }, tip { id: 'mic' } (first time it hears you).

import { MIC } from './config.js';

const clamp01 = (x) => Math.max(0, Math.min(1, x));

export class MicHearing {
  constructor(game) {
    this.game = game;
    this.enabled = false;
    this.level = 0; // 0..1 (MIC.quiet .. MIC.loud dBFS), for the HUD meter
    this.heard = false; // he could hear this right now
    this._stream = null;
    this._nodes = null; // { src, hp, lp, an, buf }
    this._asking = null;
    this._floor = -70; // dBFS: the room's own background, follows it
    this._overMs = 0; // how long the sound has been loud enough
    this._quietMs = 0; // … and how long since it last was
    this._peakDb = -120; // the loudest since the last noise event
    this._sinceEmit = 1;
    this._tipped = false;
  }

  /** Follows settings.micHearing. Turning it on asks for the microphone (once per page). */
  setEnabled(on) {
    on = !!on;
    if (on === this.enabled) return;
    this.enabled = on;
    if (!on) return this._close();
    if (this._stream || this._asking) return;
    const md = typeof navigator !== 'undefined' && navigator.mediaDevices;
    if (!md?.getUserMedia) return this._refused('This browser has no microphone access.');
    this._asking = md
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false }, video: false })
      .then((stream) => {
        this._asking = null;
        if (!this.enabled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        this._stream = stream;
        this.game.ui?.showNotice?.('Microphone on: the caretaker can hear you now. Whisper.', 4);
      })
      .catch((err) => {
        this._asking = null;
        const blocked = err?.name === 'NotAllowedError' || err?.name === 'SecurityError';
        this._refused(blocked ? 'The microphone was blocked, so the caretaker can\'t hear you.' : 'No microphone was found.');
      });
  }

  _refused(message) {
    this.enabled = false;
    this._close();
    const ui = this.game.ui;
    if (ui?.settings) {
      ui.settings.micHearing = false; // the toggle flips back
      ui.refreshSettings?.();
      ui._commitSettings?.();
    }
    ui?.showNotice?.(message, 4);
  }

  _close() {
    try {
      this._nodes?.src.disconnect();
    } catch {
      /* ignore */
    }
    this._nodes = null;
    this._stream?.getTracks().forEach((t) => t.stop());
    this._stream = null;
    this.level = 0;
    this.heard = false;
    this._overMs = 0;
    this._peakDb = -120;
  }

  /** The analyser chain, as soon as both the stream and the audio engine exist. */
  _wire() {
    if (this._nodes || !this._stream) return this._nodes;
    const ctx = this.game.audio?.ctx;
    if (!ctx) return null;
    try {
      const src = ctx.createMediaStreamSource(this._stream);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = MIC.lowHz;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = MIC.highHz;
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      src.connect(hp);
      hp.connect(lp);
      lp.connect(an); // measured only, never played back
      this._nodes = { src, hp, lp, an, buf: new Float32Array(an.fftSize) };
    } catch (err) {
      console.warn('[mic]', err);
      this._nodes = null;
    }
    return this._nodes;
  }

  /** Per frame while playing. */
  update(dt) {
    const g = this.game;
    const n = this.enabled ? this._wire() : null;
    if (!n) {
      this.level = 0;
      this.heard = false;
      return;
    }
    n.an.getFloatTimeDomainData(n.buf);
    let sum = 0;
    for (let i = 0; i < n.buf.length; i++) sum += n.buf[i] * n.buf[i];
    const db = 20 * Math.log10(Math.sqrt(sum / n.buf.length) + 1e-9);
    // the room's background: drops at once, creeps up slowly (so a long sentence doesn't raise it much)
    this._floor = db < this._floor ? db : Math.min(this._floor + MIC.floorRise * dt, MIC.quiet);
    this.level = clamp01((db - MIC.quiet) / (MIC.loud - MIC.quiet));
    const pl = g.player;
    // (at a SCHOOLNET computer the player is frozen, but he can still hear you)
    const live = g.state === 'playing' && !g.coopPaused && (pl?.enabled !== false || !!g.schoolnet?.isOpen) && !pl?.seated && (!g.coop?.active || g.coop.status === 'alive');
    const loud = live && db > MIC.quiet && db > this._floor + MIC.overFloor;
    if (loud) {
      this._overMs += dt * 1000;
      this._quietMs = 0;
      this._peakDb = Math.max(this._peakDb, db);
    } else if ((this._quietMs += dt * 1000) > MIC.holdMs || !live) {
      this._overMs = 0;
      this._peakDb = -120;
    }
    this.heard = live && this._overMs >= MIC.minMs;
    this._sinceEmit += dt;
    if (!this.heard || this._sinceEmit < MIC.every || this._peakDb <= MIC.quiet) return;
    const t = clamp01((this._peakDb - MIC.quiet) / (MIC.loud - MIC.quiet));
    let r = MIC.radiusMin + (MIC.radiusMax - MIC.radiusMin) * Math.pow(t, MIC.curve);
    if (pl?.isHidden) r *= MIC.hiddenMul;
    this._sinceEmit = 0;
    this._peakDb = -120;
    g.events?.emit('noise', { position: pl.position.clone(), radius: r, source: 'voice' });
    if (!this._tipped) {
      this._tipped = true;
      g.events?.emit('tip', { id: 'mic' });
    }
  }

  dispose() {
    this.enabled = false;
    this._close();
  }
}
