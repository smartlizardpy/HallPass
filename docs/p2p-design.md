# HallPass P2P co-op SDK — design note

Status: v1 (`hallpass-p2p.js` 1.0.0). First consumer: LAST BELL (1–4 player co-op).
Contract: section 4 of `HALLPASS_P2P_SDK_PROMPT.md` (kept in the LAST BELL repo).
Every place this build differs from that contract is listed in `HANDOFF.md`.

## 1. How HallPass works (findings)

| Question | Answer | Consequence for P2P |
| --- | --- | --- |
| How are games served? | Same origin as the site. The player iframe loads `/game-html/<slug>/`, which 307s to the static twin at `/games/<slug>/` (or proxies Blob for staged/newer games). The iframe has **no `sandbox`** and `allow="autoplay; fullscreen; gamepad; pointer-lock"`. | The SDK can call HallPass APIs with plain same-origin `fetch` (cookies ride along). `microphone` is not in `allow`, but its default allowlist is `'self'`, so a same-origin game frame may still ask for the mic. No CSP header is set anywhere, so WebRTC and `fetch` are not blocked. |
| Backend | Next.js 16 route handlers on Vercel (serverless / Fluid compute) + Neon Postgres over the HTTP driver. No long-running server, no WebSockets, no Durable Objects, no KV/Redis. | Spec §2 decision tree → **HTTP polling signaling backed by Postgres**. Needs new tables (migration `040`). |
| Identity | Auth.js (Google, JWT sessions). `/api/v1/me` returns `PlayerIdentity` whose `handle` is `effectiveHandle()`, which **falls back to the Google account name** (a real name). The public-safe name is `publicDisplayName()` (handle, else `@username`, else "Player"). | A new `GET /api/v1/p2p/config` returns `publicDisplayName()` for the signed-in player. `/api/v1/me` is not reused. |
| Existing SDK | `sdk/src` → one IIFE at `/sdk/v1/hallpass.js` (scoreboard, achievements, moments), installs `window.HallPass`, "never throws". | P2P has a different shape (an ES module the game imports, promises that reject with coded errors), so it is a **sibling module in `sdk/p2p/`** sharing the repo's build (tsup), test runner (vitest), lint boundary (`sdk/**` may not import server code) and hosting (`public/sdk/`). It does not ride inside `hallpass.js`: LAST BELL needs a vendorable ES module, and the scoreboard bundle must stay small. |
| Manifest | `app/lib/games.ts` static `Game[]` (+ DB overrides). | Add optional `multiplayer?: { minPlayers, maxPlayers, voice? }` and a "Players" row on the store page. |
| Analytics | PostHog, client-side, on the site shell. | Optional in the spec; **not built in v1** (open question). |

### Conflicts with the brief, and what was chosen

1. **No WebSocket/long-running server.** Chosen: HTTP polling against Neon, exactly the spec's "serverless + database" branch. To keep the database quiet, only the *joiner↔host* handshake and reconnects use HTTP; every other signal (mesh introductions, renegotiation for voice, ICE restarts between non-host peers) is relayed **over the host's data channels**.
2. **"Prefer no new tables."** Signaling between two browsers through stateless functions needs shared storage, so three small tables are added (`p2p_rooms`, `p2p_signals`, `p2p_attempts`). Rows are short-lived (signals are deleted when acknowledged and garbage-collected after 10 min; a room row lives while its host keeps polling). The migration is written, not applied to production.
3. **Real names.** See identity above.
4. **Avatars.** A HallPass avatar is usually the Google profile photo, "frequently a real photograph of a child" (`app/u/[username]/page.tsx`). v1 returns `avatarUrl: null` from HallPass. One constant flips it (open question).

## 2. Architecture

```
      joiner                    HallPass (Vercel + Neon)                 host
        |  POST /rooms/K7QX/join  ─────►  p2p_signals (to host) ◄── poll ──|
        |  POST /signal {offer, ice} ──►  p2p_signals          ◄── poll ──|
        |◄── poll ──  p2p_signals  ◄──────────── POST /signal {answer, ice}|
        |═══════════════ WebRTC (2 data channels) ═════════════════════════|
        |  welcome: room snapshot + list of peers to connect to            |
        |── offer to peer P (relayed by host over data channels) ─► P      |
```

