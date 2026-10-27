// LAST BELL — The Halloween Shift: encounter memory (anti-habituation).
//
// Short-term (this run): every haunt with its time, spot, pose, motifs and intensity; peaks; what changed.
// Long-term (this device, localStorage `lastbell.halloween.memory.v1`, nothing personal): per haunt, spot,
// pose, motif and blackout variant, the runs it was used in; the last few runs' flavours; and a few cautious
// behaviour counters (sounds the player didn't turn towards, figures they walked up to, doorways they keep
// checking). These are gameplay signals only: they never claim to measure fear.
//
//   mem.beginRun({ seed }) → run       mem.note(kind, key)        mem.event(e)        mem.endRun(summary)
//   mem.novelty(kind, key) → 0..1      1 = never seen, falls with recent use, recovers over later runs
//   mem.recent(kind, key, sec) → bool  used within the last `sec` seconds of this run
//   mem.reset()                        (debug)

const EMPTY = () => ({ v: 1, runs: 0, use: {}, flavors: [], ignored: {}, approached: 0, checks: {}, best: null, openings: 0, openPose: null });
const KINDS = ['seq', 'spot', 'pose', 'motif', 'blackout', 'poster', 'board', 'res'];

export class HauntMemory {
  constructor(key, storage = null) {
    this.key = key;
    this.storage = storage;
    this.p = this._load();
    this.run = null;
    this._dirty = false;
  }

  _store() {
    try {
      return this.storage || globalThis.localStorage || null;
    } catch {
      return null;
    }
  }

  _load() {
    try {
      const raw = this._store()?.getItem(this.key);
      if (raw) {
        const p = JSON.parse(raw);
        if (p && p.v === 1) return { ...EMPTY(), ...p };
      }
    } catch {
      /* private mode / blocked storage: memory lasts for this page only */
    }
    return EMPTY();
  }

  save() {
    try {
      this._store()?.setItem(this.key, JSON.stringify(this.p));
      this._dirty = false;
    } catch {
      /* ignore */
    }
  }

  reset() {
    this.p = EMPTY();
    this.save();
  }

  /** The run's flavour alternates: a quiet run after busy ones, sometimes two quiet in a row. */
  _pickFlavor(rng) {
    const last = this.p.flavors.slice(-3);
    const w = { quiet: 1, uneasy: 1.4, restless: 1 };
    if (last.at(-1) === 'restless') { w.restless = 0.2; w.quiet = 1.6; }
    if (last.at(-1) === 'quiet') { w.quiet = 0.45; w.restless = 1.5; }
    if (last.length === 3 && last.every((f) => f === last[0])) w[last[0]] = 0.05;
    if (this.p.runs === 0) return 'uneasy'; // the first shift is the classic one
    let t = rng() * (w.quiet + w.uneasy + w.restless);
    for (const k of ['quiet', 'uneasy', 'restless']) if ((t -= w[k]) <= 0) return k;
    return 'uneasy';
  }

  beginRun({ seed = 0, rng = Math.random } = {}) {
    this.run = {
      index: this.p.runs,
      seed,
      flavor: this._pickFlavor(rng),
      events: [],
      used: {},
      peaks: [],
      lastMajorAt: -999,
      lastEventAt: -999,
    };
    return this.run;
  }

  _k(kind, key) {
    return kind + '|' + key;
  }

  /** Record one use of (kind, key) in this run and in the long-term profile. */
  note(kind, key, t = 0) {
    if (!this.run || key == null) return;
    const k = this._k(kind, key);
    (this.run.used[k] ||= []).push(t);
    const u = (this.p.use[k] ||= []);
    if (u.at(-1) !== this.run.index) u.push(this.run.index);
    if (u.length > 6) u.splice(0, u.length - 6);
    this._dirty = true;
  }

  /** e = { t, seq, spot?, pose?, motifs?, intensity, major?, res?, blackout? } */
  event(e) {
    if (!this.run) return;
    this.run.events.push(e);
    if (this.run.events.length > 80) this.run.events.shift();
    this.run.lastEventAt = e.t;
    if (e.major) this.run.lastMajorAt = e.t;
    this.note('seq', e.seq, e.t);
    if (e.spot) this.note('spot', e.spot, e.t);
    if (e.pose) this.note('pose', e.pose, e.t);
    if (e.res) this.note('res', e.seq + ':' + e.res, e.t);
    if (e.blackout) this.note('blackout', e.blackout, e.t);
    for (const m of e.motifs || []) this.note('motif', m, e.t);
  }

  /** Times (s) this run used (kind, key). */
  usedThisRun(kind, key) {
    return this.run?.used[this._k(kind, key)]?.length || 0;
  }

  recent(kind, key, sec, now) {
    const list = this.run?.used[this._k(kind, key)];
    return !!list && list.length > 0 && now - list.at(-1) < sec;
  }

  /** 1 = fresh. Past runs fade (0.55 per run since), this run counts double. */
  novelty(kind, key) {
    const u = this.p.use[this._k(kind, key)] || [];
    const now = this.run?.index ?? this.p.runs;
    let w = 0;
    for (const ri of u) if (ri < now) w += Math.pow(0.55, now - ri - 1);
    w += 2 * this.usedThisRun(kind, key);
    return 1 / (1 + 0.7 * w);
  }

  /** Behaviour signals (heuristics, not measurements). */
  ignoredSound(motif) {
    this.p.ignored[motif] = (this.p.ignored[motif] || 0) + 1;
    this._dirty = true;
  }

  heardSound(motif) {
    if (this.p.ignored[motif]) this.p.ignored[motif] = Math.max(0, this.p.ignored[motif] - 0.5);
  }

  walkedUp() {
    this.p.approached = Math.min(20, this.p.approached + 1);
    this._dirty = true;
  }

  checked(spotKey) {
    this.p.checks[spotKey] = Math.min(20, (this.p.checks[spotKey] || 0) + 1);
    const keys = Object.keys(this.p.checks);
    if (keys.length > 120) delete this.p.checks[keys[0]];
    this._dirty = true;
  }

  ignoreFactor(motif) {
    return 1 / (1 + 0.35 * (this.p.ignored[motif] || 0));
  }

  checkFactor(spotKey) {
    return 1 / (1 + 0.4 * (this.p.checks[spotKey] || 0));
  }

  endRun(summary = {}) {
    if (!this.run) return;
    this.p.flavors.push(this.run.flavor);
    if (this.p.flavors.length > 8) this.p.flavors.shift();
    this.p.runs++;
    this.p.lastRun = { at: Date.now(), events: this.run.events.length, result: summary.result || null, flavor: this.run.flavor };
    // keep the profile small: drop keys not used in the last 12 runs
    for (const [k, u] of Object.entries(this.p.use)) if (!u.length || this.p.runs - u.at(-1) > 12) delete this.p.use[k];
    this.run = null;
    this.save();
  }

  /** Debug: per kind, the most used keys. */
  summary() {
    const out = {};
    for (const kind of KINDS) out[kind] = [];
    for (const [k, u] of Object.entries(this.p.use)) {
      const [kind, key] = k.split('|');
      out[kind]?.push([key, u.length]);
    }
    for (const kind of KINDS) out[kind].sort((a, b) => b[1] - a[1]);
    return { runs: this.p.runs, flavors: this.p.flavors, ignored: this.p.ignored, approached: this.p.approached, use: out };
  }

  flushIfDirty() {
    if (this._dirty) this.save();
  }
}
