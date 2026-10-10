# Game invites — design

`HallPass.invite()` lets a game ask the player to bring friends into what they
are doing right now — first consumer: LAST BELL, which sends `{ room: "ABCD" }`
so a friend lands straight in the co-op lobby. `HallPass.getLaunch()` is the
other end: the friend's copy of the game reads that data once when it opens.

This document is the plan written before the code (AGENTS.md, phase 2) and the
record of the decisions behind it. Read it with `challenge-design.md`,
`challenge-sharing-design.md` and `p2p-design.md`; invites borrow their
transports, their safety rules and their rate-limit shape.

## 1. What is being built

1. **SDK** (append-only v1 contract):
   `invite({ data, expiresInMinutes? }) → Promise<{ sent, link, cancelled }>` and
   synchronous `getLaunch() → { kind: "invite", data, from, expiresAt } | null`.
2. **A picker** at `/embed/invite`, opened exactly like the challenge picker: an
   inline first-party frame for games on HallPass's origin, a popup for
   cross-origin games. It lists the signed-in player's friends who can open this
   game, invites any number of them, and has a **Share link** button (share
   sheet → clipboard → the URL on screen). Signed-out players get "Sign in to
   invite friends" and the link button — links work for guests.
3. **`POST /api/v1/me/invites`** writes invites and notifies friends.
4. **A `game_invite` notification kind** (social, push by default).
5. **A landing page `/i/<code>`** that names who invited you and to what, and
   starts the game in place, handing the invite data to it.
6. **A privacy fix found on the way**: the friend-list GETs had no origin check.

## 2. Decisions

- **The data is opaque.** A JSON object, at most 1 KB serialised (UTF-8 bytes),
  validated server-side for shape and size only. HallPass never interprets it.
- **Expiry**: default 30 minutes, clamped to 1–120. Invites are for "come now";
  a room code is worthless an hour later.
- **One row per invite.** A friend invite is one row per recipient (so each has
  its own code, notification and dedupe key); a link is one row with no
  recipient. `kind` is `'friend' | 'link'`.
- **Codes**: 12 characters from the friend-code alphabet (`username.ts` — no
  confusable pairs, no vowels), ~1.5e17 combinations, regenerated on an
  unfortunate skeleton like challenge-link codes. Rows live at most two hours
  plus the GC grace, so enumeration is not a strategy.
- **Who can receive a friend invite**: an accepted friend, not blocked in either
  direction, and — for a staged game — somebody who can see staged games (an
  active beta tester or a dashboard role, the same rule as `canViewStaged()`).
  Recipients failing any gate are skipped silently; the response says only how
  many were sent, so it can never confirm a block.
- **Staged games**: the sender must pass `canViewStaged()`; a denied staged slug
  answers exactly like an unknown one, on the route, the picker and the landing.
- **Guests can make links**, not friend invites. A guest link has no `from`.
- **No GET API for an invite.** The landing page resolves the code server-side.
  No caller needs a JSON read, and every public read surface is one more thing to
  rate-limit and keep staged-safe. Add one when a cross-origin handoff needs it.
- **No OG image, generic metadata.** The page title is "You're invited ·
  HallPass" and names nobody: a link pasted into a group chat becomes a preview
  card cached on other people's devices (`challenge-sharing-design.md` §7).
- **Kid safety on the landing page**: the inviter's public display name only
  (handle, else `@username`, else "Player" — never the Google name), no avatar,
  no profile link, `noindex` by header and metadata, never precached.

## 3. The launch handoff

Pages do not forward their query string into a game, and
`/game-html/<slug>/` 307s to `/games/<slug>/index.html` dropping any query, so
the data cannot ride the URL. It rides **`sessionStorage`** instead:

1. The landing page writes `sessionStorage["hallpass:launch:<slug>"] =
   { v: 1, kind: "invite", data, from, expiresAt }` immediately before it mounts
   `<PlayerOverlay>`.
