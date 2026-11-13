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

A game is offered only if its adapter is `verified` **and** it packages
cleanly. A game that fails to package is left out with a `::warning::` in the
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
5. Add it to `GAMES` in `hpg/e2e/run.mjs`: how to start it and what input
   proves it is alive. Run the e2e (below). Then set `status: "verified"`.

## What blocks a game, and what to do

| Problem | Why it can't run offline | Fix |
|---|---|---|
| `<script src="https://cdn.tailwindcss.com">` | Tailwind Play builds CSS at run time from a remote script | Build the CSS once (Tailwind CLI) and commit it next to the game |
| Import map to a CDN (`three` from jsdelivr) | The module only exists online | Vendor the module into the game folder and import it relatively |
| `<script src>` from cdnjs | Same | Vendor the file |
| Google Fonts | The font can't load | Nothing needed: the game uses its fallback font, and the build reports it |
| `fetch()` to a server, WebSockets, multiplayer | Needs the internet by design | Not offline-capable |
| `import(variable)` or a surviving runtime `require` | Can't be resolved at build time | Make the import static |

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

From `npm run hpg:audit` on 14 November 2026 (34 games in `public/games/`).

| Verdict | Games |
|---|---|
| **Offered** (adapter, packaged, e2e) | conquest, depths-of-aethelgard, neon-tether |
| Packageable, no adapter yet | crimson-survivor, doodle-dash, neon-well, paddle-crawler, pixel-slicer, ragdoll-hoops, sea-mercenary, system-restore, teraria |
| Packageable, font falls back | battlebadlers, core-vs-swarm, jjk-domain-survival-top-down, jjk-domain-survival-v3, neon-fracture, neon-hockey, neon-velocity-hyperdrive, nuclear-reactor-manager, silence, snag, vanta-void |
| Blocked: Tailwind Play CDN | chroma-orbit, neon-snake, pixel-bullet-quest, rhythm-hell-harmonic-flash, shadow-core-halloween-dash, symbiosis, system-error |
| Blocked: import map to jsdelivr | color-clash-3d, duskfall |
| Blocked: Three.js from cdnjs | cube-clash-3d |
| Not published | last-bell (also needs a server for multiplayer) |

"Packageable" means the build succeeds with no remote dependency. It does
**not** mean the game has been played offline. Only the three offered games
have been. The rest need steps 2–5 above.

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
1. Press a start-like button if there is one, otherwise click the middle.
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
