// LAST BELL — The Halloween Shift: the scare gallery (development only, with the debug panel).
//
// Every scare on one page. Click one: the page closes, you are taken to a place where it works (a long corridor,
// or into a locker) and it plays at full strength (act III), with the Caretaker off and the clock stopped.
// Press B to open it again. "Back to a normal run" hands the building back to the director.
//
// Deep link: add &scare=<id> to the URL (with hwdebug=1) to land straight in one, e.g. &scare=behind_you.
// Rating: after each one plays, a card asks how scary it was (review.js). "Review every scare" plays them all in turn.

import { ScareReview } from './review.js';
import { headOnDesk, nearestDeskRoom } from './tableau.js';
import { BOARD_LINES } from './posters.js';
import { ET } from '../world-layout.js';

const GROUPS = [
  ['The start', [
    ['opening', 'What was that?', 'You step out into the corridor. The lights die. They flicker back on three times: the first time the corridor is empty, then the ghost is standing at the far end, then it is twisted and facing you.', 'Look straight down the corridor.'],
    ['fatiha', 'Al-Fatiha', 'After a clear look at the ghost, you start whispering Al-Fatiha, one ayah at a time. Nothing scary happens while you recite.', 'Watch the light ahead, then read the subtitles.'],
  ]],
  ['The ghost', [
    ['light_glimpse', 'The flicker', 'Like a theatre: every light in the corridor cuts out, then only the last light, at the very end of the corridor, flickers on, and the ghost is standing there under it, a little different each flash. Then the lights come back. It always stays far away.', 'Keep looking down the corridor.'],
    ['watcher_far', 'Far figure', 'It stands far down the corridor, watching. It leaves when you look away, or the lights die around it.', 'Look around until you find it.'],
    ['watcher_peek', 'Doorway peek', 'It leans out of a doorway, watches, and pulls back.', 'Look at the open doorways.'],
    ['watcher_window', 'In the window', 'It stares at you through a classroom window, then the lights go out.', 'Look at the classroom windows.'],
    ['watcher_reveal', 'Lights out, lights on', 'The lights and your torch go out. When they come back, it is standing a few metres away.', 'Stay still and wait.'],
    ['red_light', 'Red light, green light', 'Each time you look away and back, it is closer. At the end it is right there.', 'Turn round and back, again and again.'],
    ['behind_you', 'Behind you', 'Breathing on the back of your neck. Turn round and its face is at yours.', 'Wait for the breathing, then turn round.'],
    ['charge', 'The charge', 'The corridor lights die one by one towards you, and it comes out of the dark at a run.', 'Look down the corridor.'],
    ['signal_lost', 'Signal lost', 'The bodycam cuts to static. When the picture comes back, it is standing right in front of you.', 'Just watch.'],
    ['bait_switch', 'Bait and switch', 'A locker slams on one side. While you look at it, the ghost is at the far end on the other side.', 'Look at the bang, then look the other way.'],
    ['after_return', 'It came back', 'The second scare: after a big one, it is standing there again.', 'Look around.'],
  ]],
  ['Blood and heads', [
    ['blood_hand', 'The slap', 'Silence, a wet drag, then two bloody hands slam onto the wall at the edge of your view, and slowly slide down it.', 'Stand still.'],
    ['ceiling_drip', 'Ceiling drip', 'Blood starts dripping from the ceiling ahead (censored when it gets big).', 'Look ahead and up.'],
    ['blood_run', 'Running wall', 'A big run of blood starts down a wall of the room behind you; when you turn and see it, a swell. Censored.', 'Turn round.'],
    ['blood_reveal', 'Blood on the wall', 'A big patch of blood appears on a wall of this room you were not looking at; when you find it, a swell. Censored.', 'Look around the room.'],
    ['blood_stain', 'Small stain', 'A small stain appears somewhere you already looked.', 'Look around.'],
    ['desk_head', 'Head on the desk', 'In the classroom you start in: a head on the teacher’s desk, facing the board, bleeding over the edge onto the floor. Look away and back: it is facing you. Then walk up to it: it topples off the desk and rolls to your feet. Always censored.', 'Look at it, look away, look back, then walk up to it.'],
    ['head_drop', 'Falling head', 'The ceiling creaks over a spot ahead, a drop of blood lands... and nothing. Later, when you have stopped watching (walk on, or wait), a head drops right in front of you. Always censored.', 'Watch the ceiling, then give up and walk on.'],
    ['head_behind', 'Head behind you', 'A thud right behind you. Something is lying there. Always censored.', 'Turn round after the thud.'],
  ]],
  ['Sounds', [
    ['whisper_behind', 'Whisper', 'A whisper at the back of your head, with words. Turn round: it is standing down the corridor behind you. Ignore it and it whispers again, closer.', 'Turn round when it whispers.'],
    ['copy_steps', 'Copied footsteps', 'Footsteps behind you that copy yours, catch up, and stop one step after you do.', 'Walk forward (W), then stop.'],
    ['steps_above', 'Steps upstairs', 'Footsteps on the floor above, walking to right over your head.', 'Listen.'],
    ['distant_knock', 'Knocking', 'Knocking on a door. Go and look, and the next knock comes from somewhere else.', 'Listen.'],
    ['chair_scrape', 'Chair scrape', 'A chair scrapes in an empty room.', 'Listen.'],
    ['door_close', 'Door', 'A door closes by itself.', 'Listen.'],
    ['hum_wrong', 'The wrong hum', 'The Caretaker’s humming, slowed down and wrong, from a room he is not in.', 'Listen.'],
    ['hum_dim', 'Dying light', 'A light buzzes and dims in the room.', 'Listen.'],
    ['build', 'Build-up', 'The dread swells and your heart pounds… and nothing comes.', 'Listen.'],
    ['silence', 'Silence', 'Every sound in the building drops out.', 'Listen.'],
    ['after_breath', 'Breath', 'A breath right at your ear.', 'Listen.'],
    ['after_bang', 'Bang', 'A sudden bang just ahead of you.', 'Listen.'],
  ]],
  ['Hiding', [
    ['locker', 'The locker', 'You hide in a locker. Something is breathing right outside. Then the knocking starts.', 'You are put in a locker. Stay in.'],
  ]],
  ['The school changes', [
    ['poster_turn', 'Posters', 'A poster you walked past has changed. In a run you find it later; a quiet swell when you notice.', 'Watch: the camera glances away and back.'],
    ['board_write', 'Writing on the board', 'New writing appears on a classroom board.', 'Watch: the camera glances away and back.'],
    ['clock_wrong', 'Clock', 'A clock stops, or starts running backwards.', 'Watch: the camera glances away and back.'],
    ['drawing_change', 'Drawings', 'A child’s drawing on the wall changes to a figure: “behind you”. When you notice, something breathes on your neck.', 'Watch: the camera glances away and back.'],
    ['pane_face', 'Face in the glass', 'A pale face and two hands pressed against a window. When you see it, it taps, slams the glass, and slides down out of sight.', 'Turn towards the tapping.'],
  ]],
  ['The blackout', [
    ['blackout', 'Blackout', 'The power goes. What happens in the dark changes every time.', 'Torch on (F).'],
  ]],
];