2. The game frame is same-origin (a hosted game at `/games/<slug>/…`, or a staged
   game proxied in place at `/game-html/<slug>/…`). `sessionStorage` is keyed by
   origin **and top-level browsing context**, so a same-origin iframe reads the
   very storage area its parent wrote (HTML Standard, "The sessionStorage
   getter": the session storage map of the document's top-level traversable).
   Verified in a real browser, not just jsdom — see §8.
3. The SDK reads the key for its slug **at load and removes it**, ignoring
   anything malformed or expired, and keeps the value in memory.
   `getLaunch()` returns a copy of it for the rest of that page load (null once
   it expires); a reload gets null. The landing page also removes the key when
   the overlay closes, so a later play from the store page cannot pick up a
   stale invite.
4. The slug comes from the SDK's configured `game`, else from the frame's path
   (`/games/<slug>/` or `/game-html/<slug>/`).

**Cross-origin (external) games get `null`.** Their storage is another origin's.
The invite, notification and landing still work; only the auto-join does not.

**Call `getLaunch()` after `await HallPass.ready()`.** The inline stub cannot
know the answer before the real SDK has loaded, so its `getLaunch` returns null.

`sessionStorage` rather than `localStorage` on purpose: it dies with the tab, so
an invite opened on a shared school computer cannot follow the next pupil into
their game.

## 4. Schema — migration 041

`app/lib/scoreboard/migrations/041_game_invites.sql`, canonical copy
`app/lib/invites/schema.sql`. Idempotent, one transaction.

```
game_invites
  id          BIGINT identity PK
  code        TEXT UNIQUE NOT NULL  CHECK (12 chars of the friend-code alphabet)
  slug        TEXT NOT NULL         CHECK (slug shape)
  kind        TEXT NOT NULL         CHECK (kind IN ('friend','link'))
  data        JSONB NOT NULL        CHECK (jsonb_typeof(data) = 'object')
  from_player TEXT NULL  → players(id) ON DELETE CASCADE   (NULL = guest link)
  to_player   TEXT NULL  → players(id) ON DELETE CASCADE   (NULL = link)
  sender_key  TEXT NULL  salted hash of a guest's IP — rate limiting only
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  expires_at  TIMESTAMPTZ NOT NULL
  CHECK friend ⇒ both players set; link ⇒ no recipient;
        a row has a sender (player or guest key); expires_at > created_at
indexes: UNIQUE(code) (lookup) · (expires_at) (GC) ·
         (from_player, kind, created_at) (sender limits + pair cooldown) ·
         (sender_key, created_at) WHERE sender_key IS NOT NULL (guest limit)
```

**No cron.** Every write deletes rows that expired more than an hour ago in the
same statement. The hour of grace is what keeps the rate-limit windows honest:
a row must still exist for the whole window after it was created.

## 5. Rate limits (`app/lib/invites/config.ts`)

Keyed by player id whenever there is one; guests by a SALTED hash of the IP
(`hashIp`, as `p2p` does), with a generous number because a school is one IP.

| What | Limit |
| --- | --- |
| Friend invites per sender | 20 per hour (each recipient counts) — all-or-nothing per request |
| Same sender → same friend → same game | once per 10 minutes (re-sends are skipped, not errors) |
| Links by a signed-in player | 30 per hour |
| Links by guests | 200 per hour per IP hash |
| Recipients per request | 20 |

No inbound cap, per the anti-harassment doctrine in `social/config.ts`.

## 6. Routes and pages

- `POST /api/v1/me/invites` `{ game, data, to?: publicId[], link?: boolean,
  expiresInMinutes? }` → `{ ok: true, sent, code?, url? }`, or
  `{ ok: false, reason }` with `forbidden` 403 (origin), `bad-request` 400,
  `signed-out` 401, `unknown-game` 404, `rate-limited` 429, `unavailable` 503.
  Same-origin trusted referrer required (`isTrustedOrigin`; the picker's own
  referrer is `/embed/invite`), JSON content type, `private, no-store`.
- `/embed/invite?game&data&n&ttl` — server-rendered (`auth()`), per-viewer,
  already private in `sw.js` via `/embed/`.
- `/i/<code>` — dynamic, per-viewer (staged gate); `X-Robots-Tag` header,
  `/i/` added to `isPrivatePath` in `sw.js` and to the precache exclusions.

The picker signals back on the challenge picker's three transports
(`postMessage`, `BroadcastChannel`, a `localStorage` write) under the key
`hallpass:invite`, with a per-call nonce so another tab's picker cannot settle
this call. It sends `open` on mount, `update` after each invite or link (so a
popup closed by hand still reports what happened) and `closed` on Close. An
inline frame that never says `open` within 20 s is torn down (offline, error
page); `navigator.onLine === false` skips opening at all.

## 7. Privacy fix: friend-list GETs

Games run same-origin and un-sandboxed, so a game could `fetch` the player's
friend list: only writes were origin-checked. Now:

| GET | Returns | Change |
| --- | --- | --- |
| `/api/v1/me/friends` | friends, requests | trusted origin required when signed in |
| `/api/v1/me/friends/activity` | friends per game | trusted origin required |
| `/api/v1/me/friends/scores` | friends' standings | trusted origin required |
| `/api/v1/me/friends/search` | other players | trusted origin required |
| `/api/v1/me/friends/count` | three numbers | **unchanged** — no identities, and it is read by the header on every page, including ones outside the allowlist |

Callers checked: `FriendsIsland` (`/play/you/friends`), `ChallengeButton`
(`/game/…`, `/play/you`), `FriendsWhoPlay` and `FriendsBoard` (`/game/…`), the
challenge embed (server-side, no GET), the new invite picker (server-side).
`MobileSplash` warms the friend list from whatever page a phone lands on; it now
skips that warm-up on pages the allowlist does not cover rather than earning a
403 (`isTrustedPath`). Signed-out answers are unchanged everywhere.

**Honest limits**, the same ones `social/origin.ts` states: a same-origin game
can still set a fetch `referrer` to any same-origin URL, or call
`parent.fetch(...)`, and the referrer would then look trusted. This closes the
naive read, not a determined one; the real fix is an opaque-origin sandbox.
`GET /api/v1/me/challenges` and `/api/v1/me/notifications` carry friends' names
too and are left as they are (callers on `/c/` and every page) — noted, not fixed.

## 8. Tests

- Pure: codes, data validation, expiry clamp, config limits, copy.
- Store SQL shape against a fake `sql`; and an opt-in `store.db.test.ts`
  (`INVITES_DB_TEST=1`) against the dev database, refusing production, cleaning
  up every row it creates.
- Route: origin, body validation, signed-out, staged gating, rate-limit mapping,
  notifications sent per recipient with a per-invite dedupe key.
- Notification copy: discreet names nobody, length caps, URL `/i/<code>`.
- SDK (jsdom): `invite()` transports, nonce filtering, popup/inline choice,
  offline/inert/bad data, `getLaunch()` read-once, expiry, bad payloads, slug
  from path; the stub's 2 s fallback shape.
- Friends GET origin checks.
- Real browser (opt-in, not a dependency): a same-origin iframe reads the
  parent's `sessionStorage` write.

## 9. Files

New: `app/lib/invites/{config,code,data,store,index}.ts` + `schema.sql` + tests,
`app/lib/scoreboard/migrations/041_game_invites.sql`,
`app/api/v1/me/invites/route.ts` + test, `app/embed/invite/{page,InviteEmbed}.tsx`,
`app/i/[code]/{page,InviteLanding}.tsx`, `sdk/src/{invite,launch}.ts` + tests.
Changed: `sdk/src/{contract,client,challenge,index,version}.ts`, the three
byte-identical stub copies (`sdk/README.md`, `app/lib/integration-prompt.ts`,
`app/llms-full.txt/route.ts`), `sdk/CHANGELOG.md`, `public/sdk/v1/hallpass.js`,
`app/lib/notifications/{config,copy}.ts`, `app/lib/notifications/admins.ts`
(export the super-admin list), `app/lib/social/origin.ts`, the four friends GET
routes, `app/lib/social-cache.ts`, `next.config.ts`, `public/sw.js`,
`scripts/build-sw-manifest.mjs`, `app/lib/staged-allowlist.test.ts`.

## 10. Commit plan

1. This document.
2. Migration 041, invites config/codes/data/store + tests.
3. `game_invite` notification kind and copy.
4. `POST /api/v1/me/invites` + tests.
5. Origin check on the friend-list GETs + tests.
6. SDK `invite()` / `getLaunch()` + tests.
7. Stub copies, version, changelog, rebuilt bundle.
8. The `/embed/invite` picker.
9. The `/i/<code>` landing page, headers, service worker.
10. `sdk/README.md` "Invites" section; this document's verification notes.

## 11. Deliberately excluded

An OG preview card; a sign-in button inside the picker (it would need the picker
to refresh itself after a popup sign-in); invites to a specific room that
HallPass understands (the data is opaque); revoking an invite (they expire in
minutes); the in-app-browser escape `/c/` attempts; a launch handoff for
cross-origin games; an "invite" SDK event; inbound caps.
