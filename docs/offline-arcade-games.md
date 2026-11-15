# Offline Arcade — games, compatibility and testing

Developer guide for putting a game in the HallPass Offline Arcade. The format
itself is specified in `hpg-format.md`; why it is built this way is in
`offline-arcade-design.md`.

## How it fits together

```
public/games/<slug>/          the game, as the site serves it
hpg/games.config.ts           one adapter per offline game
        │  npm run hpg:arcade  (runs in prebuild and predev)
        ▼
public/arcade/                gitignored, rebuilt on every build
  packages/<id>-<ver>-<hash>.hpg
  index.html                  the launcher; trusts exactly these packages
  catalog.json                read by /offline-arcade at build time
        │  /offline-arcade: the player picks games
        ▼
hallpass-offline-arcade.zip   composed in the browser, every file sha256-checked
  HallPass Arcade/index.html, games.zip, README.txt
```

A game is offered only if its adapter is `verified`, it is **published**, and
it packages cleanly. "Published" uses the same rule as `sync-games`
(`scripts/lib/staged.mjs`): the dashboard override in `game_overrides.staged`
when the build can read the database, otherwise `staged` in `games.ts`. So a
game published from the dashboard can be offered without a `games.ts` edit.
Without a database the build falls back to `games.ts`, which can only offer
fewer games. A game that fails to package is left out with a `::warning::` in the
build log, and the deploy continues.

## Adding a game

1. Check it: `npm run hpg:audit`. The verdict must be `packageable` or
   `fonts-fall-back`. `blocked` names the remote dependency in the way (see
   below).
2. Add an adapter to `hpg/games.config.ts`. Start from an existing one. The
   fields that matter:
   - `entry`: the HTML file, normally `index.html`.
   - `inputs`, `display`: shown to players and used for layout.
   - `saves: true` if the game uses `localStorage`. The launcher then stores
     it.
   - `scoreOrder: "asc"` for games where lower is better (times).
   - `workers`: a pattern for worker scripts the game builds a URL for at run
     time (`new URL("worker-x.js", import.meta.url)`). They are bundled as
     classic workers, because module workers from `blob:` do not run in an
     opaque-origin frame.
   - `assets`: extra files the game fetches by URL (JSON, audio, images).
   - `status`: `"experimental"` until the e2e run below passes.
3. Build and look: `npm run hpg:build -- --game <id> --verbose`, then
   `npm run hpg:inspect -- public/arcade/packages/<file>.hpg`. Read every
   warning. Nothing is stripped silently: a dropped font or a removed SDK tag is
   reported.
4. Play it offline: `npm run hpg:arcade -- --include-experimental` (the flag
   is what lets a not-yet-verified game in; never use it for a deploy), open
   `public/arcade/index.html` from
   disk with Wi-Fi off, drop in a `games.zip` of the packages, and play it all
   the way through once, including saving and reloading.
5. Prove it, one of two ways, then set `status: "verified"`:
   - add it to `GAMES` in `hpg/e2e/run.mjs` (how to start it, what input proves
     it is alive) and pass the e2e (below); or
   - get a PASS from `npm run hpg:smoke` and have a person play it in the lab
     arcade.

## What blocks a game, and what to do

| Problem | Why it can't run offline | Fix |
|---|---|---|
| A CDN library listed in `hpg/vendor/manifest.json` (Tailwind Play CDN, three.js r128 / 0.160.0 / 0.169.0, Font Awesome 6.0.0) | — | Nothing: the packager inlines the pinned, hash-checked copy and reports it (`build/vendor.ts`) |
| Any other CDN script, stylesheet or import-map entry | The file only exists online | Add the exact version to `LIBRARIES` in `hpg/vendor/fetch.mjs`, run it, commit (`hpg/vendor/README.md`) |
| Google Fonts | The font can't load | Nothing needed: the game uses its fallback font, and the build reports it |
| `fetch()` to a server, WebSockets, multiplayer | Needs the internet by design | Not offline-capable |
| `import(variable)` or a surviving runtime `require` | Can't be resolved at build time | Make the import static. (`import(NAME)` where `NAME` is a top-level string `const` bound once in the file is resolved automatically.) |
| HallPass co-op SDK (`https://www.hallpass.games/sdk/p2p/v1/hallpass-p2p.js`) | — | Nothing: the packager bundles the repo's copy from `public/sdk/p2p/v1/` and reports it. Co-op needs the internet; solo works offline |

Every one of these is caught at build time (`build/inline.ts`,
`build/js-check.ts`). The launcher's Content-Security-Policy also blocks any
network request at run time, so a miss would fail visibly rather than quietly
working only while online.

## What a game gets at run time

The game runs in `<iframe sandbox="allow-scripts">` (never with
`allow-same-origin`) inside the launcher. The guest runtime
(`hpg/src/guest/install.ts`) is injected first and provides:

- `localStorage` and `sessionStorage`. The browser forbids real storage in an
  opaque-origin frame, so writes go to the launcher, which keeps them in
  IndexedDB.
