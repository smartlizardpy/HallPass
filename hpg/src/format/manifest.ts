/**
 * The `manifest.json` of an `.hpg` package: its type and its validator.
 *
 * The validator is hand-written rather than a schema library because the same
 * code runs in the standalone launcher, where every kilobyte ships to a USB
 * stick, and because it reports EVERY problem at once with the field path
 * (`files["game.html"].sha256: …`). A packager author fixes a broken manifest
 * in one pass instead of one error per run.
 *
 * STRICT ON PURPOSE. Unknown keys are rejected, at the top level and in every
 * nested object. A manifest is produced by our own packager, so an unknown key
 * is either a typo or a package built for a newer format. The second case
 * has a proper channel (`formatVersion` and `minimumLauncherVersion`), and
 * silently ignoring a field the publisher thought mattered is how "unsafe
 * assumptions about package contents" begin.
 *
 * Validation here is STRUCTURAL: it does not open the archive. The archive
 * checks (each listed file exists, sizes and hashes match, nothing extra is
 * present) are in archive/package.ts and run after this.
 */

import {
  HPG_FILE_ROLES,
  HPG_FORMAT,
  HPG_FORMAT_VERSION,
  HPG_INPUTS,
  HPG_PERMISSIONS,
  HPG_RUNTIMES,
  MANIFEST_PATH,
  PACKAGE_LIMITS,
  type HpgFileRole,
  type HpgInput,
  type HpgPermission,
  type HpgRuntime,
} from "./constants";
import { SHA256_HEX_RE } from "./hash";
import {
  IMAGE_EXTENSIONS,
  extensionOf,
  isSafePackagePath,
  pathKey,
} from "./paths";
import { isSemver } from "./semver";

export type HpgFileEntry = {
  size: number;
  sha256: string;
  role: HpgFileRole;
};

export type HpgManifest = {
  format: typeof HPG_FORMAT;
  formatVersion: typeof HPG_FORMAT_VERSION;
  id: string;
  name: string;
  version: string;
  description: string;
  entry: string;
  runtime: HpgRuntime;
  offline: true;
  permissions: HpgPermission[];
  minimumLauncherVersion: string;
  files: Record<string, HpgFileEntry>;
  thumbnail?: string;
  category?: string;
  tags?: string[];
  author?: string;
  accent?: string;
  gradient?: [string, string];
  inputs?: HpgInput[];
  display?: {
    width?: number;
    height?: number;
    orientation?: "landscape" | "portrait" | "any";
  };
  compatibility?: {
    webgl?: boolean;
    workers?: boolean;
    audio?: boolean;
    notes?: string[];
  };
  features?: {
    /** The game uses the HallPass SDK; the offline SDK is provided. */
    scores?: boolean;
    /** The game persists progress (through the launcher's save API). */
    saves?: boolean;
    /**
     * Which scores rank first on the local leaderboard. Online, each board's
     * sort lives in the database; offline it must travel with the package.
     * Absent means "desc" (higher is better).
     */
    scoreOrder?: "desc" | "asc";
  };
  build?: {
    packager: string;
    source?: string;
    contentHash?: string;
  };
};

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

/** Package ids are the HallPass slug alphabet: lowercase, digits, single hyphens. */
export const PACKAGE_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

const MAX = {
  id: 64,
  name: 80,
  description: 600,
  category: 40,
  author: 80,
  tag: 32,
  tags: 12,
  note: 200,
  notes: 12,
  dimension: 16384,
} as const;

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Printable text with no control characters, trimmed, non-empty, bounded. */
function isText(v: unknown, max: number): v is string {
  return (
    typeof v === "string" &&
    v.length > 0 &&
    v.length <= max &&
    v === v.trim() &&
    !/[\u0000-\u001f\u007f]/.test(v)
  );
}

function checkKeys(
  obj: Obj,
  allowed: readonly string[],
  at: string,
  errors: string[],
): void {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) errors.push(`${at}${k}: unknown field`);
  }
}

