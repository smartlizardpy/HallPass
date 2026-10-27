# BoardPass design

BoardPass lets a student sign in to an existing HallPass account on a shared
school smartboard with **username + 6-digit PIN**, no Google needed. Several
students can be signed in at once in one temporary *board session*, and every
game launch asks **"Who's playing?"** so scores go to the right person.

## The one rule

A board session is **never** a Google session. The cookie is `hp_boardpass`,
separate from the Auth.js cookie, and `auth()` / `currentPlayerId()` ignore it.
Every existing route therefore sees a guest. Only these opt in, through
`app/lib/boardpass/resolve.ts`:

- leaderboard `POST`, achievements `POST` (credit the chosen player),
- `GET /api/v1/me` (returns that player's **public** profile with `board: true`),
- the `/api/v1/boardpass/*` routes.

Friends, invites, challenge creation, settings and admin all see a guest.

## Credit

Credit is bound to the **chosen participant and the game slug**
(`active_participant_id` + `active_game_slug`). Game B can never write as the
player chosen for game A. The leaderboard route keys on `board.gameSlug`, not
the leaderboard id in the URL. Plays and streak days are recorded server-side at
launch (no device seed — a shared board's localStorage is nobody's history).

## Sessions

| Setting | Value |
|---|---|
| Lobby idle | 5 min (warning 60 s before) |
| Idle while a game is open | 20 min |
| Absolute limit | 45 min |
| Gameplay write grace after idle | 2 min |
| Recent Google sign-in for PIN changes | 10 min |
| Players per board | 8 |

Only an explicit **Keep Playing** tap extends a lobby session, and nothing can
pass the absolute limit. No heartbeat, no polling.

Cookie: 32 random bytes (base64url); the database stores only the SHA-256.
`HttpOnly`, `Secure` in production, `SameSite=Lax`, `Path=/`.

## PINs

Argon2id via built-in `node:crypto.argon2` (**Node ≥ 24.7**), m=64 MiB, t=3,
p=1, over `HMAC-SHA256(BOARDPASS_PIN_PEPPER, playerId:pin)` with a per-PIN salt.
Stored as `argon2id$v1$m=…,t=…,p=…$salt$hash`. A missing/short pepper or an old
Node makes BoardPass **fail closed** (503). Weak PINs (repeats, runs, `123123`…)
are refused. Changing or disabling a PIN bumps `pin_version` and revokes every
board seat; the resolver re-checks `pin_version` on every request.

## Throttling (all DB-backed, checked before hashing)

- Per account: each guess is reserved atomically before Argon2, so a parallel
  flood still gets at most 5 tries before a lock (30 s, escalating to a 15 min
  cap; decays after 24 h).
- Per network: 300 / 10 min per IP hash; 10 / 10 min per (IP, username).
- One generic error for unknown user, wrong PIN, locked account and rollout
  refusal, with a dummy Argon2 run so timing matches.

## Rollout

`boardpass:mode` in `app_settings`: `off` (default; every route 404s and open
sessions stop resolving) | `staff` (dashboard users + beta testers) | `on`.
Switch it at `/dashboard/boardpass` (super admin).

## Known limits

- Games run **un-sandboxed on our origin**. PIN entry therefore exists only in
  the board's own windows: they unmount before a game frame mounts. Board Mode
  now lives on the homepage (the standalone `/board` page was removed), which is
  static, cacheable and frameable, so the old page-level `X-Frame-Options: DENY`,
  `frame-ancestors 'none'`, `noindex` and `no-store` no longer apply. In their
  place `BoardProvider` renders nothing when `window.top !== window.self`. That
  guard is client-side, so it stops a page that frames the homepage and is not a
  substitute for the header; a hostile same-origin game could still script the
  homepage in a frame it controls, and could forge a referrer to rebind or end the
  session (the limit `app/lib/social/origin.ts` already documents). Nothing
  server-side changed. Restoring the header would mean making `/` dynamic, which
  drops it from the service-worker precache.
- Cross-origin external games never receive the cookie: their scores are anonymous.
- Local 2-player games credit the one chosen player; per-seat credit is deferred.
- English only; every string is in `app/lib/boardpass/copy.ts` for translation.

## Ops checklist

1. Set `BOARDPASS_PIN_PEPPER` (32+ random bytes) in Vercel, Production and Preview.
2. Confirm the Vercel Node version is ≥ 24.7.
3. Apply migration `051_boardpass.sql` to production via `scripts/migrate-prod.sh`.
4. Set the mode to `staff`, test on a real board, then `on`.
