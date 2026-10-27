// LAST BELL — The Halloween Shift: the player whispers Al-Fatiha when they see the Watcher.
//
// The first clear sighting of a run (the opening glimpse counts) makes the player start reciting Al-Fatiha
// under their breath, ayah by ayah, in the subtitles. If a recording is installed (assets/audio/player_fatiha.mp3,
// listed in assets/audio/manifest.json "available" as player_fatiha), it plays and the subtitles follow it;
// without one there is no voice at all (no speechSynthesis fallback). The file is a real recording, or an
// ElevenLabs take checked word by word (ELEVENLABS_ASSET_REQUESTS.md, request 23).
//
// Respect, as rules in code:
//   - while it lasts the director starts nothing and no loud hit can land (director.reciting: canSting is false,
//     the aftershock is dropped); the arc resumes ~10 s after the amin. The recitation is never a set-up.
//   - it is never cut for a scare; only the run ending, a capture or a Caretaker chase stops it.
//   - at most every 2.5 minutes, three times a run.
//
// API: mode.recite.saw(reason)  a sighting (the opening calls it; mode.update reports Watcher sightings)
//      update(dt)  /  stop()  /  get active

const AYAT = [
  ['Bismillahir-rahmanir-rahim', 3.0],
  ["Alhamdu lillahi rabbil-'alamin", 3.4],
  ['Ar-rahmanir-rahim', 2.4],
  ['Maliki yawmid-din', 2.4],
  ["Iyyaka na'budu wa iyyaka nasta'in", 3.6],
  ['Ihdinas-siratal-mustaqim', 3.0],
  ["Siratal-ladhina an'amta 'alayhim, ghayril-maghdubi 'alayhim wa lad-dallin", 6.2],
  ['Amin', 1.4],
];
const GAP = 0.35; // a breath between ayat
const SPEAKER = 'You (whispering)';
const COOLDOWN = 150;
const MAX_PER_RUN = 3;
const FILE_ID = 'player_fatiha';

export class Recite {
  constructor(mode) {
    this.mode = mode;
    this.reset();
  }

  reset() {
    this.stop();
    this.count = 0;
    this.lastEnd = -1e9;
    this.clock = 0;
    this.pendingAt = null;
  }

  get g() {
    return this.mode.game;
  }

  get active() {
    return !!this.cues;
  }

  /** A sighting: start a little after it (the gasp first), unless it is too soon or too often. */
  saw(reason = 'watcher') {
    if (this.active || this.pendingAt != null) return false;
    if (this.count >= MAX_PER_RUN || this.clock - this.lastEnd < COOLDOWN) return false;
    this.pendingAt = this.clock + (reason === 'glimpse' ? 1.6 : 1.1);
    this.reason = reason;
    return true;
  }

  update(dt) {
    this.clock += dt;
    const m = this.mode, g = this.g;
    let chase = false;
    try {
      chase = !!m.director?.info?.().chase;
    } catch {
      /* no Caretaker yet */
    }
    if (this.pendingAt != null && this.clock >= this.pendingAt) {
      // not over the PA (the intro announcement plays in the first ~20 s) and not inside a glimpse
      const pa = (g.audio?._annBusyUntil || 0) > performance.now();
      this.heldSince ??= this.clock;
      if ((pa || m.director?._glimpsing) && this.clock - this.heldSince < 30) this.pendingAt = this.clock + 0.5;
      else {
        this.pendingAt = null;
        this.heldSince = null;
        if (!chase && g.state === 'playing' && !m.finished) this._start();
      }
    }
    if (!this.cues) return;
    if (chase || m.finished || g.state === 'gameover' || g.state === 'victory') return this.stop();
    const t = this.clock - this.t0;
    while (this.cues.length && t >= this.cues[0].at) {
      const c = this.cues.shift();
      g.subtitle?.(c.text, c.dur + 0.5, SPEAKER);
    }
    if (!this.cues.length && t >= this.total) this._end();
  }

  _start() {
    const g = this.g, d = this.mode.director, audio = g.audio;
    const hasFile = !!audio?.hasFile?.(FILE_ID);
    const base = AYAT.reduce((n, [, s]) => n + s + GAP, 0);
    // with a recording the subtitles follow its length; without one, a frightened whisper's pace
    const total = hasFile ? Number(audio.speechDuration?.(FILE_ID)) || base : base;
    const k = total / base;
    let at = 0;
    this.cues = AYAT.map(([text, s]) => {
      const c = { text, at, dur: s * k };
      at += (s + GAP) * k;
      return c;
    });
    this.total = total + 0.3;
    this.t0 = this.clock;
    this.count++;
    d.reciting = true;
    d.aftershockAt = null;
    d._log?.('recite', this.reason, hasFile ? 'voice' : 'subtitles');
    this.voice = hasFile ? audio.play(FILE_ID, { volume: 0.9 }) : null;
  }

  _end() {
    this.cues = null;
    this.voice = null;
    this.lastEnd = this.clock;
    const d = this.mode.director;
    d.reciting = false;
    d.nextTry = Math.max(d.nextTry || 0, d.time + 10);
  }

  /** Run end / capture / chase / teardown. */
  stop() {
    if (this.voice?.stop) {
      try {
        this.voice.stop(0.4);
      } catch {
        /* already ended */
      }
    }
    const was = !!this.cues;
    this.cues = null;
    this.voice = null;
    this.pendingAt = null;
    if (was) {
      this.lastEnd = this.clock;
      if (this.mode.director) this.mode.director.reciting = false;
    }
  }
}
