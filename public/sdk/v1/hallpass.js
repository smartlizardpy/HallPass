/*!
 * HallPass Arcade SDK v1
 * https://hallpass.gg/sdk/v1/hallpass.js
 *
 * Drop-in leaderboard client for browser games. Works in two modes, auto-detected:
 *   1. Embedded  — your game runs in an <iframe> on HallPass. Scores are relayed
 *                  to the parent window via postMessage; the parent knows the slug.
 *   2. Standalone — your game runs anywhere else (your own site, itch, etc.).
 *                  Scores go over HTTP to the HallPass API. You provide the slug.
 *
 * GOLDEN RULE: this SDK NEVER throws. If anything is misconfigured or the network
 * is down, every method degrades to a safe no-op so a dead leaderboard can never
 * break your game.
 *
 * Quick start (standalone):
 *   <script src="https://hallpass.gg/sdk/v1/hallpass.js" data-game="your-slug"></script>
 *   <script> HallPass.submitScore(1234); </script>
 *
 * Full docs: https://hallpass.gg/llms-full.txt
 */
(function () {
  "use strict";

  if (typeof window === "undefined") return;
  if (window.HallPass) return; // already loaded

  var MSG_SOURCE = "hallpass";
  var DEFAULT_API = "https://hallpass.gg";
  var HANDLE_KEY = "hallpass:handle";
  var HANDLE_RE = /^[A-Za-z0-9 _-]{1,12}$/;

  /* ------------------------------ tiny utils ------------------------------ */

  function noop() {}

  function safeWarn(msg) {
    try {
      if (window.console && console.warn) console.warn("[HallPass] " + msg);
    } catch (e) {
      /* ignore */
    }
  }

  // Read config from window.HALLPASS_CONFIG and/or the <script> data-* attrs.
  function readConfig() {
    var cfg = { game: null, api: DEFAULT_API };
    try {
      var w = window.HALLPASS_CONFIG;
      if (w && typeof w === "object") {
        if (typeof w.game === "string") cfg.game = w.game;
        if (typeof w.api === "string" && w.api) cfg.api = w.api;
      }
    } catch (e) {
      /* ignore */
    }
    try {
      // Prefer the currently-executing script; fall back to a query.
      var el = document.currentScript;
      if (!el) {
        var scripts = document.getElementsByTagName("script");
        for (var i = 0; i < scripts.length; i++) {
          var src = scripts[i].getAttribute("src") || "";
          if (src.indexOf("hallpass.js") !== -1) {
            el = scripts[i];
            break;
          }
        }
      }
      if (el) {
        var g = el.getAttribute("data-game");
        var a = el.getAttribute("data-api");
        if (g) cfg.game = g;
        if (a) cfg.api = a;
      }
    } catch (e) {
      /* ignore */
    }
    // Normalize api base (strip trailing slash).
    if (cfg.api && cfg.api.charAt(cfg.api.length - 1) === "/") {
      cfg.api = cfg.api.slice(0, -1);
    }
    return cfg;
  }

  // Embedded = we are inside an iframe (window.parent !== window). We always
  // postMessage to the parent in that case; the parent decides whether it's a
  // HallPass host. Standalone = top window, or no parent.
  function detectEmbedded() {
    try {
      return window.parent && window.parent !== window;
    } catch (e) {
      // Cross-origin access to window.parent can throw; if so we still have a
      // parent, so treat as embedded.
      return true;
    }
  }

  /* ------------------------------ identity -------------------------------- */

  function getHandle() {
    try {
      var h = window.localStorage.getItem(HANDLE_KEY);
      return h && HANDLE_RE.test(h) ? h : null;
    } catch (e) {
      return null;
    }
  }

  function setHandle(value) {
    var clean = sanitizeHandle(value);
    try {
      window.localStorage.setItem(HANDLE_KEY, clean);
    } catch (e) {
      /* storage may be blocked; non-fatal */
    }
    return clean;
  }

  function sanitizeHandle(value) {
    if (typeof value !== "string") return "ANON";
    var cleaned = value.replace(/[^A-Za-z0-9 _-]/g, "").slice(0, 12).trim();
    return cleaned && HANDLE_RE.test(cleaned) ? cleaned : "ANON";
  }

  // Get a handle, prompting once for 3-letter initials if none stored.
  // Falls back to "ANON" if prompt is unavailable (mobile, sandboxed, etc.).
  function ensureHandle() {
    var existing = getHandle();
    if (existing) return existing;
    var entered = null;
    try {
      if (typeof window.prompt === "function") {
        entered = window.prompt("Enter your initials for the leaderboard (3 letters):", "");
      }
    } catch (e) {
      entered = null;
    }
    var clean = sanitizeHandle(entered || "ANON");
    setHandle(clean);
    return clean;
  }

  /* ------------------------------ event bus ------------------------------- */

  var listeners = { ready: [], scores: [], submitted: [], error: [] };

  function on(event, cb) {
    if (listeners[event] && typeof cb === "function") {
      listeners[event].push(cb);
    }
    return api; // chainable
  }

  function emit(event, payload) {
    var cbs = listeners[event];
    if (!cbs) return;
    for (var i = 0; i < cbs.length; i++) {
      try {
        cbs[i](payload);
      } catch (e) {
        /* a bad listener must not break the SDK */
      }
    }
  }

  /* ------------------------------ transports ------------------------------ */

  var config = readConfig();
  var embedded = detectEmbedded();
  var readyState = { ready: false, game: config.game, handle: getHandle() };

  // Pending getScores() promises keyed by a token, resolved when the parent
  // replies (embedded mode only).
  var pending = {};
  var tokenSeq = 0;

  function nextToken() {
    tokenSeq += 1;
    return "t" + tokenSeq + "_" + Date.now();
  }

  function postToParent(msg) {
    try {
      msg.source = MSG_SOURCE;
      window.parent.postMessage(msg, "*");
      return true;
    } catch (e) {
      return false;
    }
  }

  // --- HTTP transport (standalone) ---

  function httpGetScores(opts) {
    var slug = config.game;
    if (!slug) {
      safeWarn("getScores: no game slug configured (set data-game or HALLPASS_CONFIG.game)");
      return Promise.resolve([]);
    }
    var limit = opts && opts.limit ? opts.limit : 10;
    var period = opts && opts.period ? opts.period : "all";
    var url =
      config.api +
      "/api/v1/leaderboard/" +
      encodeURIComponent(slug) +
      "?limit=" +
      encodeURIComponent(limit) +
      "&period=" +
      encodeURIComponent(period);
    return fetch(url, { method: "GET" })
      .then(function (res) {
        if (!res.ok) return { scores: [] };
        return res.json();
      })
      .then(function (data) {
        var scores = (data && data.scores) || [];
        emit("scores", { game: slug, scores: scores });
        return scores;
      })
      .catch(function () {
        return [];
      });
  }

  function httpSubmitScore(score, opts) {
    var slug = config.game;
    if (!slug) {
      safeWarn("submitScore: no game slug configured (set data-game or HALLPASS_CONFIG.game)");
      return Promise.resolve({ ok: false });
    }
    var handle = ensureHandle();
    var url =
      config.api + "/api/v1/leaderboard/" + encodeURIComponent(slug);
    var payload = { score: score, handle: handle };
    if (opts && opts.meta) payload.meta = opts.meta;
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        return res.json().then(
          function (data) {
            return { ok: res.ok, data: data };
          },
          function () {
            return { ok: res.ok, data: {} };
          }
        );
      })
      .then(function (r) {
        if (r.ok && r.data && r.data.ok) {
          emit("submitted", { rank: r.data.rank });
          return { ok: true, rank: r.data.rank };
        }
        emit("error", {
          message: (r.data && r.data.error) || "Submit failed",
        });
        return { ok: false, error: r.data && r.data.error };
      })
      .catch(function () {
        emit("error", { message: "Network error" });
        return { ok: false };
      });
  }

  // --- postMessage transport (embedded) ---

  function pmSubmitScore(score, opts) {
    var msg = { type: "score", score: score };
    if (opts && opts.meta) msg.meta = opts.meta;
    var ok = postToParent(msg);
    // We resolve optimistically; the parent emits 'submitted' when it has a rank.
    return Promise.resolve({ ok: ok, pending: true });
  }

  function pmGetScores(opts) {
    var token = nextToken();
    var msg = {
      type: "getScores",
      token: token,
      limit: (opts && opts.limit) || 10,
      period: (opts && opts.period) || "all",
    };
    return new Promise(function (resolve) {
      var settled = false;
      pending[token] = function (scores) {
        if (settled) return;
        settled = true;
        resolve(scores || []);
      };
      var sent = postToParent(msg);
      if (!sent) {
        delete pending[token];
        resolve([]);
        return;
      }
      // Safety timeout so the promise never hangs if the parent ignores us.
      setTimeout(function () {
        if (settled) return;
        settled = true;
        delete pending[token];
        resolve([]);
      }, 4000);
    });
  }

  // Listen for replies from the parent (embedded mode).
  function installParentListener() {
    try {
      window.addEventListener("message", function (event) {
        var data = event.data;
        if (!data || data.source !== MSG_SOURCE) return;
        switch (data.type) {
          case "ready":
            readyState.ready = true;
            if (data.game) readyState.game = config.game = data.game;
            if (data.handle) readyState.handle = data.handle;
            emit("ready", { game: readyState.game, handle: readyState.handle });
            break;
          case "scores":
            // Resolve a pending getScores() if a token round-trips; also emit.
            if (data.token && pending[data.token]) {
              var cb = pending[data.token];
              delete pending[data.token];
              cb(data.scores || []);
            }
            emit("scores", { game: data.game, scores: data.scores || [] });
            break;
          case "submitted":
            emit("submitted", { rank: data.rank });
            break;
          case "error":
            emit("error", { message: data.message || "Unknown error" });
            break;
          default:
            break;
        }
      });
    } catch (e) {
      /* ignore */
    }
  }

  /* ------------------------------ public API ------------------------------ */

  function ready(opts) {
    if (opts && typeof opts === "object") {
      if (typeof opts.game === "string" && opts.game) {
        config.game = readyState.game = opts.game;
      }
      if (typeof opts.api === "string" && opts.api) {
        config.api = opts.api.replace(/\/+$/, "");
      }
    }
    if (embedded) {
      // Announce ourselves to the parent; it replies with {ready, game, handle}.
      postToParent({ type: "ready" });
    } else {
      readyState.ready = true;
      emit("ready", { game: readyState.game, handle: getHandle() });
    }
    return Promise.resolve({ game: readyState.game, handle: getHandle() });
  }

  function submitScore(score, opts) {
    // Coerce + guard the score so a bad call can't throw.
    var n = Number(score);
    if (!isFinite(n) || n < 0) {
      safeWarn("submitScore: score must be a finite number >= 0");
      return Promise.resolve({ ok: false });
    }
    try {
      return embedded ? pmSubmitScore(n, opts) : httpSubmitScore(n, opts);
    } catch (e) {
      return Promise.resolve({ ok: false });
    }
  }

  function getScores(opts) {
    try {
      return embedded ? pmGetScores(opts) : httpGetScores(opts);
    } catch (e) {
      return Promise.resolve([]);
    }
  }

  var api = {
    version: "1",
    ready: ready,
    submitScore: submitScore,
    getScores: getScores,
    getHandle: getHandle,
    setHandle: setHandle,
    on: on,
    // Read-only introspection, handy for debugging.
    _mode: embedded ? "embedded" : "standalone",
    _config: function () {
      return { game: config.game, api: config.api, embedded: embedded };
    },
  };

  // Wire everything up. Never throw out of init.
  try {
    if (embedded) installParentListener();
    window.HallPass = api;
    // Auto-run ready() on load so games can use events without boilerplate.
    ready();
  } catch (e) {
    // Last-resort: expose a fully no-op shim so HallPass is always defined.
    window.HallPass = {
      version: "1",
      ready: function () {
        return Promise.resolve({});
      },
      submitScore: function () {
        return Promise.resolve({ ok: false });
      },
      getScores: function () {
        return Promise.resolve([]);
      },
      getHandle: function () {
        return null;
      },
      setHandle: noop,
      on: function () {
        return this;
      },
    };
  }
})();
