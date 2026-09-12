/**
 * HallPass — rendering tool answers as Markdown.
 *
 * PURE and free of `server-only`, so the escaping rules below are unit-tested
 * rather than discovered in a broken table.
 *
 * ── WHY MARKDOWN AND NOT `JSON.stringify` ─────────────────────────────────
 * Every tool here used to answer with pretty-printed JSON, which is the obvious
 * choice and the wrong one. Three reasons, in order of how much they cost:
 *
 *   * IT IS WHAT THE PERSON SEES. Claude renders a tool result's text, and for
 *     a custom remote connector it is the ONLY thing it renders — MCP Apps
 *     widgets are not supported there (anthropics/claude-ai-mcp#471, closed as
 *     not planned), so a JSON blob is the whole experience.
 *   * IT IS WHAT THE MODEL READS. A nested object costs far more tokens than
 *     the same numbers as a table, and invites the model to restate the
 *     structure instead of answering the question.
 *   * A TABLE CARRIES UNITS AND CAVEATS. `{"plays": 141}` says nothing about
 *     the window or the source; "**141** plays — last 30 days, PostHog" does.
 *
 * The structured data does not go away: the tools send BOTH, Markdown as the
 * text a human and a model read and `structuredContent` as the machine-readable
 * copy. The two exceptions are `search` and `fetch`, whose text block must be
 * the JSON mirror of `structuredContent` because ChatGPT's connector contract
 * says so.
 */

/** The most columns a generated table will show before it stops adding any. */
export const MAX_TABLE_COLUMNS = 8;

/** The most rows a generated table will show. */
export const MAX_TABLE_ROWS = 50;

/** The longest a single cell may be before it is truncated. */
export const MAX_CELL_LENGTH = 120;

/**
 * Make a value safe inside a Markdown table cell.
 *
 * A pipe ends a cell and a newline ends the ROW, so an un-escaped value
 * containing either does not render badly — it silently shifts every
 * subsequent column, which is the kind of wrong that looks plausible. Review
 * bodies and game descriptions contain both.
 */
export function mdCell(value: unknown): string {
  if (value == null) return "—";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  const flat = text.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
  if (!flat) return "—";
  return flat.length > MAX_CELL_LENGTH ? `${flat.slice(0, MAX_CELL_LENGTH - 1)}…` : flat;
}

/** A Markdown pipe table. Returns `""` for no rows, so callers can branch. */
export function mdTable(headers: string[], rows: unknown[][]): string {
  if (headers.length === 0 || rows.length === 0) return "";
  const head = `| ${headers.map(mdCell).join(" | ")} |`;
  const rule = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.map(mdCell).join(" | ")} |`);
  return [head, rule, ...body].join("\n");
}

/**
 * Render arbitrary result rows as a table.
 *
 * Columns come from the FIRST row, not the union of all of them: a SQL result
 * set is rectangular, and deriving the header from a union would invent columns
 * for rows that happen to carry a null the driver omitted.
 *
 * Truncation is REPORTED rather than silent, because a model that reads a
 * clipped table as the whole answer will state a total that is exactly the cap.
 */
export function mdRows(
  rows: Record<string, unknown>[],
  { maxRows = MAX_TABLE_ROWS, maxColumns = MAX_TABLE_COLUMNS } = {},
): string {
  if (rows.length === 0) return "_No rows._";

  const allColumns = Object.keys(rows[0]);
  const columns = allColumns.slice(0, maxColumns);
  const shown = rows.slice(0, maxRows);

  const table = mdTable(
    columns,
    shown.map((row) => columns.map((column) => row[column])),
  );

  const notes: string[] = [];
  if (rows.length > shown.length) {
    notes.push(`_Showing ${shown.length} of ${rows.length} rows._`);
  }
  if (allColumns.length > columns.length) {
    notes.push(
      `_${allColumns.length - columns.length} further column(s) omitted: ${allColumns
        .slice(maxColumns)
        .join(", ")}._`,
    );
  }
  return [table, ...notes].filter(Boolean).join("\n\n");
}

/** A `## ` heading. */
export function mdHeading(text: string, level = 2): string {
  return `${"#".repeat(Math.min(Math.max(level, 1), 6))} ${text}`;
}

/** A bullet list, skipping blanks so callers can inline conditionals. */
export function mdList(items: (string | null | undefined | false)[]): string {
  const kept = items.filter((item): item is string => Boolean(item));
  return kept.map((item) => `- ${item}`).join("\n");
}

/** Join sections, collapsing the blank runs that conditionals leave behind. */
export function mdSections(sections: (string | null | undefined | false)[]): string {
  return sections
    .filter((section): section is string => Boolean(section))
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** `**141**` — a number that should catch the eye in a sentence. */
export function mdNumber(value: number): string {
  return `**${new Intl.NumberFormat("en-US").format(Math.round(value))}**`;
}

/**
 * A labelled `name: value` line with an optional trailing note.
 *
 * The note is where the unit and the caveat go — the thing a bare number in
 * JSON could never carry.
 */
export function mdStat(label: string, value: string, note?: string): string {
  return note ? `${label}: ${value} — _${note}_` : `${label}: ${value}`;
}
