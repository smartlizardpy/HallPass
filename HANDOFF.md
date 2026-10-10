# Handoff — P2P co-op SDK (`hallpass-p2p.js`)

**Branch:** `feature/p2p-coop` (from `origin/main` at `114035d`). Not pushed,
not deployed. Migration `040` is **not** applied anywhere.

## What it is

A peer-to-peer multiplayer SDK any HallPass game can vendor: 1–8 players in a
full WebRTC mesh, host-authoritative rooms joined by 4-character codes,
reliable + unreliable messages, request/handle, a shared clock, lobby controls,
voice, diagnostics. First consumer: LAST BELL co-op. Built against section 4 of
`HALLPASS_P2P_SDK_PROMPT.md` (in the LAST BELL repo).

| | |
| --- | --- |
| SDK files (stable: **1.0.0**) | `public/sdk/p2p/v1/hallpass-p2p.js`, `hallpass-p2p.min.js` (49 KB / 17 KB gzip), `hallpass-p2p.d.ts` → served at `/sdk/p2p/v1/…` |
| Source | `sdk/p2p/src/` (types in `types.ts`), built by `npm run build:sdk` (runs in `predev`/`prebuild`) or `npm run build:sdk:p2p` |
| Server | `app/lib/p2p/` (store, tokens, TURN), routes under `app/api/v1/p2p/`, migration `app/lib/scoreboard/migrations/040_p2p_signaling.sql` |
| Demo / manual test page | `/sdk/p2p/demo/index.html` (dots + chat + voice + stats + self-test); `harness.html` for automation |
| Docs | `sdk/README.md` → "P2P co-op", `docs/p2p-design.md` |
| Catalogue | optional `Game.multiplayer = { minPlayers, maxPlayers, voice? }` → "Players" row on the store page. Not set on any game yet. |

### Endpoints (same-origin, `private, no-store`, JSON content type required)

| | |
| --- | --- |
| `GET /api/v1/p2p/config?game=` | `{ self, iceServers, iceExpiresAt, turn, forceRelay }` — public display name (never the Google name), STUN + short-lived TURN |
| `POST /api/v1/p2p/rooms` | open a room → `{ code, peerId, token, relayOnly }` |
| `POST /api/v1/p2p/rooms/[code]/join` | ask to join → `{ peerId, hostId, token, relayOnly }`, or 404 `room-not-found` / 409 `version-mismatch` / `room-locked` / `room-full` / 429 |
| `POST /api/v1/p2p/rooms/[code]/signal` | acknowledge + send + read in one request; host↔anyone only |

`gameId` must be a catalogue slug (a **staged** game such as LAST BELL today
only for beta testers/admins — everyone else gets `unknown-game` /
`room-not-found`, exactly like an unknown slug) or the demo id
`hallpass-p2p-demo`.

## How to run it

```bash
cd .claude/worktrees/feat-p2p
npx vitest run sdk/p2p app/lib/p2p app/api/v1/p2p     # 84 tests (+4 opt-in DB tests skipped), ~25 s
npm run build:sdk:p2p                                  # rebuild public/sdk/p2p/v1/
```

**Two-tab demo, no server, no database:** serve `public/` on localhost (or
`npm run dev`) and open `http://localhost:3000/sdk/p2p/demo/index.html` in two
tabs of the same browser: Connect → Create room in one, type the code → Join in
the other. Any static server works, e.g. `python3 -m http.server -d public 8080`
then `http://localhost:8080/sdk/p2p/demo/index.html`. Arrow keys/WASD move your
dot; chat; "Ask host to roll a die" is a request; Start shows the shared-clock
countdown. `?transport=hallpass` uses the real HallPass signaling instead (needs
migration 040 on the database `npm run dev` points at).

**Real-browser checks (opt-in, Playwright is not a dependency):**

