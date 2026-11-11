/**
 * Read one `.hpg` from bytes into memory and verify it completely.
 *
 * Order matters. The cheap, structural checks come first, so a corrupt or
 * hostile file is refused before any expensive work:
 *
 *   1. bounded unzip                    (archive/zip.ts: limits, names, CRCs)
 *   2. manifest.json present, UTF-8 JSON
 *   3. formatVersion peeked before full validation, so a package from a
 *      NEWER format is reported as "too new", not as "invalid"
 *   4. full manifest validation
 *   5. launcher compatibility (minimumLauncherVersion)
 *   6. trust: sha256(manifest bytes) must be on the launcher's list
 *   7. every listed file present, with the right size and SHA-256
 *   8. no unlisted extra files
 *
 * Every failure is a {@link PackageError} with a stable `code`. The launcher
 * turns that code into plain words for the player, and keeps `details` for a
 * collapsed "technical details" line. A stack trace never reaches the user.
 */

import { HPG_FORMAT_VERSION, MANIFEST_PATH, PACKAGE_LIMITS } from "../format/constants";
import { checkCompatibility } from "../format/compatibility";
import { sha256Hex } from "../format/hash";
import { parseManifest, type HpgManifest } from "../format/manifest";
import { listZip, readZipEntries, ZipError } from "./zip";

export type PackageErrorCode =
  | "corrupt-archive"
  | "limits"
  | "missing-manifest"
  | "invalid-manifest"
  | "format-too-new"
  | "launcher-too-old"
  | "untrusted"
  | "missing-file"
  | "unexpected-file"
  | "size-mismatch"
  | "hash-mismatch";

export class PackageError extends Error {
  readonly code: PackageErrorCode;
  readonly details: string[];
  constructor(code: PackageErrorCode, message: string, details: string[] = []) {
    super(message);
    this.name = "PackageError";
    this.code = code;
    this.details = details;
  }
}

export type LoadedPackage = {
  manifest: HpgManifest;
  /** sha256 of the exact manifest.json bytes: the package's identity for trust. */
  manifestDigest: string;
  /** Every listed file, verified. Does not include manifest.json. */
  files: ReadonlyMap<string, Uint8Array>;
  /** The original archive bytes, kept so the library can persist them as-is. */
  archive: Uint8Array;
};

export type ReadPackageOptions = {
  /**
   * Manifest digests this launcher trusts. When given, any other package is
   * refused with `untrusted`. Omitted only by developer tools (`hpg:inspect`),
   * which must be able to open a package in order to say what is wrong with it.
   */
  trustedManifestDigests?: ReadonlySet<string>;
  launcherVersion?: string;
};

const LIMIT_CODES = new Set(["too-many-entries", "entry-too-large", "too-large", "suspicious-ratio"]);

function fromZipError(e: unknown): PackageError {
  if (e instanceof ZipError) {
    return new PackageError(
      LIMIT_CODES.has(e.code) ? "limits" : "corrupt-archive",
      LIMIT_CODES.has(e.code) ? "the package is larger than allowed" : "the package file is damaged",
      [e.message],
    );
  }
  return new PackageError("corrupt-archive", "the package file is damaged", [String(e)]);
}

export async function readPackage(
  archive: Uint8Array,
  options: ReadPackageOptions = {},
): Promise<LoadedPackage> {
  let files: Map<string, Uint8Array>;
  try {
    const entries = listZip(archive, PACKAGE_LIMITS).filter((e) => !e.isDirectory);
    files = readZipEntries(archive, entries, PACKAGE_LIMITS);
  } catch (e) {
    throw fromZipError(e);
  }

  const manifestBytes = files.get(MANIFEST_PATH);
  if (!manifestBytes) throw new PackageError("missing-manifest", "this is not a HallPass game package (no manifest)");

  // Peek at the format version so "built for a newer launcher" is reported as such.
  try {
    const peek = JSON.parse(new TextDecoder().decode(manifestBytes)) as { formatVersion?: unknown };
    if (typeof peek?.formatVersion === "number" && peek.formatVersion > HPG_FORMAT_VERSION) {
      throw new PackageError("format-too-new", "this game needs a newer version of the arcade", [
        `formatVersion ${peek.formatVersion} > ${HPG_FORMAT_VERSION}`,
      ]);
    }
  } catch (e) {
    if (e instanceof PackageError) throw e;
    // fall through: parseManifest reports the JSON error properly
  }

  const parsed = parseManifest(manifestBytes);
  if (!parsed.ok) throw new PackageError("invalid-manifest", "the game's manifest is invalid", parsed.errors);
  const manifest = parsed.value;

  const compat = checkCompatibility(manifest, options.launcherVersion);
  if (!compat.ok) throw new PackageError(compat.reason, "this game needs a newer version of the arcade", [compat.detail]);

  const manifestDigest = await sha256Hex(manifestBytes);
  if (options.trustedManifestDigests && !options.trustedManifestDigests.has(manifestDigest)) {
    throw new PackageError("untrusted", "this is not a HallPass package built for this arcade", [
      `manifest sha256 ${manifestDigest} is not on this launcher's list`,
    ]);
  }

  const verified = new Map<string, Uint8Array>();
  for (const [path, entry] of Object.entries(manifest.files)) {
    const data = files.get(path);
    if (!data) throw new PackageError("missing-file", "the package is missing some of its files", [`missing ${path}`]);
    if (data.length !== entry.size) {
      throw new PackageError("size-mismatch", "the package has been changed or damaged", [
        `${path}: ${data.length} bytes, manifest says ${entry.size}`,
      ]);
    }
    const digest = await sha256Hex(data);
    if (digest !== entry.sha256) {
      throw new PackageError("hash-mismatch", "the package has been changed or damaged", [`${path}: sha256 mismatch`]);
    }
    verified.set(path, data);
  }
  const extras = [...files.keys()].filter((p) => p !== MANIFEST_PATH && !verified.has(p));
  if (extras.length > 0) {
    throw new PackageError("unexpected-file", "the package contains files it does not declare", extras.map((p) => `unlisted ${p}`));
  }

  return { manifest, manifestDigest, files: verified, archive };
}

/** True when the bytes are a ZIP whose root holds a manifest.json (i.e. a package, whatever its file name). */
export function looksLikePackage(bytes: Uint8Array): boolean {
  try {
    return listZip(bytes, PACKAGE_LIMITS).some((e) => e.name === MANIFEST_PATH);
  } catch {
    return false;
  }
}
