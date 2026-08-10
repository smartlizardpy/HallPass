"use client";

/**
 * HallPass — mirroring one stealth preference where the service worker can read it.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * Stealth preferences live in `localStorage` under `hp:stealth`, and a SERVICE
 * WORKER CANNOT READ `localStorage`. The `push` event also fires with no tab
 * open at all, so there is nobody to postMessage the value from. IndexedDB is
 * the one storage both a page and a worker can reach, so exactly one flag —
 * `quietNotifications` — is copied there whenever it changes.
 *
 * ── WHY MIRROR RATHER THAN MOVE ────────────────────────────────────────────
 * `hp:stealth` stays the source of truth. Moving the whole preference object to
 * IndexedDB would make every read asynchronous, and `store.ts` feeds
 * `useSyncExternalStore`, whose `getSnapshot` must return a cached value
 * SYNCHRONOUSLY — an async read there is not a refactor, it is a rewrite of how
 * the cloak and the panic key are applied. One boolean copied one way is a much
 * smaller thing to keep correct.
 *
 * ── WHY IT IS PER-DEVICE, AND THAT IS THE POINT ────────────────────────────
 * The alternative was storing the preference on the account and redacting
 * server-side. That would be one setting for a person who wants full detail on
 * their own phone and discretion on the school Chromebook — necessarily wrong on
 * one of them. IndexedDB is per browser profile, which is exactly the grain the
 * preference actually has. It also keeps `app/lib/stealth` free of a backend,
 * which is the module's whole design.
 *
 * ── EVERY FAILURE IS SILENT ────────────────────────────────────────────────
 * Private mode, a blocked store, a browser with no IndexedDB: all resolve
 * without throwing. A mirror that never lands means the worker reads no flag and
 * shows the FULL notification, which is the documented default rather than a
 * broken state. Nothing here may throw into a React effect.
 */

/** Mirrored by hand in `public/sw.js`, which reads them. Change both together. */
export const PREFS_DB = "hp-sw-prefs";
export const PREFS_STORE = "prefs";
export const QUIET_KEY = "quietNotifications";

function openPrefsDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      const request = indexedDB.open(PREFS_DB, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(PREFS_STORE)) {
          db.createObjectStore(PREFS_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Copy the quiet-notifications flag to where the service worker can see it.
 *
 * Fire-and-forget and never throws. Call it whenever the preference changes, and
 * once on mount so a device that had the setting before this shipped — or whose
 * IndexedDB was cleared without `localStorage` being cleared — converges.
 */
export async function mirrorQuietNotifications(quiet: boolean): Promise<void> {
  try {
    if (typeof indexedDB === "undefined") return;
    const db = await openPrefsDb();
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(PREFS_STORE, "readwrite");
        tx.objectStore(PREFS_STORE).put(quiet, QUIET_KEY);
        tx.oncomplete = () => resolve();
        // A failed write is not worth reporting: the worker falls back to the
        // full notification, which is the default anyway.
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
    db.close();
  } catch {
    // No IndexedDB, private mode, or the store was blocked. Silent by design.
  }
}
