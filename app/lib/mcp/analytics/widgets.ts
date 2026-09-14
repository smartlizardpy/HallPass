/**
 * HallPass — the HTML cards an MCP Apps host renders.
 *
 * PURE: template strings and nothing else. `server.ts` registers them as
 * `ui://` resources and `tools.ts` points tools at them.
 *
 * ── HOW THIS RENDERS ──────────────────────────────────────────────────────
 * A TOOL DESCRIPTOR declares `_meta.ui.resourceUri: "ui://hallpass/report"` —
 * the descriptor, not the answer, which is the distinction that kept this from
 * ever working. A host that implements MCP Apps reads `tools/list`, fetches the
 * resource, drops the HTML in a sandboxed iframe, and then waits: it sends the
 * view nothing until the view has announced itself with `ui/initialize` and
 * `ui/notifications/initialized`. Only then does the tool's `structuredContent`
 * arrive, as the params of `ui/notifications/tool-result`.
 *
 * So there are three pieces here and each has its own docblock:
 * {@link REPORT_TOOL_META} and {@link REPORT_RESOURCE_META} say what to declare,
 * {@link REPORT_WIDGET_STYLE} wears the host's theme, and
 * {@link REPORT_WIDGET_SCRIPT} opens the channel.
 *
 * Reference: `modelcontextprotocol/ext-apps@specification/2026-01-26/apps.mdx`,
 * pinned here as {@link UI_PROTOCOL_VERSION}.
 *
 * ── WHY IT IS ONE SELF-CONTAINED FILE WITH NO BUILD STEP ──────────────────
 * No React, no bundler, no external fetch. Three reasons, and the third is the
 * one that decided it:
 *
 *   * The iframe is sandboxed and offline: the host's default CSP is
 *     `default-src 'none'` with `connect-src 'none'`, so anything loaded from
 *     the network would not merely be fragile — it would be dropped, silently,
 *     in somebody else's client, on a phone, where nobody can debug it.
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

/** The extension's own identifier, for the docs and for grep. */
export const UI_EXTENSION_ID = "io.modelcontextprotocol/ui";

/**
 * The wire version the card announces in `ui/initialize`.
 *
 * Pinned rather than inferred so the next person can diff the spec against this
 * file instead of re-deriving it. Source of truth:
 * `modelcontextprotocol/ext-apps@specification/2026-01-26/apps.mdx`, and
 * `LATEST_PROTOCOL_VERSION` in that repo's `src/spec.types.ts`.
 */
export const UI_PROTOCOL_VERSION = "2026-01-26";

/**
 * The deprecated flat alias for `ui.resourceUri`.
 *
 * Still written, and that is deliberate. The extension's own `constants.ts`
 * marks it deprecated and in the same breath tells hosts they "must check both
 * formats for compatibility" — and the official `registerAppTool` still emits
 * both. Sending only the nested form loses every host that has not migrated.
 */
const LEGACY_RESOURCE_URI_KEY = "ui/resourceUri";

/**
 * What a card-bearing tool DESCRIPTOR carries.
 *
 * ── WHY THE DESCRIPTOR AND NOT THE ANSWER ─────────────────────────────────
 * This is the whole bug that kept the card from ever rendering. A host reads
 * `tools/list` to learn which tools have a UI, fetches the resource, and only
 * then calls anything — so a link attached to a tool RESULT is a link nobody
 * ever looks for. The spec's normative example puts it here, and so does
 * `registerAppTool`.
 *
 * `visibility: ["model"]` narrows the default `["model", "app"]`. The default
 * advertises that the card may call these tools back; it has no interactive
 * surface and never does. One word to widen again if it ever gains a refresh
 * button, and a wrong annotation is worse than an absent one (`mcp/server.ts`).
 *
 * The `openai/` key is ChatGPT's own Apps SDK alias. Belt and braces rather
 * than load-bearing — ChatGPT reads the standard keys too — but it is one key.
 */
export const REPORT_TOOL_META: Readonly<Record<string, unknown>> = Object.freeze({
  ui: { resourceUri: REPORT_WIDGET_URI, visibility: ["model"] },
  [LEGACY_RESOURCE_URI_KEY]: REPORT_WIDGET_URI,
  "openai/outputTemplate": REPORT_WIDGET_URI,
});

