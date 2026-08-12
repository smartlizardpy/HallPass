// HALLPASS service worker — offline-first PWA.
// Generated manifest provides BUILD_ID + URL list.
self.importScripts("/sw-manifest.js");

const BUILD_ID = self.__SW_BUILD_ID || "dev";
const PRECACHE_URLS = self.__SW_PRECACHE || [];
const STATIC_CACHE = `hp-static-${BUILD_ID}`;
// Runtime + meta caches are intentionally NOT keyed by BUILD_ID: they must
// survive deploys so the games-version sentinel + warm runtime entries persist.
const RUNTIME_CACHE = "hp-runtime";
const META_CACHE = "hp-meta";
// Absolute sentinel URL — relative strings resolve against the SW origin and
// could collide with a real route.
const GAMES_VERSION_KEY = "https://hallpass.local/__sw__/games-version";

// Paths whose responses are PER-VIEWER and must never sit in a shared cache.
// `hp-runtime` is deliberately not keyed by BUILD_ID and is shared by everyone
// using the browser profile, so a cached `/play/you` is one user's email and
// standings waiting to be served to the next. Used in two places: the fetch
// handler skips these entirely, and `activate` purges anything an EARLIER
// version of this service worker already stored.
function isPrivatePath(pathname) {
  return (
    // The ENTIRE `/play/you` subtree, matched as a prefix rather than tab by
    // tab. `/play/you` renders the player's own standings and
    // `/play/you/settings` renders their email address, so every tab that
    // exists today would qualify on its own merits — but naming them one by one
    // means the next tab someone adds leaks until somebody remembers to come
    // back here. A subtree match cannot be forgotten.
    pathname.startsWith("/play/you") ||
    // The two OLD profile URLs, which are now 307s into that subtree. This is
    // NOT about the redirect response itself — a bare 307 carries no PII. It is
    // about what the service worker actually receives: `networkFirst` calls
    // `fetch(req)` with the default `redirect: "follow"`, so the response that
    // comes back is the BODY of the private destination, and it would be stored
    // under the public key `/play/account`, where `purgePrivateEntries` — which
    // matches on the cached request's own path — could never find it again.
    // `isCacheable`'s `!res.redirected` check happens to block that today, but
    // that check exists to stop redirect-poisoning of iframe sources, not to
    // protect anyone's email; a privacy guarantee must not rest on a guard kept
    // for an unrelated reason. Listing them costs nothing: neither route renders
    // any content of its own any more.
    pathname.startsWith("/play/account") ||
    pathname.startsWith("/play/friends") ||
    pathname.startsWith("/u/") ||
    // The challenge picker. It renders the viewer's own friend list, and it is
    // loaded as an IFRAME — which still reaches the fetch handler as a navigate
    // request, so without this it would be cached into `hp-runtime` and served
    // to the next person on a shared school machine. It is dynamic (it calls
    // `auth()`) and so never enters the precache, but that is a separate
    // mechanism and not a substitute for this one.
    pathname.startsWith("/embed/")
  );
}

// A response is safe to cache.put only if it's a non-redirected,
// same-origin (basic/default) success. Avoids redirect-poisoning the cache —
// some browsers refuse to serve redirected responses for iframe src.
function isCacheable(res) {
  return !!(
    res &&
    res.ok &&
    !res.redirected &&
    (res.type === "basic" || res.type === "default")
  );
}

// ---------- install: precache everything we can. ----------
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      await Promise.allSettled(
        PRECACHE_URLS.map(async (url) => {
          try {
            const isGameHtml = url.startsWith("/game-html/");
            const res = await fetch(url, {
              cache: "reload",
              credentials: "same-origin",
              // Game-html routes 307 to /games/{slug}/index.html when Blob is
              // missing — never cache that redirected response.
              redirect: isGameHtml ? "manual" : "follow",
            });
            if (isCacheable(res)) await cache.put(url, res.clone());
          } catch {
            /* best-effort */
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

// ---------- activate: drop old caches, claim clients. ----------
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      // Only sweep stale per-deploy static caches. Leave hp-runtime + hp-meta.
      await Promise.all(
        keys
          .filter((k) => k.startsWith("hp-static-") && k !== STATIC_CACHE)
          .map((k) => caches.delete(k)),
      );
      await purgePrivateEntries();
      await self.clients.claim();
    })(),
  );
  // Fire-and-forget: don't block activation on N upstream fetches.
  event.waitUntil(
    refreshAllGameHtml().catch(() => {}),
  );
});

