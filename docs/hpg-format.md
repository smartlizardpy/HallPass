# HPG — HallPass Game Package, format version 1

An `.hpg` file is **one game**, distributed as one file. It is an ordinary ZIP
archive (APPNOTE 6.3, deflate or stored) with a custom extension. The format
uses no new compression and no VM. The reference implementation is in
`hpg/src/format/` (types and validation) and `hpg/src/archive/` (reading).

## 1. Layout

```text
conquest.hpg
├── manifest.json        required, at the archive root
├── game.html            the entry: one self-contained HTML document
├── cover.webp           optional thumbnail
├── assets/…             optional files loaded at run time (workers, media)
└── wasm/…               optional WebAssembly modules
```

The packager keeps the number of entries low. JS and CSS are inlined into the
entry, and small images become `data:` URIs. Only files that must stay separate
(workers, WebAssembly, large media) are kept as separate entries.

## 2. Archive rules

A reader MUST refuse an archive that breaks any rule below. Nothing is
extracted to disk: packages are read into memory.

- Every entry path satisfies the path grammar (§4). Directory entries (names
  ending in `/`) are ignored.
- No two entries have the same path once lowercased.
- Entry count ≤ 512, each entry ≤ 32 MiB uncompressed, the total ≤ 64 MiB
  uncompressed, and each entry's uncompressed:compressed ratio ≤ 200. These are
  checked from the headers **before** inflating, and the inflated output is never
  allowed to exceed the declared size (see `archive/zip.ts`).
- Encrypted entries and compression methods other than 0 (stored) and 8
  (deflate) are refused.
- The archive contains exactly `manifest.json` plus the files the manifest
  lists. A missing file and an unlisted extra file are both errors.

## 3. `manifest.json`

UTF-8 JSON. **Unknown fields are errors**, at every level. A format change
goes through `formatVersion` or `minimumLauncherVersion`, never through fields
a reader quietly ignores.

| Field | Type | Required | Rule |
|---|---|---|---|
| `format` | `"hpg"` | yes | |
| `formatVersion` | `1` | yes | readers refuse higher versions with a "too new" message |
| `id` | string | yes | `^[a-z0-9]+(-[a-z0-9]+)*$`, ≤ 64. Unique within a library |
| `name` | string | yes | 1–80 characters, trimmed, no control characters |
| `version` | semver | yes | `MAJOR.MINOR.PATCH[-pre][+build]` |
| `description` | string | yes | 1–600 characters |
| `entry` | path | yes | ends in `.html`; listed in `files` with role `entry` |
| `runtime` | `"html"` \| `"wasm"` | yes | `"wasm"` if and only if a file has role `wasm` |
| `offline` | `true` | yes | |
| `permissions` | array | yes | subset of `["pointer-lock"]`; each adds one sandbox token |
| `minimumLauncherVersion` | semver | yes | |
| `files` | object | yes | path → `{ size, sha256, role }`; see below |
| `thumbnail` | path | no | raster image listed with role `thumbnail` |
| `category` | string | no | ≤ 40 |
| `tags` | string[] | no | ≤ 12 entries of ≤ 32 characters each |
| `author` | string | no | ≤ 80 |
| `accent` | `#rrggbb` | no | card accent colour |
| `gradient` | `[#rrggbb, #rrggbb]` | no | card background |
| `inputs` | array | no | subset of `keyboard`, `mouse`, `touch`, `gamepad` |
| `display` | object | no | `width`, `height` (integers), `orientation` (`landscape`, `portrait` or `any`) |
| `compatibility` | object | no | `webgl`, `workers`, `audio` (booleans), `notes` (≤ 12 strings) |
| `features` | object | no | `scores` (uses the HallPass SDK), `saves` (persists progress), `scoreOrder` (`desc` by default, or `asc`: which scores rank first on the local leaderboard) |
| `build` | object | no | `packager` (required inside `build`), `source`, `contentHash` |

Each `files` entry has:

- `size`: the exact uncompressed byte length.
- `sha256`: lowercase hex SHA-256 of the uncompressed bytes.
- `role`: one of the following.
  - `entry`: exactly one file.
  - `thumbnail`: the cover image.
  - `asset`: any other file.
  - `worker`: a `.js` file built as a **classic** worker script.
  - `wasm`: a `.wasm` file.

`manifest.json` never lists itself.

## 4. Path grammar

Segments are separated by `/`. Each segment matches
`[A-Za-z0-9][A-Za-z0-9._-]*` and is at most 100 characters. A path has at most
8 segments and at most 200 characters. This whitelist excludes `..`, `.`,
absolute paths, backslashes, drive letters, empty segments, hidden files,
spaces, control characters and non-ASCII.

## 5. Integrity and trust

1. Every file's SHA-256 must equal its `files[path].sha256`, and its length must
   equal `size`.
2. A hash inside the manifest only detects damage if the manifest itself is
   trusted. Anyone who rewrites a file can rewrite the manifest too. Version 1
   anchors trust in the launcher: each HallPass deploy builds the launcher and
   the packages together and embeds `sha256(manifest.json bytes)` for every
   package in the launcher. A package whose manifest digest is not on that list
   is refused. The digest covers the manifest, and the manifest covers every
   file, so a verified package is byte-for-byte the one HallPass built.
3. This establishes integrity and first-party origin for packages delivered with
   their own launcher. It does **not** cover packages from third parties, and it
   is not DRM. Version 2 may add Ed25519 signatures (a public key in the
   launcher, `signature` beside the manifest) so that packages and launchers can
   be updated independently.

## 6. Runtime contract

The launcher runs `entry` in `<iframe sandbox="allow-scripts[ allow-pointer-lock]">`,
loaded through `srcdoc`, so the frame's origin is opaque. Before any game script,
it injects a bootstrap that provides:

- `localStorage` and `sessionStorage`: in-memory stores loaded from the game's
  save and written back through the launcher. The real ones throw in an opaque
  origin.
- `hpg:/<path>` URLs: `fetch("hpg:/wasm/m.wasm")` and `new Worker("hpg:/assets/w.js")`
  resolve package files. Workers are started as classic workers; module workers
  cannot start from a blob URL in an opaque-origin frame.
- `window.HallPass`: an offline build of the HallPass SDK. `submitScore` and
  `getScores` use a local leaderboard; network-only features settle with the
  SDK's documented inert results.
- `window.HPG`: `exit()`, `save(data)`, `load()`, `ready()`.

Games send messages to the launcher over `postMessage` (`hpg/src/protocol/`):

- Game → launcher: `GAME_READY`, `GAME_EXIT`, `GAME_ERROR`, `SCORE_SUBMIT`,
  `SCORES_REQUEST`, `SAVE_REQUEST`, `LOAD_REQUEST`, `FULLSCREEN_REQUEST` (sent
  when the game calls `requestFullscreen()`, which a sandboxed frame cannot do
  itself).
- Launcher → game: `PAUSE`, `RESUME`, `MUTE`, `FLUSH`, plus the replies to
  requests.

The launcher accepts a message only when all of these hold:

- `event.source` is the active frame;
- `event.origin` is `"null"`;
- the session nonce matches;
- the message has a known shape;
- it is within the size limits.

## 7. Versioning

- `formatVersion` changes only when an older reader would misread a package.
- `minimumLauncherVersion` names the oldest launcher that provides everything
  the package uses.
- Package file names are deterministic: `<id>-<version>.hpg`, where `version`
  carries the content hash as build metadata (`1.0.0+3f9a1c2b`).
