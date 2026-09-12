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

/**
 * One headline number on a card — the same anatomy as the dashboard's own
 * `StatCard`: an uppercase label, a heavy tabular number, a delta pill beside
 * it and either a sparkline or a hint line beneath.
 */
export type WidgetStat = {
  label: string;
  value: string;
  /** The unit, window or caveat. Rendered as the hint line under the number. */
  note?: string;
  /**
   * Percentage change against the previous equal period, or `null` for "no
   * baseline" — which the dashboard renders as "— new" rather than as 0%,
   * because "grew from nothing" is not a percentage.
   */
  deltaPct?: number | null;
  /** The previous period's value, shown on the pill's tooltip as it is on the site. */
  deltaPrev?: string;
  /** A trailing series, drawn exactly where the dashboard draws its sparkline. */
  spark?: number[];
  /** Brand colour for the sparkline. Defaults to HallPass purple. */
  sparkColor?: string;
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
  /* The dashboard's own tokens, copied from app/globals.css rather than
     approximated, so a card in somebody else's chat window is the same object
     as the panel on /dashboard. */
  :root {
    --background: #f4f4f7; --foreground: #1c1c28; --surface: #ffffff;
    --surface-2: #ececf3; --border: #e4e4ec; --muted: #6b6b7b;
    --brand: #7c2eef; --brand-50: #f1e9ff;
    --up-bg: #ecfdf5; --up-fg: #047857;      /* emerald-50 / emerald-700 */
    --down-bg: #fff1f2; --down-fg: #be123c;  /* rose-50 / rose-700 */
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --background: #131318; --foreground: #f4f4f7; --surface: #1c1c24;
      --surface-2: #26262f; --border: #33333f; --muted: #a0a0b0;
      --brand: #a78bfa; --brand-50: #2a1d46;
      --up-bg: #052e21; --up-fg: #4ade80;
      --down-bg: #3f1220; --down-fg: #fb7185;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 16px; background: var(--background); color: var(--foreground);
    font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  /* The wordmark, as the dashboard sidebar draws it: lowercase, heavy, with the
     yellow dot. */
  .brand { display: flex; align-items: baseline; gap: 2px; }
  .brand b { font-size: 15px; font-weight: 900; letter-spacing: -0.02em; color: var(--brand); }
  .brand i { width: 5px; height: 5px; border-radius: 999px; background: #ffc700; display: inline-block; }
  .brand span { margin-left: 8px; font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }

  h1 { margin: 12px 0 0; font-size: 22px; font-weight: 900; letter-spacing: -0.02em; }
  .sub { margin: 3px 0 0; color: var(--muted); font-size: 13px; }

  .stats { display: grid; gap: 12px; margin-top: 16px; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
  .stat {
    display: flex; flex-direction: column;
    border: 1px solid var(--border); border-radius: 12px; background: var(--surface); padding: 16px;
  }
  .stat .label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
  .stat .row { margin-top: 4px; display: flex; align-items: flex-end; justify-content: space-between; gap: 8px; }
  .stat .value { font-size: 28px; font-weight: 900; line-height: 1.1; font-variant-numeric: tabular-nums; }
  .stat .hint { margin-top: auto; padding-top: 12px; font-size: 11px; font-weight: 500; color: var(--muted); }
  .pill {
    margin-bottom: 4px; display: inline-flex; align-items: center; gap: 2px;
    border-radius: 999px; padding: 2px 7px; font-size: 11px; font-weight: 700;
    font-variant-numeric: tabular-nums; white-space: nowrap;
  }
  .pill.up { background: var(--up-bg); color: var(--up-fg); }
  .pill.down { background: var(--down-bg); color: var(--down-fg); }
  .pill.none { background: transparent; color: var(--muted); padding-left: 0; padding-right: 0; }
  .spark { margin-top: 12px; height: 40px; width: 100%; }
  .spark svg { display: block; width: 100%; height: 100%; }

  section { margin-top: 18px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); padding: 16px; }
  section h2 { margin: 0 0 10px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
  .wrap { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); white-space: nowrap; }
  th { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); font-weight: 700; }
  tbody tr:last-child td { border-bottom: 0; }
  td:not(:first-child) { font-variant-numeric: tabular-nums; }
  td:first-child { font-weight: 600; }

  .notes { margin: 16px 0 0; padding: 0; list-style: none; }
  .notes li { color: var(--muted); font-size: 11.5px; margin-top: 5px; padding-left: 14px; position: relative; }
  .notes li::before { content: "—"; position: absolute; left: 0; }
  a.src {
    display: inline-block; margin-top: 14px; padding: 7px 14px; border-radius: 999px;
    background: var(--brand); color: #fff; font-size: 12px; font-weight: 800; text-decoration: none;
  }
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

  /* The dashboard's DeltaBadge: a pill, up in emerald and down in rose, and
     "— new" rather than a percentage when there is no baseline to divide by. */
  function pill(stat) {
    if (stat.deltaPct === undefined) return "";
    if (stat.deltaPct === null) return '<span class="pill none">— new</span>';
    var up = stat.deltaPct >= 0;
    var abs = Math.abs(stat.deltaPct);
    var shown = abs >= 100 ? Math.round(abs) : Math.round(abs * 10) / 10;
    var title = stat.deltaPrev ? ' title="Previous period: ' + esc(stat.deltaPrev) + '"' : "";
    return '<span class="pill ' + (up ? "up" : "down") + '"' + title + '>' +
      (up ? "▲" : "▼") + " " + shown + "%</span>";
  }

  /* An inline-SVG version of the dashboard's Recharts sparkline: a thin line
     over a fading fill. Hand-drawn because a charting library inside a
     sandboxed iframe is a network dependency that can fail on a phone. */
  function spark(values, color) {
    if (!values || values.length < 2) return "";
    var w = 160, h = 40, pad = 2;
    var max = Math.max.apply(null, values), min = Math.min.apply(null, values);
    var span = max - min || 1;
    var step = (w - pad * 2) / (values.length - 1);
    var pts = values.map(function (v, i) {
      var x = pad + i * step;
      var y = pad + (h - pad * 2) * (1 - (v - min) / span);
      return x.toFixed(1) + "," + y.toFixed(1);
    });
    var id = "g" + Math.random().toString(36).slice(2, 8);
    return '<div class="spark"><svg viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none">' +
      "<defs><linearGradient id='" + id + "' x1='0' y1='0' x2='0' y2='1'>" +
      "<stop offset='0%' stop-color='" + color + "' stop-opacity='0.3'/>" +
      "<stop offset='100%' stop-color='" + color + "' stop-opacity='0'/></linearGradient></defs>" +
      "<polygon fill='url(#" + id + ")' points='" + pad + "," + (h - pad) + " " + pts.join(" ") + " " + (w - pad) + "," + (h - pad) + "'/>" +
      "<polyline fill='none' stroke='" + color + "' stroke-width='2' stroke-linejoin='round' stroke-linecap='round' points='" + pts.join(" ") + "'/>" +
      "</svg></div>";
  }

  function statCard(s) {
    var body = '<div class="label">' + esc(s.label) + "</div>" +
      '<div class="row"><div class="value">' + esc(s.value) + "</div>" + pill(s) + "</div>";
    if (s.spark && s.spark.length > 1) body += spark(s.spark, s.sparkColor || "#7c2eef");
    else if (s.note) body += '<div class="hint">' + esc(s.note) + "</div>";
    return '<div class="stat">' + body + "</div>";
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
      /* Never an empty box: say what happened, so the operator knows to switch
         cards off in the dashboard rather than assuming the data is missing. */
      root.innerHTML = '<p class="empty">This report could not be displayed as a card. ' +
        "The written answer above has the same numbers.</p>";
      return;
    }
    var html = '<div class="brand"><b>hallpass</b><i></i><span>Analytics</span></div>';
    html += "<h1>" + esc(data.title) + "</h1>";
    if (data.subtitle) html += '<p class="sub">' + esc(data.subtitle) + "</p>";
    if (data.stats && data.stats.length) {
      html += '<div class="stats">' + data.stats.map(statCard).join("") + "</div>";
    }
    (data.tables || []).forEach(function (t) { html += table(t); });
    if (data.notes && data.notes.length) {
      html += '<ul class="notes">' + data.notes.map(function (note) {
        return "<li>" + esc(note) + "</li>";
      }).join("") + "</ul>";
    }
    if (data.url) html += '<a class="src" href="' + esc(data.url) + '" target="_blank" rel="noreferrer">Open in the dashboard</a>';
    root.innerHTML = html;
  }

  /* Hosts differ and the extension is young, so read the payload from every
     place one might arrive, and take whichever lands first. */
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
    /* The MCP Apps bridge speaks JSON-RPC over postMessage; claude.ai has also
       been observed injecting a non-JSON-RPC {type, token, payload} envelope,
       so both shapes are tolerated rather than assumed. */
    var candidate = d.toolOutput || d.structuredContent ||
      (d.params && (d.params.toolOutput || d.params.structuredContent)) ||
      (d.payload && (d.payload.toolOutput || d.payload.structuredContent)) || d.payload || d;
    if (candidate && candidate.kind === "hallpass-report") render(candidate);
  });

  /* If nothing has arrived shortly after mount, say so rather than spinning. */
  setTimeout(function () {
    if (!fromHost() && root.querySelector(".empty")) render(null);
  }, 1500);
})();
</script>
</body>
</html>`;