/**
 * Evict per-viewer responses an earlier service worker already cached.
 *
 * Adding a path to the never-intercept list stops NEW leaks, but it cannot undo
 * old ones: `hp-runtime` survives deploys by design, so a device that visited
 * the account page before that path was listed still holds that user's email and
 * would still be served it on the next offline navigation. This runs
 * `isPrivatePath` over the existing keys, so each addition to that list is
 * retroactive as well as preventive — listing the `/play/you` subtree evicts
 * anything cached from it before the guard shipped.
 * Retroactive, runs once per activation, and is cheap — a cache-key enumeration
 * plus a delete for the rare match.
 */
async function purgePrivateEntries() {
  try {
    const cache = await caches.open(RUNTIME_CACHE);
    const requests = await cache.keys();
    await Promise.all(
      requests
        .filter((req) => {
          try {
            const url = new URL(req.url);
            return (
              url.origin === self.location.origin && isPrivatePath(url.pathname)
            );
          } catch {
            return false;
          }
        })
        .map((req) => cache.delete(req)),
    );
  } catch {
    /* best-effort: never block activation on cache housekeeping */
  }
}

// ---------- fetch: same-origin only. ----------
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // PostHog/ads/etc.

  // Never intercept admin/dashboard/api — those need the network.
  //
  // PER-VIEWER PAGES ARE ALSO EXCLUDED, and that is a privacy requirement, not a
  // freshness one. `networkFirst` below writes every HTML navigation into
  // RUNTIME_CACHE, which is deliberately NOT keyed by BUILD_ID and therefore
  // survives deploys — and the cache is shared by everyone using the browser
  // profile. `/play/you/settings` renders the signed-in player's EMAIL,
  // `/play/you` their standings, and `/u/...` a specific person's profile.
  // Caching any of them means the next user of a shared school machine can be
  // served the previous user's page from the cache the moment the network
  // hiccups. Any future route that renders one specific player's data belongs in
  // this list.
  //
  // `/play/friends` USED TO BE deliberately absent, on the grounds that its
  // server shell read no session and leaked nothing. It is now in the list. The
  // page became a 307 to `/play/you/friends`, and while a redirect is not itself
  // PII, this handler never sees the bare redirect: `networkFirst` follows it and
  // gets the private page's HTML back, which without the listing would be written
  // into `hp-runtime` under the innocuous key `/play/friends` — a key
  // `purgePrivateEntries` would never recognise. Same for `/play/account`. The
  // offline value lost is a heading over an empty box, since the island it used
  // to host renders nothing without the network anyway.
  if (
    url.pathname.startsWith("/admin") ||
    url.pathname.startsWith("/dashboard") ||
    url.pathname.startsWith("/api/") ||
    isPrivatePath(url.pathname) ||
    url.pathname === "/games-version"
  ) {
    return;
  }

  // Game iframe: network-first, fall back to cached, then static fallback.
  if (url.pathname.startsWith("/game-html/")) {
    event.respondWith(networkFirstWithStaticFallback(req));
    return;
  }

  // HTML navigations: network-first so updates land when online.
  if (req.mode === "navigate" || req.headers.get("accept")?.includes("text/html")) {
    event.respondWith(networkFirst(req));
    return;
  }

  // SDK bundle: stable-URL script embedded by third-party games. It is NOT
  // hashed, so cache-first would pin players to an old bundle across deploys.
  // Network-first (revalidating past the HTTP cache) so a redeployed bundle is
  // picked up on the next online load, with cache fallback when offline.
  if (url.pathname.startsWith("/sdk/")) {
    event.respondWith(networkFirstNoHttpCache(req));
    return;
  }

  // Hashed/static assets: cache-first.
  event.respondWith(cacheFirst(req));
});

// ---------- strategies ----------
async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (isCacheable(res)) {
      const cache = await caches.open(RUNTIME_CACHE);
      await cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  } catch {
    return cached || new Response(null, { status: 504 });
  }
}