* **Topology:** full mesh, ≤ 8 players. Host = room creator = authority for presence, lock, kick, start and the clock. Messages between two peers go directly between them.
* **Who initiates:** a joiner initiates every link (to the host, then to every peer listed in its `welcome`). Negotiation uses the W3C "perfect negotiation" pattern (polite/impolite roles), so glare (two offers at once, e.g. both sides starting voice) resolves itself.
* **Data channels:** negotiated ids, `0` = reliable/ordered, `1` = unreliable (`ordered:false, maxRetransmits:0`). Both carry JSON (text frames) and binary (framed `ArrayBuffer`). Reliable frames over 16 KB are chunked and reassembled; 256 KB cap. Unreliable frames are capped at 16 KB and dropped when the channel's buffer is backed up (stale positions are worthless). Reliable frames queue behind `bufferedAmount` (high-water 1 MB, resume at `bufferedamountlow` 256 KB).
* **Signal routing** (`router`): a pair's own reliable channel if open → else relay via the host's data channels → else the signaling transport. Over HTTP, only host→anyone and anyone→host are allowed (enforced by the server).
* **Join:** joiner asks the signaling layer to join → (HTTP: server checks the room exists, game version, and the host's last reported lock/full state; local: the host tab answers) → a `join` signal reaches the host, which re-checks (authoritative), reserves a slot, and answers the joiner's offer. When the host link is up the host sends `welcome` (snapshot + peers to dial). The joiner dials them via host relay and reports `meshed`; only then does the host add it to `players` and broadcast a snapshot, so `player-join` fires once the new player is reachable by everyone. `joinRoom` resolves at that point.
* **Presence:** host-authoritative snapshots (`rev`, meta, locked, started, players, pending ids, departures with reasons), broadcast on every change. Every peer diffs snapshots to raise `player-join` / `player-leave` / `player-update` / `room-update`; the host runs the same diff on its own state.
* **Liveness:** ICE `disconnected/failed` → `connection.state = 'reconnecting'`, the impolite side calls `restartIce()` (retried every ~3 s), and the host gives the peer 10 s before `player-leave {reason:'timeout'}`. A data channel that closes without `bye` (tab closed, crash) → `player-leave {reason:'disconnected'}` right away. `bye` (leave / pagehide) → `'left'`.
* **Clock:** host clock = `performance.timeOrigin + performance.now()` on the host. Every peer pings every link over the unreliable channel (burst at join, then every 2 s); offsets come from the median of the 5 lowest-RTT samples; `room.now()` never runs backwards.
* **Host leaves (v1):** `host-left` then `closed` for everyone; the host deletes the server room. Designed so a v2 can migrate: presence already lives on every peer and the host id is a field of the snapshot, not a constant.

### Signaling transports

| `transport` | Signaling | ICE servers |
| --- | --- | --- |
| `local` (auto on `localhost`/`127.0.0.1`/`[::1]`) | `BroadcastChannel('hallpass-p2p/<gameId>')` between tabs of one browser profile. The host tab answers join lookups. No server at all. | none by default (host candidates suffice on one machine) |
| `hallpass` (auto elsewhere) | `POST /api/v1/p2p/rooms`, `…/rooms/[code]/join`, `…/rooms/[code]/signal` (send + poll in one request) | `GET /api/v1/p2p/config` (STUN + short-lived TURN) |

Polling (HTTP): 250 ms while a handshake or reconnect is in flight (and 15 s after); the host polls every 1 s while the room is joinable, and sends a heartbeat every 25 s otherwise. A room whose host has not polled for 180 s is gone (`room-not-found`). Outgoing signals are batched (30 ms) into the next request.

## 3. Server

* `app/lib/p2p/config.ts` — pure constants (TTLs, rate limits, size caps).
* `app/lib/p2p/tokens.ts` — HMAC-SHA256 room tokens. Secret: `P2P_SIGNING_SECRET` → `AUTH_SECRET`. Payload `{ r: roomId, p: peerId, hp: hostPeerId, h: isHost }`; the signal endpoint needs no lookup to authorise.
* Peer ids: `peerId = base32(sha256("hallpass-p2p:" + secret))[0..12]`, where `secret` is random per client and never leaves the browser except to `create`/`join`. The server recomputes the id, so a peer cannot claim someone else's id (which would let it take over that peer's reconnect).
* `app/lib/p2p/ice.ts` — STUN list (`P2P_STUN_URLS`, default Cloudflare + Google) and TURN: Cloudflare Realtime TURN (`P2P_TURN_CLOUDFLARE_KEY_ID` + `P2P_TURN_CLOUDFLARE_API_TOKEN`) or any TURN server with the standard shared-secret REST scheme, e.g. coturn `use-auth-secret` (`P2P_TURN_URLS` + `P2P_TURN_SECRET`). TTL `P2P_TURN_TTL_SECONDS` (default 4 h). `P2P_FORCE_RELAY=1` forces relay-only for every client.
* `app/lib/p2p/store.ts` — fake-`sql`-testable factory, CTE-per-operation like `challenges/store.ts`; `index.ts` binds it to Neon.
* Routes (`app/api/v1/p2p/…`), all `private, no-store`, same-origin only (no CORS headers):
  * `GET config?game=` → `{ self, iceServers, iceExpiresAt, turn, forceRelay }`
  * `POST rooms` → `{ code, peerId, token, pollMs }`
  * `POST rooms/[code]/join` → `{ peerId, hostId, token, relayOnly }` or 404 `room-not-found` / 409 `room-full|room-locked|version-mismatch` / 429
  * `POST rooms/[code]/signal` → `{ alive, messages: [{ id, from, data }] }`