```bash
npm i --no-save playwright-core && npx playwright-core install chromium
node sdk/p2p/e2e/run.mjs                               # local transport, real WebRTC
BROWSER=webkit node sdk/p2p/e2e/run.mjs
P2P_BASE_URL=http://localhost:3000 node sdk/p2p/e2e/run.mjs   # against npm run dev + its database
```

**SQL against a real (non-production) database:**
`P2P_DB_TEST=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run app/lib/p2p/store.db.test.ts`
(refuses to run when `DATABASE_URL` is the production endpoint).

### What was verified (2026-10-10)

- vitest: all 84 P2P tests pass (the 4 database tests skip unless enabled). The full `npm test` has 17 failures in
  `app/lib/console-capture.test.ts` and `app/lib/streak/streak-event.test.ts`;
  they fail identically on untouched `origin/main` under this machine's Node 26
  (its experimental global `localStorage` shadows jsdom's) and are unrelated.
- `npm run lint`: 0 errors (11 pre-existing warnings, none in P2P files).
  `tsc --noEmit`: clean. `npm run build`: passes.
- `run.mjs`, local transport: Chromium 153 9/9, WebKit 26.6 9/9.
- `run.mjs` against `next dev` + the **dev** Neon branch (040 applied to dev for
  the test, then the three tables dropped again; dev's ledger still shows 039
  and 040 pending, as before): Chromium 8/8; WebKit 7/8 — after `voice.setMuted(true)`
  the listener still measured ~0.07 RMS (0.36 unmuted). Over the local transport
  WebKit measures 0. It only shows with several WebKit pages sharing one
  browser's single-microphone arbitration; needs a two-device Safari check.
- `store.db.test.ts` against the dev branch: 4/4. Real SQL caught `full` being a
  reserved word (columns are now `is_locked`/`is_full`).
- **Not verified:** NAT traversal between different networks, TURN (no provider
  configured), Firefox, iOS Safari, Chromebooks. The manual two-network test from
  the brief still has to be done after deploy.

## Differences from section 4 of the brief (complete list)

Names and signatures are as written in section 4 unless listed here.

**Additions (nothing in section 4 removed or renamed):**
1. `connect()` options `api` (HallPass origin; default page origin) and
   `iceServers` (override).
2. `client.transport` (`'hallpass' | 'local'`).
3. `joinRoom(code, { timeoutMs })` — optional second argument, default 20000.
4. `room.maxPlayers`, `room.off(event, fn)`, and `player.hidden` (tab in the
   background).
5. `room.voice.active`, `room.voice.muted`; `voice.start()` also accepts
   `autoGainControl`; `voice.on()` returns an unsubscribe function.
6. `room.handle()` returns an unregister function. One handler per name; a
   second `handle` for the same name replaces the first.
7. `HallPassP2P.version`, `HallPassP2P.P2PError` (also a named export), and a
   default export. `selfTest()` accepts `{ api, gameId, iceServers, timeoutMs }`.
8. Error codes beyond the joinRoom list, for other operations: `closed`,
   `not-host`, `peer-left`, `handler-error`, `message-too-large`,
   `send-buffer-full`, `invalid-argument`, `already-in-room`, `unsupported`,
   `mic-denied`, `mic-unavailable`.

**Behaviour the brief left open, now defined:**
9. `client.self.id` is random **per `connect()`** (per client), not per room: one
   client reuses its id for every room it creates/joins. It is never tied to an
   account.
10. `client.self.avatarUrl` is always `null` for now (privacy choice, see open
    questions). `name` from HallPass is the public display name: handle, else
    `@username`, else "Player".
11. One room per client at a time: `createRoom`/`joinRoom` while in a room
    reject with `already-in-room`.
12. `joinRoom` resolves only when you are connected to **every** player. If one
    pair cannot connect it rejects `connect-failed`/`peer-unreachable`.
13. `joinRoom` rejection details: an unparseable code → `room-not-found`;
    rejoining after a kick → `room-locked` with `reason: 'kicked'`; rate limiting
    → `connect-failed`/`rate-limited` (kept inside the contract's code list);
    `timeout` means the host never answered. `connect-failed` reasons:
    `no-turn-restrictive-network`, `turn-failed`, `relay-unavailable`,
    `peer-unreachable`, `signaling-unreachable`, `signaling-unavailable`,
    `rate-limited`, `unknown-game`, `room-closed`. `createRoom` failures are
    `connect-failed` with the same reasons.
14. `connect()` rejects only for `invalid-argument` (bad `gameId`) and
    `unsupported` (no WebRTC); when HallPass is unreachable it still resolves with
    the fallback name.
15. Host-only methods (`setRoomMeta`, `lock`, `unlock`, `kick`, `start`) called by
    a non-host **throw** `not-host` synchronously (they return `void`).
16. `setPlayerMeta` / `setRoomMeta` **shallow-merge**; a `null` value removes a
    key. Caps: player meta 4 KB, room meta 8 KB, `createRoom` meta 8 KB.
17. `send()` defaults to `reliable: true`. It throws synchronously for: a
    lifecycle event name as the message name (`invalid-argument`), a name longer
    than 64, data JSON cannot carry (`invalid-argument`), reliable data over
    256 KB or unreliable over 16 KB (`message-too-large`), more than 16 MB queued
    to one peer (`send-buffer-full`), and a closed room (`closed`). `undefined`
    data arrives as `null`; binary arrives as the same typed-array type.
18. `to: 'others'` means the players this client currently knows; a newcomer is
    included once you have seen its `player-join` (one hop after its own
    `joinRoom` resolves). `to: 'host'` from the host delivers to itself.
19. `request(to, …)`: `to` is `'host'` or one peer id. Besides `timeout` (also
    when nobody handles the name, as the brief requires) it rejects
    `handler-error` (message = the handler's), `peer-left`, `closed`. Default
    `timeoutMs` 5000.
20. `room.now()` is an epoch-millisecond timestamp on the host's clock
    (`performance.timeOrigin + performance.now()` on the host) and never runs
    backwards; before the first ping it is the local clock.
21. `start(payload)`: payload must be JSON; may be called again (each call emits
    `start`). With `lockOnStart`, players still mid-join are turned away. A player
    joining a started, *unlocked* room receives the last `start` event right after
    `joinRoom` resolves.
22. `kick(peerId, reason)`: reason optional, ≤ 200 chars; the kicked client cannot
    rejoin that room.
23. Events: `player-update` fires for ready/meta/name and for connection
    state/relay changes, **not** for `rttMs` changes. `room-update` fires for
    meta, lock, started. `visibility` is only raised for other players.
    `closed.reason` is `'left' | 'kicked' | 'host-left' | 'timeout' | 'error'`.
    The host leaving itself gets `closed { reason: 'left' }` (no `host-left`).
    Guests get `host-left` then `closed { reason: 'host-left' }` when the host
    leaves or its tab closes, and `host-left` then `closed { reason: 'timeout' }`
    after 10 s without the host. A kicked player gets `kicked` then
    `closed { reason: 'kicked' }`. A failed `joinRoom` rejects and emits nothing.
    A throwing game handler raises `error` with a `P2PError` (`handler-error`,
    original as `cause`).
24. `player-leave` reasons: `left` (leave/pagehide), `kicked`, `disconnected`
    (connection closed with no goodbye), `timeout` (unreachable for 10 s; the
    host decides). A link between two guests that cannot recover while both still
    reach the host stays `reconnecting` and causes no leave.
25. `connection.rttMs` is `null` until measured; your own entry is
    `{ state: 'connected', rttMs: 0, relay: false }`. `room.players` / `room.meta`
    return copies.
26. Voice: remote streams are delivered even if you never started voice
    (listen-only). A late `voice.on('stream')` subscriber is told about streams
    that already arrived. `stop()` keeps the audio transceiver (later `start()`
    does not renegotiate); peers get `stream-end`. `start()` rejects
    `mic-denied` / `mic-unavailable` / `closed`. Voice is bundled, not lazy-loaded.
27. `room.stats()` returns an object keyed by peer id. `rttMs` comes from the
    SDK's own pings; `lossPct` is lost pings on the unreliable channel over the
    last ~20 (null until there are some).
28. `selfTest()` returns `notes` as an **array** of player-readable sentences;
    `natType` is `'cone' | 'symmetric' | 'udp-blocked' | 'unknown'` (best effort).
29. `relayOnly` is ignored by the `local` transport. A host's `relayOnly` is
    applied to everyone who joins its room.
30. The `local` transport uses no ICE servers (works offline). Safari only
    exposes host candidates with mic/camera permission, so same-machine Safari
    tabs cannot connect unless the mic is granted first.
31. Hosting: `/sdk/p2p/v1/` (major path, patched in place like `/sdk/v1/`), not
    an exact-semver path. The ICE endpoint is `GET /api/v1/p2p/config` (the
    brief's `/api/p2p/ice` was an example).
32. Size: 49 KB minified (17 KB gzipped), over the "~40 KB" aim.

## Before this can go live (steps for a human)

1. **Review and merge** `feature/p2p-coop` (open the PR; nothing was pushed).
2. **Apply migration 040 to production** (Neon `main`) — after checking what is
   pending there (`039` is pending on dev, so check prod too):
   `DATABASE_URL='<prod>' npm run migrate -- --status`, then `npm run migrate`.
   Until it runs, the P2P endpoints answer 503 and the SDK reports
   `connect-failed`/`signaling-unavailable`; nothing else is affected.
3. **TURN (strongly recommended — school networks):** create a Cloudflare
   Realtime TURN key and set `P2P_TURN_CLOUDFLARE_KEY_ID` +
   `P2P_TURN_CLOUDFLARE_API_TOKEN` in Vercel, or run coturn with
   `use-auth-secret` and set `P2P_TURN_URLS` + `P2P_TURN_SECRET`. The Cloudflare
   call was written from its documented API but not tested against a real
   account.
4. Optional env: `P2P_SIGNING_SECRET` (else `AUTH_SECRET` is used),
   `P2P_TURN_TTL_SECONDS`, `P2P_STUN_URLS`, `P2P_FORCE_RELAY=1` (relay-only for
   all — needs TURN), `P2P_DISABLED=1` (kill switch).
5. **Deploy.** `prebuild` rebuilds `public/sdk/p2p/v1/` (also committed).
6. **Manual test** from the brief: two people on different networks (home Wi-Fi
   + phone hotspot) open `https://hallpass.gg/sdk/p2p/demo/index.html`, create
   and join, move dots, chat, try voice. Then with "relay only" ticked: Stats
   should show `relay: true`. Try "Test connection" on a school network.
7. **LAST BELL:** copy `hallpass-p2p.js` (+ `.d.ts`) into its `lib/`, use
   `gameId: 'last-bell'`. While LAST BELL is staged only beta testers/admins can
   open or join rooms on HallPass. When co-op ships, add
   `multiplayer: { minPlayers: 1, maxPlayers: 4, voice: true }` to its entry in
   `app/lib/games.ts`.

## Open questions (need a decision)

1. **TURN provider and cost** — Cloudflare Realtime TURN (free tier, then per GB)
   or self-hosted coturn? Without one, many school networks cannot connect.
2. **Avatars** — HallPass avatars are usually Google photos of children, so
   `avatarUrl` is `null` for now. Flip `SHARE_AVATAR_WITH_PEERS` in
   `app/lib/p2p/config.ts` if peers should see them.
3. **Relay-only by default?** `P2P_FORCE_RELAY=1` hides every player's IP from
   the others at the cost of TURN bandwidth. Off for now.
4. **Rate limits** — guests are keyed by IP and a school shares one, so limits
   are generous (60 failed joins / 10 min / IP). With 4-character codes (~1M per
   game) a determined guesser can occasionally land in a live room; hosts can
   kick and lock. Tighter limits, longer codes, or signed-in-only joining?
5. **Which games may use it** — any catalogue slug today. Restrict to games that
   declare `multiplayer`?
6. **The public demo** at `/sdk/p2p/demo/` on production — keep it public (it is
   the brief's manual test page) or gate it?
7. **Analytics** (rooms created, players per room, success/failure, relay share,
   session length) was optional and is not built.
8. **Database load** — an open lobby polls about once a second (one Neon
   statement per poll); a locked room heartbeats every 25 s. Acceptable?
9. **Bundle size** — 49 KB vs the ~40 KB aim. Worth trimming further?
10. **Host migration** (v2) — not built; the snapshot carries the host id so a
    v2 can add it.
11. **WebKit voice mute** in the multi-page test (above) — confirm on two real
    Safari devices.

---

# Handoff — video on external games (remaining local steps)

**Branch:** `claude/youtube-upload-external-games-6lldi6`

This branch adds the ability to attach a YouTube gameplay/intro video to
**external** games and fixes the "Could not save the video" error. The code is
done; the only remaining work needs local access to the database and is
described below.

## What's in this branch

1. **Add a Video form to the external-game control page**
   (`app/dashboard/(app)/games/[slug]/page.tsx`). The per-game control page
   early-returns a focused editor for external games and returned *before* the
   Video section existed, so an external game had no way to attach a video. The
   backend already supported it: `setGameVideoAction` gates on `isResolvedSlug`
   (which includes external games), the `game_videos.slug` CHECK accepts their
   slugs, and the store page renders `GameTrailer` for any resolved game. This
   was purely a missing UI in the external branch.
2. **Prefill that form** from `getGameVideo(slug)`, so an already-attached video
   is shown and editable in one place — matching the native branch.
3. **Log the real error** when saving/clearing a video fails
   (`video-actions.ts`). The catch previously swallowed the cause behind the
   generic "Could not save the video. Try again." It now `console.error`s the
   underlying error (matching the moderation/favorites convention).

## The bug that needs a local fix — apply migration 013

"Save video" fails on **normal games too**, because the `game_videos` table
doesn't exist in the database the app runs against: **migration
`013_game_videos.sql` was never applied.** The write is not fail-soft, so it
surfaces as the generic error. With change (3) above, the server log now shows
the real cause:

```
[video] setGameVideo(<slug>) failed … relation "game_videos" does not exist
```

### Neon branching caveat

We use **Neon database branching**, so there are multiple `DATABASE_URL`s (e.g.
a production branch plus dev/preview branches). Migration 013 must be applied to
**every branch the app runs against**, not only local dev. The prod app failing
means the **prod** branch is the one that must get it.

```bash
# Confirm what's pending + WHICH db you're pointed at (prints target host; changes nothing)
npm run migrate -- --status        # expect: · 013_game_videos.sql  PENDING

# Apply to the current DATABASE_URL (.env.local)
npm run migrate

# For each OTHER Neon branch (prod, preview), point DATABASE_URL at it and repeat:
DATABASE_URL='<other-branch-connection-string>' npm run migrate -- --status
DATABASE_URL='<other-branch-connection-string>' npm run migrate
```

- The runner prints `[migrate] target: <host>` — **verify it matches the
  intended Neon branch each time.**
- `013` is already on `main`, so any up-to-date checkout can run it.
- Do **not** use `--baseline-through=013` — that records it as applied *without
  creating the table*. Use plain `npm run migrate`.

## Verify

- `npm run migrate -- --status` shows `✓ 013_game_videos.sql` on each branch.
- In the dashboard, "Save video" succeeds on a normal game **and** an external
  game; the video shows on `/game/<slug>`.
- Run `npm run build` and `npm run lint` locally — the remote container that
  produced these commits had no `node_modules`, so the UI change has not been
  build-checked yet.

## Notes

- Commit author must be `Smartlizardpy <Smartlizardpy@duck.com>` with **no**
  attribution trailers (AGENTS.md).
- This file is coordination-only; delete it before merge if you'd rather it not
  land on `main`.