/* @pure-start pickFresher */
/**
 * Of a precached response and a runtime one for the same URL, the one that
 * actually reflects the newest content. Either may be absent.
 *
 * WHY A COMPARISON AND NOT AN ORDERING. Both caches can be wrong, in opposite
 * directions, and a fixed preference picks the wrong one half the time:
 *
 *   - `hp-runtime` is never swept, so it can hold HTML from a DEPLOY AGO.
 *     That is the bug the unconditional precache-first rule below was written
 *     to fix, and it was a real one.
 *   - `hp-static-<id>` is written ONCE, by the install handler, and never
 *     refreshed for the life of the deploy. So it can hold content from before
 *     any amount of same-deploy change — an ISR page that has since
 *     regenerated, a dashboard edit, a newly tagged game. Offline never
 *     improved, however many successful online visits happened in between.
 *
 * `date` settles it, and the equivalence is exact rather than approximate:
 * `hp-static-<id>` is created fresh per BUILD_ID and its entries are fetched
 * with `cache: "reload"` at install, so every precache entry is stamped at THIS
 * deploy's install time. A runtime entry stamped later than that can only have
 * been written during this deploy — which is precisely the condition the
 * precache-first rule was reaching for. An older one is a previous deploy's and
 * still loses.
 *
 * Both dates come from the SAME origin's clock (they are server `Date` headers,
 * not local time), so a wrong client clock cannot skew the comparison.
 *
 * UNCERTAINTY FAVOURS THE PRECACHE. A missing or unparseable header on either
 * side falls back to the previous behaviour, which is the conservative
 * direction: this deploy's asset hashes are guaranteed to match its HTML.
 */
function pickFresher(precached, warm) {
  if (!precached) return warm || null;
  if (!warm) return precached;
  const at = (res) => {
    const raw = res.headers && res.headers.get && res.headers.get("date");
    const ms = raw ? Date.parse(raw) : NaN;
    return Number.isNaN(ms) ? null : ms;
  };
  const staticAt = at(precached);
  const warmAt = at(warm);
  if (staticAt === null || warmAt === null) return precached;
  return warmAt > staticAt ? warm : precached;
}
/* @pure-end */

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (isCacheable(res)) {
      const cache = await caches.open(RUNTIME_CACHE);
      await cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  } catch {
    // THE FRESHER OF THE TWO CACHED COPIES — see {@link pickFresher} for why
    // this is a comparison rather than a fixed preference, and why comparing
    // `date` is exactly equivalent to "was this written during this deploy".
    //
    // `caches.match` searches every cache in CREATION order, which cannot be
    // relied on: `hp-runtime` is created on a visitor's first-ever navigation
    // and `activate` deliberately never sweeps it (the games-version sentinel
    // and warm entries have to survive deploys), while `hp-static-<id>` is
    // rebuilt under a new key on every deploy — so from the second deploy
    // onward the runtime cache is the OLDER one and would win the search. Both
    // caches are therefore asked BY NAME and the answer decided here.
    //
    // Exact match only, so this cannot shadow a query-string document: `/?q=racing`
    // (the store page's header search) is not in either cache under that key,
    // misses here, and still reaches the loose match below.
    const staticCache = await caches.open(STATIC_CACHE);
    const runtimeCache = await caches.open(RUNTIME_CACHE);
    const [precached, warm] = await Promise.all([
      staticCache.match(req),
      runtimeCache.match(req),
    ]);
    const best = pickFresher(precached, warm);
    if (best) return best;

    // Exact first, then loose. `caches.match` is exact on the query string by
    // default and precached documents never carry one, so a navigation to
    // `/?q=racing` would otherwise miss its own cached document and fall through
    // to the offline page. Widening only on miss keeps "serve the document you
    // actually cached" true.
    //
    // Navigations ONLY. This must never reach `networkFirstWithStaticFallback`,
    // where exact matching of `/game-html/<slug>/` is load-bearing. Nor can it
    // cross-match private pages: everything `isPrivatePath` covers (`/play/you`,
    // `/play/account`, `/play/friends`, `/u/`, `/embed/`) plus `/admin`,
    // `/dashboard`, `/api/` and `/games-version` all return before this strategy
    // is reached.
    const cached = await caches.match(req);
    if (cached) return cached;
    const loose = await caches.match(req, { ignoreSearch: true });
    if (loose) return loose;

    // The precached offline document. Note the pathname still has to match
    // exactly above, so `/u/someone` and `/game/<slug>/` (the trailing-slash form
    // `skipTrailingSlashRedirect: true` keeps alive) correctly land here rather
    // than being answered with the catalog — which is what this chain was
    // rewritten for. There is deliberately no `/` fallback any more: `/` is
    // precached, so a request for it is already satisfied by the exact match.
    const offline = await caches.match("/offline");
    if (offline) return offline;

    // Synthesized offline page — Response.error() shows the browser's hard
    // network error and breaks back-button navigation.
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>Offline</title><body style="font-family:system-ui;padding:2rem"><h1>You\'re offline</h1><p>This page isn\'t cached yet. Reconnect and reload.</p>',
      {
        status: 503,
        headers: { "content-type": "text/html; charset=utf-8" },
      },
    );
  }
}

