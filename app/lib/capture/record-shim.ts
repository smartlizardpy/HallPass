/**
 * HallPass — the script injected into a game page so it can be recorded.
 *
 * ── WHY THIS HAS TO RUN BEFORE THE GAME ─────────────────────────────────────
 * Video needs nothing from inside the page: `canvas.captureStream()` works from
 * the parent. Audio does. A game wires its sound graph at startup, and a node that
 * is already connected to `AudioContext.destination` cannot be tapped afterwards —
 * there is no handle to the destination's input. The only way to hear what a game
 * plays is to be present when it connects, which means running first.
 * `/game-html/<slug>/?hp-rec=1` is how the route puts this script in the page; see
 * the route's docblock for why nothing else could.
 *
 * ── WHAT IT DOES ────────────────────────────────────────────────────────────
 *  1. AUDIO. Patches `AudioNode.prototype.connect` so that a connection to a
 *     destination is ALSO made to a per-context `MediaStreamAudioDestinationNode`.
 *     The original connection still happens, so the tester hears the game as
 *     normal. The parent mixes the collected streams into the recording.
 *     Known limit: a node the game later `disconnect()`s from the destination
 *     keeps feeding the recording.
 *  2. SDK EVENTS. Wraps `HallPass.submitScore` / `progress` in place (call time
 *     and value — the `submitted` event carries no score) and listens for
 *     `achievement`. `window.HallPass` is a setter because it is assigned TWICE:
 *     first the inline stub, then the real client, which then replays the stub's
 *     queued calls into itself. Calls made while that replay runs are skipped,
 *     otherwise every early call would be logged by the stub wrapper AND the
 *     real one.
 *  3. VISIBILITY. A hidden tab throttles the game's frame loop, which shows up as
 *     a hole in the video; the event makes the hole explicable.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 * It must never break a game. Everything is inside try/catch, nothing is awaited,
 * and it is idempotent. Game errors are NOT collected here: `ErrorLog` already
 * collects them from the parent.
 *
 * The source is a plain string with no imports because it is serialised into
 * someone else's HTML. It deliberately avoids backslashes and backticks so it
 * survives being embedded verbatim.
 */

/** The shim, as the body of an immediately-invoked function over `window`. */
export const RECORD_SHIM_SOURCE = `(function (w) {
  try {
    if (w.__hpRec) return;
    var hp = (w.__hpRec = { version: 1, streams: [], onEvent: null, onStream: null });
    var epoch = function () { return w.performance.timeOrigin + w.performance.now(); };
    var emit = function (type, source, data) {
      try {
        if (typeof hp.onEvent === "function") hp.onEvent({ at: epoch(), type: type, source: source, data: data });
      } catch (e) {}
    };

    // 1. AUDIO ---------------------------------------------------------------
    try {
      var AN = w.AudioNode;
      var ADN = w.AudioDestinationNode;
      if (AN && ADN && AN.prototype && typeof AN.prototype.connect === "function") {
        var taps = new WeakMap();
        var origConnect = AN.prototype.connect;
        AN.prototype.connect = function (target) {
          try {
            if (target instanceof ADN) {
              var ctx = target.context;
              var tap = taps.get(ctx);
              if (!tap && typeof ctx.createMediaStreamDestination === "function") {
                tap = ctx.createMediaStreamDestination();
                taps.set(ctx, tap);
                hp.streams.push(tap.stream);
                if (typeof hp.onStream === "function") hp.onStream(tap.stream);
              }
              if (tap) origConnect.call(this, tap);
            }
          } catch (e) {}
          return origConnect.apply(this, arguments);
        };
      }
    } catch (e) {}

    // 2. SDK EVENTS ----------------------------------------------------------
    try {
      var replaying = false;
      var wrapMethod = function (obj, name, before, after) {
        var orig = obj[name];
        if (typeof orig !== "function") return;
        obj[name] = function () {
          var skip = replaying;
          var args = arguments;
          try { if (!skip) before(args); } catch (e) {}
          var result = orig.apply(this, args);
          try {
            if (!skip && result && typeof result.then === "function") {
              result.then(function (r) { try { after(args, r); } catch (e) {} }, function () {});
            }
          } catch (e) {}
          return result;
        };
      };
      var wrapSdk = function (v) {
        try {
          if (!v || typeof v !== "object" || v.__hpWrapped) return;
          Object.defineProperty(v, "__hpWrapped", { value: true });
          var real = v.version !== "0";
          if (real) {
            replaying = true;
            w.setTimeout(function () { replaying = false; }, 0);
          }
          wrapMethod(v, "submitScore",
            function (a) { var s = Number(a[0]); emit("score.submit", "sdk", { score: isFinite(s) ? s : null }); },
            function (a, r) { emit("score.result", "sdk", { ok: !!(r && r.ok), rank: r && r.rank != null ? r.rank : null, reason: r && r.reason ? String(r.reason) : null }); });
          wrapMethod(v, "progress",
            function (a) { var n = Number(a[1]); emit("progress", "sdk", { key: String(a[0]), value: isFinite(n) ? n : null }); },
            function () {});
          if (real && typeof v.on === "function") {
            v.on("achievement", function (p) {
              p = p || {};
              emit("achievement", "sdk", { key: p.key == null ? null : String(p.key), name: p.name == null ? null : String(p.name), points: typeof p.points === "number" ? p.points : null });
            });
          }
        } catch (e) {}
      };
      ["HallPass", "HP"].forEach(function (key) {
        var current = w[key];
        Object.defineProperty(w, key, {
          configurable: true,
          enumerable: true,
          get: function () { return current; },
          set: function (v) { current = v; wrapSdk(v); }
        });
        if (current) wrapSdk(current);
      });
    } catch (e) {}

    // 3. VISIBILITY ----------------------------------------------------------
    try {
      w.document.addEventListener("visibilitychange", function () {
        emit("visibility", "game", { state: w.document.visibilityState });
      });
    } catch (e) {}
  } catch (e) {}
})(window);`;

/**
 * Put the shim at the very top of a game's HTML, ahead of every game script.
 *
 * After the opening `<head>` when there is one; otherwise at the very start,
 * after any doctype (a script before the doctype would throw the page into
 * quirks mode).
 */
export function injectShim(html: string): string {
  const tag = `<script data-hp-rec>${RECORD_SHIM_SOURCE}</script>`;
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + tag + html.slice(at);
  }
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  const at = doctype ? doctype[0].length : 0;
  return html.slice(0, at) + tag + html.slice(at);
}
