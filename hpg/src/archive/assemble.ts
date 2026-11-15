/**
 * Turn a set of files plus manifest metadata into `.hpg` bytes.
 *
 * The one place a package is written, used by the Node packager and by tests
 * (so tests exercise real packages, not hand-faked ones). It fills in
 * `files` (sizes, hashes, roles) and `build.contentHash`, validates the result
 * with the same validator the launcher uses, and refuses to emit an invalid
 * package.
 *
 * Determinism: `manifest.json` first, then the entry, then the rest sorted by
 * path, with a fixed mtime (archive/zip.ts). Already-compressed media is stored,
 * not deflated again: that saves build time for no loss in size.
 */

import { MANIFEST_PATH } from "../format/constants";
import { sha256Hex } from "../format/hash";
import { validateManifest, type HpgFileEntry, type HpgManifest } from "../format/manifest";
import { extensionOf } from "../format/paths";
import { writeZip, type ZipInput } from "./zip";

export type PackageFile = { path: string; data: Uint8Array; role: HpgFileEntry["role"] };

export type ManifestBase = Omit<HpgManifest, "files">;

const STORED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".mp3", ".ogg", ".m4a", ".woff2", ".glb"]);

export type AssembledPackage = {
  bytes: Uint8Array;
  manifest: HpgManifest;
  manifestBytes: Uint8Array;
  manifestDigest: string;
};

export async function assemblePackage(base: ManifestBase, files: readonly PackageFile[]): Promise<AssembledPackage> {
  const listed: Record<string, HpgFileEntry> = {};
  const ordered = [...files].sort((a, b) =>
    a.role === "entry" ? -1 : b.role === "entry" ? 1 : a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  const contentParts: string[] = [];
  for (const f of ordered) {
    const sha256 = await sha256Hex(f.data);
    listed[f.path] = { size: f.data.length, sha256, role: f.role };
    contentParts.push(`${f.path}\0${sha256}`);
  }
  const contentHash = await sha256Hex(contentParts.join("\n"));
  const manifest: HpgManifest = {
    ...base,
    files: listed,
    build: { ...(base.build ?? { packager: "hpg" }), contentHash },
  };
  const checked = validateManifest(manifest);
  if (!checked.ok) throw new Error(`refusing to write an invalid package:\n  ${checked.errors.join("\n  ")}`);

  const manifestBytes = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
  const zipFiles: ZipInput[] = [
    { path: MANIFEST_PATH, data: manifestBytes },
    ...ordered.map((f) => ({
      path: f.path,
      data: f.data,
      level: STORED_EXTENSIONS.has(extensionOf(f.path)) ? (0 as const) : (9 as const),
    })),
  ];
  return {
    bytes: writeZip(zipFiles),
    manifest,
    manifestBytes,
    manifestDigest: await sha256Hex(manifestBytes),
  };
}