* `gameId` must be a known game slug (staged games only for those who may see them — a denied staged slug answers exactly like an unknown one) or the demo id `hallpass-p2p-demo`.
* Rate limits (keyed by a salted hash of the player id when signed in, else of the IP — the codebase's "a school is one IP" rule is why the IP limits are generous): create 20 / 10 min, join 40 / 10 min, failed lookups 60 / 10 min, TURN minting 60 / 10 min.
* Kill switch: `P2P_DISABLED=1` → every P2P endpoint answers 503 `unavailable`. A missing table also answers 503.

## 4. Privacy and safety

* Peers see only `{ id, name, avatarUrl }` where `id` is random per client, `name` is the public display name (or the game's fallback), `avatarUrl` is `null` from HallPass in v1. The server stores no names; `join` bodies (name + version) live in `p2p_signals` until the host reads them.
* IP exposure is inherent to P2P. `relayOnly: true` (or `P2P_FORCE_RELAY=1`) sets `iceTransportPolicy: 'relay'`, so the SDP a peer sends contains only TURN addresses. A host's `relayOnly` is stored on the room and applied by every joiner before it gathers candidates. Without TURN, relay-only cannot connect and says so.
* Rooms are private, joined by a 4-character code from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`. No listing. Host can kick (kicked ids are refused on rejoin) and lock.
* Voice is off until the game calls `room.voice.start()` (mic prompt). Per-peer and self mute.

## 5. SDK layout and build

```
sdk/p2p/src/   index.ts (entry) · types.ts (public types) · errors.ts · emitter.ts · env.ts
               codes.ts · wire.ts · clock.ts · peer.ts · signaling-local.ts · signaling-http.ts
               room.ts · voice.ts · selftest.ts · client.ts · util.ts
sdk/p2p/test/  fake-rtc.ts (in-memory RTCPeerConnection for unit tests)
sdk/p2p/tsup.config.ts → public/sdk/p2p/v1/hallpass-p2p.js, .min.js, .d.ts
public/sdk/p2p/demo/   index.html + demo.js (dots + chat; the manual test page) · harness.html
sdk/p2p/e2e/run.mjs    opt-in Playwright run of the spec §6 scenarios against real Chromium
```

`npm run build:sdk` builds both SDKs (it already runs in `predev`/`prebuild`). Served at `/sdk/p2p/v1/` (patched in place within major 1, like `/sdk/v1/`); the exact semver is in the banner and `HallPassP2P.version`. Games vendor the file and import it relatively.

## 6. Tests

* vitest (node env): wire framing/chunking, clock estimator, codes, tokens, ICE minting, store SQL shape, routes (validation + status codes), and room behaviour end-to-end over the **real** `LocalSignaling` (Node's `BroadcastChannel`) with an in-memory fake `RTCPeerConnection`: 4-player join, room-full/locked/version-mismatch, reliable ordering under simulated latency+jitter, unreliable under loss, request/handle + timeout, kick, host leave, reconnect after a cut link, clock agreement, start.
* Real browsers: `sdk/p2p/e2e/run.mjs` drives headless Chromium (fake media devices) through the same scenarios with real WebRTC and the `local` transport, plus voice. Opt-in because Playwright is not a dependency of this repo.
* Not verifiable locally: NAT traversal across different networks, TURN (needs a provider account), iOS Safari.

## 7. Plan (files, order, commits)

1. This note.
2. Migration `040_p2p_signaling.sql` + `app/lib/p2p/*` (config, tokens, ice, store, index) + tests.
3. Routes `app/api/v1/p2p/*` + tests.
4. SDK foundations: types, errors, emitter, codes, wire, clock + tests.
5. SDK transport: env, peer link, local + HTTP signaling, fake RTC.
6. SDK room + client (presence, messaging, request/handle, clock, lifecycle) + tests.
7. Voice, stats, selfTest.
8. Build: tsup config, `build:sdk`, built artifacts.
9. Demo + harness + e2e runner.
10. `multiplayer` field on `Game` + store-page row.
11. Docs: `sdk/README.md` P2P section, `sdk/CHANGELOG.md`, `HANDOFF.md`.

Deliberately excluded: host migration, public room lists, analytics, Metered's proprietary API, server-side name verification, a relay fallback through the host when one mesh link cannot connect (v1 fails the join with `connect-failed` / `peer-unreachable` instead).