// Like networkFirst, but bypasses the HTTP cache so a redeployed stable-URL
// bundle (e.g. /sdk/v1/hallpass.js — a non-hashed URL, served with
// must-revalidate) is fetched fresh instead of read from the browser's HTTP
// cache. "no-cache" revalidates
// with the server, so an unchanged bundle returns a cheap 304 while a new
// deploy returns the updated 200. Falls back to the runtime cache when offline.
async function networkFirstNoHttpCache(req) {
  try {
    const res = await fetch(req, { cache: "no-cache" });
    if (isCacheable(res)) {
      const cache = await caches.open(RUNTIME_CACHE);
      await cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  } catch {
    const cached = await caches.match(req);
    if (cached) return cached;
    return new Response(null, { status: 504 });
  }
}

async function networkFirstWithStaticFallback(req) {
  const url = new URL(req.url);
  const rel = url.pathname.slice("/game-html/".length).replace(/\/+$/, "");
  const [slug, ...rest] = rel.split("/");
  const staticUrl = rest.length
    ? `/games/${slug}/${rest.join("/")}`
    : `/games/${slug}/index.html`;

  let res = null;
  try {
    res = await fetch(req, { cache: "no-store", redirect: "manual" });
  } catch {
    res = null; // network unreachable — use the cache chain below.
  }

  if (res && isCacheable(res)) {
    const cache = await caches.open(RUNTIME_CACHE);
    await cache.put(req, res.clone()).catch(() => {});
    return res;
  }

  // An opaqueredirect is the route's authoritative "no blob copy" answer
  // (307 to the static twin). Any runtime-cached blob copy is now stale —
  // evict it so "Reset source to default" propagates to returning clients,
  // and serve the static fallback instead of preferring the dead entry.
  if (res && res.type === "opaqueredirect") {
    const cache = await caches.open(RUNTIME_CACHE);
    await cache.delete(req).catch(() => {});
    const fallback = await caches.match(staticUrl);
    if (fallback) return fallback;
    return fetchStaticFallback(staticUrl);
  }

  // Offline or transient upstream error: cached copy → static twin → network.
  // caches.match searches all caches (static + runtime + meta).
  const cached = await caches.match(req);
  if (cached) return cached;
  const fallback = await caches.match(staticUrl);
  if (fallback) return fallback;
  return fetchStaticFallback(staticUrl);
}

async function fetchStaticFallback(staticUrl) {
  try {
    const res = await fetch(staticUrl);
    if (isCacheable(res)) {
      const cache = await caches.open(RUNTIME_CACHE);
      await cache.put(staticUrl, res.clone()).catch(() => {});
    }
    return res;
  } catch {
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>Offline</title><body style="font-family:system-ui;padding:2rem"><h1>Game unavailable offline</h1><p>Reconnect and reload to play.</p>',
      {
        status: 503,
        headers: { "content-type": "text/html; charset=utf-8" },
      },
    );
  }
}

// ---------- games-version polling: refresh cache when admin uploads. ----------
async function refreshAllGameHtml() {
  const cache = await caches.open(RUNTIME_CACHE);

  // Precached game documents PLUS every /game-html/ entry the runtime cache
  // accumulated during play. Bundle assets exist only as runtime entries, and
  // skipping them would pin offline players to a torn new-index/old-assets mix
  // after a bundle update.
  const urls = new Set(PRECACHE_URLS.filter((u) => u.startsWith("/game-html/")));
  try {
    for (const req of await cache.keys()) {
      const u = new URL(req.url);
      if (
        u.origin === self.location.origin &&
        u.pathname.startsWith("/game-html/")
      ) {
        urls.add(u.pathname + u.search);
      }
    }
  } catch {
    /* enumeration is best-effort */
  }

  const tasks = [...urls].map(async (url) => {
    try {
      const res = await fetch(url, {
        cache: "no-store",
        credentials: "same-origin",
        redirect: "manual",
      });
      if (isCacheable(res)) {
        await cache.put(url, res.clone());
      } else if (res.type === "opaqueredirect") {
        // Blob copy deleted (307 to the static twin) — drop the stale entry
        // instead of serving a removed override forever.
        await cache.delete(url);
      }
    } catch {
      /* offline — keep what we have */
    }
  });
  await Promise.allSettled(tasks);
}

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "CHECK_GAMES_VERSION") {
    event.waitUntil(checkGamesVersion(data.version));
  } else if (data.type === "SYNC_NOW") {
    event.waitUntil(refreshAllGameHtml());
  } else if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

