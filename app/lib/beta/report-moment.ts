/**
 * Which game-reported moment, if any, a bug report is allowed to keep.
 *
 * The tester's browser says "this screenshot was taken for the moment
 * `boss-phase-2` with this data". Both halves ultimately come from a game, so the
 * server judges them with the SDK's own rules rather than trusting the client to
 * have done so. Kept out of `submitReportAction` so the rule has a test that needs
 * no auth, Blob or database.
 *
 * Two conditions, both deliberate:
 *  - A moment is kept only when the report actually carries a picture. The moment
 *    describes the picture; on its own it is a label on nothing.
 *  - If EITHER half is invalid the whole moment is dropped, never half-stored. The
 *    report itself is unaffected - the tester's words are the point.
 */

import { parseMoment } from "@/sdk/src/moment";

export type ReportMoment = {
  /** Normalised moment name. */
  name: string;
  /** The game's data serialised for the row, or null when it passed none. */
  data: string | null;
};

export function reportMoment(
  name: unknown,
  data: unknown,
  hasPicture: boolean,
): ReportMoment | null {
  if (!hasPicture || name === null || name === undefined || name === "") return null;
  const parsed = parseMoment(name, data ?? undefined);
  if (!parsed.ok) return null;
  const { moment } = parsed;
  return { name: moment.name, data: moment.data ? JSON.stringify(moment.data) : null };
}

/** A report's stored moment, read back for display. */
export type StoredMoment = {
  name: string;
  data: Record<string, unknown> | null;
};

/**
 * Read a report's moment back out of its columns.
 *
 * NEVER THROWS, for the reason `parseErrorLog` gives: `moment_data` is TEXT with
 * no CHECK so a bad payload cannot fail the insert, which means the reader has to
 * absorb it - one corrupt row must not be able to take down the queue listing the
 * report behind it. A missing name is no moment; unreadable data is a moment with
 * no data.
 */
export function readStoredMoment(
  name: string | null,
  data: string | null,
): StoredMoment | null {
  if (!name) return null;
  let parsed: Record<string, unknown> | null = null;
  if (data) {
    try {
      const value: unknown = JSON.parse(data);
      if (value && typeof value === "object" && !Array.isArray(value)) {
        parsed = value as Record<string, unknown>;
      }
    } catch {
      parsed = null;
    }
  }
  return { name, data: parsed };
}
