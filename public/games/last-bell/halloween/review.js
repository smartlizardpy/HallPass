// LAST BELL — The Halloween Shift: scare review (development only, from the scare gallery).
//
// Is each scare scary enough? Plays the scares one after another. When one is over, a card asks how scary it was
// (1-5), what was off (tags) and for a note. Ratings go to docs/halloween/scare-ratings.json in the project through
// the dev server (the scratchpad serve.py: GET/POST /__hw/ratings), or stay in this browser (localStorage) when
// there is no dev server. The gallery shows each scare's score on its card.
//
// While a scare plays:  Enter  rate it now     R  replay
// On the card:          1-5    how scary       Enter  save and play the next one
//                       R      replay          S  skip (no save)       G / Esc  save and back to the gallery

const TAGS = [
  ['jumped', 'Made me jump'],
  ['creepy', 'Creepy'],
  ['bug', 'Looked like a bug'],
  ['unseen', 'Couldn’t see it'],
  ['far', 'Too far'],
  ['close', 'Too close'],
  ['quiet', 'Too quiet'],
  ['loud', 'Too loud'],
  ['slow', 'Too slow'],
  ['fast', 'Too quick'],
  ['obvious', 'Saw it coming'],
  ['nothing', 'Nothing happened'],
];
const SCORES = ['Not scary', 'A bit', 'Creepy', 'Made me jump', 'Pants ruined'];
const LS = 'lastbell.hw.ratings';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export class ScareReview {
  /** gallery: the ScareGallery. items: [[id, name, what, tip, group]] in gallery order. */
  constructor(gallery, items) {
    this.gallery = gallery;
    this.items = items;
    this.data = {}; // id → { rating, tags, note, build, at, plays }
    this.server = false;
    this.phase = 'off'; // 'play' | 'card'
    this.i = -1;
    this.plays = {};
    this.run = 0; // bumps on every play, so an old watch loop stops
    const bar = (this.bar = document.createElement('div'));
    bar.className = 'hw-review-bar';
    bar.hidden = true;
    const card = (this.card = document.createElement('section'));
    card.className = 'hw-review';
    card.hidden = true;
    card.setAttribute('aria-label', 'Rate this scare');
    card.innerHTML = `
      <div class="hw-review__card">
        <p class="hw-review__count"></p>
        <h2 class="hw-review__name"></h2>
        <p class="hw-review__what"></p>
        <fieldset class="hw-review__scores">
          <legend>How scary was it? <kbd>1</kbd>–<kbd>5</kbd></legend>
          ${SCORES.map((s, i) => `<button type="button" data-score="${i + 1}"><b>${i + 1}</b><span>${s}</span></button>`).join('')}
        </fieldset>
        <fieldset class="hw-review__tags">
          <legend>Anything off?</legend>
          ${TAGS.map(([k, s]) => `<button type="button" data-tag="${k}" aria-pressed="false">${s}</button>`).join('')}
        </fieldset>
        <label class="hw-review__note">Note <input type="text" maxlength="400" placeholder="What would make it scarier?"></label>
        <div class="hw-review__acts">
          <button type="button" data-r="replay">Replay <kbd>R</kbd></button>
          <button type="button" data-r="skip">Skip <kbd>S</kbd></button>
          <button type="button" data-r="gallery">Gallery <kbd>G</kbd></button>
          <button type="button" data-r="next" class="is-main">Save and next <kbd>Enter</kbd></button>
        </div>
        <p class="hw-review__status" aria-live="polite"></p>
      </div>`;
    document.body.append(bar, card);
    this.note = card.querySelector('.hw-review__note input');
    card.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.score) this._score(+b.dataset.score);
      else if (b.dataset.tag) b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
      else if (b.dataset.r) this._act(b.dataset.r, true);
    });
    // capture, ahead of the game and the debug panel (their keys must not fire under the card)
    this._onKey = (e) => this._key(e);
    addEventListener('keydown', this._onKey, true);
    this.load();
  }

  get mode() {
    return this.gallery.mode;
  }

  get rated() {
    return this.items.filter(([id]) => this.data[id]?.rating).length;
  }

  async load() {
    try {
      const r = await fetch('/__hw/ratings', { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      this.data = (await r.json()).scares || {};
      this.server = true;
    } catch {
      this.server = false;
      try {
        this.data = JSON.parse(localStorage.getItem(LS) || '{}');
      } catch {
        this.data = {};
      }
    }
    this.gallery.paintScores?.();
  }

  /** Review everything, from `id` (or the first scare not yet rated). */
  start(id = null) {
    let i = id ? this.items.findIndex(([x]) => x === id) : this.items.findIndex(([x]) => !this.data[x]?.rating);
    if (i < 0) i = 0;
    this.i = i;
    this._play(true);
  }

  /** One scare from a gallery click: it plays, then the card. */
  one(id) {
    this.start(id);
  }

  stop() {
    this.run++;
    this.phase = 'off';
    this.bar.hidden = true;
    this.card.hidden = true;
  }

  async _play(gesture = false) {
    const [id, name, , tip] = this.items[this.i];
    const run = ++this.run;
    this.phase = 'play';
    this.card.hidden = true;
    this.plays[id] = (this.plays[id] || 0) + 1;
    this._bar(`<b>Review ${this.i + 1}/${this.items.length}</b> ${esc(name)} <i>${esc(tip)}</i> <span><kbd>Enter</kbd> rate it now · <kbd>R</kbd> replay</span>`);
    const ok = await this.gallery.go(id, { gesture, review: true });
    if (run !== this.run) return;
    if (!ok) {
      this._card({ failed: true });
      return;
    }
    // wait until it is over: nothing running for 2 s (at least 3 s in), or 5 s after its hit (a sting or the boy's
    // reaction: some scares linger until you look away), a minute at most; then a few seconds to look
    const d = this.mode.director;
    const t0 = performance.now(), d0 = d.time;
    const hitAt = () => Math.max(d.lastStingAt ?? -999, d._lastReact ?? -999);
    let quietSince = null;
    while (run === this.run && this.phase === 'play') {
      await new Promise((r) => setTimeout(r, 250));
      const now = performance.now();
      if (this._busy()) quietSince = null;
      else quietSince ??= now;
      const hit = hitAt();
      const done = (quietSince != null && now - quietSince > 2000 && now - t0 > 3000) || (hit > d0 && d.time - hit > 5) || now - t0 > 60000;
      if (done) {
        this._bar(`<b>Review ${this.i + 1}/${this.items.length}</b> ${esc(name)}: done. <span>Rating card in a moment · <kbd>Enter</kbd> now · <kbd>R</kbd> replay</span>`);
        await new Promise((r) => setTimeout(r, 2500));
        if (run === this.run && this.phase === 'play') this._card();
        return;
      }
    }
  }

  /** Is a scare still going? (a sequence, the opening, a blackout, the recitation, a head in the air) */
  _busy() {
    const m = this.mode, d = m.director;
    return !!(d.fg || d.boFg || d.bg?.size || d._glimpsing || d.bo?.active || m.opening.state === 'armed' || m.opening.state === 'blink' || m.recite.active || m.recite.pendingAt != null || d.heads?.falling);
  }

  _bar(html) {
    this.bar.innerHTML = html;
    this.bar.hidden = false;
  }

  _card({ failed = false } = {}) {
    const [id, name, what, , group] = this.items[this.i];
    this.phase = 'card';
    this.bar.hidden = true;
    const prev = this.data[id] || {};
    // rated on this build already: carry it over to change. On an older build: start blank, the old rating and note
    // shown greyed (playtest: old notes were carried over and saved again against the new build)
    const same = !!prev.rating && prev.build === (this.mode.build || '');
    const was = prev.rating || prev.note ? `Last time (build ${prev.build || '?'}): ${prev.rating ? prev.rating + '/5' : 'no score'}${prev.note ? ` · "${prev.note}"` : ''}` : '';
    const c = this.card;
    c.querySelector('.hw-review__count').textContent = `Scare ${this.i + 1} of ${this.items.length} · ${group} · ${this.rated} rated`;
    c.querySelector('.hw-review__name').textContent = name;
    c.querySelector('.hw-review__what').textContent = what;
    this.score = same ? prev.rating : 0;
    this._score(this.score);
    const tags = new Set(same ? prev.tags || [] : []);
    if (failed) tags.add('nothing');
    for (const b of c.querySelectorAll('[data-tag]')) b.setAttribute('aria-pressed', tags.has(b.dataset.tag) ? 'true' : 'false');
    this.note.value = same ? prev.note || '' : '';
    this.note.placeholder = !same && prev.note ? `Last time: ${prev.note}` : 'What would make it scarier?';
    this._status(failed ? 'It could not be set up here. Replay tries somewhere else.' : same ? `You rated this build ${prev.rating}. Change it or press Enter to keep it.` : was ? `${was}. Press Enter without a score to keep that.` : '');
    c.hidden = false;
    this.mode.game.player?.unlockPointer?.();
    c.querySelector('[data-r="next"]').focus({ preventScroll: true });
  }

  _score(n) {
    this.score = n;
    for (const b of this.card.querySelectorAll('[data-score]')) b.setAttribute('aria-pressed', +b.dataset.score === n ? 'true' : 'false');
  }

  _status(t) {
    this.card.querySelector('.hw-review__status').textContent = t;
  }

  async _save() {
    const [id, name] = this.items[this.i];
    const tags = [...this.card.querySelectorAll('[data-tag][aria-pressed="true"]')].map((b) => b.dataset.tag);
    const note = this.note.value.trim();
    if (!this.score && !tags.length && !note) return true; // nothing to save
    const rec = { id, name, rating: this.score || null, tags, note, build: this.mode.build || '', plays: this.plays[id] || 1 };
    this.data[id] = { ...rec, at: new Date().toISOString() };
    let ok = false;
    if (this.server) {
      try {
        const r = await fetch('/__hw/ratings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rec) });
        ok = r.ok;
      } catch {
        ok = false;
      }
    }
    try {
      localStorage.setItem(LS, JSON.stringify(this.data));
    } catch {
      /* private window */
    }
    this.gallery.paintScores?.();
    this.gallery._say(ok ? `Saved: ${name} ${rec.rating ? rec.rating + '/5' : ''} → docs/halloween/scare-ratings.json` : `Saved in this browser only (no dev server): ${name}`, 3);
    return true;
  }

  async _act(a, gesture = false) {
    if (this.phase === 'off') return;
    if (a === 'replay') {
      if (this.phase === 'card') await this._save();
      return this._play(gesture);
    }
    if (a === 'next' || a === 'skip') {
      if (a === 'next') await this._save();
      if (this.i >= this.items.length - 1) {
        this.stop();
        this.gallery.show();
        return this.gallery._say(`Review finished: ${this.rated} of ${this.items.length} rated.`, 6);
      }
      this.i++;
      return this._play(gesture);
    }
    if (a === 'gallery') {
      if (this.phase === 'card') await this._save();
      this.stop();
      this.gallery.show();
    }
  }

  _key(e) {
    if (this.phase === 'off' || e.repeat) return;
    const k = e.code;
    if (this.phase === 'play') {
      // only while the gallery is shut (its own keys work as normal)
      if (this.gallery.open) return;
      if (k === 'Enter' || k === 'NumpadEnter') this._card();
      else if (k === 'KeyR') this._play(true);
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    // the card: nothing reaches the game underneath
    e.stopImmediatePropagation();
    if (e.target === this.note) {
      if (k === 'Enter' || k === 'NumpadEnter') {
        e.preventDefault();
        this._act('next', true);
      } else if (k === 'Escape') this.note.blur();
      return;
    }
    const n = /^(?:Digit|Numpad)([1-5])$/.exec(k);
    if (n) this._score(+n[1]);
    else if (k === 'Enter' || k === 'NumpadEnter') this._act('next', true);
    else if (k === 'KeyR') this._act('replay', true);
    else if (k === 'KeyS') this._act('skip', true);
    else if (k === 'KeyG' || k === 'Escape') this._act('gallery');
    else return;
    e.preventDefault();
  }

  dispose() {
    this.stop();
    removeEventListener('keydown', this._onKey, true);
    this.bar.remove();
    this.card.remove();
  }
}
