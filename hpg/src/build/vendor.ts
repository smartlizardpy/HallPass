/**
 * Pinned local copies of the CDN libraries games load (hpg/vendor/).
 *
 * A game that loads Tailwind's Play CDN, three.js or Font Awesome from a CDN
 * cannot run offline as written. Rather than edit the game (the Blob mirror
 * would overwrite the edit on the next deploy), the packager substitutes the
 * repo's copy of exactly that file. The mapping is by URL, so only URLs listed
 * in hpg/vendor/manifest.json are ever substituted; anything else is still a
 * build error.
 *
 * Every file's sha256 is in the manifest and is checked before use, so the
 * package contains exactly what `node hpg/vendor/fetch.mjs` downloaded and
 * a reviewer saw committed.
 *
 *   prefixes  URL prefix → folder under hpg/vendor/ (versioned URLs)
 *   aliases   exact URL a game uses → a URL under a prefix (pins an
 *             unversioned URL such as https://cdn.tailwindcss.com)
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

type Manifest = {
  libraries: string[];
  prefixes: Record<string, string>;
  aliases: Record<string, string>;
  files: Record<string, string>;
};

export type VendorHit = {
  /** Absolute path of the local copy. */
  file: string;
  /** The versioned URL it is a copy of. */
  url: string;
  /** The game's URL was unversioned and was pinned by an alias. */
  pinned: boolean;
};

function normalise(url: string): string | null {
  try {
    return new URL(url.startsWith("//") ? `https:${url}` : url).href;
  } catch {
    return null;
  }
}

export class Vendor {
  readonly root: string;
  private readonly manifest: Manifest;
  private readonly aliases = new Map<string, string>();
  private readonly verified = new Set<string>();

  constructor(dir: string) {
    this.root = realpathSync(dir);
    this.manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as Manifest;
    for (const [from, to] of Object.entries(this.manifest.aliases)) {
      const n = normalise(from);
      if (n) this.aliases.set(n, to);
    }
  }

  /** Load hpg/vendor/ if it exists (it is absent in unit-test fixtures). */
  static at(dir: string): Vendor | undefined {
    return existsSync(path.join(dir, "manifest.json")) ? new Vendor(dir) : undefined;
  }

  /** True when every URL under `prefix` would map into a vendored library. */
  coversPrefix(prefix: string): boolean {
    const n = normalise(prefix);
    return !!n && Object.keys(this.manifest.prefixes).some((p) => n.startsWith(p));
  }

  /**
   * The local copy of `url`, or null if it is not vendored. Throws if the file
   * on disk does not match its manifest hash.
   */
  lookup(url: string): VendorHit | null {
    const n = normalise(url);
    if (!n) return null;
    const alias = this.aliases.get(n);
    const target = alias ?? n;
    for (const [prefix, dir] of Object.entries(this.manifest.prefixes)) {
      if (!target.startsWith(prefix)) continue;
      const rel = dir + target.slice(prefix.length);
      const want = this.manifest.files[rel];
      if (!want) return null;
      const file = path.join(this.root, ...rel.split("/"));
      if (!this.verified.has(rel)) {
        const got = createHash("sha256").update(readFileSync(file)).digest("hex");
        if (got !== want) throw new Error(`hpg/vendor/${rel} does not match its sha256 in manifest.json`);
        this.verified.add(rel);
      }
      return { file, url: target, pinned: alias !== undefined };
    }
    return null;
  }

  /** True when `url` is vendored, without reading the file. */
  has(url: string): boolean {
    const n = normalise(url);
    if (!n) return false;
    const target = this.aliases.get(n) ?? n;
    return Object.entries(this.manifest.prefixes).some(([prefix, dir]) => target.startsWith(prefix) && !!this.manifest.files[dir + target.slice(prefix.length)]);
  }

  /** True when `file` (a real path) is inside hpg/vendor/. */
  contains(file: string): boolean {
    return file.startsWith(this.root + path.sep);
  }
}
