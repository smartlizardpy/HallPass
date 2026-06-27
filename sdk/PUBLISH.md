# Publishing the HallPass Scoreboard SDK

The SDK ships two ways from the same `sdk/src/*` source:

1. **The hosted runtime** — a single IIFE built by `npm run build:sdk` (tsup) to
   `public/sdk/v1/hallpass.js` and served from `https://hallpass.gg/sdk/v1/`.
   This is what games actually load. **It is the product.**
2. **An npm package** (`@hallpass/scoreboard-sdk`) — the same modules published
   for tooling, bundler users, and type consumers. Not yet published.

This document records the TARGET npm setup and the URL-stability contract. It
intentionally does **not** create a `package.json` inside `sdk/` — the repo build
uses the root config, and a stray manifest would confuse it. Add the manifest
only at the moment of the first npm publish.

## Target `package.json` (do not create yet)

When the package is first published, the manifest should look like this:

```json
{
  "name": "@hallpass/scoreboard-sdk",
  "version": "1.0.0",
  "description": "Tiny, dependency-free browser leaderboard client for HallPass. Never throws, never hangs.",
  "type": "module",
  "sideEffects": ["./dist/iife/hallpass.js"],
  "main": "./dist/cjs/index.cjs",
  "module": "./dist/esm/index.js",
  "types": "./dist/esm/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/esm/index.d.ts",
      "import": "./dist/esm/index.js",
      "require": "./dist/cjs/index.cjs",
      "default": "./dist/esm/index.js"
    },
    "./iife": "./dist/iife/hallpass.js",
    "./package.json": "./package.json"
  },
  "files": ["dist"],
  "license": "MIT",
  "repository": "github:hallpass/scoreboard-sdk",
  "homepage": "https://hallpass.gg",
  "sideEffectsNote": "Only the IIFE entry has side effects; the ESM/CJS entries are tree-shakeable."
}
```

Notes:

- `type: "module"` — the source is ESM.
- The `exports` map exposes three artifacts from one source: **ESM** (`import`),
  **CJS** (`require`), and the side-effecting **IIFE** (`./iife`, the same code as
  the hosted `/sdk/v1/hallpass.js`).
- `types` points at the generated `.d.ts`; `contract.ts` is the public type
  surface.
- `files: ["dist"]` ships only build output — never `src` or tests.
- The hosted IIFE (`public/sdk/v1/hallpass.js`) is built from `sdk/src/index.ts`,
  which is side-effecting (it installs `window.HallPass`); the ESM/CJS entry for
  npm consumers should re-export the named API instead. Wire a dedicated tsup
  build (esm + cjs + dts) at publish time; the existing `sdk/tsup.config.ts`
  builds only the hosted IIFE.

## Publish steps (future)

1. Add the `package.json` above inside a publish-only layout (or a workspace) so
   it never collides with the app's root manifest.
2. Build all three formats (esm, cjs, iife) plus `.d.ts`.
3. `npm publish --access public`.
4. Tag the release `v1.0.0` and update `CHANGELOG.md`.

## URL stability contract (`/sdk/v1/`)

The hosted path is a public API and is **append-only within a major**:

- `https://hallpass.gg/sdk/v1/hallpass.js` must keep working for every page that
  already embeds it. Caching is aggressive, so old pages may run old HTML for a
  long time.
- Within `v1` you may add optional methods, optional options, and new event
  names, but you may **never** remove or repurpose existing behaviour, change a
  method's resolved shape, or rename a `submitScore` reason.
- `window.HallPass.version` always equals the major (`"1"`) and matches the URL.
- A breaking change means a **new path** (`/sdk/v2/hallpass.js`), a bumped
  `SDK_MAJOR`/`version` (`"2"`), and a parallel `/api/v2/` contract. `v1` stays
  live alongside it.

This mirrors the append-only rule on the shared wire contract
(`sdk/src/contract.ts`).