/**
 * What the card's RESOURCE carries, on both `resources/list` and the
 * `resources/read` content item.
 *
 * ── NO `csp` KEY, AND THAT IS THE DECISION ────────────────────────────────
 * Omitting it makes the host apply its restrictive default — `default-src
 * 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';
 * img-src 'self' data:; connect-src 'none'` — which this document satisfies
 * exactly: one inline <style>, one inline <script>, inline SVG, and no network
 * use at all. Declaring domains it does not need would widen the sandbox for
 * nothing, and `widgets.test.ts` asserts the key stays absent.
 *
 * `prefersBorder: false` because the card paints its own page background and
 * its own bordered surfaces; a host frame around it would double the border.
 * Stated rather than left to default, which the spec recommends because hosts
 * differ.
 */
export const REPORT_RESOURCE_META: Readonly<Record<string, unknown>> = Object.freeze({
  ui: { prefersBorder: false },
});

/**
 * The card's stylesheet.
 *
 * ── IT WEARS THE HOST'S THEME, NOT ITS OWN ────────────────────────────────
 * Every colour, font and radius reads a host style variable first and falls
 * back to the HallPass value: `var(--color-background-primary, #f4f4f7)`. The
 * host sets those variables on the root element during the `ui/initialize`
 * handshake (`hostContext.styles.variables`), so the card sits inside somebody
 * else's chat rather than fighting it. Only names from the extension's own
 * variable enum are used — a made-up token is silently nothing.
 *
 * The fallbacks are the dashboard's own tokens, copied from `app/globals.css`
 * rather than approximated, so a card in a host that sends no variables is the
 * same object as the panel on /dashboard.
 *
 * Dark is handled twice on purpose: `prefers-color-scheme` for a host that
 * sends no theme, and `[data-theme="dark"]` for one that does. The media query
 * is guarded with `:not([data-theme="light"])` so an explicit host theme always
 * wins over the operating system's preference.
 *
 * `--brand` and the delta-pill colours stay HallPass's own in both. They are
 * brand, not chrome: a green pill has to read as "up" whatever the host looks
 * like.
 */