async function checkGamesVersion(reportedVersion) {
  if (!reportedVersion) return;
  try {
    const stored = await readGamesVersion();
    if (stored === reportedVersion) return;
    await writeGamesVersion(reportedVersion);
    // Always refresh on mismatch — the previous "skip on first install" guard
    // was unreachable anyway because the meta cache survives deploys now,
    // but more importantly: a real version mismatch means stale HTML.
    await refreshAllGameHtml();
  } catch {
    /* ignore */
  }
}

async function readGamesVersion() {
  const cache = await caches.open(META_CACHE);
  const res = await cache.match(GAMES_VERSION_KEY);
  if (!res) return null;
  return (await res.text()) || null;
}

async function writeGamesVersion(value) {
  const cache = await caches.open(META_CACHE);
  await cache.put(
    GAMES_VERSION_KEY,
    new Response(value, {
      headers: { "content-type": "text/plain" },
    }),
  );
}

// ---------- push: challenge notifications ----------
//
// WHY THE PAYLOAD CARRIES TWO VERSIONS AND THIS FILE ONLY CHOOSES.
// A service worker cannot read `localStorage`, which is where the stealth
// preferences live (`hp:stealth`), and a push arrives with no tab open to ask.
// So the server sends BOTH a full and a discreet rendering (see
// `app/lib/push/payload.ts`) and this picks one by a flag the page mirrors into
// IndexedDB — which a worker CAN read.
//
// The wording itself is never reconstructed here. If it were, the discreet
// version would exist in two places and could drift in the direction that
// leaks. This file's entire share of that decision is `quiet ? a : b`.
//
// DEFAULT IS THE FULL VERSION. Discretion is opt-in from stealth settings: a
// phone is personal, and a vague notification wastes the feature for most
// people. A device that has never written the mirror gets full detail.

const PUSH_PREFS_DB = "hp-sw-prefs";
const PUSH_PREFS_STORE = "prefs";
const QUIET_KEY = "quietNotifications";

// Mirrored from `app/lib/stealth/sw-mirror.ts`, which writes it. The two names
// must match or the preference silently never applies.
function openPrefsDb() {
  return new Promise((resolve, reject) => {
    try {
      const request = indexedDB.open(PUSH_PREFS_DB, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(PUSH_PREFS_STORE)) {
          db.createObjectStore(PUSH_PREFS_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    } catch (error) {
      reject(error);
    }
  });
}

// Reads the mirrored flag. ANY failure — no IndexedDB, a private-mode block, a
// store that was never written — resolves `false`, i.e. show the full version.
// Failing to the loud default is deliberate: the quiet mode is opt-in, and
// silently applying it to everyone whose browser blocked storage would make the
// feature look broken for the majority.
async function readQuietPreference() {
  try {
    const db = await openPrefsDb();
    const value = await new Promise((resolve) => {
      try {
        const tx = db.transaction(PUSH_PREFS_STORE, "readonly");
        const request = tx.objectStore(PUSH_PREFS_STORE).get(QUIET_KEY);
        request.onsuccess = () => resolve(request.result === true);
        request.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
    db.close();
    return value;
  } catch {
    return false;
  }
}

self.addEventListener("push", (event) => {
  event.waitUntil(showPush(event));
});

async function showPush(event) {
  let data = null;
  try {
    data = event.data ? event.data.json() : null;
  } catch {
    // A push with no payload, or one we cannot parse. Nothing honest to show —
    // inventing a banner would be worse than staying silent.
    return;
  }
  if (!data || !data.full || !data.discreet) return;

  const quiet = await readQuietPreference();
  const copy = quiet ? data.discreet : data.full;

  await self.registration.showNotification(copy.title, {
    body: copy.body,
    // One icon for both versions: a DIFFERENT icon in quiet mode would defeat
    // the point by making the quiet notification recognisable as the quiet one.
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    // Shared tag, so four challenges while a phone is in a bag collapse into
    // one banner rather than four.
    tag: data.tag || "hallpass",
    data: { url: data.url || "/play/you/friends" },
  });
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(openFromNotification(event));
});

// Focus an existing HallPass tab rather than piling up new ones — someone who
// taps three notifications should end with one window, not three.
async function openFromNotification(event) {
  const target =
    (event.notification.data && event.notification.data.url) || "/play/you/friends";
  try {
    const clientList = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });
    for (const client of clientList) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.focus();
        if ("navigate" in client) await client.navigate(target);
        return;
      }
    }
    await self.clients.openWindow(target);
  } catch {
    try {
      await self.clients.openWindow(target);
    } catch {
      /* nothing further we can do */
    }
  }
}
