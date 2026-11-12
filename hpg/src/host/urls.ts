/**
 * Object URLs the launcher mints for its OWN page (game covers), keyed so a
 * replaced or removed game releases its URL, and everything is released when
 * the library is torn down. An object URL keeps its Blob alive until revoked,
 * so a forgotten one is a memory leak that grows with every re-import.
 *
 * (Game frames never receive launcher-minted URLs: an opaque-origin frame
 * cannot load them. See guest/install.ts.)
 */

export class ObjectUrlPool {
  private urls = new Map<string, string>();

  constructor(private api: Pick<typeof URL, "createObjectURL" | "revokeObjectURL"> = URL) {}

  /** The URL for `key`, minted from `make()` the first time. */
  get(key: string, make: () => Blob): string {
    let u = this.urls.get(key);
    if (!u) {
      u = this.api.createObjectURL(make());
      this.urls.set(key, u);
    }
    return u;
  }

  /** Revoke every URL whose key starts with `prefix` (e.g. one game's covers). */
  release(prefix: string): void {
    for (const [k, u] of this.urls) {
      if (k.startsWith(prefix)) {
        this.api.revokeObjectURL(u);
        this.urls.delete(k);
      }
    }
  }

  releaseAll(): void {
    for (const u of this.urls.values()) this.api.revokeObjectURL(u);
    this.urls.clear();
  }

  get size(): number {
    return this.urls.size;
  }
}
