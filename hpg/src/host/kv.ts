/**
 * The launcher's storage: IndexedDB when this browser gives it to a `file://`
 * page, an in-memory map when it does not.
 *
 * IndexedDB on `file://` IS NOT A GIVEN. Measured in the spike: Chrome
 * persists it across reloads (every file:// page shares one `file://`
 * origin). Other browsers and policies differ: private windows, school
 * lockdown policies and some Firefox configurations either throw, refuse, or
 * never fire `onsuccess` at all. {@link openKv} therefore PROBES
 * (open, write, read back, all under a timeout) and falls back to memory on
 * any failure. It reports which store it got, so the launcher can tell the
 * player plainly that progress will not survive a refresh unless they export
 * it.
 */

export type StoreName = "packages" | "saves" | "scores" | "settings";
const STORES: StoreName[] = ["packages", "saves", "scores", "settings"];

export interface KvStore {
  readonly persistent: boolean;
  get<T>(store: StoreName, key: string): Promise<T | undefined>;
  getAll<T>(store: StoreName): Promise<T[]>;
  keys(store: StoreName): Promise<string[]>;
  put(store: StoreName, key: string, value: unknown): Promise<void>;
  delete(store: StoreName, key: string): Promise<void>;
  close(): void;
}

export class MemoryKv implements KvStore {
  readonly persistent = false;
  private data = new Map<StoreName, Map<string, unknown>>(STORES.map((s) => [s, new Map()]));
  async get<T>(store: StoreName, key: string) {
    return this.data.get(store)!.get(key) as T | undefined;
  }
  async getAll<T>(store: StoreName) {
    return [...this.data.get(store)!.values()] as T[];
  }
  async keys(store: StoreName) {
    return [...this.data.get(store)!.keys()];
  }
  async put(store: StoreName, key: string, value: unknown) {
    this.data.get(store)!.set(key, structuredClone(value));
  }
  async delete(store: StoreName, key: string) {
    this.data.get(store)!.delete(key);
  }
  close() {}
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export class IdbKv implements KvStore {
  readonly persistent = true;
  constructor(private db: IDBDatabase) {}

  private tx(store: StoreName, mode: IDBTransactionMode) {
    return this.db.transaction(store, mode).objectStore(store);
  }
  async get<T>(store: StoreName, key: string) {
    return (await req(this.tx(store, "readonly").get(key))) as T | undefined;
  }
  async getAll<T>(store: StoreName) {
    return (await req(this.tx(store, "readonly").getAll())) as T[];
  }
  async keys(store: StoreName) {
    return (await req(this.tx(store, "readonly").getAllKeys())).map(String);
  }
  put(store: StoreName, key: string, value: unknown): Promise<void> {
    return new Promise((res, rej) => {
      const t = this.db.transaction(store, "readwrite");
      t.objectStore(store).put(value, key);
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error ?? new Error("transaction aborted"));
    });
  }
  delete(store: StoreName, key: string): Promise<void> {
    return new Promise((res, rej) => {
      const t = this.db.transaction(store, "readwrite");
      t.objectStore(store).delete(key);
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    });
  }
  close() {
    this.db.close();
  }
}

export const DB_NAME = "hallpass-offline-arcade";
const DB_VERSION = 1;
const PROBE_TIMEOUT_MS = 3000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("timed out")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        res(v);
      },
      (e) => {
        clearTimeout(t);
        rej(e);
      },
    );
  });
}

export type KvOpenResult = { kv: KvStore; reason?: string };

/** Open IndexedDB and prove it works, or fall back to memory and say why. */
export async function openKv(idb: IDBFactory | undefined = globalThis.indexedDB): Promise<KvOpenResult> {
  if (!idb) return { kv: new MemoryKv(), reason: "IndexedDB is not available" };
  try {
    const db = await withTimeout(
      new Promise<IDBDatabase>((res, rej) => {
        const r = idb.open(DB_NAME, DB_VERSION);
        r.onupgradeneeded = () => {
          for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s);
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
        r.onblocked = () => rej(new Error("blocked by another open arcade tab"));
      }),
      PROBE_TIMEOUT_MS,
    );
    const kv = new IdbKv(db);
    const token = String(Date.now());
    await withTimeout(kv.put("settings", "probe", token), PROBE_TIMEOUT_MS);
    if ((await withTimeout(kv.get<string>("settings", "probe"), PROBE_TIMEOUT_MS)) !== token) {
      kv.close();
      return { kv: new MemoryKv(), reason: "IndexedDB did not read back what was written" };
    }
    return { kv };
  } catch (e) {
    return { kv: new MemoryKv(), reason: `IndexedDB is unavailable (${e instanceof Error ? e.message : String(e)})` };
  }
}