const TOP_LEVEL_KEYS = [
  "format",
  "formatVersion",
  "id",
  "name",
  "version",
  "description",
  "entry",
  "runtime",
  "offline",
  "permissions",
  "minimumLauncherVersion",
  "files",
  "thumbnail",
  "category",
  "tags",
  "author",
  "accent",
  "gradient",
  "inputs",
  "display",
  "compatibility",
  "features",
  "build",
] as const;

function checkEnumArray<T extends string>(
  v: unknown,
  allowed: readonly T[],
  at: string,
  errors: string[],
): void {
  if (!Array.isArray(v)) {
    errors.push(`${at}: must be an array`);
    return;
  }
  const seen = new Set<unknown>();
  v.forEach((item, i) => {
    if (!(allowed as readonly unknown[]).includes(item)) {
      errors.push(`${at}[${i}]: must be one of ${allowed.join(", ")}`);
    }
    if (seen.has(item)) errors.push(`${at}[${i}]: duplicate`);
    seen.add(item);
  });
}

function checkOptionalBool(obj: Obj, key: string, at: string, errors: string[]) {
  if (key in obj && typeof obj[key] !== "boolean") {
    errors.push(`${at}${key}: must be a boolean`);
  }
}

function checkFiles(m: Obj, errors: string[]): void {
  const files = m.files;
  if (!isObj(files)) {
    errors.push("files: must be an object of path → { size, sha256, role }");
    return;
  }
  const paths = Object.keys(files);
  if (paths.length === 0) errors.push("files: must list at least the entry");
  if (paths.length > PACKAGE_LIMITS.maxEntries - 1) {
    errors.push(`files: more than ${PACKAGE_LIMITS.maxEntries - 1} entries`);
  }
  const keys = new Map<string, string>();
  let total = 0;
  for (const path of paths) {
    const at = `files[${JSON.stringify(path)}]`;
    if (!isSafePackagePath(path)) {
      errors.push(`${at}: unsafe or invalid path`);
      continue;
    }
    if (path === MANIFEST_PATH) {
      errors.push(`${at}: the manifest cannot list itself`);
    }
    const key = pathKey(path);
    const clash = keys.get(key);
    if (clash) errors.push(`${at}: collides with ${JSON.stringify(clash)} ignoring case`);
    keys.set(key, path);

    const f = files[path];
    if (!isObj(f)) {
      errors.push(`${at}: must be an object`);
      continue;
    }
    checkKeys(f, ["size", "sha256", "role"], `${at}.`, errors);
    if (
      typeof f.size !== "number" ||
      !Number.isSafeInteger(f.size) ||
      f.size < 0 ||
      f.size > PACKAGE_LIMITS.maxEntryBytes
    ) {
      errors.push(`${at}.size: must be an integer 0..${PACKAGE_LIMITS.maxEntryBytes}`);
    } else {
      total += f.size;
    }
    if (typeof f.sha256 !== "string" || !SHA256_HEX_RE.test(f.sha256)) {
      errors.push(`${at}.sha256: must be 64 lowercase hex characters`);
    }
    if (!(HPG_FILE_ROLES as readonly unknown[]).includes(f.role)) {
      errors.push(`${at}.role: must be one of ${HPG_FILE_ROLES.join(", ")}`);
    } else if (f.role === "wasm" && extensionOf(path) !== ".wasm") {
      errors.push(`${at}.role: "wasm" requires a .wasm file`);
    } else if (f.role === "worker" && extensionOf(path) !== ".js") {
      errors.push(`${at}.role: "worker" requires a .js file`);
    }
  }
  if (total > PACKAGE_LIMITS.maxTotalBytes) {
    errors.push(`files: total size exceeds ${PACKAGE_LIMITS.maxTotalBytes} bytes`);
  }
}

function roleOf(m: Obj, path: string): unknown {
  const files = m.files;
  if (!isObj(files) || !Object.prototype.hasOwnProperty.call(files, path)) {
    return undefined;
  }
  const f = files[path];
  return isObj(f) ? f.role : undefined;
}

