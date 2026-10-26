/*
 * Event hall prototype: the page.
 *
 * Layout model (same as the Pack Room plan): the room is a 1x PNG shown at a
 * whole-number scale; HTML sits on top in room coordinates (native px x --s), and
 * text inside it is never scaled. Content width >= 1736 -> 4x (whiteboards),
 * >= 1302 -> 3x (1366 laptops), 868..1301 -> uniform fit, phones -> their own
 * composition at width/195.
 *
 * State comes from the URL or from the review shell (postMessage).
 */
(function () {
  "use strict";
  const D = window.HALL_DATA;
  const ART = window.HALL_ART || {};
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const DEFAULTS = { concept: "a", phase: "upcoming", season: "haunted", champ: "on", api: "ok", auth: "out", data: "real", lineup: "today", rm: "0", hot: "0" };
  const state = Object.assign({}, DEFAULTS);
  const qs = new URLSearchParams(location.search);
  for (const k in DEFAULTS) if (qs.has(k)) state[k] = qs.get(k);
  let sel = 0;
  let tab = "overall";
  let zoomed = false;
  let showAll = false;

  // ------------------------------------------------------------------ fallback geometry (art/CONTRACT.md + briefs)
  // Used only until a concept's manifest.json exists; boxes are drawn instead of art.
  const FALLBACK = {
    a: {
      title: "The Arcade Hall",
      desk: { w: 434, h: 230, cab: { w: 58, h: 96, screen: { x: 8, y: 18, w: 42, h: 32 }, button: { x: 5, y: 68, w: 48, h: 15 } },
        slots: [{ x: 118, y: 60 }, { x: 188, y: 60 }, { x: 258, y: 60 }], pool: { dx: -6, dy: 84 },
        zones: { board: { x: 8, y: 10, w: 94, h: 96, calm: { x: 15, y: 30, w: 80, h: 68 } }, quest: { x: 10, y: 110, w: 92, h: 42, calm: { x: 16, y: 134, w: 80, h: 14 } },
          prize: { x: 334, y: 24, w: 94, h: 132, calm: { x: 346, y: 160, w: 70, h: 14 } }, sign: { x: 142, y: 4, w: 150, h: 38 }, ticker: { x: 156, y: 44, w: 122, h: 10 }, panel: { x: 112, y: 166, w: 210, h: 58 } } },
      phone: { w: 195, h: 236, slot: { x: 68, y: 96 }, zones: { sign: { x: 22, y: 4, w: 150, h: 30 }, ticker: { x: 34, y: 36, w: 126, h: 9 } } },
    },
    b: {
      title: "The School Hall",
      desk: { w: 434, h: 230, cab: { w: 48, h: 84, screen: { x: 6, y: 14, w: 36, h: 30 }, button: { x: 0, y: 0, w: 0, h: 0 } },
        slots: [{ x: 140, y: 62 }, { x: 193, y: 62 }, { x: 246, y: 62 }], pool: { dx: -8, dy: 72 }, spot: { dx: -8, dy: -26 },
        zones: { board: { x: 10, y: 38, w: 96, h: 72, calm: { x: 16, y: 54, w: 84, h: 50 } }, quest: { x: 328, y: 38, w: 96, h: 66, calm: { x: 336, y: 86, w: 80, h: 12 } },
          prize: { x: 332, y: 108, w: 92, h: 56, calm: { x: 350, y: 166, w: 56, h: 12 } }, sign: { x: 136, y: 38, w: 162, h: 18 }, ticker: { x: 150, y: 172, w: 134, h: 9 }, panel: { x: 120, y: 184, w: 194, h: 44 },
          tickets: [{ x: 140, y: 152, w: 48, h: 15 }, { x: 193, y: 152, w: 48, h: 15 }, { x: 246, y: 152, w: 48, h: 15 }] } },
      phone: { w: 195, h: 252, slot: { x: 73, y: 112 }, zones: { sign: { x: 16, y: 18, w: 163, h: 18 } } },
    },
    c: {
      title: "The Possessed Arcade",
      desk: { w: 434, h: 230, cab: { w: 64, h: 104, screen: { x: 9, y: 20, w: 46, h: 38 }, button: { x: 8, y: 72, w: 48, h: 15 } },
        slots: [{ x: 40, y: 96 }, { x: 185, y: 90 }, { x: 330, y: 96 }], pool: { dx: -10, dy: 96 },
        zones: { board: { x: 155, y: 8, w: 124, h: 82, calm: { x: 167, y: 20, w: 100, h: 58 } }, quest: { x: 118, y: 84, w: 46, h: 88, calm: { x: 122, y: 154, w: 38, h: 12 } },
          prize: { x: 268, y: 62, w: 46, h: 84 }, sign: { x: 16, y: 4, w: 118, h: 30 }, ticker: { x: 24, y: 36, w: 102, h: 9 }, panel: { x: 120, y: 182, w: 194, h: 42 } } },
      phone: { w: 195, h: 300, slot: { x: 65, y: 150 }, zones: { board: { x: 43, y: 10, w: 110, h: 72, calm: { x: 53, y: 20, w: 90, h: 50 } } } },
    },
  };
  const man = () => ART[state.concept] || FALLBACK[state.concept];
  const hasArt = () => !!ART[state.concept];
  const base = () => `art/${state.concept}/`;
  const size = (file) => (man().sizes || {})[file];

  // easter-egg lines: short, gentle, never a scare
  const EGGS = {
    ghost: "Shh. It only haunts this machine.",
    pumpkin: "This pumpkin has seen every high score since 2025.",
    room000: "Room 000. The door is locked. For now.",
    "room-000": "Room 000. The door is locked. For now.",
    "moon-cab": "This one only plays at full moon.",
    mop: "Somebody left the mop. It's not moving. Probably.",
    clock: "The clock always says 3:15. Last bell.",
    cat: "The arcade cat. It is not on the leaderboard.",
    skylight: "The moon keeps an eye on the high scores.",
    crow: "Caw.",
    keys: "The caretaker's keys. One tag just says 000.",
    booth: "Madame Moon is on her break.",
  };
  const HAUNTED_EGGS = new Set(["ghost", "pumpkin", "spider", "bat", "bats", "crow"]);

  // ------------------------------------------------------------------ layout
  function layout() {
    const W = document.documentElement.clientWidth;
    if (W < 900) {
      const m = man().phone;
      return { mode: "phone", s: Math.max(1.6, W / m.w), W, fs: 2 };
    }
    const cw = W - 64;
    const s = cw >= 1736 ? 4 : cw >= 1302 ? 3 : Math.max(2, cw / 434);
    return { mode: "desk", s, W, fs: s >= 4 ? 4 : 3, board: cw >= 1736 };
  }

  // ------------------------------------------------------------------ lineup and copy
  function lineup() {
    const G = D.CONFIG.games;
    if (state.lineup === "all") return G.map((g) => ({ key: g.key, game: g, open: true }));
    return [{ key: "lastbell", game: G[0], open: true }, { key: "mystery", game: G[1], open: false }, { key: "mystery", game: G[2], open: false }];
  }
  const champOn = () => state.champ === "on";
  const L = D.LABELS;
  const short = (g) => g.short || g.title;

  let tickerShort = false;
  // short = a narrow ticker plate
  function tickerText(now, short) {
    if (!champOn()) return { t: short ? "Rewards to be announced" : "Scoring and rewards: to be announced", tone: "idle" };
    if (state.phase === "upcoming") { const c = D.countdown(Date.parse(D.CONFIG.opensAt), now); return { t: short ? `Opens ${L.opens}` : `Opens ${L.opens} · in ${c.text}`, tone: "soon" }; }
    if (state.phase === "live") return { t: short ? `Live · until ${L.lastDay}` : `Live · last ranked runs ${L.lastDay} 23:59`, tone: "live" };
    if (state.phase === "closed") return { t: short ? `Closed · final ${L.resultsBy}` : `Closed · results final by ${L.resultsBy}`, tone: "idle" };
    return { t: "Final results are in", tone: "final" };
  }

  function gameStatus(slot) {
    const g = slot.game;
    if (!slot.open) return { chip: "Mystery cabinet", line: "A game joins when its Fright Fest mode is ready and its board opens. Its Fright Points count from that moment.", play: false };
    if (!champOn()) return { chip: g.modeShort, line: `Play ${g.mode} any time. Scoring and rewards: to be announced.`, play: true };
    if (state.phase === "upcoming") return { chip: `Opens ${L.opens}`, line: `Ranked runs open ${L.opens}, 00:00 UK time. Practise now; nothing counts until then.`, play: true };
    if (state.phase === "live") return { chip: "Ranked · live", line: `Ranked until ${L.lastDay}, 23:59 UK. Your best run counts.`, play: true };
    if (state.phase === "closed") return { chip: "Board closed", line: `Ranked runs have closed. Results are checked and final by ${L.resultsBy}.`, play: true };
    return { chip: "Final", line: "The results are final. The mode stays open for fun.", play: true };
  }

  // ------------------------------------------------------------------ small builders
  const box = (r, cls, inner = "", attrs = "") =>
    r ? `<div class="ov ${cls}" style="--x:${r.x};--y:${r.y};--w:${r.w};--h:${r.h}" ${attrs}>${inner}</div>` : "";
  const ovImg = (file, cls, x, y, on) => {
    const sz = size(file);
    return sz ? `<img class="${cls}${on ? " is-on" : ""}" src="${base()}${file}" alt="" draggable="false" style="--x:${x};--y:${y};--iw:${sz.w};--ih:${sz.h}">` : "";
  };
  const img = (file, cls, extra = "") => `<img class="${cls}" src="${base()}${file}" alt="" draggable="false" ${extra}>`;

  function anims(list, season) {
    return (list || []).filter((a) => a.season === "both" || a.season === season).map((a) => {
      const sz = size(a.file) || { w: (a.w || 8) * a.frames, h: a.h || 8 };
      const fw = sz.w / a.frames;
      return `<div class="anim" aria-hidden="true" style="--x:${a.x};--y:${a.y};--w:${fw};--h:${sz.h};--frames:${a.frames};--dur:${(a.frames / (a.fps || 4)).toFixed(3)}s;background-image:url('${base()}${a.file}')"></div>`;
    }).join("");
  }

  // ------------------------------------------------------------------ in-scene high-score board
  function boardScreen(pub, mine, rows) {
    if (!champOn()) return `<div class="bs-msg"><b>To be announced</b><span>The cabinets still play.</span></div>`;
    if (state.api === "loading") return `<div class="bs-head"><span>Overall</span><span>Pts</span></div><ol class="bs-rows is-loading">${"<li><b>–</b><span>········</span><i>–</i></li>".repeat(rows)}</ol>`;
    if (!pub.available) return `<div class="bs-msg"><b>Scores offline</b><span>The machines still work. Try again in a minute.</span><button class="bs-retry" type="button" data-retry>Try again</button></div>`;
    const o = pub.standings.overall;
    const tag = (state.phase === "closed" ? `<em class="bs-tag">Provisional</em>` : state.phase === "finalised" ? `<em class="bs-tag is-final">Final</em>` : "") + (pub.sample ? `<em class="bs-tag is-sample">Sample</em>` : "");
    if (!o.length) {
      const msg = state.phase === "upcoming" ? [`Wakes up ${L.opens}`, "1st place on a board: 100 Fright Points"]
        : state.phase === "live" ? ["No ranked runs yet", "First place is open: 100 Fright Points"]
        : ["No ranked runs", "Nobody posted a ranked run"];
      return `<div class="bs-head"><span>Overall</span><span class="bs-tags">${tag}</span></div><div class="bs-msg"><b>${msg[0]}</b><span>${msg[1]}</span></div>`;
    }
    const you = mine.signedIn && mine.rank ? mine : null;
    const n = you && you.rank > rows ? rows - 1 : rows;
    const li = o.slice(0, n).map((e) => `<li class="r${e.rank <= 3 ? e.rank : ""}${pub.standings.championPublicId === e.publicId ? " is-champ" : ""}"><b>${e.rank}</b><span title="${esc(e.name)}">${esc(e.name)}</span><i>${e.points}</i></li>`).join("");
    const youLi = you && you.rank > n ? `<li class="is-you"><b>${you.rank}</b><span>You</span><i>${you.points}</i></li>` : "";
    return `<div class="bs-head"><span>${tag ? "Overall" : "Overall · Fright Points"}</span><span class="bs-tags">${tag}</span></div><ol class="bs-rows" data-src="GET /api/v1/championship/fright-fest-2026 → standings.overall">${li}${youLi}</ol>`;
  }

  // ------------------------------------------------------------------ details panel
  function panelHTML(slots, L2, compact) {
    const slot = slots[sel] || slots[0];
    const g = slot.game;
    const st = gameStatus(slot);
    if (!slot.open) {
      return `<div class="p-body"><p class="p-chip">${esc(st.chip)}</p><h2 class="p-title">??? <em>Not announced yet</em></h2><p class="p-line">${esc(st.line)}</p></div>`;
    }
    const phoneBlocked = L2.mode === "phone" && g.desktopOnly;
    const play = phoneBlocked
      ? `<span class="btn-play is-off">Play on a laptop</span>`
      : `<a class="btn-play" href="#play-${g.slug}" data-play="${g.slug}">Play ${esc(short(g))}</a>`;
    const board = champOn() && state.phase !== "upcoming" ? `<a class="btn-sec" href="#standings" data-tab="${g.slug}">See its board</a>` : champOn() ? `<a class="btn-sec" href="#rules">How it is ranked</a>` : "";
    return `<div class="p-body">
      <p class="p-chip">${esc(st.chip)}</p>
      <h2 class="p-title">${esc(short(g))} <em>${esc(g.mode)}</em></h2>
      <p class="p-line">${esc(champOn() ? g.rankingRule : g.tagline)}</p>
      ${compact ? "" : `<p class="p-sub">${esc(phoneBlocked ? "Last Bell needs a keyboard. Open HallPass on a laptop to play." : st.line)}</p>`}
    </div><div class="p-actions">${play}${board}</div>`;
  }

  // ------------------------------------------------------------------ the scene
  function sceneHTML(L2, pub, mine) {
    const M = man();
    const d = L2.mode === "desk" ? M.desk : M.phone;
    const season = state.season;
    const slots = lineup();
    const cab = M.desk.cab;
    const now = D.nowFor(state.phase);
    const tz0 = d.zones && (d.zones.ticker || d.zones.front);
    tickerShort = !!tz0 && tz0.w * L2.s < 340; // narrow plates (phones, concept C) get the short wording
    const tk = tickerText(now, tickerShort);
    let h = "";

    // art layers. A layered room (concept C) gets a background layer here and its
    // foreground layers after the overlays; each animation rides in its own layer so
    // parallax never separates a sprite from the art under it.
    const layered = hasArt() && L2.mode === "desk" && Array.isArray(M.desk.layers) && M.desk.layers.length > 0;
    const inLayer = (name) => (d.anims || []).filter((a) => (a.layer || "bg") === name);
    if (layered) {
      h += `<div class="layer" data-depth="${M.desk.bgDepth ?? -0.5}" aria-hidden="true">${img(d.files[season], "art")}${anims(inLayer("bg"), season)}</div>`;
    } else if (hasArt()) {
      h += img(d.files[season], "art") + anims(d.anims, season);
    } else {
      h += `<div class="art placeholder" aria-hidden="true"><span>${esc(M.title)} · art in progress</span></div>`;
    }
    // the ticker; in a layered room it rides in the layer that holds its plate
    const tz = d.zones && (d.zones.ticker || d.zones.front);
    const tickerBox = tz ? box(tz, `ticker is-${tk.tone}`, `<span>${esc(tk.t)}</span>`, `data-src="championship config + /api phase"`) : "";
    if (layered) {
      // depth layers sit under every interactive overlay: nothing in them overlaps a cabinet,
      // and the fog must never speckle over a Play strip
      for (const ly of M.desk.layers) {
        const file = ly.file || ly[season];
        if (!file) continue;
        const fog = ly.name === "fog";
        const top = ly.y ? `style="top:calc(${ly.y}px*var(--s))"` : "";
        h += `<div class="layer${fog ? " fog" : ""}" data-depth="${ly.depth}" ${top}><div aria-hidden="true">${img(file, "art" + (fog ? " fog-img" : ""))}${fog ? img(file, "art fog-img fog-2") : anims(inLayer(ly.name), season)}</div>${ly.name === "fg" ? tickerBox : ""}</div>`;
      }
    } else {
      h += tickerBox;
    }


    // board (desk always; phone only when the composition has it)
    const bz = d.zones && d.zones.board;
    if (bz) {
      const calm = bz.calm || bz;
      const rowH = L2.board ? 32 : 24;
      const rows = Math.max(3, Math.floor((calm.h * L2.s - (L2.board ? 84 : 72)) / rowH));
      h += box(calm, "board-screen", `<h2 class="sr-only">High scores</h2>${boardScreen(pub, mine, Math.min(rows, L2.mode === "phone" ? 3 : 6))}${champOn() ? `<a class="bs-more" href="#standings">Full standings</a>` : ""}`, `data-zone="board"`);
    }

    // phone glimpses of the board and the prize door at the edges of the room
    if (L2.mode === "phone" && d.zones) {
      if (d.zones.board_glimpse) h += box(d.zones.board_glimpse, "hot-zone", `<a href="#standings" aria-label="High scores board: see the standings"></a>`);
      if (d.zones.prize_glimpse) h += box(d.zones.prize_glimpse, "hot-zone prize-hit", `<a href="#prize-counter" data-peek aria-label="The prize counter: go to the Pack Room"></a>`);
    }
    // quest hotspot
    const qz = d.zones && d.zones.quest;
    if (qz) {
      h += box(qz, "hot-zone quest-hit", `<a href="#candy" aria-label="Candy Hunt noticeboard: see the notices"></a>`);
      if (qz.calm) h += box(qz.calm, "label quest-label", qz.calm.w * L2.s < 170 ? `<span>Candy Hunt<small>preview</small></span>` : `<span>Candy Hunt · preview</span>`);
    }
    // prize hotspot
    const pz = d.zones && d.zones.prize;
    if (pz) {
      h += box(pz, "hot-zone prize-hit", `<a href="#prize-counter" data-peek aria-label="The prize counter: go to the Pack Room"></a>`);
      if (pz.calm) h += box(pz.calm, "label prize-label", pz.calm.w * L2.s < 170 ? `<span>Prize<small>counter →</small></span>` : `<span>Prize counter →</span>`);
    }

    // cabinets
    if (L2.mode === "desk") {
      (M.desk.slots || []).forEach((p, i) => {
        const sl = slots[i]; if (!sl) return;
        h += cabinetHTML(sl, i, p, cab, M, L2);
      });
      // tickets (concept B) or play strips are inside cabinetHTML
      if (d.zones && d.zones.panel && !(state.concept === "c")) h += box(d.zones.panel, "panel", panelHTML(slots, L2, false), `role="region" aria-label="Selected machine"`);
    } else {
      h += phoneMachines(slots, M, d, L2);
    }

    // eggs
    const eggSeason = (e) => e.season || (HAUNTED_EGGS.has(e.name) ? "haunted" : "both");
    if (L2.mode === "desk") (M.desk.eggs || []).filter((e) => eggSeason(e) === "both" || eggSeason(e) === season).forEach((e) => {
      const line = EGGS[e.name] || "Nothing here. Probably.";
      // pointer-only bonus: kept out of the tab order and the accessibility tree
      h += box(e, "egg", `<button type="button" tabindex="-1" aria-hidden="true" data-egg="${esc(line)}"></button>`);
    });

    const dims = `--s:${L2.s};width:${d.w * L2.s}px;height:${d.h * L2.s}px`;
    const fg = "";
    return { html: h, fg, dims };
  }

  function cabinetHTML(sl, i, p, cab, M, L2) {
    const on = i === sel;
    const key = sl.key;
    const g = sl.game;
    const label = sl.open ? `${short(g)}: ${g.mode}. Cabinet ${i + 1} of 3` : `Mystery cabinet, not announced. Cabinet ${i + 1} of 3`;
    let h = "";
    const pool = M.desk.pool;
    if (hasArt() && pool) h += ovImg(pool.file || "pool-on.png", "pool", p.x + pool.dx, p.y + pool.dy, on);
    if (hasArt() && M.desk.spot) h += ovImg(M.desk.spot.file || "spot-on.png", "spot", p.x + M.desk.spot.dx, p.y + M.desk.spot.dy, on);
    const art = hasArt()
      ? cabArt(key, cab)
      : `<span class="cab-ph">${sl.open ? esc(short(g)) : "???"}</span>`;
    h += `<div class="cab${on ? " is-on" : ""} k-${key}" style="--x:${p.x};--y:${p.y};--w:${cab.w};--h:${cab.h}" data-slot="${i}">
      ${art}
      <button class="cab-hit" type="button" aria-pressed="${on}" aria-label="${esc(label)}" tabindex="${on ? 0 : -1}" data-select="${i}"></button>
    </div>`;
    // the PLAY strip: on the cabinet (A, C) or on the stage front (B)
    const zone = state.concept === "b" && M.desk.zones.tickets ? M.desk.zones.tickets[i]
      : cab.button && cab.button.w ? { x: p.x + cab.button.x, y: p.y + cab.button.y, w: cab.button.w, h: cab.button.h } : null;
    if (zone) {
      const inner = sl.open
        ? `<a class="play-strip" href="#play-${g.slug}" data-play="${g.slug}" aria-label="Play ${esc(short(g))}">${state.concept === "b" ? `<small aria-hidden="true">Admit one</small>Play` : "Play"}</a>`
        : `<span class="play-strip is-soon">Soon</span>`;
      h += box(zone, `play-zone${on ? " is-sel" : ""}`, inner);
    }
    return h;
  }

  // a cabinet's sprites; some keys have calm-season variants (e.g. the mystery cabinet's eyes)
  const seasonal = (f) => (state.season === "calm" && size(f.replace(".png", "-calm.png")) ? f.replace(".png", "-calm.png") : f);
  function cabArt(key, cab) {
    return `${img(seasonal(`cab-${key}-off.png`), "cab-img off")}${img(seasonal(`cab-${key}-on.png`), "cab-img on")}${screenAnim(key, cab)}`;
  }

  function screenAnim(key, cab) {
    const f = seasonal(`scr-${key}.png`);
    const sz = size(f);
    if (!sz || !cab.screen) return "";
    const frames = Math.max(1, Math.round(sz.w / cab.screen.w));
    return `<div class="scr anim" aria-hidden="true" style="--x:${cab.screen.x};--y:${cab.screen.y};--w:${sz.w / frames};--h:${sz.h};--frames:${frames};--dur:${(frames / 3).toFixed(2)}s;background-image:url('${base()}${f}')"></div>`;
  }

  function phoneMachines(slots, M, d, L2) {
    const cab = M.desk.cab;
    const p = d.slot;
    const sl = slots[sel] || slots[0];
    let h = "";
    if (state.concept === "a") {
      // a swipe row: every machine has its own snap panel the width of the room
      h += `<div class="ov swipe" style="--x:0;--y:${p.y - 6};--w:${d.w};--h:${cab.h + 12}" role="group" aria-label="Machines, swipe to choose">`;
      slots.forEach((s2, i) => {
        h += `<div class="swipe-item" data-index="${i}"><div class="cab${i === sel ? " is-on" : ""} k-${s2.key}" style="--x:${p.x};--y:6;--w:${cab.w};--h:${cab.h}">
          ${hasArt() ? cabArt(s2.key, cab) : `<span class="cab-ph">${s2.open ? esc(short(s2.game)) : "???"}</span>`}
          <button class="cab-hit" type="button" aria-pressed="${i === sel}" aria-label="${esc(s2.open ? short(s2.game) : "Mystery cabinet, not announced")}" tabindex="${i === sel ? 0 : -1}" data-select="${i}"></button></div></div>`;
      });
      h += `</div>`;
      const below = (d.zones && d.zones.panel) || { x: 0, y: p.y + cab.h + 4, w: d.w, h: Math.max(14, d.h - (p.y + cab.h + 4)) };
      h += box(below, "phone-dots", `<button type="button" class="arrow" data-step="-1" aria-label="Previous machine">◀</button><span>${slots.map((s2, i) => `<i class="${i === sel ? "on" : ""}"></i>`).join("")}</span><button type="button" class="arrow" data-step="1" aria-label="Next machine">▶</button>`);
    } else {
      const ps = (M.phone && M.phone.spot) || M.desk.spot, pp = (M.phone && M.phone.pool) || M.desk.pool;
      if (hasArt() && ps) h += ovImg(ps.file || "spot-on.png", "spot", p.x + ps.dx, p.y + ps.dy, true);
      if (hasArt() && pp) h += ovImg(pp.file || "pool-on.png", "pool", p.x + pp.dx, p.y + pp.dy, true);
      h += `<div class="cab is-on k-${sl.key}" style="--x:${p.x};--y:${p.y};--w:${cab.w};--h:${cab.h}">
        ${hasArt() ? cabArt(sl.key, cab) : `<span class="cab-ph">${sl.open ? esc(short(sl.game)) : "???"}</span>`}</div>`;
      const below = (d.zones && (d.zones.tabs || d.zones.footer)) || { x: 0, y: p.y + cab.h + 4, w: d.w, h: Math.max(16, d.h - (p.y + cab.h + 4)) };
      if (state.concept === "b") {
        h += box(below, "pass-tabs", slots.map((s2, i) => `<button type="button" class="pass${i === sel ? " on" : ""}" aria-pressed="${i === sel}" data-select="${i}"><small>Hall pass</small>${s2.open ? esc(short(s2.game)) : "???"}</button>`).join(""), `role="group" aria-label="Choose a machine"`);
      } else {
        const z = d.zones || {};
        h += box(z.navL || { x: 0, y: p.y + 30, w: 40, h: 50 }, "side-arrow", `<button type="button" class="arrow" data-step="-1" aria-label="Previous machine">◀</button>`);
        h += box(z.navR || { x: d.w - 40, y: p.y + 30, w: 40, h: 50 }, "side-arrow", `<button type="button" class="arrow" data-step="1" aria-label="Next machine">▶</button>`);
        h += box(below, "phone-dots", `<span>${slots.map((s2, i) => `<i class="${i === sel ? "on" : ""}"></i>`).join("")}</span><b>${sl.open ? esc(short(sl.game)) : "Mystery cabinet"}</b>`);
      }
    }
    return h;
  }

  // ------------------------------------------------------------------ sections under the scene
  function standingsHTML(pub, mine) {
    if (!champOn()) return "";
    const boards = pub.available ? pub.standings.boards : [];
    const tabs = [{ id: "overall", label: "Overall" }].concat(boards.map((b) => ({ id: b.slug, label: D.CONFIG.games.find((g) => g.slug === b.slug).short || b.title })));
    if (!tabs.find((t) => t.id === tab)) tab = "overall";
    const stamp = (state.phase === "closed" ? `<span class="stamp">Provisional</span>` : state.phase === "finalised" ? `<span class="stamp is-final">Final</span>` : "") + (pub.sample ? `<span class="stamp is-sample">Sample data</span>` : "");
    let body = "";
    if (state.api === "loading") body = `<div class="tbl-wrap"><table class="tbl is-loading"><tbody>${"<tr><td>–</td><td>········</td><td>–</td></tr>".repeat(8)}</tbody></table></div>`;
    else if (!pub.available) body = `<div class="empty"><b>The scores are offline for a moment.</b><p>Your runs are still being saved. The board comes back by itself; you can also <button type="button" class="link" data-retry>try again</button>.</p></div>`;
    else {
      const rows = tab === "overall" ? pub.standings.overall : (boards.find((b) => b.slug === tab) || { entries: [] }).entries;
      const g = D.CONFIG.games.find((x) => x.slug === tab);
      if (!rows.length) {
        body = state.phase === "upcoming"
          ? `<div class="empty"><b>The board wakes up on ${L.opens}.</b><p>Ranked runs open at 00:00 UK time. 1st place on a game's board is worth 100 Fright Points.</p></div>`
          : `<div class="empty"><b>No ranked runs yet.</b><p>First place is open. ${state.data === "real" ? "This is the honest state today: no real results exist yet. Turn on Sample data in the review bar to judge a full board." : ""}</p></div>`;
      } else {
        const lim = showAll ? 50 : 10;
        const you = mine.signedIn && mine.rank && tab === "overall" ? mine : null;
        const head = tab === "overall"
          ? `<tr><th scope="col">#</th><th scope="col">Player</th><th scope="col" class="num">Fright Points</th>${boards.map((b) => `<th scope="col" class="num hide-s">${esc(D.CONFIG.games.find((x) => x.slug === b.slug).short || b.title)}</th>`).join("")}</tr>`
          : `<tr><th scope="col">#</th><th scope="col">Player</th><th scope="col" class="num">${esc(g.metric.label)}</th><th scope="col" class="num">Points</th></tr>`;
        const tr = rows.slice(0, lim).map((e) => tab === "overall"
          ? `<tr class="r${e.rank <= 3 ? e.rank : ""}${pub.standings.championPublicId === e.publicId ? " is-champ" : ""}"><td class="rk">${e.rank}</td><td class="nm">${esc(e.name)}${pub.standings.championPublicId === e.publicId ? ` <span class="crown">Champion</span>` : ""}${!e.eligible ? ` <span class="miss" title="Needs a result on every open board">not on every board</span>` : ""}</td><td class="num pts">${e.points}</td>${boards.map((b) => `<td class="num hide-s">${e.games[b.slug] ? D.ordinal(e.games[b.slug].rank) : "–"}</td>`).join("")}</tr>`
          : `<tr class="r${e.rank <= 3 ? e.rank : ""}"><td class="rk">${e.rank}</td><td class="nm">${esc(e.name)}</td><td class="num">${D.fmtScore(g.metric, e.score)}</td><td class="num pts">${e.points}</td></tr>`).join("");
        const youRow = you && you.rank > lim ? `<tr class="is-you"><td class="rk">${you.rank}</td><td class="nm">You <small>(${esc(you.name)})</small></td><td class="num pts">${you.points}</td>${boards.map((b) => `<td class="num hide-s">${(you.boards.find((x) => x.slug === b.slug) || {}).rank ? D.ordinal(you.boards.find((x) => x.slug === b.slug).rank) : "–"}</td>`).join("")}</tr>` : "";
        body = `<div class="tbl-wrap"><table class="tbl"><caption class="sr-only">${tab === "overall" ? "Overall Fright Points" : esc(g.title) + " board"}</caption><thead>${head}</thead><tbody>${tr}${youRow}</tbody></table></div>
          ${rows.length > 10 ? `<button type="button" class="link more" data-more>${showAll ? "Show the top 10" : `Show all ${Math.min(rows.length, 50)}`}</button>` : ""}`;
      }
    }
    const pending = pub.available && pub.standings.pendingGames ? `<p class="note">${pub.standings.pendingGames === 1 ? "One more game joins" : pub.standings.pendingGames + " more games join"} when its Fright Fest mode is ready. Unannounced games are not named here.</p>` : "";
    const ahead = mine.signedIn && mine.rank && pub.available ? pub.standings.overall.filter((e) => e.points > mine.points).pop() : null;
    const gap = ahead && !["closed", "finalised"].includes(state.phase) ? ` The next place up, ${D.ordinal(ahead.rank)}, is ${ahead.points - mine.points} Fright Points ahead.` : "";
    const meLine = mine.signedIn ? (mine.available && mine.rank ? `<p class="me">You are <b>${D.ordinal(mine.rank)}</b> overall with <b>${mine.points}</b> Fright Points.${gap}${mine.eligible ? "" : " Get a result on every open board to be eligible for Overall Champion."}</p>` : `<p class="me">You have no ranked run yet.</p>`) : `<p class="me"><a href="#">Sign in</a> to be ranked. Guests can play the modes, but their runs are not ranked.</p>`;
    return `<section id="standings" class="sec sec-board frame-board" aria-labelledby="st-h">
      <header class="sec-head"><h2 id="st-h">High scores</h2>${stamp}</header>
      <p class="sec-lede">Fright Points come from your rank on each game's board, and they decide the champion. They can't be spent.</p>
      <div class="tabs" role="tablist" aria-label="Boards">${tabs.map((t) => `<button type="button" role="tab" aria-selected="${t.id === tab}" data-tabbtn="${t.id}" tabindex="${t.id === tab ? 0 : -1}">${esc(t.label)}</button>`).join("")}</div>
      <div role="tabpanel" data-src="GET /api/v1/championship/fright-fest-2026 (CDN 30 s) + /me (no-store)">${body}</div>${pending}${meLine}
    </section>`;
  }

  function candyHTML() {
    const tierIcons = (t) => t ? `<span class="tier t${t}" aria-hidden="true">${"<i></i>".repeat(t)}</span>` : "";
    const named = (g) => !g || state.lineup === "all" || g.slug === "last-bell"; // unannounced games are never named
    const notes = D.QUESTS.map((q, i) => {
      const g = q.game ? D.CONFIG.games.find((x) => x.slug === q.game) : null;
      const show = named(g);
      const src = show ? q.source : "Waits for the game to be announced";
      return `<li class="note-card k-${q.kind}${q.kind === "slot" ? " is-slot" : ""}" style="--tilt:${[-2, 1, -1, 2, -1, 1, -2][i % 7]}" data-src="${esc(src)}">
        <span class="pin" aria-hidden="true"></span>
        <p class="nc-game">${g ? esc(show ? short(g) : "A mystery cabinet") : "Every open board"}</p>
        <h3>${esc(q.title)}</h3>
        <p>${esc(!show && q.kind === "slot" ? "A notice goes up if this game joins and can tell HallPass about your runs." : q.text)}</p>
        <footer>${q.tier ? tierIcons(q.tier) + `<span class="tier-word">${D.TIERS[q.tier]} reward</span>` : `<span class="tier-word">No notice yet</span>`}</footer>
      </li>`;
    }).join("");
    return `<section id="candy" class="sec sec-quest frame-quest" aria-labelledby="cd-h">
      <header class="sec-head"><h2 id="cd-h">Candy Hunt</h2><span class="stamp is-preview">Preview · not open</span></header>
      <p class="sec-lede">Candy Hunt isn't open. This is a preview of how it could work, and nothing here can be earned.</p>
      <div class="currencies">
        <div class="cur cur-pts"><b>Fright Points</b><p>Earned by your rank on each game's board. They decide the championship. You can't spend them.</p></div>
        <div class="cur cur-candy"><b>Halloween Candy</b><p>Would be earned from notices like these and traded for packs at the prize counter. Never bought, never ranked.</p></div>
      </div>
      <ul class="notes">${notes}</ul>
      <ol class="flow" aria-label="How Candy Hunt would work">
        <li class="is-preview">Pick a notice and play <small>not open</small></li><li class="is-preview">Earn Candy <small>not open</small></li><li class="is-preview">Trade it at the prize counter <small>not open</small></li><li>Open your pack</li><li>Keep the cards in your binder</li>
      </ol>
      <p class="boundary dev-only"><b>Integration boundary (review note).</b> Notice conditions can use data HallPass already has: Last Bell's achievements and the championship's own progress (MyProgress). Candy balances, amounts and the trade do not exist anywhere, so rewards are shown as Small, Medium and Large. Games that report no achievements to HallPass get blank notices.</p>
    </section>`;
  }

  function prizesHTML(pub) {
    const M = man();
    const el = M.elements && M.elements.prize;
    const elFile = el && (state.season === "calm" && el.calm_file ? el.calm_file : el.file);
    const door = hasArt() && el ? `<img class="el" src="${base()}${elFile}" alt="" style="width:${el.w * 2}px">` : "";
    const packs = state.champ === "on" ? D.PACKS.filter((p) => !p.game || state.lineup === "all" || p.game === "last-bell").map((p) => `
      <li class="pack">
        <img src="art/packs/${p.art}" alt="" width="96" height="140">
        <div><h3>${esc(p.name)}</h3><p class="who">${esc(p.who)}</p>
          <ul class="slots">${p.slots.map((s) => s.fixed ? `<li class="fixed r-${s.rarity}"><b>Guaranteed</b> ${esc(s.fixed)} <small>${s.rarity}</small></li>` : `<li class="rand"><b>1 random card</b> ${oddsText(s.random)}</li>`).join("")}</ul>
          ${state.phase === "finalised" && pub.sample && p.id === "ff26-overall-winner" && pub.standings.championPublicId ? `<p class="won">Won by ${esc(pub.standings.overall[0].name)} <small>(sample)</small></p>` : ""}
        </div>
      </li>`).join("") : "";
    const hidden = state.lineup !== "all" ? `<p class="note">Two more Game Champion Packs are ready for the mystery cabinets' boards if they open.</p>` : "";
    return `<section id="prize-counter" class="sec sec-prize frame-prize" aria-labelledby="pz-h">
      <header class="sec-head"><h2 id="pz-h">The prize counter</h2></header>
      <div class="walkup">${door}<div><p>Packs you win wait for you at the prize counter, in the Pack Room. It stays open after Halloween.</p>
        ${state.auth === "in" && state.data === "sample" ? `<p class="me">You have <b>2 sealed packs</b> <small>(sample)</small></p>` : ""}
        <a class="btn-sec" href="#prize-counter" data-peek>Walk to the prize counter</a></div></div>
      ${packs ? `<h3 class="sub">Fright Fest rewards</h3><p class="lede">Free digital packs. Nothing is sold and nothing is posted. Packs are given out once the results are final; one player can earn several.</p><ul class="packs">${packs}</ul>${hidden}
      <details class="odds"><summary>Odds for the random cards</summary>${oddsTable()}</details>` : `<p class="lede">Rewards: to be announced.</p>`}
    </section>`;
  }
  function oddsText(key) { const o = D.ODDS[key]; return Object.entries(o).map(([k, v]) => `${k} ${v}%`).join(" · "); }
  function oddsTable() {
    return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th scope="col">Slot</th>${["common", "uncommon", "rare", "epic", "legendary"].map((r) => `<th scope="col" class="num">${r}</th>`).join("")}</tr></thead><tbody>
      ${Object.entries({ standard: "Standard", rareOrBetter: "Rare or better", epicOrBetter: "Epic or better" }).map(([k, n]) => `<tr><td>${n}</td>${["common", "uncommon", "rare", "epic", "legendary"].map((r) => `<td class="num">${D.ODDS[k][r] ? D.ODDS[k][r] + "%" : "–"}</td>`).join("")}</tr>`).join("")}
    </tbody></table></div><p class="note">From the collectibles catalogue. Within a rarity every eligible card is equally likely.</p>`;
  }

  function rulesHTML() {
    if (!champOn()) return "";
    const pts = D.CONFIG.points;
    const bands = [[1, 1, 100], [2, 2, 80], [3, 3, 65], [4, 5, 40], [6, 10, 20], [11, null, 5]];
    return `<section id="rules" class="sec sec-rules frame-paper" aria-labelledby="ru-h">
      <header class="sec-head"><h2 id="ru-h">How Fright Points work</h2></header>
      <div class="rules-grid">
        <div><p>Your rank on each game's board earns Fright Points. Every game is worth the same, so no single game decides it.</p>
          <table class="tbl pts-tbl"><caption class="sr-only">Fright Points by rank on a game board</caption><thead><tr><th scope="col">Rank on a board</th><th scope="col" class="num">Points</th></tr></thead><tbody>
          ${bands.map(([a, b, p]) => `<tr><td>${b === null ? D.ordinal(a) + " and below" : a === b ? D.ordinal(a) : D.ordinal(a) + " to " + D.ordinal(b)}</td><td class="num">${p}</td></tr>`).join("")}<tr><td>No result</td><td class="num">0</td></tr></tbody></table></div>
        <div><ul class="rules">
          <li><b>When:</b> ranked runs count from ${L.opens}, 00:00 to ${L.lastDay}, 23:59 UK time. A run you started before the close has ${D.CONFIG.submitGraceMin} more minutes to finish.</li>
          <li><b>Who:</b> anyone signed in to HallPass. Guests can play the modes, but their runs are not ranked.</li>
          <li><b>Names:</b> the board shows your HallPass handle or @username, never your real name.</li>
          <li><b>Your best counts:</b> a worse run never costs you anything.</li>
          <li><b>The champion</b> is the highest-placed player with a result on every game in the championship.</li>
          <li><b>Checks:</b> standings are provisional until the results are checked, final by ${L.resultsBy}.</li>
        </ul></div>
      </div>
    </section>`;
  }

  // ------------------------------------------------------------------ the "current page" reconstructions
  function currentHTML(L2) {
    const live = state.concept === "current";
    if (live) {
      const shot = L2.mode === "phone" ? "art/current/ff-phone.png" : "art/current/ff-1366-full.png";
      return `<div class="current-shot"><p class="cur-note">Live today on hallpass.games (main), captured 26 Oct 2026 at ${L2.mode === "phone" ? "390 px" : "1366 px"}.</p><img src="${shot}" alt="Screenshot of the current Fright Fest page"></div>`;
    }
    // championship branch: the night card plus FrightFestSections, rebuilt from its markup
    const pub = D.championship(state); const mine = D.me(state, pub);
    const c = D.countdown(Date.parse(D.CONFIG.opensAt), D.nowFor("upcoming"));
    return `<div class="cur-branch"><p class="cur-note">The fright-fest-championship branch (not merged), rebuilt from its components.</p>
      <section class="cb-card cb-scene"><p class="cb-k">HallPass presents</p><h1 class="cb-title">Fright Fest 2026</h1><p>Fright Fest opens on 28 Oct (UK).</p>
      <div class="cb-cd">${[["Days", c.d], ["Hrs", c.text.split(" ")[1] || "00"], ["Min", "14"], ["Sec", "51"]].map(([k, v]) => `<div><b>${String(parseInt(v, 10)).padStart(2, "0")}</b><span>${k}</span></div>`).join("")}</div>
      <p class="cb-small">Earn Fright Points, top the table, win collectible packs. Rules and standings below.</p></section>
      <section class="cb-card"><h2>Standings</h2><div class="cb-tabs"><span>Overall</span><span>Last Bell</span></div><p class="cb-muted">Nothing ranked yet.</p></section>
      <section class="cb-card"><h2>Your Fright Fest</h2><p class="cb-muted">Sign in to see your progress.</p></section>
      <div class="cb-grid"><section class="cb-card"><h2>How Fright Points work</h2><p class="cb-muted">Your rank on each game's board earns Fright Points…</p></section><section class="cb-card"><h2>When</h2><p class="cb-muted">Ranked runs open: Wed 28 Oct, 00:00 UK time…</p></section></div>
      <section class="cb-card"><h2>Rules</h2><p class="cb-muted">Who, names, your best counts, fair play, checks and results…</p></section>
      <section class="cb-card"><h2>Rewards</h2><div class="cb-grid3"><div>Participation Pack</div><div>Game Champion Pack</div><div>Overall Champion Pack</div></div></section></div>`;
  }

  // ------------------------------------------------------------------ render
  let L2 = null;
  function render() {
    const root = document.documentElement;
    root.dataset.concept = state.concept;
    root.dataset.season = state.season;
    root.classList.toggle("rm", state.rm === "1" || matchMedia("(prefers-reduced-motion: reduce)").matches);
    root.classList.toggle("hot", state.hot === "1");
    root.classList.toggle("signed-in", state.auth === "in");
    L2 = layout();
    root.dataset.layout = L2.mode;
    root.classList.toggle("wb", !!L2.board);
    root.dataset.selkey = (lineup()[sel] || {}).key || "";
    root.style.setProperty("--fs", L2.fs);
    const main = document.getElementById("main");
    const M = man() || {}; // the "current page" views have no room
    if (M.tile && hasArt()) root.style.setProperty("--tile", `url('${base()}${M.tile}')`); else root.style.removeProperty("--tile");
    const fr = M.frames || {};
    for (const k of ["board", "quest", "prize", "paper"]) {
      if (fr[k] && hasArt()) { root.style.setProperty(`--frame-${k}`, `url('${base()}${fr[k].file}')`); root.style.setProperty(`--frame-${k}-fill`, fr[k].fill || "#0b0612"); }
      else { root.style.removeProperty(`--frame-${k}`); root.style.removeProperty(`--frame-${k}-fill`); }
    }

    if (state.concept === "current" || state.concept === "current-branch") {
      main.innerHTML = currentHTML(L2);
      return;
    }
    const pub = D.championship(state);
    const mine = D.me(state, pub);
    const sc = sceneHTML(L2, pub, mine);
    const slots = lineup();
    const C = state.concept === "c";
    const zoomPanel = C && L2.mode === "desk"
      ? `<div class="zoom-panel${zoomed ? " is-open" : ""}${(M.desk.slots[sel] || {}).x > 200 ? " on-left" : ""}" role="region" aria-label="Selected machine" tabindex="-1">${panelHTML(slots, L2, false)}<button type="button" class="btn-ghost" data-unzoom>Back to the hall</button></div>` : "";
    main.innerHTML = `
      <h1 class="sr-only">Fright Fest 2026</h1>
      <section class="stage" aria-label="The event hall">
        <div class="viewport" style="${sc.dims}">
          <div class="scene" style="${sc.dims}">${sc.html}${sc.fg}</div>
        </div>
        ${zoomPanel}
      </section>
      ${L2.mode === "phone" ? `<section class="sec phone-panel" aria-label="Selected machine">${panelHTML(slots, L2, false)}</section>` : ""}
      ${L2.mode === "phone" && !(man().phone.zones || {}).board ? phoneBoard(pub, mine) : ""}
      <div class="below">
        ${standingsHTML(pub, mine)}
        ${prizesHTML(pub)}
        ${rulesHTML()}
        ${candyHTML()}
        <footer class="foot"><p>Design prototype for review · concept ${state.concept.toUpperCase()} · ${esc(M.title)}. Links do not leave the prototype.</p></footer>
      </div>`;
    applyZoom(false);
    wire();
    observeAnims();
  }

  function phoneBoard(pub, mine) {
    if (!champOn()) return "";
    return `<section class="sec sec-mini frame-board" aria-labelledby="mb-h"><header class="sec-head"><h2 id="mb-h">High scores</h2></header><div class="board-screen is-flow">${boardScreen(pub, mine, 3)}<a class="bs-more" href="#standings">Full standings</a></div></section>`;
  }

  // ------------------------------------------------------------------ zoom (concept C)
  function applyZoom(animate) {
    if (state.concept !== "c" || !L2 || L2.mode !== "desk") return;
    const scene = document.querySelector(".scene");
    if (!scene) return;
    const M = man(); const s = L2.s; const p = M.desk.slots[sel]; const cab = M.desk.cab;
    if (!zoomed || !p) { scene.style.setProperty("--s", s); scene.style.transform = ""; scene.classList.remove("is-zoomed"); return; }
    const z = s * 4 / 3;
    const cx = (p.x + cab.w / 2), cy = (p.y + cab.h / 2);
    const vw = 434 * s, vh = 230 * s;
    // keep the cabinet a little off-centre so the panel has room on the other side
    const targetX = p.x > 200 ? vw * 0.66 : vw * 0.34;
    let ox = targetX - cx * z, oy = vh * 0.5 - cy * z;
    ox = Math.min(0, Math.max(vw - 434 * z, ox)); oy = Math.min(0, Math.max(vh - 230 * z, oy));
    scene.style.setProperty("--s", z);
    scene.style.width = 434 * z + "px"; scene.style.height = 230 * z + "px";
    scene.style.transform = `translate(${Math.round(ox)}px, ${Math.round(oy)}px)`;
    scene.classList.add("is-zoomed");
    scene.querySelectorAll("a, button").forEach((el) => { el.tabIndex = -1; });
  }

  // ------------------------------------------------------------------ events
  // how: "key" (arrow keys: focus stays on the cabinets), "click" (pointer or Enter), null (phone arrows)
  function select(i, how) {
    const n = lineup().length;
    sel = ((i % n) + n) % n;
    const zoom = state.concept === "c" && L2 && L2.mode === "desk" && how === "click";
    if (zoom) zoomed = true;
    render();
    const sl = lineup()[sel];
    announce(sl.open ? `${short(sl.game)} selected. ${gameStatus(sl).chip}.` : "Mystery cabinet selected. Not announced yet.");
    const zp = document.querySelector(".zoom-panel.is-open");
    if (zoom && zp) { zp.focus(); return; }
    const b = document.querySelector(`[data-select="${sel}"]`); if (b && how) b.focus();
    if (L2.mode === "phone" && state.concept === "a") {
      const sw = document.querySelector(".swipe"); if (sw) sw.scrollTo({ left: sel * sw.clientWidth, behavior: "instant" });
    }
  }

  function wire() {
    const main = document.getElementById("main");
    main.onclick = (e) => {
      const t = e.target.closest("[data-select],[data-step],[data-tabbtn],[data-more],[data-retry],[data-peek],[data-play],[data-tab],[data-unzoom],[data-egg]");
      if (!t) return;
      if (t.dataset.select !== undefined) { select(+t.dataset.select, "click"); return; }
      if (t.dataset.step) { const k = t.dataset.step; select(sel + +k, null); const st = document.querySelector(`[data-step="${k}"]`); if (st) st.focus(); return; }
      if (t.dataset.tabbtn) { tab = t.dataset.tabbtn; showAll = false; render(); document.querySelector(`[data-tabbtn="${tab}"]`).focus(); return; }
      if (t.dataset.more !== undefined) { showAll = !showAll; render(); return; }
      if (t.dataset.retry !== undefined) { state.api = "ok"; render(); post("hall-state", { api: "ok" }); return; }
      if (t.dataset.unzoom !== undefined) { zoomed = false; render(); const b = document.querySelector(`[data-select="${sel}"]`); if (b) b.focus(); return; }
      if (t.dataset.tab) { e.preventDefault(); tab = t.dataset.tab; render(); document.getElementById("standings").scrollIntoView({ behavior: state.rm === "1" ? "auto" : "smooth" }); return; }
      if (t.dataset.peek !== undefined) { e.preventDefault(); openPeek(t); return; }
      if (t.dataset.play) { e.preventDefault(); toast(`In production this opens /game/${t.dataset.play} and its Fright Fest mode.`); return; }
      if (t.dataset.egg) { const b = t; b.classList.add("is-boo"); b.setAttribute("data-bubble", t.dataset.egg); setTimeout(() => b.classList.remove("is-boo"), 1800); }
    };
    // arrow keys move between cabinets (roving), Escape leaves the zoom
    main.onkeydown = (e) => {
      const onCab = e.target.matches && e.target.matches("[data-select]");
      if (onCab && (e.key === "ArrowRight" || e.key === "ArrowLeft")) { e.preventDefault(); select(sel + (e.key === "ArrowRight" ? 1 : -1), "key"); }
      if (e.key === "Escape" && zoomed) { zoomed = false; render(); const b = document.querySelector(`[data-select="${sel}"]`); if (b) b.focus(); }
      if (e.target.matches && e.target.matches("[role=tab]") && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
        const tabs = [...document.querySelectorAll("[role=tab]")]; const i = tabs.indexOf(e.target);
        const nx = tabs[(i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length]; tab = nx.dataset.tabbtn; render(); document.querySelector(`[data-tabbtn="${tab}"]`).focus();
      }
    };
    // phone swipe row
    const sw = document.querySelector(".swipe");
    if (sw) {
      sw.scrollLeft = sel * sw.clientWidth;
      let tmr = 0;
      sw.onscroll = () => { clearTimeout(tmr); tmr = setTimeout(() => { const i = Math.round(sw.scrollLeft / sw.clientWidth); if (i !== sel) { sel = i; const keep = sw.scrollLeft; render(); const s2 = document.querySelector(".swipe"); if (s2) s2.scrollLeft = keep; } }, 120); };
    }
    // parallax (concept C, desk, fine pointer, motion allowed)
    const stage = document.querySelector(".stage");
    if (state.concept === "c" && L2.mode === "desk" && stage && !document.documentElement.classList.contains("rm") && matchMedia("(pointer: fine)").matches) {
      let raf = 0, nx = 0, ny = 0;
      const layers = [...document.querySelectorAll(".layer")];
      stage.classList.add("has-parallax");
      stage.onpointermove = (e) => {
        const r = stage.getBoundingClientRect();
        nx = ((e.clientX - r.left) / r.width - 0.5) * 2; ny = ((e.clientY - r.top) / r.height - 0.5) * 2;
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          // whole room pixels only, so the art never lands between pixels
          for (const ly of layers) { const d = parseFloat(ly.dataset.depth || 0); ly.style.transform = `translate(${Math.round(nx * d * 2) * L2.s}px, ${Math.round(ny * d) * L2.s}px)`; }
        });
      };
    }
  }

  // ------------------------------------------------------------------ peek at the prize counter (Option A)
  function openPeek(from) {
    const pk = document.getElementById("peek");
    pk.hidden = false;
    const site = document.querySelector(".site"); if (site) site.inert = true;
    pk.innerHTML = `<div class="peek-box" role="dialog" aria-modal="true" aria-labelledby="pk-h">
      <h2 id="pk-h">You walk up to the prize counter</h2>
      <img src="art/packroom/composite-desk-${state.season === "calm" ? "normal" : "halloween"}.png" alt="The approved Pack Room: a lit prize counter">
      <p>This is the approved Pack Room, <b>Option A · The Prize Counter</b>, being built separately. In production this doorway is a plain link to <code>/packs</code>; the event page never copies the Pack Room.</p>
      <button type="button" class="btn-sec" data-close>Back to the hall</button></div>`;
    const close = () => { if (site) site.inert = false; pk.hidden = true; pk.innerHTML = ""; from && from.focus && from.focus(); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => {
      if (e.key === "Escape") close();
    };
    pk.querySelector("[data-close]").onclick = close;
    pk.onclick = (e) => { if (e.target === pk) close(); };
    document.addEventListener("keydown", onKey);
    pk.querySelector("[data-close]").focus();
  }

  function announce(msg) {
    let a = document.getElementById("announce");
    if (!a) { a = document.createElement("div"); a.id = "announce"; a.className = "sr-only"; a.setAttribute("aria-live", "polite"); document.body.appendChild(a); }
    a.textContent = ""; setTimeout(() => { a.textContent = msg; }, 30);
  }

  let toastT = 0;
  function toast(msg) {
    let t = document.querySelector(".toast");
    if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 2600);
  }

  // ------------------------------------------------------------------ pause loops off-screen
  let io = null;
  function observeAnims() {
    if (io) io.disconnect();
    if (!("IntersectionObserver" in window)) return;
    io = new IntersectionObserver((es) => es.forEach((e) => e.target.classList.toggle("paused", !e.isIntersecting)));
    document.querySelectorAll(".stage").forEach((s) => io.observe(s));
  }
  document.addEventListener("visibilitychange", () => document.documentElement.classList.toggle("hidden-tab", document.hidden));

  function post(type, payload) { try { parent.postMessage({ type, state: payload }, "*"); } catch (e) { /* standalone */ } }
  window.addEventListener("message", (e) => {
    const d = e.data;
    if (!d || d.type !== "hall-state") return;
    const prevConcept = state.concept;
    Object.assign(state, d.state || {});
    if (state.concept !== prevConcept) { sel = 0; zoomed = false; tab = "overall"; }
    if (d.select !== undefined) sel = d.select;
    render();
    if (d.scrollTo) { const el = document.getElementById(d.scrollTo); if (el) el.scrollIntoView(); else window.scrollTo(0, 0); }
  });
  try { matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", () => render()); } catch (e) { /* old browsers */ }
  let rz = 0;
  window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(render, 80); });
  // tick the ticker once a minute
  setInterval(() => { if (state.phase === "upcoming") { const tk = document.querySelector(".ticker span"); if (tk) tk.textContent = tickerText(D.nowFor("upcoming"), tickerShort).t; } }, 30000);

  window.HALL = { state, render, select };
  render();
  post("hall-ready", {});
})();
