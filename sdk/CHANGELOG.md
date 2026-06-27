# Changelog

All notable changes to the HallPass Scoreboard SDK are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
The SDK major version is exposed at runtime as `window.HallPass.version` and maps
to the served URL path (`v1` → `/sdk/v1/hallpass.js`).

## [Unreleased]

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

[Unreleased]: https://github.com/hallpass/scoreboard-sdk/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/hallpass/scoreboard-sdk/releases/tag/v1.0.0
