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
