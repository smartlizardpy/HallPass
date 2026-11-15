/**
 * Fixed facts of the HallPass Game Package format, version 1.
 *
 * Shared by the Node packager and the browser launcher, so nothing here may
 * import Node or DOM APIs. See docs/hpg-format.md for the specification these
 * constants implement.
 */

export const HPG_FORMAT = "hpg";
export const HPG_FORMAT_VERSION = 1;
export const HPG_EXTENSION = ".hpg";
export const MANIFEST_PATH = "manifest.json";

/**
 * The launcher's own version. A package whose `minimumLauncherVersion` is
 * higher is refused with a "get a newer arcade" message rather than run against
 * a runtime it was not built for.
 */
export const LAUNCHER_VERSION = "1.0.0";

/** Written into `manifest.build.packager` so a package records what built it. */
export const PACKAGER_VERSION = "1.0.0";

/**
 * Hard ceilings applied while reading untrusted archives, before any byte is
 * inflated. They bound memory: a package can never make the launcher allocate
 * more than `maxTotalBytes`, however its headers lie (see archive/zip.ts).
 *
 * Sized from the real games: the largest packageable game is well under 2 MB
 * unpacked, and `last-bell`, the largest game in the repo, is 15 MB. 64 MB per
 * package leaves room for asset-heavy games without letting a bomb through.
 */
export const PACKAGE_LIMITS = {
  maxEntries: 512,
  maxEntryBytes: 32 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
  /** Uncompressed / compressed. Real text compresses ~3-10x; bombs ~1000x. */
  maxCompressionRatio: 200,
} as const;

/** Limits for the outer `games.zip`, whose entries are themselves `.hpg` files. */
export const COLLECTION_LIMITS = {
  maxEntries: 256,
  maxEntryBytes: 64 * 1024 * 1024,
  maxTotalBytes: 512 * 1024 * 1024,
  /** `.hpg` entries are already compressed, so a high ratio is itself suspect. */
  maxCompressionRatio: 50,
} as const;

/** Permissions a package may request. Each maps to one iframe sandbox token. */
export const HPG_PERMISSIONS = ["pointer-lock"] as const;
export type HpgPermission = (typeof HPG_PERMISSIONS)[number];

export const HPG_RUNTIMES = ["html", "wasm"] as const;
export type HpgRuntime = (typeof HPG_RUNTIMES)[number];

export const HPG_INPUTS = ["keyboard", "mouse", "touch", "gamepad"] as const;
export type HpgInput = (typeof HPG_INPUTS)[number];

export const HPG_FILE_ROLES = [
  "entry",
  "thumbnail",
  "asset",
  "worker",
  "wasm",
] as const;
export type HpgFileRole = (typeof HPG_FILE_ROLES)[number];
