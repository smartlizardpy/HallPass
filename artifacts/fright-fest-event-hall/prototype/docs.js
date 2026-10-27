/* The review shell's written content. Facts were checked in code on 26 Oct 2026; each says where. */
(function () {
  "use strict";
  const NAMES = { a: "A · The Arcade Hall", b: "B · The School Hall", c: "C · The Possessed Arcade", current: "Live today", "current-branch": "Championship branch" };
  const pill = (k, t) => `<span class="pill ${k}">${t}</span>`;

  const CONCEPTS = {
    a: {
      idea: "The room next door to the Pack Room. Same camera, wallpaper, wood and brass, so the hall and the prize counter read as one building. Three classic uprights stand in pools of light under a bulb-lit FRIGHT FEST marquee; the HIGH SCORES board hangs on the left wall; through the doorway on the right you can see the prize counter itself.",
      plays: ["Every cabinet has its own PLAY strip: one click to play, no puzzle.", "Clicking a cabinet's body lights it and fills the control deck under the machines with its mode, rule and status.", "The LED ticker under the marquee carries the phase (opens in, live, closed, final) instead of a giant countdown.", "Phone: swipe through the three machines in a row; the deck sits under the room."],
      good: ["Closest to the approved Pack Room, so the lowest brand risk.", "Clearest hierarchy: title, three machines, Play, board, door.", "Cheapest to keep accurate: everything sits on one flat wall."],
      risk: ["The safest of the three; it could feel like the Pack Room re-skinned.", "The Candy Hunt board is only a teaser in the room; the notices live below."],
      effort: "About 5–6 developer days plus art (scene + 8 cabinet sprites + frames).",
    },
    b: {
      idea: "The arcade has moved into the assembly hall of the haunted school from the homepage (and from Last Bell). Clerestory windows with the moon and the bell tower, three old cabinets on the school stage under a hand-made FRIGHT FEST banner, an old electronic gym scoreboard, a red-felt noticeboard, and the tuck-shop hatch that leads to the prize counter.",
      plays: ["The stage spotlight follows the cabinet you pick; the others stay in the dark.", "Each machine's Play is an 'Admit one' ticket on the stage front.", "The details panel is a paper hall pass: the brand's own object.", "Phone: the stage with one cabinet, and three paper hall-pass tabs to switch."],
      good: ["The strongest story: it ties HallPass, Last Bell and Room 000 together.", "School materials (paper, cork, felt, LED scoreboard) make the panels feel physical rather than like cards.", "The mystery games read naturally as cabinets still under dust sheets."],
      risk: ["A school setting on a site used to dodge school: teachers may read it as provocation. It also leans hard on Last Bell, which two of the three games are not.", "Paper panels lower contrast discipline; every text pair needs checking."],
      effort: "About 6–7 developer days plus art (scene, spotlight, 8 cabinets, paper frames).",
    },
    c: {
      idea: "The arcade is possessed. A one-point view down a foggy aisle of dead cabinets to a giant HI-SCORE shrine built from fused machines, lit by a moon shaft from a broken skylight. The three competition cabinets stand in an arc, each throwing its own colour across the floor. The only warm light is the prize-counter doorway.",
      plays: ["Selecting a cabinet zooms the room from 3× to exactly 4× around it (still whole pixels) and opens a CRT panel beside it. Escape or Back returns to the hall.", "Play still sits on every cabinet, so nobody has to zoom to play.", "A fortune-teller booth, Madame Moon, is the way into Candy Hunt.", "Subtle parallax between the background, fog and foreground on a mouse; off on touch and with reduced motion.", "Phone: one possessed machine at a time with ◀ ▶."],
      good: ["The most memorable first screen; reads as a game, not a website.", "The board is the centre of the room, which suits a competition."],
      risk: ["Most art and the most code (layers, zoom, parallax), so the most to get wrong on a Chromebook.", "Darkest palette: needs the most contrast care and is the most likely to tip from playful into scary for younger players."],
      effort: "About 8–10 developer days plus the largest art set (layered scene, fog, 8 cabinets).",
    },
  };

  function notes(c) {
    if (c === "current" || c === "current-branch") {
      return `<div class="card"><h3>What you are looking at</h3><p>${c === "current" ? "A screenshot of the live page on hallpass.games, 26 Oct 2026 (main). It is one centred card with a large countdown; the championship is not on main yet." : "The fright-fest-championship branch's page, rebuilt from its components: the same night card, then seven stacked rounded cards (phase, standings, your progress, points, when, rules, rewards). Not merged."}</p></div>
        <div class="card"><h3>See the audit</h3><p>The Audit tab lists what this page does well (honest copy, rules generated from config, static and prerendered) and why it reads as a dashboard.</p></div>`;
    }
    const k = CONCEPTS[c];
    return `<div class="card"><h3>${NAMES[c]}</h3><p>${k.idea}</p></div>
      <div class="card"><h3>How it plays</h3><ul>${k.plays.map((x) => `<li>${x}</li>`).join("")}</ul></div>
      <div class="card"><h3>Strengths</h3><ul>${k.good.map((x) => `<li>${x}</li>`).join("")}</ul></div>
      <div class="card"><h3>Risks and costs</h3><ul>${k.risk.map((x) => `<li>${x}</li>`).join("")}</ul><p><b>Effort:</b> ${k.effort}</p></div>`;
  }

  function firsts() {
    return `<h3 style="margin-top:20px">The three first screens at 1366 × 768</h3><div class="shots">
      ${["a", "b", "c"].map((x) => `<figure><img src="art/shots/first-${x}.png" alt="First screen of concept ${x.toUpperCase()}" loading="lazy"><figcaption>${NAMES[x]}</figcaption></figure>`).join("")}
      <figure><img src="art/current/ff-1366-full.png" alt="The live page today" loading="lazy"><figcaption>Live today, for scale</figcaption></figure></div>`;
  }

  function journey() {
    return `<h2>One building, five places</h2>
      <p class="lede">The homepage is the outside of the haunted arcade. Fright Fest is the hall inside. The Pack Room is the prize counter you walk up to. Opening a pack is the close-up, and the binder is where cards end up. Each place keeps the same moon, wood, plum walls, brass and bulb signs, and each one has a door to the next.</p>
      <div class="journey">
        <figure><img src="art/current/home-1366.png" alt="The approved homepage: a haunted school at night with three mystery cabinets"><figcaption><b>Outside · homepage</b>Approved Design C, live. Three mystery cabinets in the yard; FRIGHT FEST in the header leads inside.</figcaption></figure>
        <figure class="here"><img src="art/shots/first-a.png" alt="Concept A, the event hall"><figcaption><b>Inside · the event hall</b>This exploration. The cabinets from the yard are now inside and switched on; a doorway shows the prize counter.</figcaption></figure>
        <figure><img src="art/packroom/composite-desk-halloween.png" alt="The approved Pack Room, Option A, the prize counter"><figcaption><b>The prize counter · /packs</b>Approved Option A, being built by another session. Packs won at Fright Fest wait here; it stays open after Halloween.</figcaption></figure>
        <figure><figcaption><b>The close-up · opening</b>The foil pack opening (collectibles-pack-opening branch) plays in the Pack Room. The hall never opens packs itself.</figcaption></figure>
        <figure><figcaption><b>The collection · /collection</b>The binder. The hall links to it only through the prize counter, so the event page never duplicates collectibles UI.</figcaption></figure>
      </div>
      <div class="card"><h3>What carries over between places</h3><ul>
        <li><b>Camera and scale.</b> All three use the Pack Room's canvas (434 × 230 at 3×, 195 wide at 2× on phones). A and B keep its front-on camera; C breaks it on purpose for depth.</li>
        <li><b>Materials.</b> A reuses the Pack Room's plum wallpaper, wood wainscot and brass trim, so the two rooms read as neighbours. B swaps them for the school's brick, stage curtains and paper; C for neon and dead cabinets. All three keep the night palette and the moon.</li>
        <li><b>Signs.</b> Every place has one big sign: HALLPASS on the school, PACK ROOM over the counter, FRIGHT FEST in the hall (a bulb marquee in A, a hand-made letter banner in B, broken neon in C).</li>
        <li><b>Mystery stays mystery.</b> Cabinets the homepage shows as "???" stay "???" in the hall until their board opens.</li>
        <li><b>Seasons.</b> All three places swap to a calm version when the haunted skin is off, with identical layout.</li>
      </ul></div>`;
  }

  function audit() {
    return `<h2>Audit of the current Fright Fest page</h2>
      <p class="lede">Two versions exist. Main (live) shows one night card with a countdown. The unmerged championship branch adds seven stacked cards under it. Both are honest and technically careful. Both read as a promotion page rather than a place to play.</p>
      <div class="shots"><figure><img src="art/current/ff-1366-full.png" alt="Live page at 1366 px"><figcaption>Live, 1366 px, full page</figcaption></figure><figure><img src="art/current/ff-phone.png" alt="Live page on a phone" style="max-width:300px"><figcaption>Live, 390 px phone</figcaption></figure></div>
      <div class="card"><h3>What is implemented, and where</h3><div class="tbl-wrap"><table><thead><tr><th>Feature</th><th>State</th><th>Where</th></tr></thead><tbody>
        <tr><td><b>Event dates and countdown</b></td><td>${pill("ok", "Live")}</td><td>main: <code>FrightFestCountdown</code>, <code>FrightFestPhase</code>; skin window 25 Oct → 2 Nov</td></tr>
        <tr><td><b>Three competition games</b></td><td>${pill("part", "1 of 3")}</td><td>Only Last Bell's Halloween Shift exists and is verified. Cursed Dash and Blood Moon are not in their games yet; their boards are <code>pending</code> and their cabinets are deliberately unnamed (docs/championship-design.md §2).</td></tr>
        <tr><td><b>Per-game boards</b></td><td>${pill("part", "Branch")}</td><td>fright-fest-championship: <code>Standings.tsx</code>, API <code>/api/v1/championship/[event]</code></td></tr>
        <tr><td><b>Overall standings, Fright Points</b></td><td>${pill("part", "Branch")}</td><td>100/80/65/40/40/20×5, then 5. Overall Champion needs a result on every opened board.</td></tr>
        <tr><td><b>Your progress</b></td><td>${pill("part", "Branch")}</td><td><code>MyProgress.tsx</code>, API <code>/me</code></td></tr>
        <tr><td><b>Pack rewards</b></td><td>${pill("part", "Branch")}</td><td>Participation, one Game Champion per board, Overall Champion. Pack ids match the collectibles catalogue (collectibles branches).</td></tr>
        <tr><td><b>Runner-up reward</b></td><td>${pill("no", "None")}</td><td>The brief mentions a second-place reward; no such reward exists in the rules or the catalogue. Not drawn; listed as a question.</td></tr>
        <tr><td><b>Candy Hunt, Halloween Candy</b></td><td>${pill("no", "Not built")}</td><td>No code on any branch. The Pack Room removed its "candy soon" placards so production promises nothing.</td></tr>
        <tr><td><b>Link to the Pack Room</b></td><td>${pill("no", "None")}</td><td><code>/packs</code> exists only on the unmerged collectibles branches.</td></tr>
      </tbody></table></div></div>
      <div class="card"><h3>Why it reads as a dashboard</h3><ul>
        <li><b>The countdown is the hero.</b> Four 148 px boxes are the largest thing on screen. Before the event that is all the page says.</li>
        <li><b>The art is a frame, not a place.</b> Moon, bat, ghost and a graveyard strip sit around a centred card. Nothing in the art can be used.</li>
        <li><b>Empty width.</b> The card is about 830 px wide inside a 1302 px content area at 1366; about 236 px of empty dark on each side, and a gap above the footer.</li>
        <li><b>No way to play.</b> The page never shows the games or links to them. The homepage hero does more for the games than the event's own page.</li>
        <li><b>Branch adds paperwork.</b> Seven stacked rounded cards (phase, standings, your progress, points table, when, rules, rewards) with the same border and radius. The rewards are three grey boxes, although real pack art exists.</li>
        <li><b>The story breaks.</b> The homepage shows three cabinets in a haunted yard; clicking through lands on a generic card instead of inside the arcade.</li>
      </ul></div>
      <div class="card"><h3>What must be kept</h3><ul>
        <li>Static, prerendered page; live data only in small client islands (incident #131).</li>
        <li>Rules, dates and points rendered from the championship config, so the page and the server cannot disagree.</li>
        <li>Honest phase copy, provisional standings, handles never real names, no prize promises while the championship is off.</li>
        <li>The skin and the championship stay independent; either can be off.</li>
      </ul></div>
      <div class="card"><h3>Noticed in passing (not in scope)</h3><p>The live homepage logs a React hydration error (#418, text content mismatch) on load at 1366 px. It did not appear on <code>/fright-fest</code>. Worth a look by whoever owns the homepage skin.</p></div>`;
  }

  function research() {
    return `<h2>Research</h2>
      <p class="lede">Four Sonnet agents ran in parallel. Two of them could reach fewer sources than asked for, and say so in their notes; game-specific claims they could not fetch are marked unverified there and are treated as craft judgement here.</p>
      <div class="card"><h3>A · Pixel-art environments</h3><ul>
        <li>Front-on interiors with a slightly top-down floor; eye level at the wall/floor seam about 55–60% down; four layers (wall, machines, floor props, dark foreground edge).</li>
        <li>Night lighting: one cool ambient plus three or four warm sources; shadows lean blue-violet, never black; glow as dithered rings or separate glow sprites, never blur (Moonlighter's approach, 80.lv).</li>
        <li>Cabinets read by silhouette first (tall upright, wide sit-down, narrow mini) and one dominant hue each, then by label.</li>
        <li>Mock up at a fixed size and scale by whole numbers (Slynyrd's 470 × 240 at 4×); one shared palette across related scenes.</li>
        <li>Sources fetched: Slynyrd Pixelblog, Saint11 tutorials index, 80.lv on Moonlighter, Wikipedia "Arcade cabinet", Game Developer on Eastward. Lospec and GDC talks were not reachable.</li>
      </ul></div>
      <div class="card"><h3>B · Game event UX</h3><ul>
        <li>First screen: a phase indicator, one main action, and "your status". Boards, rewards, quests and rules go below. Show a countdown only near the end, and small.</li>
        <li>Arcade boards: big top-three rows, a pinned "you" row with the gap to the next place, a "first place is open" empty state, and a provisional stamp until results are checked (Trackmania-style medals).</li>
        <li>Quests: verb-first title, game tag, one-line condition, reward, difficulty, progress, done stamp; harder notices pay more (Hades makes harder options opt-in with rarer rewards). Keep them optional, no daily reset.</li>
        <li>Two currencies at a glance: "points rank you, can't be spent" against "candy is spent on packs, never bought" (Destiny 2 keeps faction points apart from its currencies).</li>
        <li>Guaranteed rewards and random contents on separate shelves, odds next to the pack. UK guidance on loot boxes covers paid boxes; free packs probably fall outside it, but publishing odds is cheap. Not legal advice.</li>
        <li>Avoid: fake-urgency timers (the CMA's Wowcher case), streak pressure, loss framing, real names on boards.</li>
        <li>Publisher pages (Fortnite, Roblox, ICO, gov.uk) returned 403/404; most game-specific patterns are the agent's recall and unverified.</li>
      </ul></div>
      <div class="card"><h3>C · HallPass visual consistency</h3><ul>
        <li>Always night: ink and night bases, the yellow moon as key light, orange lamps only in the haunted season.</li>
        <li>Light from the top-left; one dark outline on characters; hue-shifted ramps; whole-number scales; glow as dithered rings.</li>
        <li>Materials: wood, plum plaster, navy glass, brass and bulbs, plus the CRT.</li>
        <li>Type: Silkscreen as the site's pixel face, Jersey 10 for big signs, Pixelify for the wordmark, Nunito for anything people read or act on.</li>
        <li>"Art holds signs, HTML holds facts": nothing a player relies on (dates, scores, rules) is baked into art.</li>
        <li>All motion stepped, Still-mode safe, every keyframe named in the reduced-motion block, nothing above the panic screen.</li>
      </ul></div>
      <div class="card"><h3>D · Technical feasibility</h3><ul>
        <li>Feasible and low risk. The room is static server HTML plus one PNG; standings, progress and pack counts are client islands (the existing <code>data.ts</code> hooks).</li>
        <li>A 434 × 230 PNG at 3× is about 0.9 MP and one composited layer; sprite loops via <code>steps()</code> repaint only small boxes. Existing sprites are 78–620 bytes; Pack Room rooms about 22 KB.</li>
        <li>Pause loops off-screen with IntersectionObserver and on <code>visibilitychange</code>; add every new keyframe name to the reduced-motion list in <code>globals.css</code>.</li>
        <li>Build on the championship branch: <code>app/fright-fest/page.tsx</code> conflicts with it if started from main; <code>/api/v1/collection</code> and <code>useMyCollection</code> exist only on the collectibles branches.</li>
        <li>No whiteboard handling exists anywhere today: a touch-only board gets the phone layout stretched wide.</li>
      </ul></div>`;
  }

  function art() {
    const sw = (hex, name) => `<div class="sw"><i style="background:${hex}"></i><span><b>${name}</b><br>${hex}</span></div>`;
    return `<h2>Art direction: one world, three rooms</h2>
      <p class="lede">The hall sits between the homepage (outside) and the Pack Room (a lit room inside). It uses their palette, scale, materials and type, and adds one new thing per concept.</p>
      <div class="card"><h3>Shared palette</h3><div class="swatches">
        ${sw("#0b0612", "Ink")}${sw("#1b1026", "Night")}${sw("#2e163a", "Plum wall")}${sw("#6e3a1e", "Wood")}${sw("#b86e00", "Brass")}${sw("#2c3a5e", "Glass")}${sw("#ffd84a", "Moon")}${sw("#ffc700", "Yellow dot")}${sw("#7c2eef", "Brand purple")}${sw("#f2e8d5", "Bone")}${sw("#b9a7cf", "Lavender")}${sw("#ffb347", "Amber")}${sw("#ff7a1a", "Pumpkin · haunted only")}
      </div><p>Game accents, used only on their own cabinets: Last Bell institutional green-grey <code>#6f7a68</code> with exit red; Shadow Core black with neon pink <code>#ff4f8b</code>; Survive Till Dawn crimson <code>#ff5470</code>.</p></div>
      <div class="card"><h3>Rules every room follows</h3><ul>
        <li><b>Scale.</b> Rooms are drawn at 1×: 434 × 230 on laptops (3× = 1302 × 690, the exact content width at 1366; 4× on 1920 boards), 195 wide on phones at 2×. HTML is placed in room pixels and never scaled.</li>
        <li><b>Light.</b> Top-left key; at most three light sources per room; glow as dithered rings; no blur, no CSS glow.</li>
        <li><b>Line.</b> One dark ink outline on characters and props, none on architecture; hue-shifted ramps; Bayer dithering only.</li>
        <li><b>Signs vs facts.</b> FRIGHT FEST, HIGH SCORES, PRIZE COUNTER and the game marquees are art. Dates, names, scores, counts and rules are HTML on calm, dark zones at 7:1 or better.</li>
        <li><b>Cabinets are sprites.</b> Each slot can show a named game or a mystery cabinet, lit or not, without new art.</li>
        <li><b>Two seasons.</b> Haunted (cobwebs, a spider, a ghost, pumpkins, bats, candy-corn bunting, orange light; at most eight props) and calm (same room, no Halloween props, yellow light). Pumpkin orange never appears in calm.</li>
        <li><b>Motion.</b> 2–4 frame loops at 3–8 fps, at most five per room, paused off-screen, off with reduced motion. No flashing, no sound, no jump scares.</li>
      </ul></div>
      <div class="card"><h3>Type</h3><ul>
        <li><b>Jersey 10</b> for big signs and section titles; <b>Silkscreen</b> for labels, tickers, ranks and buttons; <b>Pixelify Sans</b> for names on the in-room board; <b>Handjet</b> for school signage in concept B; <b>Nunito</b> for everything people read at length.</li>
      </ul></div>
      <div class="card"><h3>Sprite inventory per concept</h3><p>Room (haunted + calm, laptop + phone), 4 cabinet keys × 2 states, 3 screen loops, a light pool, standalone board / quest / prize objects for phones, four 9-slice frames for the sections below the room, and one wall tile. Concept B adds a spotlight; concept C splits the room into background, foreground and fog layers.</p></div>`;
  }

  function build() {
    return `<h2>Build notes</h2>
      <div class="card"><h3>Integration points</h3><div class="tbl-wrap"><table><thead><tr><th>Element</th><th>Data</th><th>Exists?</th><th>Notes</th></tr></thead><tbody>
        <tr><td><b>Ticker</b></td><td>Championship config dates + API <code>phase</code></td><td>${pill("ok", "Branch")}</td><td>Server renders phase-neutral words; a client island fills the phase (as <code>FrightFestPhase</code> does).</td></tr>
        <tr><td><b>Cabinets</b></td><td>Theme registry (announced per game) + <code>standings.boards[].status</code></td><td>${pill("ok", "Main + branch")}</td><td>A cabinet is named only when its game is announced; pending boards are never named, matching the API.</td></tr>
        <tr><td><b>In-room board</b></td><td><code>GET /api/v1/championship/fright-fest-2026</code> → <code>standings.overall[0..5]</code></td><td>${pill("ok", "Branch")}</td><td>CDN 30 s, shared promise via <code>useChampionship</code>; <code>active</code> false until in view.</td></tr>
        <tr><td><b>"You" row</b></td><td><code>/me</code> → <code>rank, points, eligible</code></td><td>${pill("ok", "Branch")}</td><td>Never cached. Signed-out shows "Sign in to be ranked".</td></tr>
        <tr><td><b>Full standings</b></td><td>Same API, all boards</td><td>${pill("ok", "Branch")}</td><td>Reuse <code>Standings</code> logic; restyle only.</td></tr>
        <tr><td><b>Candy Hunt</b></td><td>Last Bell achievements; <code>/me</code> board ranks and eligibility</td><td>${pill("no", "Candy: no")}</td><td>Notice conditions can be real today; Candy amounts, balances and the swap do not exist. Ship as a static preview or not at all.</td></tr>
        <tr><td><b>Prize-counter door</b></td><td>Link to <code>/packs</code>; optional sealed count from <code>/api/v1/collection</code></td><td>${pill("part", "Collectibles branch")}</td><td>A plain link costs a quarter of a day; the count waits for the collectibles branches to merge.</td></tr>
        <tr><td><b>Reward shelf</b></td><td>Collectibles catalogue (packs, slots, odds); championship <code>rewards</code></td><td>${pill("ok", "Branch")}</td><td>Pack prints already exist (Pack Room art). Read names and odds from the catalogue, never copy them.</td></tr>
      </tbody></table></div></div>
      <div class="card"><h3>The five states</h3><div class="tbl-wrap"><table><thead><tr><th>State</th><th>What the hall does</th></tr></thead><tbody>
        <tr><td><b>Skin on, championship off</b></td><td>The room and cabinets stay; the board says "To be announced"; standings, rules and rewards are hidden; no prize promises.</td></tr>
        <tr><td><b>Skin on, live</b></td><td>The full design.</td></tr>
        <tr><td><b>Skin off, live</b></td><td>The calm room (same layout, no Halloween props, yellow light); everything else unchanged.</td></tr>
        <tr><td><b>Ended</b></td><td>Ticker "Closed · results final by …"; PROVISIONAL stamp on every board; Play stays (the modes remain for fun). After finalisation: FINAL, the champion's crown, the winner on the shelf. The page never 404s.</td></tr>
        <tr><td><b>Scores API down</b></td><td>The board says "Scores offline · the machines still work" with Try again; everything else on the page works.</td></tr>
      </tbody></table></div><p>All of these can be switched on in the Explore bar.</p></div>
      <div class="card"><h3>Effort and trade-offs</h3><div class="tbl-wrap"><table><thead><tr><th></th><th>A</th><th>B</th><th>C</th></tr></thead><tbody>
        <tr><td><b>Art</b></td><td>1 room ×2 seasons ×2 sizes, 8 cabinets</td><td>Same + spotlight</td><td>3 layers + fog ×2 seasons, phone room, 8 cabinets</td></tr>
        <tr><td><b>Code</b></td><td>Scene + hotspots, deck panel, swipe row</td><td>Scene, spotlight, paper panel, tabs</td><td>Layers, zoom, parallax, CRT panel</td></tr>
        <tr><td><b>Developer days</b></td><td>5–6</td><td>6–7</td><td>8–10</td></tr>
        <tr><td><b>Chromebook cost</b></td><td>Lowest</td><td>Low</td><td>Moderate (three full-size layers, parallax; off on touch)</td></tr>
        <tr><td><b>Brand risk</b></td><td>Low</td><td>Medium (school setting)</td><td>Medium (darkest, scariest)</td></tr>
      </tbody></table></div><p>Day counts exclude art and assume the championship branch is merged first. Research D's estimate for the shared parts (scene and hotspots, live board, quest preview, pack-count teaser) is 5–7 days.</p></div>
      <div class="card"><h3>Files a build would touch</h3><ul>
        <li>New: <code>app/components/events/fright-fest/hall/*</code> (scene, cabinets, board island, panel), <code>public/events/fright-fest/hall/*</code> (art), tests for the geometry.</li>
        <li>Changed: <code>app/fright-fest/page.tsx</code> (owned by the championship branch; build on top of it), <code>app/globals.css</code> (reduced-motion names only).</li>
        <li>Reused unchanged: <code>ArcadeShell</code>, <code>lib/championship/*</code>, <code>championship/data.ts</code>, the Pack Room's <code>room/geometry.ts</code> scale rules once merged.</li>
      </ul></div>
      <div class="card"><h3>Working alongside the Pack Room session</h3><ul>
        <li>Worked only in a separate worktree (<code>.claude/worktrees/fright-fest-hall</code>, branch <code>design/fright-fest-event-hall</code>), under <code>artifacts/fright-fest-event-hall/</code>.</li>
        <li>Messaged the busy peer session; it confirmed it is the Pack Room session, that production has no candy UI, and that it will not move the shared art sources.</li>
        <li>Read, never wrote: the prize-counter worktree, <code>artifacts/collectibles-redesign-src/</code> (toolkit, room art, pack prints copied read-only), the championship branch, <code>public/events/fright-fest/</code>.</li>
        <li>No production file, no other worktree, no stash, no reset, no merge, no deploy.</li>
      </ul></div>
      <div class="card"><h3>Open questions for you</h3><ul>
        <li><b>Runner-up.</b> The brief mentions a second-place reward. The rules pay Overall Champion only (plus one champion per board). Add one, or drop it from the brief?</li>
        <li><b>Candy.</b> Build Candy Hunt for real, ship the noticeboard as a "coming next year" preview, or leave it out?</li>
        <li><b>Light mode.</b> The hall is always night. Should the site header around it stay light for light-mode players, as the Pack Room does?</li>
        <li><b>Phones and Last Bell.</b> Last Bell is desktop-only, so on phones its cabinet says "Play on a laptop". Fine, or should phones lead with a playable game?</li>
      </ul></div>`;
  }

  function reviews() {
    return window.HALL_REVIEWS ? window.HALL_REVIEWS() : `<h2>Independent reviews</h2><p>Pending.</p>`;
  }

  window.HALL_DOCS = { notes, name: (c) => NAMES[c] || c, firsts, journey, audit, research, art, build, reviews };
})();