const SPECIAL = new Set(['opening', 'fatiha', 'blackout', 'desk_head']);
// the school changes while you aren't looking: the gallery shows it to you, glances away, and looks back
const CHANGES = new Set(['poster_turn', 'board_write', 'clock_wrong', 'drawing_change']);
// these need a classroom (a wall you aren't looking at, an open door in front of you)
const ROOM_FIRST = new Set(['blood_run', 'blood_reveal', 'door_close', 'blood_hand']);

export class ScareGallery {
  constructor(debug) {
    this.debug = debug;
    this.mode = debug.mode;
    this.d = debug.d;
    this.views = null;
    const el = (this.el = document.createElement('section'));
    el.className = 'hw-gallery';
    el.hidden = true;
    const known = new Set(this.d.catalog.map((c) => c.id));
    el.innerHTML = `
      <header class="hw-gallery__head">
        <div>
          <h1>Scare gallery</h1>
          <p>Click one: you’re taken somewhere it works and it plays at full strength. The Caretaker is off and the clock is stopped. When it’s over you rate it (1–5, what was off, a note). Press <kbd>B</kbd> to come back here.</p>
          <p class="hw-gallery__sum"></p>
        </div>
        <div class="hw-gallery__acts">
          <button data-g="review" class="is-main">Review every scare</button>
          <button data-g="normal">Back to a normal run</button>
          <button data-g="close">Close</button>
        </div>
      </header>
      ${GROUPS.map(([title, items]) => `
        <h2>${title}</h2>
        <div class="hw-gallery__grid">
          ${items.filter(([id]) => SPECIAL.has(id) || known.has(id)).map(([id, name, what, tip]) => `
            <button class="hw-gallery__card" data-id="${id}">
              <strong>${name}</strong>
              <span>${what}</span>
              <em>${tip}</em>
              <small class="hw-gallery__score" data-score-for="${id}"></small>
            </button>`).join('')}
        </div>`).join('')}
      <p class="hw-gallery__out" aria-live="polite"></p>`;
    document.body.appendChild(el);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.id) this.review.one(b.dataset.id);
      else if (b.dataset.g === 'review') this.review.start();
      else if (b.dataset.g === 'close') this.close(true);
      else if (b.dataset.g === 'normal') this.normal();
    });
    const items = GROUPS.flatMap(([group, it]) => it.filter(([id]) => SPECIAL.has(id) || known.has(id)).map((x) => [...x, group]));
    this.review = new ScareReview(this, items);
  }

  /** Each card's score, and the totals in the header. */
  paintScores() {
    const data = this.review?.data || {};
    const scores = [];
    let bugs = 0;
    for (const el of this.el.querySelectorAll('[data-score-for]')) {
      const r = data[el.dataset.scoreFor];
      el.className = 'hw-gallery__score';
      if (!r || (!r.rating && !r.tags?.length && !r.note)) {
        el.textContent = 'Not rated';
        continue;
      }
      if (r.rating) scores.push(r.rating);
      if (r.tags?.includes('bug')) bugs++;
      el.classList.add(r.rating >= 4 ? 'is-good' : r.rating === 3 ? 'is-mid' : 'is-low');
      el.textContent = `${r.rating ? r.rating + '/5' : '–'}${r.tags?.length ? ' · ' + r.tags.length + ' tag' + (r.tags.length > 1 ? 's' : '') : ''}${r.note ? ' · note' : ''}`;
      el.title = [r.tags?.join(', '), r.note].filter(Boolean).join(' · ');
    }
    const n = this.review?.items.length || 0;
    const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : null;
    this.el.querySelector('.hw-gallery__sum').textContent = scores.length
      ? `Rated ${scores.length} of ${n} · average ${avg}/5${bugs ? ` · ${bugs} looked like a bug` : ''} · saved to ${this.review.server ? 'docs/halloween/scare-ratings.json' : 'this browser only (no dev server)'}`
      : `Nothing rated yet (${n} scares).`;
    const btn = this.el.querySelector('[data-g="review"]');
    btn.textContent = scores.length && scores.length < n ? `Continue review (${scores.length}/${n})` : 'Review every scare';
  }

  get open() {
    return !this.el.hidden;
  }

  toggle() {
    if (this.open) this.close(true);
    else this.show();
  }

  show() {
    if (this.review?.phase !== 'off') this.review?.stop();
    this.paintScores();
    this.el.hidden = false;
    this.mode.game.player?.unlockPointer?.();
  }

  close(relock = false) {
    this.el.hidden = true;
    if (relock) this.mode.game.player?.lockPointer?.();
  }

  _say(text, sec = 5) {
    this.el.querySelector('.hw-gallery__out').textContent = text;
    try {
      this.mode.game.ui?.showNotice?.(text, sec);
    } catch {
      /* no notice line */
    }
  }

  /** Long straight corridor views (stand at a, look at b), with room behind a. */
  _views() {
    if (this.views?.length) return this.views;
    const m = this.mode, w = m.game.world;
    const cs = m.spotsCat.of('corridor');
    const out = [];
    for (const a of cs) {
      for (const b of cs) {
        const L = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
        if (L < 13 || L > 20) continue;
        if (!w.lineOfSight({ x: a.pos.x, y: 1.6, z: a.pos.z }, { x: b.pos.x, y: 1.4, z: b.pos.z })) continue;
        if (!w.lineOfSight({ x: a.pos.x, y: 0.5, z: a.pos.z }, { x: b.pos.x, y: 0.5, z: b.pos.z })) continue;
        const bx = a.pos.x - ((b.pos.x - a.pos.x) / L) * 2, bz = a.pos.z - ((b.pos.z - a.pos.z) / L) * 2;
        if (!w.isWalkable(bx, bz, 0.3, 0)) continue;
        out.push({ a: a.pos, b: b.pos });
      }
    }
    // shuffle, so retries see somewhere new
    for (let i = out.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [out[i], out[j]] = [out[j], out[i]];
    }
    this.views = out.slice(0, 24);
    return this.views;
  }

  _reset() {
    const m = this.mode, d = this.d, g = m.game;
    for (const c of [d.fg, d.boFg, ...d.bg]) if (c) d.abort(c, 'gallery');
    m.opening.cancel();
    m.recite.stop();
    m.recite.count = 0;
    m.recite.lastEnd = -1e9;
    m.watcher.hideNow?.();
    m.lights.restoreAll(0.05);
    d.duck(1, 0.05);
    g.player.enabled = true;
    if (g.player.isHidden) g.player.exitHide?.();
    d.lastStingAt = -999;
    d.aftershockAt = null;
  }

  /** An open door 6-9 m away: in front of you (door_close) or off to one side, out of view (watcher_peek). */
  async _stageDoor(id, wait) {
    const m = this.mode, w = m.game.world, d = this.d;
    const targets = id === 'watcher_peek'
      ? m.spotsCat.of('doorway').filter((s) => s.door && !s.door.locked)
      : (w.doors || []).filter((x) => (x.floor || 0) === 0 && x.kind === 'door' && !x.pair && !x.locked).map((door) => ({ pos: door.position, door }));
    const stands = m.spotsCat.of('corridor');
    for (const t of targets.sort(() => Math.random() - 0.5).slice(0, 12)) {
      for (const st of stands) {
        const dd = Math.hypot(st.pos.x - t.pos.x, st.pos.z - t.pos.z);
        if (dd < 6 || dd > 9) continue;
        if (!w.lineOfSight({ x: st.pos.x, y: 1.6, z: st.pos.z }, { x: t.pos.x, y: 1.2, z: t.pos.z })) continue;
        if (!t.door.isOpen) t.door.open?.('world');
        const to = Math.atan2(-(t.pos.x - st.pos.x), -(t.pos.z - st.pos.z));
        m.game.player.spawn({ x: st.pos.x, y: 0, z: st.pos.z }, id === 'watcher_peek' ? to + (Math.random() < 0.5 ? 1 : -1) * 1.15 : to);
        await wait(350);
        if (d.play(id)) return true;
        break; // next door
      }
    }
    return false;
  }

  /**
   * A change, staged so you see it: you stand in front of the thing (a poster, a board, a clock, a drawing), the
   * camera glances away, it changes, the camera comes back. The real run doesn't move your view: it changes
   * somewhere you have been, and a quiet swell plays when you notice (director.noteChange).
   */
  async _stageChange(id, wait) {
    const m = this.mode, d = this.d, g = m.game, w = g.world, P = d.posters;
    let targets = [];
    if (id === 'poster_turn') targets = P.list.filter((p) => p.state < 2).map((p) => ({ pos: p.pos, n: p.normal, apply: () => (P.setState(p, 2), d.noteChange('poster', p.pos)) }));
    else if (id === 'board_write') {
      targets = P.boards.filter((b) => !b.changed).map((b) => {
        b.board.mesh.updateMatrixWorld?.();
        const n = { x: 0, y: 0, z: 1 };
        const e = b.board.mesh.matrixWorld.elements;
        n.x = e[8]; n.z = e[10];
        return { pos: b.pos, n, apply: () => { const used = new Set(P.boards.map((x) => x.text)); const lines = BOARD_LINES.filter((l) => !used.has(l)); P.boardWrite(b, lines[(Math.random() * lines.length) | 0] || BOARD_LINES[0]); d.noteChange('board', b.pos); } };
      });
    } else if (id === 'clock_wrong') targets = P.clocks.filter((c) => c.mode === 'normal').map((c) => ({ pos: c.pos, n: c.normal, apply: () => (P.setClock(c, 'backwards'), d.noteChange('clock', c.pos)) }));
    else if (id === 'drawing_change') {
      targets = m.decor.drawings.filter((x) => x.kind !== 'figure').map((x) => ({ pos: x.mesh.position, n: { x: Math.sin(x.mesh.rotation.y), z: Math.cos(x.mesh.rotation.y) }, apply: () => { const r = m.decor.corruptDrawing((y) => y === x); if (r) d.noteChange('drawing', x.mesh.position); } }));
    }
    const eyeH = g.player.eyePosition?.y - g.player.position.y || 1.6;
    for (const t of targets.sort(() => Math.random() - 0.5).slice(0, 30)) {
      if ((t.pos.y || 0) > 3) continue; // upstairs
      const len = Math.hypot(t.n?.x || 0, t.n?.z || 0) || 1;
      const nx = (t.n?.x || 0) / len, nz = (t.n?.z || 0) / len;
      for (const dist of [2.2, 1.8, 2.8, 3.4]) {
        for (const sgn of [1, -1]) {
          const x = t.pos.x + nx * dist * sgn, z = t.pos.z + nz * dist * sgn;
          if (!w.isWalkable(x, z, 0.3, 0)) continue;
          if (!w.lineOfSight({ x, y: eyeH, z }, { x: t.pos.x + nx * 0.3 * sgn, y: t.pos.y, z: t.pos.z + nz * 0.3 * sgn })) continue; // (off the wall: its thickness blocks the ray)
          const yaw = Math.atan2(-(t.pos.x - x), -(t.pos.z - z));
          const p = g.player;
          p.spawn({ x, y: 0, z }, yaw);
          p.pitch = Math.atan2((t.pos.y || 1.4) - eyeH, dist);
          this._say('Watch it… (the camera glances away and back)', 4);
          await wait(2400);
          await this._pan(yaw + 2.6, 450);
          await wait(450);
          t.apply();
          await wait(700);
          await this._pan(yaw, 550);
          return true;
        }
      }
    }
    return false;
  }

  /** Turn the view to `yaw` over `ms` (gallery demos only). */
  _pan(yaw, ms) {
    const p = this.mode.game.player, y0 = p.yaw;
    const dy = Math.atan2(Math.sin(yaw - y0), Math.cos(yaw - y0));
    const t0 = performance.now();
    return new Promise((res) => {
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / ms);
        p.yaw = y0 + dy * (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
        if (k < 1) requestAnimationFrame(step);
        else res();
      };
      requestAnimationFrame(step);
    });
  }

  /** The slap: about 2 m from a bare classroom wall, looking at it, with a clear patch 30 degrees to one side. */
  async _stageSlap(wait) {
    const m = this.mode, g = m.game, w = g.world, d = this.d, b = d.blood;
    const rooms = (w.rooms || []).filter((r) => r && !r.isCorridor && (r.floor || 0) === 0).sort(() => Math.random() - 0.5);
    for (const r of rooms.slice(0, 10)) {
      for (const s of (m.decor._walls?.(r) || []).filter((s) => s.kind === ET.WALL || s.kind === ET.EXT)) {
        for (const a of [0, 1, -1, 1.6, -1.6]) {
          const p = { ...s, x: s.x + s.tx * a, z: s.z + s.tz * a };
          if (!b.wallClear(p, 0.3, 0) || !b.wallClear(p, 0.3, 0.45) || !b.wallClear(p, 0.3, -0.45)) continue;
          for (const side of [1, -1]) {
            const x = p.x + s.nx * 1.8 + s.tx * 1.05 * side, z = p.z + s.nz * 1.8 + s.tz * 1.05 * side;
            if (!w.isWalkable(x, z, 0.3, 0)) continue;
            g.player.spawn({ x, y: 0, z }, Math.atan2(s.nx, s.nz)); // facing the wall
            g.player.pitch = 0;
            await wait(400);
            if (d.play('blood_hand')) return true;
          }
        }
      }
    }
    return false;
  }

  /** The face in the glass: a door window 4-7 m away, just off to one side of your view. */
  async _stagePane(wait) {
    const m = this.mode, g = m.game, w = g.world, d = this.d;
    const panes = m.spotsCat.of('pane').filter((s) => (s.floor || 0) === 0);
    const stands = m.spotsCat.of('corridor');
    for (const s of panes.sort(() => Math.random() - 0.5).slice(0, 14)) {
      for (const st of stands) {
        const dd = Math.hypot(st.pos.x - s.pos.x, st.pos.z - s.pos.z);
        if (dd < 4 || dd > 7) continue;
        if (!w.lineOfSight({ x: st.pos.x, y: 1.6, z: st.pos.z }, { x: s.pos.x, y: 1.5, z: s.pos.z })) continue;
        const to = Math.atan2(-(s.pos.x - st.pos.x), -(s.pos.z - st.pos.z));
        g.player.spawn({ x: st.pos.x, y: 0, z: st.pos.z }, to + (Math.random() < 0.5 ? 1.1 : -1.1)); // just out of view: the tap turns you
        await wait(350);
        if (!d.gaze.canPlace(s.pos, [1.0, 1.6])) break;
        if (d.play('pane_face', { spot: s })) return true; // this window (the one you can see from here)
        break;
      }
    }
    return false;
  }

  /** Classrooms (ground floor): stand in the middle, facing one way. */
  _roomViews() {
    const w = this.mode.game.world, out = [];
    for (const r of w.rooms || []) {
      if (!r || r.isCorridor || (r.floor || 0) !== 0 || !r.center || !w.isWalkable(r.center.x, r.center.z, 0.3, 0)) continue;
      out.push({ a: r.center, yaw: ((Math.random() * 4) | 0) * (Math.PI / 2) });
    }
    return out.sort(() => Math.random() - 0.5);
  }

  _stand(v) {
    const g = this.mode.game;
    const yaw = v.yaw ?? Math.atan2(-(v.b.x - v.a.x), -(v.b.z - v.a.z)) + (v.off || 0);
    g.player.spawn({ x: v.a.x, y: 0, z: v.a.z }, yaw);
  }

  /** Take the player somewhere it works and play it. True if it started. */
  async go(id, { gesture = false } = {}) {
    const m = this.mode, d = this.d, g = m.game, dbg = this.debug;
    if (g.state !== 'playing') return (this._say('Start a run first.'), false);
    this.close(false);
    if (gesture) g.player.lockPointer?.(); // inside the click, so the browser allows it
    m.markDebug('gallery');
    dbg._setSafe?.(true);
    dbg.tour = null;
    if (!d.started) {
      m.started = true;
      d.begin(g.seed);
    }
    d.auto = false;
    d.forceAct = 3;
    d.stingGap = 6;
    this._reset();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    await wait(450);
    const name = GROUPS.flatMap(([, it]) => it).find(([x]) => x === id);
    const tip = name ? `${name[1]}: ${name[3]}` : id;
    if (id === 'blackout') {
      this._stand(this._views()[0]);
      await wait(400);
      const ok = d.forceBlackout();
      this._say(ok ? tip : 'Blackout: not possible right now, try again in a moment.');
      return ok;
    }
    if (id === 'desk_head') {
      // the one from the start of the run (or a new one in the nearest classroom), seen from 2 m
      let h = d.heads.list.find((x) => x.keep);
      if (!h) h = headOnDesk(d, nearestDeskRoom(d, g.player.position, { max: 80 })?.id, 7)?.head;
      if (!h) return (this._say('No teacher’s desk free for it.'), false);
      const o = h.obj.position;
      for (const a of [0, 0.5, -0.5, 1, -1, 1.6, -1.6, 2.4, -2.4, 3.1]) {
        const ang = h.obj.rotation.y + a;
        const x = o.x + Math.sin(ang) * 2.1, z = o.z + Math.cos(ang) * 2.1;
        if (!g.world.isWalkable(x, z, 0.3, 0)) continue;
        g.player.spawn({ x, y: 0, z }, Math.atan2(-(o.x - x), -(o.z - z)));
        g.player.pitch = -0.3;
        this._say(tip, 6);
        return true;
      }
      return (this._say('Could not find a place to stand by the desk.'), false);
    }
    if (CHANGES.has(id)) {
      const ok = await this._stageChange(id, wait);
      if (!ok) this._say(`${name[1]}: nothing left to change nearby. Try another, or start a new run.`, 6);
      else this._say(`${name[1]}: did you see what changed?`, 6);
      return ok;
    }
    if (id === 'blood_hand') {
      const ok = await this._stageSlap(wait);
      this._say(ok ? tip : `${name[1]}: no bare wall found right now. Click it again.`, 6);
      return ok;
    }
    if (id === 'pane_face') {
      const ok = await this._stagePane(wait);
      this._say(ok ? tip : `${name[1]}: no door window found right now. Click it again.`, 6);
      return ok;
    }
    if (id === 'door_close' || id === 'watcher_peek') {
      const ok = await this._stageDoor(id, wait);
      this._say(ok ? tip : `${name[1]}: no good door found right now. Click it again.`, 6);
      return ok;
    }
    if (id === 'locker') {
      const p = g.player, w = g.world;
      let best = null, bd = 1e9;
      for (const s of w.hidingSpots || []) {
        const dd = Math.hypot(s.position.x - p.position.x, s.position.z - p.position.z);
        if (!s.occupied && (s.floor || 0) === 0 && dd < bd) {
          bd = dd;
          best = s;
        }
      }
      if (!best) return (this._say('No locker found.'), false);
      p.spawn({ x: best.position.x, y: 0, z: best.position.z }, best.yaw || 0);
      await wait(300);
      p.enterHide?.(best);
      await wait(2200);
      const ok = d.play('locker');
      this._say(ok ? tip : 'The locker scare could not start here. Try again.');
      return ok;
    }
    // where to try: straight down corridors first, then looking off to the side, then classrooms (or the
    // other way round for the ones that need a room); the first try settles, the rest are quick
    const straight = id === 'opening' || id === 'fatiha' || id === 'light_glimpse' || id === 'charge';
    const views = this._views().slice(0, 10);
    const tries = [...views];
    if (!straight) for (const v of views) tries.push({ ...v, off: 1.15 }, { ...v, off: -1.15 });
    if (ROOM_FIRST.has(id)) tries.unshift(...this._roomViews().slice(0, 8));
    else if (!straight) tries.push(...this._roomViews().slice(0, 4));
    let first = true;
    for (const v of tries.slice(0, 40)) {
      this._stand(v);
      await wait(first ? 650 : 170);
      first = false;
      let ok = false;
      if (id === 'opening') ok = m.opening.arm({ now: true });
      else if (id === 'fatiha') {
        ok = d.play('light_glimpse');
        if (!ok) ok = m.recite.saw('watcher'); // no tube here: the recitation on its own
      } else ok = d.play(id);
      if (ok) return (this._say(tip, 6), true);
    }
    this.views = null; // try fresh views next time
    this._say(`${name ? name[1] : id}: no good place found for it right now. Click it again to try somewhere else.`, 6);
    return false;
  }

  /** Hand the building back to the director (still no Caretaker; untick "safe" in the panel for him). */
  normal() {
    const d = this.d;
    this.review.stop();
    d.forceAct = 0;
    d.stingGap = 45;
    d.auto = true;
    this.close(true);
    this._say('Normal run: the director is back in charge.', 4);
  }

  dispose() {
    this.review.dispose();
    this.el.remove();
  }
}