export const REPORT_WIDGET_STYLE = `
  :root {
    --background: #f4f4f7; --foreground: #1c1c28; --surface: #ffffff;
    --surface-2: #ececf3; --border: #e4e4ec; --muted: #6b6b7b;
    --brand: #7c2eef;
    --up-bg: #ecfdf5; --up-fg: #047857;      /* emerald-50 / emerald-700 */
    --down-bg: #fff1f2; --down-fg: #be123c;  /* rose-50 / rose-700 */
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --background: #131318; --foreground: #f4f4f7; --surface: #1c1c24;
      --surface-2: #26262f; --border: #33333f; --muted: #a0a0b0;
      --brand: #a78bfa;
      --up-bg: #052e21; --up-fg: #4ade80;
      --down-bg: #3f1220; --down-fg: #fb7185;
    }
  }
  :root[data-theme="dark"] {
    --background: #131318; --foreground: #f4f4f7; --surface: #1c1c24;
    --surface-2: #26262f; --border: #33333f; --muted: #a0a0b0;
    --brand: #a78bfa;
    --up-bg: #052e21; --up-fg: #4ade80;
    --down-bg: #3f1220; --down-fg: #fb7185;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 16px;
    background: var(--color-background-primary, var(--background));
    color: var(--color-text-primary, var(--foreground));
    font: var(--font-text-md-size, 14px)/1.5 var(--font-sans, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif);
    -webkit-font-smoothing: antialiased;
  }
  .brand { display: flex; align-items: baseline; gap: 2px; }
  .brand b { font-size: 15px; font-weight: 900; letter-spacing: -0.02em; color: var(--brand); }
  .brand i { width: 5px; height: 5px; border-radius: 999px; background: #ffc700; display: inline-block; }
  .brand span { margin-left: 8px; font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--color-text-secondary, var(--muted)); }

  h1 { margin: 12px 0 0; font-size: var(--font-heading-lg-size, 22px); font-weight: 900; letter-spacing: -0.02em; }
  .sub { margin: 3px 0 0; color: var(--color-text-secondary, var(--muted)); font-size: 13px; }

  .stats { display: grid; gap: 12px; margin-top: 16px; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
  .stat {
    display: flex; flex-direction: column;
    border: 1px solid var(--color-border-primary, var(--border));
    border-radius: var(--border-radius-lg, 12px);
    background: var(--color-background-secondary, var(--surface));
    padding: 16px;
  }
  .stat .label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--color-text-secondary, var(--muted)); }
  .stat .row { margin-top: 4px; display: flex; align-items: flex-end; justify-content: space-between; gap: 8px; }
  .stat .value { font-size: 28px; font-weight: 900; line-height: 1.1; font-variant-numeric: tabular-nums; }
  .stat .hint { margin-top: auto; padding-top: 12px; font-size: 11px; font-weight: 500; color: var(--color-text-secondary, var(--muted)); }
  .pill {
    margin-bottom: 4px; display: inline-flex; align-items: center; gap: 2px;
    border-radius: var(--border-radius-full, 999px); padding: 2px 7px; font-size: 11px; font-weight: 700;
    font-variant-numeric: tabular-nums; white-space: nowrap;
  }
  .pill.up { background: var(--up-bg); color: var(--up-fg); }
  .pill.down { background: var(--down-bg); color: var(--down-fg); }
  .pill.none { background: transparent; color: var(--color-text-secondary, var(--muted)); padding-left: 0; padding-right: 0; }
  .spark { margin-top: 12px; height: 40px; width: 100%; }
  .spark svg { display: block; width: 100%; height: 100%; }

  section {
    margin-top: 18px; padding: 16px;
    border: 1px solid var(--color-border-primary, var(--border));
    border-radius: var(--border-radius-lg, 12px);
    background: var(--color-background-secondary, var(--surface));
  }
  section h2 { margin: 0 0 10px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--color-text-secondary, var(--muted)); }
  .wrap { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--color-border-primary, var(--border)); white-space: nowrap; }
  th { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: var(--color-text-secondary, var(--muted)); font-weight: 700; }
  tbody tr:last-child td { border-bottom: 0; }
  td:not(:first-child) { font-variant-numeric: tabular-nums; }
  td:first-child { font-weight: 600; }

  .notes { margin: 16px 0 0; padding: 0; list-style: none; }
  .notes li { color: var(--color-text-secondary, var(--muted)); font-size: 11.5px; margin-top: 5px; padding-left: 14px; position: relative; }
  .notes li::before { content: "—"; position: absolute; left: 0; }
  .src {
    display: inline-block; margin-top: 14px; padding: 7px 14px;
    border: 0; border-radius: var(--border-radius-full, 999px);
    background: var(--brand); color: #fff; font: inherit; font-size: 12px; font-weight: 800;
    text-decoration: none; cursor: pointer;
  }
  .srcnote { margin: 14px 0 0; font-size: 11.5px; color: var(--color-text-secondary, var(--muted)); word-break: break-all; }
  .empty { color: var(--color-text-secondary, var(--muted)); font-size: 13px; }
`;
/**
 * The card's script: an MCP Apps view, hand-rolled.
 *
 * ── WHY THE HANDSHAKE IS THE WHOLE FIX ────────────────────────────────────
 * This document used to listen passively for `message` events and hope a
 * payload turned up. It never did, and the spec says why: a host MUST NOT send
 * any request or notification to a view before it has received that view's
 * `ui/notifications/initialized`. A view that never announces itself is a view
 * that is never spoken to. So the order below is load-bearing:
 *
 *   view → host   ui/initialize                    (a request, with an id)
 *   host → view   result { hostCapabilities, hostContext }
 *   view → host   ui/notifications/initialized     (the gate)
 *   host → view   ui/notifications/tool-result     { content, structuredContent }
 *
 * `ui/notifications/initialized` is sent AFTER the initialize result resolves,
 * never before, or the host is answering a view that has not finished asking.
 *
 * ── WHY IT IS HAND-ROLLED AND NOT `@modelcontextprotocol/ext-apps` ────────
 * The package would work — its peer range admits this repo's SDK — but its
 * `App` class is an ESM module with `zod` in its graph, so bundling it into one
 * self-contained HTML string means Vite plus `vite-plugin-singlefile`. That is
 * the second toolchain this file's header refuses, in a repo whose whole build
 * is `next build`. The surface actually needed is small and pinned: three
 * notifications out, one request out, three messages in. The spec blesses this
 * directly — "you don't need an SDK to talk MCP with the host".
 *
 * ── IT MUST NEVER HANG ────────────────────────────────────────────────────
 * A host that renders `ui://` HTML but does not implement the handshake still
 * has to get a card. So `window.openai.toolOutput` and the loose `postMessage`
 * envelope survive as fallbacks on the timeout path, and if nothing at all
 * arrives the card says so in words. An empty box is the one outcome that is
 * worse than a Markdown table.
 *
 * ── `postMessage(msg, "*")` IS CORRECT HERE ───────────────────────────────
 * Not a weakening. Hosts are recommended to run an intermediate sandbox-proxy
 * iframe on a DIFFERENT origin, so a view cannot know a target origin to name.
 * Nothing secret is ever posted: the card only sends its own size and the
 * dashboard URL the server already put in the payload.
 */
