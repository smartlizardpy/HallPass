/**
 * HallPass — the HTML cards an MCP Apps host renders.
 *
 * PURE: template strings and nothing else. `server.ts` registers them as
 * `ui://` resources and `tools.ts` points tools at them.
 *
 * ── HOW THIS RENDERS ──────────────────────────────────────────────────────
 * A tool declares `_meta.ui.resourceUri: "ui://hallpass/report"`. A host that
 * implements MCP Apps reads that resource, drops the HTML in a sandboxed
 * iframe, and hands the tool's `structuredContent` to it. The document below
 * reads that payload and draws a card.
 *
 * ── WHY IT IS ONE SELF-CONTAINED FILE WITH NO BUILD STEP ──────────────────
 * No React, no bundler, no external fetch. Three reasons, and the third is the
 * one that decided it:
 *
 *   * The iframe is sandboxed and offline-ish: anything it loads from the
 *     network is another thing that can fail in somebody else's client, on a
 *     phone, where nobody can debug it.
 *   * A build step for one HTML file would put a second toolchain in a repo
 *     whose whole build is `next build`.
 *   * IT HAS TO DEGRADE. If the host hands over nothing — a payload shape that
 *     changed, a host that renders the resource without data — the card must
 *     still say something rather than showing an empty box, which is precisely
 *     the failure `output-mode.ts` exists to let an operator escape.
 *
 * ── THE PAYLOAD CONTRACT ──────────────────────────────────────────────────
 * Every widget-bearing tool answers with `structuredContent` shaped as
 * {@link WidgetPayload}: a title, some stat tiles, and any number of tables.
 * ONE shape for every tool, not one widget per tool, because the alternative is
 * seven HTML documents that drift. What differs between an overview and a game
 * report is the rows, not the layout.
 */

/** One headline number on a card. */
export type WidgetStat = {
  label: string;
  value: string;
  /** The unit, window or caveat. Rendered small under the number. */
  note?: string;
  /** `up` / `down` colour the delta; omit for a number with no direction. */
  trend?: "up" | "down" | "flat";
};

/** A table on a card. */
export type WidgetTable = {
  title?: string;
  headers: string[];
  rows: (string | number | null)[][];
};

/** What a widget-bearing tool puts in `structuredContent`. */
export type WidgetPayload = {
  kind: "hallpass-report";
  title: string;
  subtitle?: string;
  stats?: WidgetStat[];
  tables?: WidgetTable[];
  /** Shown as a muted footnote — the caveats that travel with the numbers. */
  notes?: string[];
  /** Where to read the same thing on the site. */
  url?: string;
};

/** The one resource URI every widget-bearing tool points at. */
export const REPORT_WIDGET_URI = "ui://hallpass/report";

/** The MIME type MCP Apps uses to mark an HTML document as a widget. */
export const WIDGET_MIME_TYPE = "text/html;profile=mcp-app";

/**
 * The card.
 *
 * Styling is inline and deliberately NEUTRAL — system font stack, CSS custom
 * properties, `prefers-color-scheme` — rather than HallPass purple. It renders
 * inside somebody else's chat UI, and a card that fights the surrounding theme
 * reads as an advert rather than as an answer. The one brand touch is the
 * accent on the stat values.
 *
 * The payload is read from three places because hosts differ and the extension
 * is young: `window.openai.toolOutput` (ChatGPT), the MCP Apps bridge message,
 * and a `postMessage` fallback. Whichever arrives first wins; if none does, the
 * empty state below says so in words.
 */
export const REPORT_WIDGET_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>HallPass report</title>
<style>
  :root {
    --bg: #ffffff; --fg: #18181b; --muted: #71717a; --line: #e4e4e7;
    --surface: #fafafa; --accent: #7c2eef; --up: #15803d; --down: #b91c1c;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #18181b; --fg: #fafafa; --muted: #a1a1aa; --line: #3f3f46;
      --surface: #27272a; --accent: #a78bfa; --up: #4ade80; --down: #f87171;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 16px; background: var(--bg); color: var(--fg);
    font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  h1 { margin: 0; font-size: 16px; font-weight: 800; letter-spacing: -0.01em; }
  .sub { margin: 2px 0 0; color: var(--muted); font-size: 12px; }
  .stats {
    display: grid; gap: 8px; margin-top: 14px;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  }
  .stat { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; background: var(--surface); }
  .stat .label { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
  .stat .value { margin-top: 3px; font-size: 20px; font-weight: 800; font-variant-numeric: tabular-nums; color: var(--accent); }
  .stat .note { margin-top: 2px; font-size: 11px; color: var(--muted); }
  .stat.up .value { color: var(--up); } .stat.down .value { color: var(--down); }
  section { margin-top: 16px; }
  section h2 { margin: 0 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
  .wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 10px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--line); white-space: nowrap; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); font-weight: 600; }
  tr:last-child td { border-bottom: 0; }
  td:not(:first-child) { font-variant-numeric: tabular-nums; }
  .notes { margin: 14px 0 0; padding: 0; list-style: none; }
  .notes li { color: var(--muted); font-size: 11.5px; margin-top: 4px; }
  a.src { display: inline-block; margin-top: 12px; color: var(--accent); font-size: 12px; text-decoration: none; }
  a.src:hover { text-decoration: underline; }
  .empty { color: var(--muted); font-size: 13px; }
