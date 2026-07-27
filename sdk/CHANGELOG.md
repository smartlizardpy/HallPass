# Changelog

All notable changes to the HallPass Scoreboard SDK are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
The SDK major version is exposed at runtime as `window.HallPass.version` and maps
to the served URL path (`v1` → `/sdk/v1/hallpass.js`).

## [Unreleased]

## [1.2.0] - 2026-07-27

### Added

- Achievements, on the SAME `/sdk/v1/hallpass.js` bundle rather than a sibling
  script: `unlock(key)`, `unlockMany(keys)`, `progress(key, value)` and
  `getAchievements()`. A second bundle would have meant a second script tag, a
  second inline stub in every game (eight copies to keep byte-identical instead of
  four), and its own cache/version story — all to defer ~2 KB.
- `"achievement"` event — fires the earned achievement (`{ key, name, description,
  icon, points, progress, target, unlockedAt, game }`) ONLY when it is newly
  earned, never for one the player already holds, so
  `HallPass.on("achievement", a => showToast(a.name, a.icon))` is the whole
  integration. Deliberately NOT sticky (unlike `"ready"`/`"auth"`): an unlock is a
  moment, not a state, and replaying it would re-toast an old trophy.
- `progress()` coalescing: calls are merged per key on a ~1s trailing edge — safe
  to call from a `requestAnimationFrame` loop — and flushed with `sendBeacon` on
  `pagehide` / `visibilitychange`, so the FINAL value is never the one that gets
  dropped. The merge takes the maximum, matching the server's
  `GREATEST(stored, incoming)`, so a duplicated or out-of-order call can neither
  double-count nor walk a counter backwards.
- The inline stub now queues `unlock` / `unlockMany` / `progress` /
  `getAchievements`, with matching entries in its 2s inert fallback
  (`unlockMany` and `getAchievements` settle `[]`). Games embedded before this
  release keep working with the old stub — call the new methods after `ready()`
  resolves.

### Notes

- Achievements require a signed-in player and a same-origin embed (the endpoints
  are cookie-credentialed). A cross-origin embed resolves
  `{ ok: false, reason: "signed-out" }` locally instead of firing a request that
  cannot succeed.
- No breaking changes: every addition is an optional method, an optional field, or
  a new event name, per the `/sdk/v1/` append-only contract.

## [1.1.0] - 2026-07-04

### Added

- Popup sign-in / sign-out: `signIn()` / `signOut()` now open a small same-origin
  popup and signal completion back to the game, so the game document is never
  unloaded (a blocked popup falls back to a top-level redirect). Must be called
  from a user-gesture click handler.
- `"auth"` event — fires `{ player: PlayerIdentity | null }` whenever the signed-in
  identity changes (sign-in or sign-out, including from another tab). Sticky, like
  `"ready"`: a late listener still receives the current identity.
- In-session guest-score claiming: an anonymous same-origin submission may return a
  short-lived `claimToken`; the SDK holds these in memory and, on sign-in this same
  page visit, POSTs them to `/api/v1/me/claim` so those scores attach to the account.
  In-memory only (capped, ~6h TTL) — the tokens die with the page, so a shared
  computer can never leak one player's scores to the next.
- Conditional credentialed submits: same-origin `submitScore` / `getPlayer` /
  `setPlayerHandle` / claim requests now send the session cookie
  (`credentials: "include"`); cross-origin embeds stay anonymous (`omit`) so
  wildcard-CORS public reads keep working.

### Fixed

- Signed-in submissions are now attributed to the account instead of being stored
  as an anonymous `Guest#NNNN` (the session cookie was previously never sent).
- In-game sign-in no longer reloads the game — the in-progress round and score are
  preserved.

## [1.0.0] - 2026-06-27

### Added

- Initial public release of the browser SDK, served as a dependency-free IIFE
  from `https://hallpass.gg/sdk/v1/hallpass.js`.
- Inline bootstrap stub that queues early calls and replays them once the real
  SDK loads, settling safely after 2s if it never does.
- `window.HallPass` global (aliased `window.HP`) implementing the frozen
  `HallPass` contract: `ready`, `submitScore`, `getScores`, `getHandle`,
  `setHandle`, `on`/`off`, plus `version` and `mode`.
- Golden-rule guarantees: every method resolves, none throw, all network and
  storage access is bounded (~6s request timeout) and wrapped.
- Configuration resolution from `window.HALLPASS_CONFIG`, `data-game` / `data-api`
  script attributes, or the script/page origin.
- Player handle persistence in `localStorage` with `[A-Za-z0-9 _-]{1,12}`
  sanitisation and an `"ANON"` fallback; optional one-time prompt for initials.
- Event emitter for `ready`, `scores`, `submitted`, and `error`.

[Unreleased]: https://github.com/hallpass/scoreboard-sdk/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/hallpass/scoreboard-sdk/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/hallpass/scoreboard-sdk/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/hallpass/scoreboard-sdk/releases/tag/v1.0.0
