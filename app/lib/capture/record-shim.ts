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
 *     (1b) It also notes which context type each canvas was given — see below.
 *  2b. MOMENTS. Hands `HallPass.moment(...)` calls to `__hpRec.onMoment`, and
 *     wraps `requestAnimationFrame` so the hand-over happens at the END of the
 *     frame the game drew in - the one instant a WebGL canvas can be read back.
 *     The wrapper returns the same frame id and re-throws the game's errors, so
 *     `cancelAnimationFrame` and error handling behave as before.
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
    var hp = (w.__hpRec = { version: 1, streams: [], ctxTypes: new WeakMap(), onEvent: null, onStream: null, onMoment: null });
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
              // Same OUTPUT index as the game's own connection — a splitter or a
              // multi-output node connects output 1 to the destination on purpose,
              // and tapping output 0 instead would record the wrong signal. The
              // input index is for the destination (always 0) and does not carry
              // over to the tap.
              if (tap) {
                if (arguments.length > 1 && arguments[1] !== undefined) origConnect.call(this, tap, arguments[1]);
                else origConnect.call(this, tap);
              }
            }
          } catch (e) {}
          return origConnect.apply(this, arguments);
        };
      }
    } catch (e) {}

    // 1b. CANVAS CONTEXT TYPES ------------------------------------------------
    // The recorder wants to nudge a STILL 2D canvas into emitting a frame, which is
    // only safe on a canvas that already HAS a 2D context. Asking the canvas with
    // getContext("2d") is not a way to find out: on a canvas with no context it
    // CREATES one, and the game's own later getContext("webgl") then returns null.
    // So remember what the game itself asked for, and let the recorder look that up.
    try {
      var CE = w.HTMLCanvasElement;
      if (CE && CE.prototype && typeof CE.prototype.getContext === "function") {
        var origGetContext = CE.prototype.getContext;
        CE.prototype.getContext = function (type) {
          var ctx = origGetContext.apply(this, arguments);
          try {
            if (ctx && !hp.ctxTypes.has(this)) hp.ctxTypes.set(this, String(type));
          } catch (e) {}
          return ctx;
        };
      }
    } catch (e) {}

    // 2b. MOMENTS ------------------------------------------------------------
    // HallPass.moment(name, data, opts) asks for a picture of the game NOW. A WebGL
    // canvas is cleared once its frame has been shown, so a read taken from an
    // event handler (or before the game has drawn this frame) comes back blank.
    // The read has to happen at the END of a requestAnimationFrame callback, when
    // the game has just drawn. So a moment is held until the callback it was made
    // in finishes, or - made outside one - until the end of the NEXT one. A timer
    // flushes it anyway for a game with no animation loop or a hidden tab.
    // The arguments are forwarded RAW; the app side validates them.
    var momentQueue = [];
    var rafDepth = 0;
    var flushMoments = function (armedOnly) {
      try {
        var keep = [];
        for (var i = 0; i < momentQueue.length; i++) {
          var m = momentQueue[i];
          if (armedOnly && !m.armed) { keep.push(m); continue; }
          try { if (typeof hp.onMoment === "function") hp.onMoment(m.payload); } catch (e) {}
        }
        momentQueue = keep;
      } catch (e) {}
    };
    var queueMoment = function (args) {
      if (typeof hp.onMoment !== "function" || momentQueue.length >= 20) return;
      momentQueue.push({ armed: rafDepth > 0, payload: { at: epoch(), name: args[0], data: args[1], opts: args[2] } });
      if (typeof w.setTimeout === "function") w.setTimeout(function () { flushMoments(false); }, 250);
    };
    try {
      var origRaf = w.requestAnimationFrame;
      if (typeof origRaf === "function") {
        w.requestAnimationFrame = function (cb) {
          if (typeof cb !== "function") return origRaf.apply(w, arguments);
          return origRaf.call(w, function () {
            rafDepth++;
            for (var i = 0; i < momentQueue.length; i++) momentQueue[i].armed = true;
            try {
              return cb.apply(this, arguments);
            } finally {
              rafDepth--;
              if (rafDepth === 0) flushMoments(true);
            }
          });
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
          // ONLY the SDK. window.HP is a very common game variable (hit points, a
          // helper namespace) and window.HallPass could be anything a game put
          // there; wrapping methods on, or attaching listeners to, somebody else's
          // object would be interference. The SDK, stub or real, is the one thing
          // with a string-ish version and a submitScore function.
          if (typeof v.submitScore !== "function" || !("version" in v)) return;
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
          wrapMethod(v, "moment", function (a) { queueMoment(a); }, function () {});
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
 * Tokens that can CONTAIN the text `<head>` without being a head element, matched
 * whole so the scan below steps over them: comments, and the raw-text elements
 * (`script`, `style`, `title`, `textarea`) whose bodies are not markup. The
 * fourth alternative is the real thing.
 */
const HTML_SCAN =
  /<!--[\s\S]*?-->|<(script|style|title|textarea)\b[^>]*>[\s\S]*?<\/\1\s*>|(<head(?:\s[^>]*)?>)/gi;

/** The doctype, allowing comments before it. Matched at the very start only. */
const DOCTYPE = /^\s*(?:<!--[\s\S]*?-->\s*)*<!doctype[^>]*>/i;

/**
 * Where to insert: just after the real opening `<head>`, else just after the
 * doctype, else the very start. Never before the doctype — a script ahead of it
 * throws the page into quirks mode.
 */
function insertionPoint(html: string): number {
  const doctypeEnd = DOCTYPE.exec(html)?.[0].length ?? 0;
  HTML_SCAN.lastIndex = 0;
  for (let m = HTML_SCAN.exec(html); m; m = HTML_SCAN.exec(html)) {
    if (m[2]) return Math.max(doctypeEnd, m.index + m[2].length);
  }
  return doctypeEnd;
}

/**
 * Put the shim at the very top of a game's HTML, ahead of every game script.
 *
 * `baseHref` also injects `<base href>` ahead of the shim, so a document served
 * from `/game-html/<slug>/` resolves its relative URLs against `/games/<slug>/`
 * exactly as it does in production, where the same document is reached through
 * the 307. (`location.pathname` still differs; a base tag cannot change that.)
 * Skipped when the game already declares its own `<base>`.
 */
export function injectShim(html: string, options: { baseHref?: string } = {}): string {
  const at = insertionPoint(html);
  const base =
    options.baseHref && !/<base\s/i.test(html)
      ? `<base href="${options.baseHref.replace(/"/g, "&quot;")}">`
      : "";
  const tag = `${base}<script data-hp-rec>${RECORD_SHIM_SOURCE}</script>`;
  return html.slice(0, at) + tag + html.slice(at);
}