/**
 * Validate an already-parsed manifest object. Never throws; returns every
 * error found.
 */
export function validateManifest(input: unknown): ValidationResult<HpgManifest> {
  const errors: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ["manifest: must be a JSON object"] };
  const m = input;
  checkKeys(m, TOP_LEVEL_KEYS, "", errors);

  if (m.format !== HPG_FORMAT) errors.push(`format: must be "${HPG_FORMAT}"`);
  if (m.formatVersion !== HPG_FORMAT_VERSION) {
    errors.push(
      typeof m.formatVersion === "number" && m.formatVersion > HPG_FORMAT_VERSION
        ? `formatVersion: ${m.formatVersion} is newer than this launcher supports (${HPG_FORMAT_VERSION})`
        : `formatVersion: must be ${HPG_FORMAT_VERSION}`,
    );
  }
  if (typeof m.id !== "string" || m.id.length > MAX.id || !PACKAGE_ID_RE.test(m.id)) {
    errors.push("id: must be lowercase letters, digits and single hyphens (max 64)");
  }
  if (!isText(m.name, MAX.name)) errors.push(`name: must be 1-${MAX.name} characters`);
  if (!isSemver(m.version)) errors.push("version: must be a semantic version (1.2.3)");
  if (!isText(m.description, MAX.description)) {
    errors.push(`description: must be 1-${MAX.description} characters`);
  }
  if (!(HPG_RUNTIMES as readonly unknown[]).includes(m.runtime)) {
    errors.push(`runtime: must be one of ${HPG_RUNTIMES.join(", ")}`);
  }
  if (m.offline !== true) errors.push("offline: must be true");
  checkEnumArray(m.permissions, HPG_PERMISSIONS, "permissions", errors);
  if (!isSemver(m.minimumLauncherVersion)) {
    errors.push("minimumLauncherVersion: must be a semantic version");
  }

  checkFiles(m, errors);

  // The entry: an HTML file, listed, with the entry role. One entry only.
  if (typeof m.entry !== "string" || !isSafePackagePath(m.entry)) {
    errors.push("entry: must be a safe package path");
  } else {
    if (extensionOf(m.entry) !== ".html") {
      errors.push("entry: unsupported entry type (only .html entries run in version 1)");
    }
    if (roleOf(m, m.entry) !== "entry") {
      errors.push("entry: must be listed in files with role \"entry\"");
    }
  }
  if (isObj(m.files)) {
    const entries = Object.entries(m.files).filter(
      ([, f]) => isObj(f) && f.role === "entry",
    );
    if (entries.length > 1) errors.push("files: only one file may have role \"entry\"");
    const hasWasm = Object.values(m.files).some((f) => isObj(f) && f.role === "wasm");
    if (m.runtime === "wasm" && !hasWasm) {
      errors.push("runtime: \"wasm\" requires at least one file with role \"wasm\"");
    }
    if (m.runtime === "html" && hasWasm) {
      errors.push("runtime: packages containing WebAssembly must declare runtime \"wasm\"");
    }
  }

  if ("thumbnail" in m) {
    if (typeof m.thumbnail !== "string" || !isSafePackagePath(m.thumbnail)) {
      errors.push("thumbnail: must be a safe package path");
    } else if (!IMAGE_EXTENSIONS.has(extensionOf(m.thumbnail))) {
      errors.push("thumbnail: must be a raster image (png, jpg, webp, gif, avif)");
    } else if (roleOf(m, m.thumbnail) !== "thumbnail") {
      errors.push("thumbnail: must be listed in files with role \"thumbnail\"");
    }
  }
  if ("category" in m && !isText(m.category, MAX.category)) {
    errors.push(`category: must be 1-${MAX.category} characters`);
  }
  if ("author" in m && !isText(m.author, MAX.author)) {
    errors.push(`author: must be 1-${MAX.author} characters`);
  }
  if ("tags" in m) {
    if (!Array.isArray(m.tags) || m.tags.length > MAX.tags) {
      errors.push(`tags: must be an array of at most ${MAX.tags}`);
    } else {
      m.tags.forEach((t, i) => {
        if (!isText(t, MAX.tag)) errors.push(`tags[${i}]: must be 1-${MAX.tag} characters`);
      });
    }
  }
  if ("accent" in m && (typeof m.accent !== "string" || !HEX_COLOR_RE.test(m.accent))) {
    errors.push("accent: must be a #rrggbb colour");
  }
  if ("gradient" in m) {
    const g = m.gradient;
    if (
      !Array.isArray(g) ||
      g.length !== 2 ||
      !g.every((c) => typeof c === "string" && HEX_COLOR_RE.test(c))
    ) {
      errors.push("gradient: must be two #rrggbb colours");
    }
  }
  if ("inputs" in m) checkEnumArray(m.inputs, HPG_INPUTS, "inputs", errors);

  if ("display" in m) {
    const d = m.display;
    if (!isObj(d)) errors.push("display: must be an object");
    else {
      checkKeys(d, ["width", "height", "orientation"], "display.", errors);
      for (const k of ["width", "height"] as const) {
        if (
          k in d &&
          (typeof d[k] !== "number" ||
            !Number.isInteger(d[k]) ||
            (d[k] as number) < 1 ||
            (d[k] as number) > MAX.dimension)
        ) {
          errors.push(`display.${k}: must be an integer 1..${MAX.dimension}`);
        }
      }
      if ("orientation" in d && !["landscape", "portrait", "any"].includes(d.orientation as string)) {
        errors.push("display.orientation: must be landscape, portrait or any");
      }
    }
  }
  if ("compatibility" in m) {
    const c = m.compatibility;
    if (!isObj(c)) errors.push("compatibility: must be an object");
    else {
      checkKeys(c, ["webgl", "workers", "audio", "notes"], "compatibility.", errors);
      for (const k of ["webgl", "workers", "audio"]) checkOptionalBool(c, k, "compatibility.", errors);
      if ("notes" in c) {
        if (!Array.isArray(c.notes) || c.notes.length > MAX.notes) {
          errors.push(`compatibility.notes: must be an array of at most ${MAX.notes}`);
        } else {
          c.notes.forEach((n, i) => {
            if (!isText(n, MAX.note)) {
              errors.push(`compatibility.notes[${i}]: must be 1-${MAX.note} characters`);
            }
          });
        }
      }
    }
  }
  if ("features" in m) {
    const f = m.features;
    if (!isObj(f)) errors.push("features: must be an object");
    else {
      checkKeys(f, ["scores", "saves", "scoreOrder"], "features.", errors);
      checkOptionalBool(f, "scores", "features.", errors);
      checkOptionalBool(f, "saves", "features.", errors);
      if ("scoreOrder" in f && f.scoreOrder !== "desc" && f.scoreOrder !== "asc") {
        errors.push('features.scoreOrder: must be "desc" or "asc"');
      }
    }
  }
  if ("build" in m) {
    const b = m.build;
    if (!isObj(b)) errors.push("build: must be an object");
    else {
      checkKeys(b, ["packager", "source", "contentHash"], "build.", errors);
      if (!isText(b.packager, 80)) errors.push("build.packager: must be 1-80 characters");
      if ("source" in b && !isText(b.source, 200)) errors.push("build.source: must be 1-200 characters");
      if ("contentHash" in b && (typeof b.contentHash !== "string" || !SHA256_HEX_RE.test(b.contentHash))) {
        errors.push("build.contentHash: must be 64 lowercase hex characters");
      }
    }
  }

  return errors.length === 0
    ? { ok: true, value: m as unknown as HpgManifest }
    : { ok: false, errors };
}

/** Parse manifest bytes as UTF-8 JSON, then validate. */
export function parseManifest(bytes: Uint8Array): ValidationResult<HpgManifest> {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return { ok: false, errors: ["manifest.json: not valid UTF-8 JSON"] };
  }
  return validateManifest(json);
}
