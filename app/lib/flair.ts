/**
 * HallPass — admin-granted player flair ("custom perks").
 *
 * PURE AND DEPENDENCY-FREE, like `badges.ts`: types, the tone whitelist, input
 * normalisation, and a row mapper — no `server-only`, no `@/app/lib/db`. The
 * store that reads and writes the `player_flair` table lives in `flair-store.ts`;
 * keeping this half pure means it unit-tests in the plain `node` env and can be
 * imported by both the store and the (server-only) profile reader without either
 * pulling a database client into the other's import graph.
 *
 * WHAT A FLAIR IS. A short title an admin CONFERS on a player from the dashboard
 * — "Beta Tester", "Founder", "Staff". It is neither derived (as `badges.ts`
 * argues platform badges should be) nor earned (as `achievements` are, reported
 * by a game): it is an editorial act, so the grant is stored and carries who made
 * it. See `flair.sql` for the table.
 */

/** Longest a flair label may be, in characters. Matches the badge-pill scale. */
export const MAX_FLAIR_LABEL = 24;

/** Longest a flair icon may be. Emoji can be several code points (ZWJ sequences). */
export const MAX_FLAIR_ICON = 8;

/**
 * The pill colour buckets. Whitelisted here AND in the `player_flair_tone_check`
 * CHECK constraint in `flair.sql`/`014_player_flair.sql`; the two are kept in
 * lockstep by hand. The names are colours rather than meanings ("staff",
 * "vip", ...) so an admin can dress any label however reads best without the set
 * of tones growing every time a new kind of flair is invented.
 */
export const FLAIR_TONES = ["brand", "gold", "green", "blue", "pink", "gray"] as const;

export type FlairTone = (typeof FLAIR_TONES)[number];

/** The default tone when none is chosen — the site's own brand purple. */
export const DEFAULT_FLAIR_TONE: FlairTone = "brand";

/** A flair as rendered on a profile. No `player_id`, no `granted_by`. */
export type Flair = {
  id: number;
  label: string;
  icon: string | null;
  tone: FlairTone;
};

/** A normalised, ready-to-store flair (no id yet). */
export type FlairInput = {
  label: string;
  icon: string | null;
  tone: FlairTone;
};

/** Why {@link normalizeFlairInput} rejected an admin's entry. */
export type FlairInputError = "empty-label" | "label-too-long" | "bad-tone";

export type FlairValidation =
  | { ok: true; value: FlairInput }
  | { ok: false; reason: FlairInputError };

/** Narrow an untrusted string to a {@link FlairTone}, else `null`. */
export function toFlairTone(value: unknown): FlairTone | null {
  return typeof value === "string" && (FLAIR_TONES as readonly string[]).includes(value)
    ? (value as FlairTone)
    : null;
}

/**
 * Strip anything that would render as an invisible, reordering, or control glyph
 * from an admin-authored string, then collapse whitespace. Shared shape with
 * `sanitizeHandle` in `players.ts`, and here for the same reason: a flair label
 * is printed on a public profile beside a child's name, so a bidi override or a
 * zero-width run in it is a defacement vector even though only an admin can type
 * it. `collapse` keeps internal spaces (a label is "Beta Tester") for the label
 * and drops them entirely for the icon.
 */
function scrub(raw: string, collapse: " " | ""): string {
  return (
    raw
      // C0/C1 control characters + DEL.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
      // Zero-width spaces/joiners + BOM — would render blank.
      .replace(/[\u200b-\u200d\ufeff]/g, "")
      // Bidirectional overrides/isolates — can visually reorder a public row.
      .replace(/[\u202a-\u202e\u2066-\u2069]/g, "")
      .replace(/\s+/g, collapse)
      .trim()
  );
}

/**
 * Turn a dashboard form's raw fields into a stored {@link FlairInput}, or a
 * reason it cannot be. The label is scrubbed and length-checked; a blank icon
 * becomes `null`; the tone must be on the whitelist (a missing tone defaults, but
 * a present-and-wrong one is rejected so a hand-crafted POST cannot smuggle an
 * off-palette value past the CHECK constraint and 500).
 */
export function normalizeFlairInput(raw: {
  label: string;
  icon?: string | null;
  tone?: string | null;
}): FlairValidation {
  const label = scrub(raw.label ?? "", " ");
  if (label.length === 0) return { ok: false, reason: "empty-label" };
  if (label.length > MAX_FLAIR_LABEL) return { ok: false, reason: "label-too-long" };

  const iconScrubbed = scrub(raw.icon ?? "", "").slice(0, MAX_FLAIR_ICON);
  const icon = iconScrubbed.length > 0 ? iconScrubbed : null;

  // A missing tone is fine (defaults); a supplied one must be legal.
  const rawTone = raw.tone == null || raw.tone === "" ? DEFAULT_FLAIR_TONE : raw.tone;
  const tone = toFlairTone(rawTone);
  if (tone === null) return { ok: false, reason: "bad-tone" };

  return { ok: true, value: { label, icon, tone } };
}

/**
 * Decode a `player_flair` row into the public {@link Flair} shape. Tone falls
 * back to the default rather than throwing: a value that somehow escaped the
 * CHECK constraint should degrade to a valid pill, not take a profile page down.
 */
export function mapFlairRow(row: Record<string, unknown>): Flair {
  return {
    id: Number(row.id),
    label: String(row.label),
    icon: row.icon == null ? null : String(row.icon),
    tone: toFlairTone(row.tone) ?? DEFAULT_FLAIR_TONE,
  };
}