- `window.HallPass`: an offline SDK. Scores go to a local leaderboard; every
  other call returns its documented inert result.
- `hpg:/` URLs for packaged files, through `fetch`, `Worker`, and media `src`.
- Fullscreen requests are forwarded to the launcher, which makes its player
  fullscreen.
- `hpg:pause` and `hpg:resume` events when the tab is hidden or shown, plus a
  master mute.

## Compatibility report

Every game the site hosts packages: 40 of 40 on 15 November 2026 (34 in
`public/games/` plus the 6 published from the dashboard, which a deploy
mirrors from Blob). Smoke results from Chrome 157 with the network off.

| Verdict | Games |
|---|---|
| **Offered**, full e2e | conquest, depths-of-aethelgard, neon-tether |
| **Offered**, smoke PASS + playtest (14 Nov) | battlebadlers, core-vs-swarm, crimson-survivor, doodle-dash, jjk-domain-survival-top-down, jjk-domain-survival-v3, neon-fracture, neon-hockey, neon-well, ragdoll-hoops, sea-mercenary, silence, snag, vanta-void, last-bell (solo; playtested, headless Chrome cannot pointer-lock) |
| **Offered**, smoke PASS (15 Nov) | color-clash-3d, cube-clash-3d, cyber-pulse-3d-neon-dash, duskfall (synthesised sound offline), living-flesh, neon-snake, neon-velocity-hyperdrive, paddle-crawler, rhythm-hell-harmonic-flash, scp-lockdown, shadow-core-halloween-dash, survive-till-dawn-pixel-edition, symbiosis, system-error, vanishing-point-3-14 |
| **Offered**, smoke CHECK (15 Nov): start screen drawn, no errors, generic input can't get past it | chroma-orbit, customizable-os, nuclear-reactor-manager, pixel-bullet-quest, pixel-slicer, system-restore, teraria |
| Not packageable | games hosted off-site (`externalUrl`) |

The 15 November rows were added at the site owner's request to offer every
game that packages; see the docblock in hpg/games.config.ts.

## Trying every game at once (the lab)

Before writing adapters, see which games actually run offline:

```
npm run hpg:lab
PLAYWRIGHT_CORE=<dir of a playwright-core install> npm run hpg:smoke
```

`hpg:lab` packages **every** game in `public/games/` into the gitignored
`arcade-lab/`. Games with an adapter use it, and the rest use the audit's trial
adapter. The output is a launcher that trusts all of them, a `games.zip`, and
`lab.json` listing what built and why the rest didn't. To play them by hand,
open `arcade-lab/index.html` and drop `games.zip` on it.

Staged games are included in the lab, and `--source <id>=<dir>` packages a
game from its own working folder instead of `public/games/` (for example
`npm run hpg:lab -- --source last-bell=../last-bell`). Neither is ever possible
in the deploy build.

`hpg:smoke` opens that launcher from `file://` with the network off, imports
everything and gives each game the same generic treatment:
1. Press a start-like button (`START_WORDS` in smoke.mjs) if there is one, otherwise click the middle.
2. Press Enter and Space.
3. Hold arrows and WASD, then swipe and click.

Each game gets one of three verdicts:
- **PASS**: it started, drew and reacted.
- **CHECK**: it ran but logged errors, or didn't visibly react. The usual reason is a start screen the generic input can't get past.
- **FAIL**: it never became ready, or the screen stayed blank.

The verdicts and three screenshots per game are in
`arcade-lab/report/index.html`. Run a subset with `ONLY=id,id` and watch with
`HEADED=1`. Any http(s) request fails the run.

A smoke PASS is a shortlist, not a verification. The lab never touches
`public/arcade/` or what the website offers.

## Browser testing

Opt-in, like the P2P SDK's e2e, because Playwright is not a dependency:

```
npm run hpg:arcade
PLAYWRIGHT_CORE=<dir of a playwright-core install> BROWSER=chrome npm run hpg:e2e
```

`BROWSER` is `chrome` (the installed Google Chrome, the default), `edge`,
`firefox` or `chromium`. `SHOTS=<dir>` keeps screenshots and `HEADED=1` shows
the window.

The run opens the launcher from `file://` with the browser's network turned
off. It imports `games.zip` through the file picker and refuses a tampered
package and a non-ZIP. Then, for every game, it checks that the game starts,
draws, reacts to its real input, and is sandboxed (opaque origin, no parent
DOM, no network). It also checks that its `localStorage` survives Back,
relaunch and a full browser restart, and that Back removes the frame. Any
http(s) request fails the run.

Results are in `offline-arcade-design.md` §7.

### Known test limitation

Headless Chrome stops delivering real mouse input to the sandboxed game frame
once a canvas in it has captured the pointer. Conquest does this when you tap
the map. So the e2e presses Conquest's Start button with a DOM click, after a
real tap has enabled it. Headed Chrome, which is what players use, delivers
the real click and the match starts: checked with `HEADED=1` on 14 November
2026. (The unpackaged game, loaded as a top-level page in headless Chrome,
also accepts the real click. The problem only appears when headless input
crosses into an out-of-process frame.)
