/* The four independent reviews (Sonnet reviewers, 26 Oct 2026), each finding checked against the
   page before acting, and what happened to it. Outcome: fixed, partly fixed, kept (declined, with the
   reason) or noted (a real cost of that concept, left for the decision). */
(function () {
  "use strict";
  const R = [
    {
      who: "Visual art", pick: "A, tightened: the only one that already feels like the same world as the homepage and the Pack Room, with the cleanest overlay fit on a Chromebook.",
      verdicts: ["A: most coherent with the Pack Room and the homepage, and the safest; reads as a flat front-on row.", "B: the most charming and original, with the best stage framing and lighting; the busiest, and the weakest on game identity.", "C: the most atmospheric and distinct; the muddiest at 1×, and the riskiest on a Chromebook."],
      items: [
        ["C", "high", "On the first screen the cabinets run past the fold.", "noted", "Checked: Play on the left cabinet is visible (page rows 584–629 of 640), but the cabinet bases are not. This comes from C's camera, so it is recorded as C's main cost rather than patched."],
        ["C", "high", "Dither and fog read as noise; the far cabinets are mush.", "partly fixed", "The light was already redrawn as solid bands; in the page the fog now sits under the cabinets, never over a Play strip. The far rows are still texture."],
        ["all", "high", "The two mystery cabinets are identical; give each a hint of its game's colour.", "kept", "Unannounced games are deliberately unnamed (championship design §2). A pink or crimson tell would announce them, so the cabinets stay identical until their board opens."],
        ["B", "medium", "The lower third is overloaded (chairs, tape, wall bars).", "fixed", "Chairs removed; tape and wall bars one value quieter, so HALL SCORES leads the left wall."],
        ["A", "medium", "Flat room with an empty floor.", "kept", "The empty floor is where the control deck (the HTML panel) sits in the page. The front-on camera is shared with the Pack Room on purpose."],
        ["C", "medium", "The Candy Hunt label sits on the fortune-teller.", "kept", "By design, Madame Moon's booth is the way into Candy Hunt."],
        ["C", "medium", "The calm season still looks haunted.", "noted", "A possessed room can't become a year-round room without redrawing it. This is C's biggest structural limit. In A and B, calm removes every Halloween prop; the moon and the night are the brand's year-round setting."],
        ["A", "low", "An empty bar sits under the marquee.", "kept", "That bar is the ticker, filled with live text in the page."],
      ],
    },
    {
      who: "Gaming UX", pick: "A: the only one where title, status, Play, the board with your row, and the prize counter all fit one Chromebook screen. Keep C's selection panel; drop its zoom.",
      verdicts: ["A: best first screen; the page below the room is long.", "B: charming, but the title is small and its panel sits below the fold.", "C: most atmospheric, hardest to read on a Chromebook; the zoom hides the board.", "All three beat the live page, which has no play path, no points and no board."],
      items: [
        ["all", "high", "Unannounced games are named in the Candy Hunt notes.", "fixed", "A bug: the source lines and the review note named them. They now say \"A mystery cabinet\" until the game is announced."],
        ["A, B", "high", "The details panel with Play sits below the fold.", "fixed", "A's panel content is top-aligned, so the title and Play land above the fold. B's Play ticket is on the first screen; its panel stays below the fold."],
        ["C", "high", "The zoom hides the board and the prize counter.", "partly fixed", "Arrow keys now move between cabinets without zooming; only a click or Enter zooms. Escape or Back returns. The zoom itself is C's idea, so it stays for you to judge."],
        ["all", "medium", "Candy Hunt doesn't read as not built, and it shows developer jargon.", "fixed", "Stamp \"Preview · not open\", a plain lede (\"nothing here can be earned\"), unbuilt steps marked \"not open\", API names only in the review overlay, and the section moved below the rules."],
        ["all", "medium", "Fright Points vs Candy is explained too far down.", "fixed", "One line under High scores: points come from your rank, decide the champion, and can't be spent."],
        ["A", "medium", "The sample label is small; show the gap to the next place.", "fixed", "\"The next place up, 10th, is 15 Fright Points ahead.\" The Sample tag now also shows beside Provisional and Final."],
        ["all", "medium", "Guaranteed vs random rewards are not plain enough.", "fixed", "Random slots now read \"1 random card\" with their odds."],
        ["phone", "medium", "Put the panel above the room on phones.", "kept", "The room is the event's identity; Play is one short scroll down, and Last Bell can't be played on a phone anyway."],
        ["A", "low", "Play is live before the event opens.", "kept", "You can practise before ranked runs open. The copy now matches production word for word: \"Practise now; nothing counts until then.\""],
      ],
    },
    {
      who: "HallPass brand", pick: "A: it reads as the room between the homepage cabinets and the Pack Room counter, with the safest tone for teachers and younger players.",
      verdicts: ["A: strongest family resemblance; a little crowded.", "B: the most narrative link to the school, but its green brick drifts from the night palette, and the school setting is the riskiest.", "C: the darkest, and the furthest from HallPass's playful warmth."],
      items: [
        ["B", "high", "A school hall on a site used in class may provoke teachers.", "noted", "This is B's main risk, already in its notes. \"Hard Detention\" stays because it is the real name of a Last Bell achievement. ROOM 000 is fictional Last Bell lore and stays, flagged."],
        ["C", "high", "Glowing eyes and fused-machine horror may unsettle younger players.", "fixed", "Cut to three muted amber pairs; Madame Moon stays friendly."],
        ["all", "medium", "Wordmark use varies; in C it overlaps the title.", "fixed", "C's wordmark sits on its own line inside the sign plate. A and C use bone lettering with the yellow square, as on the Pack Room sign; B's is the purple wordmark on a paper card."],
        ["all", "medium", "The mock sidebar of empty boxes looks unfinished.", "fixed", "The mock rail and tab bar have icons."],
        ["all", "medium", "Developer text appears on a player page.", "fixed", "Same fix as the gaming UX finding."],
        ["all", "medium", "\"Design preview · not built\" reads as an internal note.", "fixed", "Changed to \"Preview · not open\". It does not say \"coming soon\", because nobody has decided to build it."],
        ["B", "low", "\"Admit one\" replaces \"Play\".", "fixed", "Each ticket says Play, with \"admit one\" as small print, so the visible label matches the accessible name."],
        ["C", "low", "In calm, swap Madame Moon for a plain stand.", "noted", "Part of C's calm-season limit."],
      ],
    },
    {
      who: "Accessibility & performance", pick: "",
      verdicts: ["Text contrast on art measured 7.4–16.4:1 everywhere, except B's paper panel (5.0–6.5:1).", "First load about 260–272 KB per concept, including JS, CSS and fonts, but not the Google font files; the six web font families are probably the largest cost.", "C has three full-room layers plus fog, and 11 sprite loops; A and B have no layers, and 7 to 8 loops."],
      items: [
        ["all", "high", "Selecting a cabinet drops keyboard focus, and the live regions are rebuilt on every render.", "fixed", "Focus stays on the cabinet. C's zoom moves focus into its panel and takes the hidden room out of the tab order. One persistent announcer says \"Last Bell selected. Ranked · live.\""],
        ["all", "high", "The \"Full standings\" link is 96 × 19 px.", "fixed", "Now 12 px type, at least 36 px tall, 44 px on touch and 48 px on whiteboards."],
        ["all", "medium", "Cabinet tab stops are not roving, and the mystery cabinets share a name.", "fixed", "Only the selected cabinet is a tab stop (arrow keys move). Names are \"Cabinet 2 of 3\"."],
        ["B", "medium", "The paper panel is below 7:1.", "fixed", "Chip #7f1f0d (7.9:1), small text #4a4030 (8.1:1), selected ticket in ink on pumpkin (7.4:1)."],
        ["all", "medium", "Pixel type at 8–10 px.", "fixed", "12 px minimum for pixel type; only the second line of narrow plates and B's \"admit one\" small print are 10 px."],
        ["all", "medium", "The page behind the dialog stays interactive.", "fixed", "The page is inert while the prize-counter dialog is open; the alt text is shorter."],
        ["C", "medium", "Parallax writes on every pointer move.", "fixed", "Batched with requestAnimationFrame, will-change on the layers only while parallax is active, and a live reduced-motion change re-renders."],
        ["all", "low", "Long names are cut off with no way to read them.", "fixed", "Truncated names carry the full name as a title. Narrow ticker plates get the short wording."],
        ["all", "low", "Touch users get no hint for the hotspots.", "kept", "The plates (\"Candy Hunt · preview\", \"Prize counter →\") are the visible hint; nothing relies on hover."],
        ["C", "low", "About 60 KB of unused tiles ship with C.", "fixed", "Builder test tiles are no longer copied into the prototype."],
      ],
    },
  ];
  const tone = { fixed: "ok", "partly fixed": "part", kept: "", noted: "part" };
  window.HALL_REVIEWS = () => `<h2>Independent reviews</h2>
    <p class="lede">Four Sonnet reviewers, briefed separately, had the screenshots, the art and the running prototype. Each finding below was checked against the page before anything changed. "Kept" means I declined the change, for the reason given. "Noted" means it is a real cost of that concept and is left for your decision.</p>
    <div class="card"><h3>Where they agree</h3><ul>
      <li>All three concepts beat the live page.</li>
      <li>Three of the four picked <b>A</b> to build (the accessibility reviewer was not asked), mostly for Chromebook fit and the family resemblance to the Pack Room. B's stage framing and C's selection panel are worth borrowing.</li>
      <li>B's school setting and C's darkness are the two brand risks. C's calm season is its structural weakness.</li>
    </ul></div>
    ${R.map((r) => `<div class="card"><h3>${r.who}</h3>
      <ul>${r.verdicts.map((v) => `<li>${v}</li>`).join("")}</ul>
      ${r.pick ? `<p><b>Would build:</b> ${r.pick}</p>` : ""}
      <div class="tbl-wrap"><table><thead><tr><th>Where</th><th>Sev.</th><th>Finding</th><th>Outcome</th></tr></thead><tbody>
      ${r.items.map(([w, sev, f, o, why]) => `<tr><td>${w}</td><td>${sev}</td><td><b>${f}</b><br>${why}</td><td><span class="pill ${tone[o]}">${o}</span></td></tr>`).join("")}
      </tbody></table></div></div>`).join("")}`;
})();
