# Changelog

All notable changes to the HallPass Scoreboard SDK are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
The SDK major version is exposed at runtime as `window.HallPass.version` and maps
to the served URL path (`v1` → `/sdk/v1/hallpass.js`).

## [Unreleased]

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

[Unreleased]: https://github.com/hallpass/scoreboard-sdk/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/hallpass/scoreboard-sdk/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/hallpass/scoreboard-sdk/releases/tag/v1.0.0
