/**
 * HallPass — how the analytics tools present their answers.
 *
 * PURE and free of `server-only`, like every other rule here, so the fallback
 * logic is unit-tested rather than discovered in a client that shows an empty
 * box.
 *
 * ── WHY THIS IS A SETTING AND NOT A CONSTANT ──────────────────────────────
 * MCP Apps (SEP-1865) lets a tool attach an HTML widget: the tool answers with
 * text for the model AND a `ui://` resource the host renders in a sandboxed
 * iframe. Done right that is a genuine card instead of a wall of numbers.
 *
 * Support for it is uneven, and the failure mode is not a graceful fallback.
 * ChatGPT renders widgets today. Claude's own tracker carries
 * `anthropics/claude-ai-mcp#471` — a spec-correct custom remote connector whose
 * widget never renders — closed as not planned, and `claude-code#65653`
 * reports a **labelled but completely empty container** rather than the text.
 * An empty box is strictly worse than a Markdown table: the person sees a
 * broken feature instead of their answer.
 *
 * So which of the two a client gets is an operator decision, taken from what
 * they can actually see on their own screen, and changed without a deploy.
 * `app_settings` is the right home for exactly the reason its own header gives:
 * a key that has never been written simply is not there, and the reader
 * supplies the default.
 *
 * ── THE TEXT IS ALWAYS SENT ───────────────────────────────────────────────
 * In every mode. In `widget` and `auto` it is the fallback the MCP Apps spec
 * expects a host to show when it cannot render the resource, and it is what the
 * MODEL reads in all cases — a widget is for the person, never for the model.
 * The setting only decides whether the widget metadata rides along.
 */

/** The `app_settings` key. Namespaced like every other key in that table. */
export const OUTPUT_MODE_KEY = "mcp:output_mode";

/** What an operator may choose. */
export const OUTPUT_MODES = ["auto", "widget", "markdown"] as const;
export type OutputMode = (typeof OUTPUT_MODES)[number];

/**
 * What an unwritten key means.
 *
 * `auto` rather than `widget`, because the cost of being wrong is asymmetric: a
 * client that would have rendered a card shows a good Markdown table instead,
 * which is a mild loss, whereas a client that cannot render one shows an empty
 * box, which reads as broken. Defaulting to the outcome that is never broken is
 * the same instinct as `MCP_OAUTH_ENABLED` defaulting off.
 */
export const DEFAULT_OUTPUT_MODE: OutputMode = "auto";

/** Narrow a stored string, falling back to the default for anything unknown. */
export function toOutputMode(value: unknown): OutputMode {
  return OUTPUT_MODES.includes(value as OutputMode)
    ? (value as OutputMode)
    : DEFAULT_OUTPUT_MODE;
}

/**
 * The client names and origins known to render MCP Apps widgets.
 *
 * ── WHY THIS IS MATCHED ON HEADERS AND NOT ON `clientInfo` ────────────────
 * A client names itself in `initialize`, which would be the right signal — and
 * is unavailable here. The transport is STATELESS (`app/api/mcp/route.ts`): a
 * new server is built per request, `tools/list` arrives as its own HTTP request
 * carrying no memory of the `initialize` before it, and `tools/list` is exactly
 * where a tool's widget metadata has to be decided. So the only per-request
 * evidence of who is calling is the HTTP headers.
 *
 * That makes `auto` A COARSE GUESS, and it is worth being blunt about it rather
 * than implying a negotiation that does not exist. The protocol has no "I
 * render `ui://` resources" capability at all — MCP Apps is an extension, and a
 * host that does not implement it is supposed to ignore the `_meta`. The two
 * reliable controls are the operator's own eyes, which is why `widget` and
 * `markdown` override this entirely and why the dashboard says so.
 */
export const WIDGET_CAPABLE_HINTS = ["chatgpt", "openai", "chat.openai.com"] as const;

/**
 * A lowercase hint for who is calling, from `Origin` then `User-Agent`.
 *
 * `Origin` first because it is the more trustworthy of the two: a browser sets
 * it and a page cannot forge it, whereas a User-Agent is whatever the caller
 * typed. Neither is a security control here — the worst a spoofed hint achieves
 * is a card in a client that cannot draw one, which the operator fixes with the
 * setting.
 */
export function clientHintFrom(headers: Headers): string {
  const origin = headers.get("origin")?.trim();
  const agent = headers.get("user-agent")?.trim();
  return `${origin ?? ""} ${agent ?? ""}`.toLowerCase().trim();
}

/**
 * Should this request carry widget metadata?
 *
 * `widget` and `markdown` are absolute — an operator who has looked at their
 * own screen outranks any guess this module could make, and that is the whole
 * point of the setting existing. Only `auto` consults the hint.
 */
export function shouldSendWidgets(mode: OutputMode, hint: string | null): boolean {
  if (mode === "markdown") return false;
  if (mode === "widget") return true;
  const value = (hint ?? "").toLowerCase();
  if (!value) return false;
  return WIDGET_CAPABLE_HINTS.some((known) => value.includes(known));
}

/** What the dashboard explains each choice means. */
export const OUTPUT_MODE_LABEL: Record<OutputMode, string> = {
  auto: "Automatic",
  widget: "Always send cards",
  markdown: "Text only",
};

export const OUTPUT_MODE_HINT: Record<OutputMode, string> = {
  auto:
    "Send cards only to clients that look like ones known to render them (ChatGPT today), and formatted text to everyone else. A coarse guess from the request headers — the protocol offers nothing better — but it is the choice that is never broken.",
  widget:
    "Send cards to every client. Pick this once you have seen a client render one. If it cannot, it may show an empty box instead of your answer.",
  markdown:
    "Never send cards, only formatted text. Pick this if a client is showing empty boxes, or if you simply prefer reading tables.",
};