export const REPORT_WIDGET_SCRIPT = `
(function () {
  var root = document.getElementById("root");
  var PROTOCOL_VERSION = "${UI_PROTOCOL_VERSION}";
  /* How long to wait for the host to answer ui/initialize before falling back
     to the legacy readers. Short: a host that speaks the protocol answers in
     microseconds, and a host that does not never will. */
  var INIT_TIMEOUT_MS = 2000;
  /* How long to wait for a tool-result AFTER a successful handshake. Longer,
     because the host has told us it is coming. */
  var RESULT_TIMEOUT_MS = 6000;

  var nextId = 1;
  var pending = {};
  var hostCapabilities = {};
  var connected = false;
  var rendered = false;
  var payloadUrl = null;

  /* ── the wire ─────────────────────────────────────────────────────────── */

  function post(message) {
    try { window.parent.postMessage(message, "*"); } catch (e) { /* no host */ }
  }
  function notify(method, params) {
    post({ jsonrpc: "2.0", method: method, params: params || {} });
  }
  function request(method, params) {
    return new Promise(function (resolve, reject) {
      var id = nextId++;
      pending[id] = { resolve: resolve, reject: reject };
      post({ jsonrpc: "2.0", id: id, method: method, params: params || {} });
    });
  }
  /* ui/resource-teardown and ping are REQUESTS, not notifications. A view that
     ignores them leaves the host waiting on an answer that never comes. */
  function reply(id, result) {
    if (id === undefined || id === null) return;
    post({ jsonrpc: "2.0", id: id, result: result || {} });
  }

  /* ── drawing ──────────────────────────────────────────────────────────── */

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
     sandboxed iframe is a network dependency the CSP forbids anyway. */
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
    rendered = true;
    if (!data || data.kind !== "hallpass-report") {
      /* Never an empty box: say what happened, so the operator knows to switch
         cards off in the dashboard rather than assuming the data is missing. */
      root.innerHTML = '<p class="empty">This report could not be displayed as a card. ' +
        "The written answer above has the same numbers.</p>";
      sendSize();
      return;
    }
    payloadUrl = data.url || null;
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
    if (payloadUrl) {
      /* A sandboxed iframe is not granted allow-popups, so an anchor opening a
         new tab is inert here — the host has to open the link for us, and only
         if it said it could. A dead button is worse than a URL somebody can
         select, hence the two branches. */
      html += hostCapabilities.openLinks
        ? '<button class="src" type="button" id="open">Open in the dashboard</button>'
        : '<p class="srcnote">Read it on the dashboard: ' + esc(payloadUrl) + "</p>";
    }
    root.innerHTML = html;
    var button = document.getElementById("open");
    if (button) {
      button.addEventListener("click", function () {
        request("ui/open-link", { url: payloadUrl }).catch(function () {});
      });
    }
    sendSize();
  }

  /* ── the host's theme ─────────────────────────────────────────────────── */

  function applyContext(context) {
    if (!context) return;
    var el = document.documentElement;
    if (context.theme === "light" || context.theme === "dark") {
      el.setAttribute("data-theme", context.theme);
      el.style.colorScheme = context.theme;
    }
    var vars = context.styles && context.styles.variables;
    if (vars) {
      for (var key in vars) {
        if (Object.prototype.hasOwnProperty.call(vars, key) && vars[key] != null) {
          el.style.setProperty(key, String(vars[key]));
        }
      }
    }
    sendSize();
  }

  /* ── telling the host how tall we are ─────────────────────────────────── */

  var sizeScheduled = false, lastWidth = 0, lastHeight = 0;
  function sendSize() {
    if (!connected || sizeScheduled) return;
    sizeScheduled = true;
    var raf = window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };
    raf(function () {
      sizeScheduled = false;
      var html = document.documentElement;
      /* max-content, not fit-content: fit-content clamps to the viewport
         height when the content is taller than the iframe, which makes the
         card scroll inside itself instead of asking to grow. */
      var previous = html.style.height;
      html.style.height = "max-content";
      var height = Math.ceil(html.getBoundingClientRect().height);
      html.style.height = previous;
      /* Width from innerWidth rather than measured: setting html width to
         fit-content forces a reflow at 0px, which permanently clamps the
         scrollLeft of every horizontal scroller — and the tables here are in
         .wrap containers that scroll horizontally. */
      var width = Math.ceil(window.innerWidth);
      /* Only on a real change, or the host's resize and ours feed each other. */
      if (width !== lastWidth || height !== lastHeight) {
        lastWidth = width;
        lastHeight = height;
        notify("ui/notifications/size-changed", { width: width, height: height });
      }
    });
  }

  function watchSize() {
    sendSize();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", sendSize);
      return;
    }
    var observer = new ResizeObserver(sendSize);
    observer.observe(document.documentElement);
    observer.observe(document.body);
  }

  /* ── reading a result ─────────────────────────────────────────────────── */

  function payloadOf(params) {
    if (!params) return null;
    if (params.structuredContent) return params.structuredContent;
    /* Second chance: a host that forwards only the text blocks. */
    var content = params.content || [];
    for (var i = 0; i < content.length; i++) {
      var block = content[i];
      if (block && block.type === "text" && typeof block.text === "string") {
        try {
          var parsed = JSON.parse(block.text);
          if (parsed && parsed.kind === "hallpass-report") return parsed;
        } catch (e) { /* the text is Markdown, which is the normal case */ }
      }
    }
    return null;
  }

  /* The pre-handshake readers, kept for a host that renders ui:// HTML without
     implementing the extension. Demoted to the fallback path, never deleted. */
  function fromLegacyGlobal() {
    try {
      if (window.openai && window.openai.toolOutput) return window.openai.toolOutput;
    } catch (e) { /* the host may not expose it */ }
    return null;
  }
  function fromLegacyMessage(message) {
    var candidate = message.toolOutput || message.structuredContent ||
      (message.params && (message.params.toolOutput || message.params.structuredContent)) ||
      (message.payload && (message.payload.toolOutput || message.payload.structuredContent)) ||
      message.payload || message;
    return candidate && candidate.kind === "hallpass-report" ? candidate : null;
  }

  window.addEventListener("message", function (event) {
    var message = event && event.data;
    if (!message || typeof message !== "object") return;

    if (message.jsonrpc !== "2.0") {
      var legacy = fromLegacyMessage(message);
      if (legacy) render(legacy);
      return;
    }

    if (message.id !== undefined && message.id !== null && pending[message.id]) {
      var waiter = pending[message.id];
      delete pending[message.id];
      if (message.error) waiter.reject(message.error); else waiter.resolve(message.result);
      return;
    }

    switch (message.method) {
      case "ui/notifications/tool-result": {
        var payload = payloadOf(message.params);
        if (payload) render(payload);
        break;
      }
      case "ui/notifications/host-context-changed":
        applyContext(
          message.params && message.params.hostContext ? message.params.hostContext : message.params,
        );
        break;
      case "ui/resource-teardown":
      case "ping":
        reply(message.id, {});
        break;
    }
  });

  /* ── boot ─────────────────────────────────────────────────────────────── */

  request("ui/initialize", {
    appInfo: { name: "HallPass report", version: "1" },
    appCapabilities: { availableDisplayModes: ["inline"] },
    protocolVersion: PROTOCOL_VERSION,
  }).then(function (result) {
    connected = true;
    hostCapabilities = (result && result.hostCapabilities) || {};
    applyContext(result && result.hostContext);
    /* THE GATE. Everything the host has for us is held until this lands. */
    notify("ui/notifications/initialized", {});
    watchSize();
    setTimeout(function () { if (!rendered) render(null); }, RESULT_TIMEOUT_MS);
  }).catch(function () { /* handled by the timeout below */ });

  var initial = fromLegacyGlobal();
  if (initial) render(initial);

  setTimeout(function () {
    if (rendered || connected) return;
    var late = fromLegacyGlobal();
    render(late || null);
  }, INIT_TIMEOUT_MS);
})();
`;

/**
 * The card, as one self-contained document.
 *
 * Composed from {@link REPORT_WIDGET_STYLE} and {@link REPORT_WIDGET_SCRIPT}
 * rather than written inline, so both halves can be asserted by a unit test —
 * the style for what it must never contain (no external URL, no stylesheet
 * link, nothing the host's restrictive default CSP would silently drop) and the
 * script for the handshake vocabulary it must never lose.
 *
 * No build step, no bundler, no network. Three reasons, and the third decided
 * it: the iframe is sandboxed and offline, a second toolchain for one HTML file
 * is not worth it in a repo whose whole build is `next build`, and IT HAS TO
 * DEGRADE — handed nothing, the card must still say something rather than
 * showing the empty box that `output-mode.ts` exists to let an operator escape.
 */
export const REPORT_WIDGET_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>HallPass report</title>
<style>${REPORT_WIDGET_STYLE}</style>
</head>
<body>
<div id="root"><p class="empty">Loading the report…</p></div>
<script>${REPORT_WIDGET_SCRIPT}</script>
</body>
</html>`;
