/**
 * HallPass — survey vocabulary.
 *
 * Mirrors `tracker/config.ts`: pure, no `server-only`, no database. Read by the
 * store, the dashboard pages, the server actions, the public routes AND the MCP
 * tools, so the kinds and limits one draws cannot drift from the ones another
 * accepts.
 *
 * Whenever a value here changes, the matching CHECK in BOTH
 * `scoreboard/migrations/037_surveys.sql` and `surveys/schema.sql` changes with
 * it. `config.test.ts` pins the invariants a mismatch would break.
 *
 * WHO MAY EDIT. There is deliberately no survey-specific role. Writing a survey
 * is "changing something outside the beta programme", which is exactly the rung
 * `permissions.ts` already names {@link SITE_WRITE_ROLE}; a second constant
 * holding the same value would only give the two a chance to drift. Every guard
 * (the dashboard actions, the MCP tools) and every hidden control reads
 * `canEditSite`.
 */

// ---------------------------------------------------------------------------
// Statuses
// ---------------------------------------------------------------------------

/**
 * Where a survey is in its life.
 *
 * `draft`  — being written; invisible to players.
 * `live`   — accepting answers; the one status the banner and `/survey/[slug]`
 *            serve.
 * `closed` — finished; answers kept and still readable by admins, no longer
 *            offered. Separate from archiving, which only hides it from the list.
 */
export const SURVEY_STATUSES = ["draft", "live", "closed"] as const;
export type SurveyStatus = (typeof SURVEY_STATUSES)[number];

export const SURVEY_STATUS_LABEL: Record<SurveyStatus, string> = {
  draft: "Draft",
  live: "Live",
  closed: "Closed",
};

export const SURVEY_STATUS_HINT: Record<SurveyStatus, string> = {
  draft: "Being written, players cannot see it",
  live: "Players can answer it now",
  closed: "No longer accepting answers",
};

/** Written out in full: Tailwind v4 scans source text for class names. */
export const SURVEY_STATUS_CHIP_CLASS: Record<SurveyStatus, string> = {
  draft: "bg-surface-2 text-muted",
  live: "bg-emerald-100 text-emerald-800",
  closed: "bg-amber-100 text-amber-900",
};

export function toSurveyStatus(value: unknown): SurveyStatus | null {
  return (SURVEY_STATUSES as readonly string[]).includes(String(value))
    ? (value as SurveyStatus)
    : null;
}

// ---------------------------------------------------------------------------
// Question kinds
// ---------------------------------------------------------------------------

/**
 * The four shapes of question v1 supports. Ordering is the order a builder
 * offers them in.
 */
export const QUESTION_KINDS = ["single", "multi", "scale", "text"] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

export const QUESTION_KIND_LABEL: Record<QuestionKind, string> = {
  single: "Single choice",
  multi: "Multiple choice",
  scale: "1–5 rating",
  text: "Free text",
};

/** Kinds that carry an option list. */
export function hasOptions(kind: QuestionKind): boolean {
  return kind === "single" || kind === "multi";
}

export function toQuestionKind(value: unknown): QuestionKind | null {
  return (QUESTION_KINDS as readonly string[]).includes(String(value))
    ? (value as QuestionKind)
    : null;
}

// ---------------------------------------------------------------------------
// Limits — each mirrors a CHECK constraint
// ---------------------------------------------------------------------------

export const SURVEY_TITLE_MAX = 140;
export const SURVEY_INTRO_MAX = 2000;
export const QUESTION_PROMPT_MAX = 300;

/** A choice question needs something to choose between. */
export const OPTIONS_MIN = 2;
export const OPTIONS_MAX = 12;
export const OPTION_LABEL_MAX = 80;

/** A survey long enough to need more than this is a survey nobody finishes. */
export const QUESTIONS_MAX = 30;

export const SCALE_MIN = 1;
export const SCALE_MAX = 5;

/**
 * Free-text answers are checked by the reviews validator (contact info, links,
 * flooding, blocked words), so they inherit ITS length cap rather than the
 * column's 2000. See `validate.ts`.
 */

// ---------------------------------------------------------------------------
// Slugs
// ---------------------------------------------------------------------------

/** Mirrors the `surveys_slug_format` CHECK. */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;

