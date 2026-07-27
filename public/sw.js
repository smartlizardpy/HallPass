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
      await self.clients.claim();
    })(),
  );
  // Fire-and-forget: don't block activation on N upstream fetches.
  event.waitUntil(
    refreshAllGameHtml().catch(() => {}),
  );
});

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
  // profile. `/play/account` renders the signed-in player's EMAIL, and `/u/...`
  // renders a specific person's profile. Caching either means the next user of a
  // shared school machine can be served the previous user's page from the cache
  // the moment the network hiccups. Any future route that renders one specific
  // player's data belongs in this list.
  //
  // `/play/friends` is intentionally NOT here: its server shell is PII-free and
  // all viewer data arrives from `/api/` (never intercepted), so it can be
  // precached and still work offline without leaking anything.
  if (
    url.pathname.startsWith("/admin") ||
    url.pathname.startsWith("/dashboard") ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/play/account") ||
    url.pathname.startsWith("/u/") ||
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

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (isCacheable(res)) {
      const cache = await caches.open(RUNTIME_CACHE);
      await cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  } catch {
    const cached = await caches.match(req);
    if (cached) return cached;

    // Fallback chain: the precached /offline document, THEN "/" but only for a
    // request that actually IS "/".
    //
    // Why "/" is no longer a universal fallback: it used to answer ANY
    // unsatisfiable navigation, so opening an uncached URL offline rendered the
    // arcade homepage UNDER THAT URL — e.g. /u/someone or /game/silence/ (which
    // `skipTrailingSlashRedirect: true` keeps as a distinct, never-precached
    // URL) would silently show the catalog instead of an offline message, and
    // the served HTML's RSC payload disagrees with the router's expected route.
    // A wrong page is worse than an honest one.
    const offline = await caches.match("/offline");
    if (offline) return offline;
    const url = new URL(req.url);
    if (url.pathname === "/") {
      const home = await caches.match("/");
      if (home) return home;
    }
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
