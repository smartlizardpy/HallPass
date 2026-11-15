/**
 * The player's installed games: verified packages kept as their original
 * archive bytes, so they survive a refresh when storage allows.
 *
 * Stored bytes are RE-VERIFIED on every start ({@link PackageLibrary.open}).
 * Storage is not a trust boundary: on Chrome's shared `file://` origin, any
 * local HTML file the player opens can write to this database. A stored package
 * that no longer verifies is dropped and reported; it is never run.
 *
 * One game per id. Adding a package whose id is already installed REPLACES it
 * when the bytes differ (an update, or a deliberate reinstall) and is a no-op
 * when they are identical. The caller is told which happened.
 */

import { readPackage, type LoadedPackage, type ReadPackageOptions } from "../archive/package";
import { compareSemver } from "../format/semver";
import type { KvStore } from "./kv";

type StoredPackage = { id: string; manifestDigest: string; addedAt: number; archive: Uint8Array };

export type AddOutcome =
  | { kind: "added" }
  | { kind: "unchanged" }
  | { kind: "updated"; from: string; to: string }
  | { kind: "replaced"; from: string; to: string };

export type InstalledGame = { pkg: LoadedPackage; addedAt: number };

export class PackageLibrary {
  private games = new Map<string, InstalledGame>();

  private constructor(
    private kv: KvStore,
    private readOptions: ReadPackageOptions,
  ) {}

  /** Load and re-verify everything stored. Returns the library and the ids dropped as invalid. */
  static async open(kv: KvStore, readOptions: ReadPackageOptions): Promise<{ library: PackageLibrary; dropped: string[] }> {
    const lib = new PackageLibrary(kv, readOptions);
    const dropped: string[] = [];
    for (const stored of await kv.getAll<StoredPackage>("packages")) {
      try {
        const pkg = await readPackage(new Uint8Array(stored.archive), readOptions);
        if (pkg.manifest.id !== stored.id) throw new Error("id mismatch");
        lib.games.set(pkg.manifest.id, { pkg, addedAt: stored.addedAt });
      } catch {
        dropped.push(String(stored?.id ?? "?"));
        await kv.delete("packages", String(stored?.id)).catch(() => {});
      }
    }
    return { library: lib, dropped };
  }

  list(): InstalledGame[] {
    return [...this.games.values()].sort((a, b) => a.pkg.manifest.name.localeCompare(b.pkg.manifest.name));
  }

  get(id: string): InstalledGame | undefined {
    return this.games.get(id);
  }

  get size(): number {
    return this.games.size;
  }

  async add(pkg: LoadedPackage, now = Date.now()): Promise<AddOutcome> {
    const id = pkg.manifest.id;
    const existing = this.games.get(id);
    if (existing && existing.pkg.manifestDigest === pkg.manifestDigest) return { kind: "unchanged" };
    const stored: StoredPackage = { id, manifestDigest: pkg.manifestDigest, addedAt: now, archive: pkg.archive };
    await this.kv.put("packages", id, stored);
    this.games.set(id, { pkg, addedAt: now });
    if (!existing) return { kind: "added" };
    const from = existing.pkg.manifest.version;
    const to = pkg.manifest.version;
    return compareSemver(to, from) > 0 ? { kind: "updated", from, to } : { kind: "replaced", from, to };
  }

  async remove(id: string): Promise<void> {
    this.games.delete(id);
    await this.kv.delete("packages", id);
  }
}
