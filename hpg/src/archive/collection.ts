/**
 * Import what the player hands the launcher: `games.zip`, one or more `.hpg`
 * files, or a mix of them, all from a browser file input or a drop. No network
 * is involved.
 *
 * PARTIAL SUCCESS IS THE NORMAL CASE. One damaged package must not cost the
 * player the other eleven, so every source gets its own result line (`ok`,
 * `error` or `skipped`) and the valid packages are returned regardless.
 * The collection's OWN structure is the exception: a `games.zip` that is not a
 * ZIP at all, or that trips the limits, fails as one item, because nothing
 * inside it can be trusted to be what its headers claim.
 *
 * Duplicates: when two sources carry the same game `id`, the higher `version`
 * wins and the other is reported as a duplicate. Identical copies (same
 * manifest digest) are reported the same way. Whether a winner REPLACES a game
 * already in the library is decided by the library, not here (host/library.ts).
 */

import { COLLECTION_LIMITS, HPG_EXTENSION } from "../format/constants";
import { extensionOf } from "../format/paths";
import { compareSemver } from "../format/semver";
import { listZip, readZipEntries, ZipError } from "./zip";
import {
  looksLikePackage,
  PackageError,
  readPackage,
  type LoadedPackage,
  type ReadPackageOptions,
} from "./package";

export type ImportSource = { name: string; bytes: Uint8Array };

export type ImportItem =
  | { source: string; status: "ok"; pkg: LoadedPackage }
  | { source: string; status: "duplicate"; id: string; version: string; keptVersion: string }
  | { source: string; status: "error"; code: string; message: string; details: string[] }
  | { source: string; status: "skipped"; reason: string };

export type ImportReport = {
  items: ImportItem[];
  /** The packages to add, one per id, highest version first-come. */
  packages: LoadedPackage[];
};

export type ImportProgress = (done: number, total: number, label: string) => void;

/** Junk that OS archivers add and that should be ignored silently-but-listed. */
function isArchiverNoise(name: string): boolean {
  const base = name.slice(name.lastIndexOf("/") + 1);
  return name.startsWith("__MACOSX/") || base.startsWith("._") || base === ".DS_Store" || base === "Thumbs.db";
}

type Pending = { source: string; bytes: Uint8Array };

function expandCollection(src: ImportSource, items: ImportItem[]): Pending[] {
  let entries;
  try {
    entries = listZip(src.bytes, COLLECTION_LIMITS);
  } catch (e) {
    items.push({
      source: src.name,
      status: "error",
      code: e instanceof ZipError ? e.code : "corrupt",
      message: e instanceof ZipError && e.code === "not-zip" ? "this is not a ZIP file" : "the games collection is damaged",
      details: [e instanceof Error ? e.message : String(e)],
    });
    return [];
  }
  const selected = [];
  for (const e of entries) {
    if (e.isDirectory) continue;
    // A collection may nest packages in folders (games/conquest.hpg), but the
    // whole name must still obey the path grammar. Nothing is extracted to
    // disk, so a bad name could not traverse anywhere; it is reported and not
    // read anyway, because a legitimate games.zip never contains one.
    const label = `${src.name} › ${e.name}`;
    if (isArchiverNoise(e.name)) continue;
    if (extensionOf(e.name) !== HPG_EXTENSION) {
      items.push({ source: label, status: "skipped", reason: "not a .hpg game package" });
      continue;
    }
    if (!e.safePath) {
      items.push({ source: label, status: "skipped", reason: "unsafe file name" });
      continue;
    }
    selected.push(e);
  }
  // Read each package separately so one bad entry does not sink the rest.
  const out: Pending[] = [];
  for (const e of selected) {
    const label = `${src.name} › ${e.name}`;
    try {
      const data = readZipEntries(src.bytes, [e], COLLECTION_LIMITS).get(e.name)!;
      out.push({ source: label, bytes: data });
    } catch (err) {
      items.push({
        source: label,
        status: "error",
        code: err instanceof ZipError ? err.code : "corrupt",
        message: "this package could not be unpacked from the collection",
        details: [err instanceof Error ? err.message : String(err)],
      });
    }
  }
  if (selected.length === 0) {
    items.push({ source: src.name, status: "skipped", reason: "contains no .hpg game packages" });
  }
  return out;
}

const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

export async function importSources(
  sources: readonly ImportSource[],
  options: ReadPackageOptions = {},
  onProgress?: ImportProgress,
): Promise<ImportReport> {
  const items: ImportItem[] = [];
  const pending: Pending[] = [];
  for (const src of sources) {
    // A package is recognised by its content (a root manifest.json) or its
    // extension; a `.hpg` with no manifest still goes to readPackage so the
    // player hears "not a HallPass game package", not "empty collection".
    const ext = extensionOf(src.name);
    if (ext === HPG_EXTENSION || looksLikePackage(src.bytes)) {
      pending.push({ source: src.name, bytes: src.bytes });
    } else if (ext === ".zip") {
      pending.push(...expandCollection(src, items));
    } else {
      items.push({ source: src.name, status: "skipped", reason: "choose games.zip or a .hpg file" });
    }
  }

  const loaded: { source: string; pkg: LoadedPackage }[] = [];
  for (let i = 0; i < pending.length; i++) {
    const p = pending[i];
    onProgress?.(i, pending.length, p.source);
    await yieldToUi();
    try {
      loaded.push({ source: p.source, pkg: await readPackage(p.bytes, options) });
    } catch (e) {
      const pe = e instanceof PackageError ? e : new PackageError("corrupt-archive", "the package could not be read", [String(e)]);
      items.push({ source: p.source, status: "error", code: pe.code, message: pe.message, details: pe.details });
    }
  }
  onProgress?.(pending.length, pending.length, "");

  // Keep the highest version per id; ties keep the first seen.
  const best = new Map<string, { source: string; pkg: LoadedPackage }>();
  for (const l of loaded) {
    const cur = best.get(l.pkg.manifest.id);
    if (!cur || compareSemver(l.pkg.manifest.version, cur.pkg.manifest.version) > 0) best.set(l.pkg.manifest.id, l);
  }
  for (const l of loaded) {
    const winner = best.get(l.pkg.manifest.id)!;
    if (winner === l) items.push({ source: l.source, status: "ok", pkg: l.pkg });
    else {
      items.push({
        source: l.source,
        status: "duplicate",
        id: l.pkg.manifest.id,
        version: l.pkg.manifest.version,
        keptVersion: winner.pkg.manifest.version,
      });
    }
  }
  return { items, packages: [...best.values()].map((b) => b.pkg) };
}