/**
 * Turn a title (or a typed slug) into a slug: lowercase, hyphenated, ASCII.
 * Returns `null` when nothing usable is left, so the caller can say so rather
 * than inserting an empty string the CHECK would reject.
 */
export function toSlug(raw: string): string | null {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48)
    .replace(/-$/, "");
  return SLUG_PATTERN.test(slug) ? slug : null;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** One choice. `id` is stable: answers store it, never the label. */
export type SurveyOption = { id: string; label: string };

/**
 * Parse an option list typed one per line (or comma separated in an MCP call
 * that passes a string). Trims, drops blanks and case-insensitive duplicates,
 * and caps the length of each label and the number of options.
 *
 * Returns labels only; ids are assigned by {@link assignOptionIds} so an edit
 * can keep the ids of options whose label survived.
 */
export function parseOptionLabels(raw: string | readonly string[]): string[] {
  const parts = typeof raw === "string" ? raw.split(/\n/) : raw;
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const part of parts) {
    const label = part.trim().replace(/\s+/g, " ").slice(0, OPTION_LABEL_MAX);
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
    if (labels.length >= OPTIONS_MAX) break;
  }
  return labels;
}

/**
 * Give each label an id, reusing the id of an existing option with the same
 * label (case-insensitive) so an edit that merely reorders or adds options
 * never re-points an answer already stored against `o2`. New options get the
 * next unused `oN`.
 */
export function assignOptionIds(
  labels: readonly string[],
  existing: readonly SurveyOption[] = [],
): SurveyOption[] {
  const byLabel = new Map(existing.map((o) => [o.label.toLowerCase(), o.id]));
  const used = new Set<string>();
  let next = 1;
  const nextId = (): string => {
    while (used.has(`o${next}`) || existing.some((o) => o.id === `o${next}`)) next += 1;
    return `o${next}`;
  };
  return labels.map((label) => {
    const reuse = byLabel.get(label.toLowerCase());
    if (reuse && !used.has(reuse)) {
      used.add(reuse);
      return { id: reuse, label };
    }
    const id = nextId();
    used.add(id);
    return { id, label };
  });
}

export type QuestionCheck =
  | { ok: true; prompt: string; optionLabels: string[] }
  | { ok: false; error: string };

/**
 * The rules for what a question may say, in ONE place for every door that can
 * write one (the dashboard action and the MCP tools), so "a choice question
 * needs two options" cannot be true for one and not the other.
 *
 * `options` is ignored for scale and text questions, which carry none. The
 * database CHECKs are the backstop; this is where a bad field becomes a message
 * instead of a failed insert.
 */
export function checkQuestion(
  kind: QuestionKind,
  prompt: unknown,
  options: string | readonly string[] | undefined,
): QuestionCheck {
  const text = String(prompt ?? "").trim().slice(0, QUESTION_PROMPT_MAX);
  if (!text) return { ok: false, error: "A question needs some text." };

  if (!hasOptions(kind)) return { ok: true, prompt: text, optionLabels: [] };

  const optionLabels = parseOptionLabels(options ?? []);
  if (optionLabels.length < OPTIONS_MIN) {
    return { ok: false, error: `Give at least ${OPTIONS_MIN} different options.` };
  }
  return { ok: true, prompt: text, optionLabels };
}

/** Narrow a jsonb value read back from the database to an option list. */
export function toOptions(value: unknown): SurveyOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const { id, label } = entry as { id?: unknown; label?: unknown };
    return typeof id === "string" && typeof label === "string" ? [{ id, label }] : [];
  });
}

// ---------------------------------------------------------------------------
// Close dates
// ---------------------------------------------------------------------------

/**
 * A `YYYY-MM-DD` date as the END of that day (UTC), or `null` when blank or
 * malformed.
 *
 * End-of-day because "closes on the 14th" means players can still answer on the
 * 14th. Never throws on a bad date: an unparseable field is "no close date", not
 * a failed save of everything else on the form. A real calendar check, so
 * `2026-02-31` is `null` rather than silently rolling into March.
 */
export function closesAtFromDate(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T23:59:59.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10) === raw ? date.toISOString() : null;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export const SURVEYS_DASHBOARD_PATH = "/dashboard/surveys";