</style>
</head>
<body>
<div id="root"><p class="empty">Loading the report…</p></div>
<script>
(function () {
  var root = document.getElementById("root");

  function esc(value) {
    return String(value == null ? "—" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function table(t) {
    if (!t || !t.headers || !t.rows || !t.rows.length) return "";
    var head = t.headers.map(function (h) { return "<th>" + esc(h) + "</th>"; }).join("");
    var body = t.rows.map(function (row) {
      return "<tr>" + (row || []).map(function (cell) { return "<td>" + esc(cell) + "</td>"; }).join("") + "</tr>";
    }).join("");
    return "<section>" + (t.title ? "<h2>" + esc(t.title) + "</h2>" : "") +
      '<div class="wrap"><table><thead><tr>' + head + "</tr></thead><tbody>" + body + "</tbody></table></div></section>";
  }

  function render(data) {
    if (!data || data.kind !== "hallpass-report") {
      // Never an empty box: say what happened, so the operator knows to switch
      // this off in the dashboard rather than assuming the data is missing.
      root.innerHTML = '<p class="empty">This report could not be displayed as a card. ' +
        'The written answer above has the same numbers.</p>';
      return;
    }
    var html = "<h1>" + esc(data.title) + "</h1>";
    if (data.subtitle) html += '<p class="sub">' + esc(data.subtitle) + "</p>";

    if (data.stats && data.stats.length) {
      html += '<div class="stats">' + data.stats.map(function (s) {
        var cls = "stat" + (s.trend === "up" ? " up" : s.trend === "down" ? " down" : "");
        return '<div class="' + cls + '"><div class="label">' + esc(s.label) + "</div>" +
          '<div class="value">' + esc(s.value) + "</div>" +
          (s.note ? '<div class="note">' + esc(s.note) + "</div>" : "") + "</div>";
      }).join("") + "</div>";
    }

    (data.tables || []).forEach(function (t) { html += table(t); });

    if (data.notes && data.notes.length) {
      html += '<ul class="notes">' + data.notes.map(function (note) {
        return "<li>" + esc(note) + "</li>";
      }).join("") + "</ul>";
    }
    if (data.url) html += '<a class="src" href="' + esc(data.url) + '" target="_blank" rel="noreferrer">Open in the dashboard →</a>';
    root.innerHTML = html;
  }

  // Hosts differ and the extension is young, so read the payload from every
  // place one might arrive, and take whichever lands first.
  function fromHost() {
    try {
      if (window.openai && window.openai.toolOutput) return window.openai.toolOutput;
    } catch (e) { /* the host may not expose it */ }
    return null;
  }

  var initial = fromHost();
  if (initial) render(initial);

  window.addEventListener("message", function (event) {
    var d = event && event.data;
    if (!d) return;
    // The MCP Apps bridge speaks JSON-RPC over postMessage; claude.ai has also
    // been observed injecting a non-JSON-RPC {type, token, payload} envelope,
    // so both shapes are tolerated rather than assumed.
    var candidate = d.toolOutput || d.structuredContent ||
      (d.params && (d.params.toolOutput || d.params.structuredContent)) ||
      (d.payload && (d.payload.toolOutput || d.payload.structuredContent)) || d.payload || d;
    if (candidate && candidate.kind === "hallpass-report") render(candidate);
  });

  // If nothing has arrived shortly after mount, say so rather than spinning.
  setTimeout(function () {
    if (!fromHost() && root.querySelector(".empty")) render(null);
  }, 1500);
})();
</script>
</body>
</html>`;
