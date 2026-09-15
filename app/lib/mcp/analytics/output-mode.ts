/**
 * HallPass — how the analytics tools present their answers.
 *
 * PURE and free of `server-only`, like every other rule here, so the decision is
 * unit-tested rather than discovered in a client that shows an empty box.
 *
 * ── WHAT MCP APPS ACTUALLY ASKS OF A SERVER ───────────────────────────────
 * MCP Apps (SEP-1865, stable since 2026-01-26 as the extension
 * `io.modelcontextprotocol/ui`) lets a TOOL declare a `ui://` resource on its
 * descriptor. A host that implements the extension reads `tools/list`, fetches
 * that resource, renders it in a sandboxed iframe and hands it the tool's
 * `structuredContent`. A host that does not implement it is required to ignore
 * the unrecognised `_meta` and show the text — `_meta` is the protocol's
 * designated ignore-me channel, and that is exactly what makes declaring safe.
 *
 * ── WHY THIS NO LONGER GUESSES WHO IS CALLING ─────────────────────────────
 * It used to. `WIDGET_CAPABLE_HINTS` matched `Origin` and `User-Agent` against
 * a list of clients believed to render cards, and it was wrong twice over:
 *
 *   * THE EVIDENCE IS NOT THERE. ChatGPT and Claude call an MCP server from
 *     their BACKENDS, not from a browser. There is no `Origin` on a tool call
 *     and the `User-Agent` is generic, so the hint was empty and `auto` read
 *     empty as "not known". The default mode never sent a card to anything —
 *     including the one client the list was written for.
 *   * THE LIST NAMED THE WRONG HOSTS. It withheld cards from Claude by name,
 *     while the extension's own client matrix records Claude (web and desktop),
 *     ChatGPT, Cursor, VS Code Copilot, Goose and others as implementing it.
 *
 * So the guess is gone. Every answer declares its card and each host decides,
 * which is what the spec asks for and the only arrangement that does not
 * depend on this file knowing things it cannot know.
 *
 * For the record, and contrary to what this module used to assert: the protocol
 * DOES have a capability for this. A client may advertise
 * `capabilities.extensions["io.modelcontextprotocol/ui"]` at `initialize`, and
 * per request in `params._meta["io.modelcontextprotocol/clientCapabilities"]` —
 * the latter would even survive this deployment's stateless transport. Reading
 * it means parsing the JSON-RPC body ahead of the transport in the auth path
 * for a signal almost nothing sends yet, so it is deferred rather than denied.
 * `analytics-mcp-design.md` §9 carries it as an open question.
 *
 * ── WHY THE SETTING SURVIVES AT ALL ───────────────────────────────────────
 * One operator-visible escape hatch, changed without a deploy, for the host
 * nobody anticipated. If a client ever draws a broken box, `markdown` turns the
 * declaration off on the next request. That is the whole job, and it is why
 * there are two modes rather than three: "automatic" described a guess that no
 * longer happens, and a setting with two names for one behaviour is a ceremony.
 *
 * ── THE TEXT IS ALWAYS SENT ───────────────────────────────────────────────
 * In both modes. It is the fallback the spec expects a host to show when it
 * cannot render the resource, and it is what the MODEL reads in all cases — a
 * card is for the person, never for the model. The setting only decides whether
 * the card is declared alongside it.
 */

/** The `app_settings` key. Namespaced like every other key in that table. */
export const OUTPUT_MODE_KEY = "mcp:output_mode";

/** What an operator may choose. */
export const OUTPUT_MODES = ["cards", "markdown"] as const;
export type OutputMode = (typeof OUTPUT_MODES)[number];

/**
 * What an unwritten key means.
 *
 * `cards` now, where it used to be the withhold-by-default guess. The old
 * default's premise — that withholding was "never broken" — held only because
 * the card itself was broken: it never declared itself where a host looks, and
 * never opened the handshake a host waits for. With both fixed and the card
 * degrading in words when it is handed nothing, the asymmetry that justified
 * defaulting to silence is gone.
 */
export const DEFAULT_OUTPUT_MODE: OutputMode = "cards";

/**
 * Narrow a stored string.
 *
 * `auto` and `widget` are the pre-2026 names and both meant "declare where we
 * think it will render", so both narrow to `cards`. That is the migration
 * contract for rows already sitting in `app_settings`, and it has its own test:
 * an operator who chose a mode once should not silently get a different one.
 */
export function toOutputMode(value: unknown): OutputMode {
  if (value === "markdown") return "markdown";
  return DEFAULT_OUTPUT_MODE;
}

/**
 * Does this answer declare its card?
 *
 * The only question left. No client hint, because there is no client hint worth
 * reading — see the header.
 */
export function shouldDeclareUi(mode: OutputMode): boolean {
  return mode !== "markdown";
}

/** What the dashboard explains each choice means. */
export const OUTPUT_MODE_LABEL: Record<OutputMode, string> = {
  cards: "Cards",
  markdown: "Text only",
};

export const OUTPUT_MODE_HINT: Record<OutputMode, string> = {
  cards:
    "Offer the card to every app, and let each one decide. Apps that implement " +
    "MCP Apps draw the report as tiles and tables; every other app ignores the " +
    "offer and shows the same formatted text it always did.",
  markdown:
    "Never offer the card, only formatted text. Pick this if an app is showing " +
    "an empty box, or if you simply prefer reading tables.",
};
