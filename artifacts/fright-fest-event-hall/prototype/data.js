/*
 * Event hall prototype: the data layer.
 *
 * REAL facts are copied from the code on 26 Oct 2026 and say where they came from.
 * SAMPLE data is generated only when the reviewer turns on "Sample data", and every
 * sample name starts with "sample·" so it can never be mistaken for a real player.
 *
 * Shapes mirror the championship API on the fright-fest-championship branch:
 *   GET /api/v1/championship/fright-fest-2026     -> PublicChampionship
 *   GET /api/v1/championship/fright-fest-2026/me  -> { signedIn:false } | ({ signedIn:true } & MyProgress)
 */
(function () {
  "use strict";

  // fright-fest-championship:app/lib/championship/fright-fest-2026.ts
  const CONFIG = {
    id: "fright-fest-2026",
    title: "Fright Fest 2026",
    opensAt: "2026-10-28T00:00:00Z",
    closesAt: "2026-11-02T00:00:00Z",
    resultsBy: "2026-11-05T00:00:00Z",
    timeZone: "Europe/London",
    submitGraceMin: 10,
    points: { byRank: [100, 80, 65, 40, 40, 20, 20, 20, 20, 20], others: 5 },
    games: [
      {
        slug: "last-bell", key: "lastbell", board: "last-bell-halloween-shift",
        title: "Last Bell", mode: "The Halloween Shift", modeShort: "Halloween Shift",
        rules: "verified", desktopOnly: true,
        metric: { label: "Time left", format: "clock", sort: "desc", tiebreakLabel: "Escape time" },
        howToEnter: "Sign in, open Last Bell and choose The Halloween Shift from its menu. Everyone gets the same school, Normal difficulty and an 8:00 clock. Solo only.",
        rankingRule: "Escape with the most time left on the clock. Equal times are split by the faster escape to a hundredth of a second.",
        tagline: "Report to Room 000.",
      },
      {
        slug: "shadow-core-halloween-dash", key: "shadowcore", board: "shadow-core-cursed-dash",
        title: "Shadow Core: Halloween Dash", short: "Shadow Core", mode: "Cursed Dash", modeShort: "Cursed Dash",
        rules: "proposed", desktopOnly: false,
        metric: { label: "Total time", format: "ms-clock", sort: "asc", tiebreakLabel: "Deaths" },
        howToEnter: "Sign in, open Shadow Core: Halloween Dash and choose Cursed Dash: all fifteen sectors in one run, against one clock.",
        rankingRule: "Fastest total time through all fifteen sectors. Equal times are split by fewer deaths.",
        tagline: "Fifteen sectors. One clock.",
      },
      {
        slug: "survive-till-dawn-pixel-edition", key: "std", board: "survive-till-dawn-blood-moon",
        title: "Survive Till Dawn: Pixel Edition", short: "Survive Till Dawn", mode: "Blood Moon", modeShort: "Blood Moon",
        rules: "proposed", desktopOnly: false,
        metric: { label: "Survived", format: "clock", sort: "desc", tiebreakLabel: "Kills" },
        howToEnter: "Sign in, open Survive Till Dawn: Pixel Edition and choose Blood Moon: the same realm, difficulty and 20-minute night for everyone. Solo only.",
        rankingRule: "Survive the longest, up to dawn at 20:00. Equal times are split by more kills.",
        tagline: "The walls are alive. The night is hungry.",
      },
    ],
  };

  // collectibles-prize-counter:app/lib/collectibles/catalogue/{packs,odds}.ts and the ff26 card list.
  const ODDS = {
    standard: { common: 60, uncommon: 25, rare: 10, epic: 4, legendary: 1 },
    rareOrBetter: { rare: 75, epic: 20, legendary: 5 },
    epicOrBetter: { epic: 80, legendary: 20 },
  };
  const PACKS = [
    {
      id: "ff26-overall-winner", name: "Overall Champion Pack", art: "ff26-overall.png",
      who: "The Fright Fest champion: the highest-placed player with a result on every opened board.",
      slots: [
        { fixed: "Overall Champion 2026", rarity: "legendary" },
        { fixed: "The Last Bell", rarity: "legendary" },
        { random: "epicOrBetter" },
      ],
      count: "1 player",
    },
    {
      id: "ff26-winner-last-bell", name: "Last Bell Champion Pack", art: "ff26-champion-last-bell.png", game: "last-bell",
      who: "1st place on the Last Bell board when the results are final.",
      slots: [{ fixed: "Last Bell Champion", rarity: "epic" }, { random: "rareOrBetter" }, { random: "standard" }],
      count: "1 per board",
    },
    {
      id: "ff26-winner-shadow-core", name: "Shadow Core Champion Pack", art: "ff26-champion-shadow-core.png", game: "shadow-core-halloween-dash",
      who: "1st place on the Shadow Core board, if that board opens.",
      slots: [{ fixed: "Shadow Core Champion", rarity: "epic" }, { random: "rareOrBetter" }, { random: "standard" }],
      count: "1 per board",
    },
    {
      id: "ff26-winner-survive-till-dawn", name: "Survive Till Dawn Champion Pack", art: "ff26-champion-survive-till-dawn.png", game: "survive-till-dawn-pixel-edition",
      who: "1st place on the Survive Till Dawn board, if that board opens.",
      slots: [{ fixed: "Survive Till Dawn Champion", rarity: "epic" }, { random: "rareOrBetter" }, { random: "standard" }],
      count: "1 per board",
    },
    {
      id: "ff26-participation", name: "Participation Pack", art: "ff26-participation.png",
      who: "An accepted result on every board in the Fright Fest lineup.",
      slots: [{ fixed: "Survivor 2026", rarity: "rare" }, { random: "standard" }, { random: "standard" }],
      count: "everyone who qualifies",
    },
  ];

  /*
   * Candy Hunt: NOT BUILT. These notices show how the board would read.
   * Conditions are tied to things that exist today:
   *   - achievement keys Last Bell already unlocks (public/games/last-bell/achievements.js);
   *   - facts the championship API already returns (MyProgress.boards, eligible).
   * Candy amounts are not configured anywhere, so rewards are relative tiers only.
   */
  const QUESTS = [
    { id: "clock-in", title: "Clock in", game: "last-bell", text: "Get one ranked run on The Halloween Shift.", tier: 1,
      source: "Championship API: MyProgress.boards[last-bell].rank", kind: "real" },
    { id: "last-out", title: "Last Out", game: "last-bell", text: "Escape the school in Last Bell.", tier: 2,
      source: "Last Bell achievement first-escape", kind: "real" },
    { id: "early-bell", title: "Early Bell", game: "last-bell", text: "Escape with at least half the clock left.", tier: 3,
      source: "Last Bell achievement quick-escape", kind: "real" },
    { id: "hard-detention", title: "Hard Detention", game: "last-bell", text: "Escape on Hard.", tier: 3,
      source: "Last Bell achievement hard-escape", kind: "real" },
    { id: "full-house", title: "Full house", game: null, text: "Get a ranked result on every open board.", tier: 2,
      source: "Championship API: MyProgress.eligible", kind: "real" },
    { id: "slot-shadow", title: "Notice coming", game: "shadow-core-halloween-dash", text: "Pinned when Shadow Core reports achievements to HallPass.", tier: 0,
      source: "Shadow Core reports no achievements today", kind: "slot" },
    { id: "slot-std", title: "Notice coming", game: "survive-till-dawn-pixel-edition", text: "Pinned when Survive Till Dawn reports achievements to HallPass.", tier: 0,
      source: "Survive Till Dawn reports no achievements today", kind: "slot" },
  ];
  const TIERS = { 1: "Small", 2: "Medium", 3: "Large" };

  // ---------------------------------------------------------------- time
  const DAY = 86400000;
  const fmtDay = (t) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short" }).format(typeof t === "number" ? t : Date.parse(t));
  const LABELS = {
    opens: fmtDay(CONFIG.opensAt),                      // Wed 28 Oct
    lastDay: fmtDay(Date.parse(CONFIG.closesAt) - 1),   // Sun 1 Nov
    resultsBy: fmtDay(Date.parse(CONFIG.resultsBy) - 1),
  };

  /** The simulated "now" for each phase the reviewer can pick. */
  function nowFor(phase) {
    const open = Date.parse(CONFIG.opensAt), close = Date.parse(CONFIG.closesAt);
    if (phase === "upcoming") { const n = Date.now(); return n < open ? n : open - 29 * 3600 * 1000; }
    if (phase === "live") return Date.parse("2026-10-30T16:20:00Z");
    if (phase === "closed") return close + 1.5 * DAY;
    return Date.parse(CONFIG.resultsBy) + DAY; // finalised
  }

  function countdown(toMs, nowMs) {
    let s = Math.max(0, Math.floor((toMs - nowMs) / 1000));
    const d = Math.floor(s / 86400); s -= d * 86400;
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60);
    return { d, h, m, text: d > 0 ? `${d}d ${String(h).padStart(2, "0")}h` : `${h}h ${String(m).padStart(2, "0")}m` };
  }

  // ---------------------------------------------------------------- formatting (championship/format.ts)
  function fmtScore(metric, v) {
    if (v == null) return "–";
    if (metric.format === "clock") { const m = Math.floor(v / 60), s = v % 60; return `${m}:${String(s).padStart(2, "0")}`; }
    if (metric.format === "ms-clock") { const t = Math.floor(v / 10); const m = Math.floor(t / 6000), s = Math.floor((t % 6000) / 100), cs = t % 100; return `${m}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`; }
    return String(v);
  }
  const ordinal = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  const pointsFor = (rank) => CONFIG.points.byRank[rank - 1] ?? CONFIG.points.others;

  // ---------------------------------------------------------------- sample generator (deterministic)
  const WORDS = ["cobweb", "lantern", "broomstick", "gravestone", "candlewax", "nightowl", "hollow", "batwing", "moonbeam",
    "crowbar", "fogbank", "bonepile", "inkwell", "hayride", "scarecrow", "toffee", "creaky", "mothball", "gourd", "wisp",
    "ghoulish", "hexed", "cauldron", "shroud", "willow"];
  function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

  function sampleBoard(game, n, seed) {
    const r = rng(seed);
    const used = new Set();
    const entries = [];
    for (let i = 0; i < n; i++) {
      let w; do { w = WORDS[Math.floor(r() * WORDS.length)] + (r() < 0.3 ? Math.floor(r() * 90 + 10) : ""); } while (used.has(w));
      used.add(w);
      entries.push({ publicId: "s-" + w, name: "sample·" + w, avatar: "", score: 0, tiebreak: 0 });
    }
    // scores in the metric's direction
    entries.forEach((e, i) => {
      if (game.metric.format === "clock" && game.key === "lastbell") e.score = Math.max(12, 318 - i * 17 - Math.floor(r() * 9));
      else if (game.metric.format === "clock") e.score = Math.max(60, 1200 - i * 70 - Math.floor(r() * 40));
      else e.score = 412340 + i * 9310 + Math.floor(r() * 2000);
      e.tiebreak = Math.floor(r() * 40);
    });
    return entries.map((e, i) => ({ ...e, rank: i + 1, points: pointsFor(i + 1) }));
  }

  /** Build a PublicChampionship for the chosen review state. */
  function championship(state) {
    const phase = state.phase;
    const open = state.lineup === "all" ? CONFIG.games.map((g) => g.slug) : ["last-bell"];
    if (state.api === "error") return { available: false, phase, final: false, standings: null };
    const sample = state.data === "sample" && phase !== "upcoming";
    const boards = CONFIG.games.map((g, gi) => {
      const isOpen = open.includes(g.slug);
      return {
        slug: g.slug, board: g.board, title: g.title, mode: g.mode, modeShort: g.modeShort, metric: g.metric,
        rules: g.rules, status: isOpen ? "open" : "pending", counting: isOpen,
        entries: isOpen && sample ? sampleBoard(g, 24 - gi * 5, 77 + gi * 13) : [],
      };
    });
    // overall = sum of points by name across counting boards
    const tally = new Map();
    for (const b of boards) for (const e of b.entries) {
      const t = tally.get(e.name) || { name: e.name, publicId: e.publicId, avatar: "", points: 0, games: {}, gamesWithResult: 0 };
      t.points += e.points; t.games[b.slug] = { rank: e.rank, points: e.points }; t.gamesWithResult++;
      tally.set(e.name, t);
    }
    const counting = boards.filter((b) => b.counting).length;
    const overall = [...tally.values()]
      .map((o) => ({ ...o, eligible: o.gamesWithResult === counting, missing: boards.filter((b) => b.counting && !o.games[b.slug]).map((b) => b.slug) }))
      .sort((a, b) => b.points - a.points || b.gamesWithResult - a.gamesWithResult)
      .map((o, i) => ({ ...o, rank: i + 1 }));
    const champion = overall.find((o) => o.eligible);
    return {
      available: true,
      phase,
      final: phase === "finalised",
      sample,
      standings: {
        phase, boards: boards.filter((b) => b.status !== "pending"), overall: overall.slice(0, 50),
        championPublicId: phase === "finalised" && champion ? champion.publicId : null,
        pendingGames: boards.filter((b) => b.status === "pending").length,
        lineupFinal: phase !== "upcoming" && phase !== "live",
      },
    };
  }

  /** The viewer's own progress (MyProgress), or signed out. */
  function me(state, pub) {
    if (state.auth !== "in") return { signedIn: false };
    if (!pub.available) return { signedIn: true, available: false };
    const sample = pub.sample;
    if (!sample) return { signedIn: true, available: true, rank: null, points: 0, eligible: false, boards: [] };
    // a mid-table sample player, outside the top 10
    const rank = Math.min(14, pub.standings.overall.length);
    const o = pub.standings.overall[rank - 1];
    return { signedIn: true, available: true, rank, points: o ? o.points : 0, name: "sample·you", eligible: o ? o.eligible : false,
      boards: pub.standings.boards.map((b) => ({ slug: b.slug, rank: o && o.games[b.slug] ? o.games[b.slug].rank : null })) };
  }

  window.HALL_DATA = { CONFIG, PACKS, ODDS, QUESTS, TIERS, LABELS, nowFor, countdown, fmtScore, ordinal, pointsFor, championship, me };
})();
