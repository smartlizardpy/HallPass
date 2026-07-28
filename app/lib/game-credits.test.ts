/**
 * Tests for credit resolution.
 *
 * `resolveCredit` is the one piece of `game-credits.ts` that is pure, and it is
 * also the piece with a decision in it: which of TWO sources wins. Games arrive
 * two ways — the `add-game` skill appends to the static catalogue from a local
 * machine and commits, while dashboard uploads and external games write a
 * database row — so both sources are real and either can be missing.
 *
 * `vi.mock("server-only")` because the module imports it; the same pattern
 * `favorites.test.ts` already uses.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { resolveCredit } = await import("./game-credits");

/** A database row, with only the fields resolution reads. */
function row(over: { authorName?: string | null; uploaderName?: string }) {
  return {
    slug: "duskfall",
    authorName: over.authorName ?? null,
    uploaderName: over.uploaderName ?? "Uploader",
    firstUploadedAt: "2026-07-28T00:00:00.000Z",
  };
}

describe("resolveCredit", () => {
  it("uses the static catalogue when there is no database row", () => {
    // The skill's path: committed to games.ts, never written to a database.
    expect(
      resolveCredit({ author: "Ateş Demir", addedBy: "Ozan Kaygusuz" }, null),
    ).toEqual({ author: "Ateş Demir", addedBy: "Ozan Kaygusuz" });
  });

  it("uses the database row when there is no static entry", () => {
    // The dashboard/external path: no static catalogue entry exists at all.
    expect(
      resolveCredit(undefined, row({ authorName: "Ateş", uploaderName: "Ozan" })),
    ).toEqual({ author: "Ateş", addedBy: "Ozan" });
  });

  it("lets the database win, because it is the editable source", () => {
    // An admin correcting a credit in the dashboard must not be silently
    // overridden by a stale value someone committed months ago.
    expect(
      resolveCredit(
        { author: "Wrong Person", addedBy: "Also Wrong" },
        row({ authorName: "Ateş Demir", uploaderName: "Ozan Kaygusuz" }),
      ),
    ).toEqual({ author: "Ateş Demir", addedBy: "Ozan Kaygusuz" });
  });

  it("wins PER FIELD, so correcting one name does not blank the other", () => {
    // The database row always carries an uploader (the column is NOT NULL) but
    // may have no author. Whole-record precedence would drop a static author the
    // moment anything was saved in the dashboard.
    expect(
      resolveCredit(
        { author: "Ateş Demir", addedBy: "Someone Stale" },
        row({ authorName: null, uploaderName: "Ozan Kaygusuz" }),
      ),
    ).toEqual({ author: "Ateş Demir", addedBy: "Ozan Kaygusuz" });
  });

  it("treats blank and whitespace-only names as absent", () => {
    // An empty string in either source must not render an empty credit row.
    expect(
      resolveCredit({ author: "   ", addedBy: "" }, row({ uploaderName: "Ozan" })),
    ).toEqual({ author: null, addedBy: "Ozan" });
  });

  it("returns nothing at all for a game nobody has credited", () => {
    // The store page then omits the rows entirely rather than guessing.
    expect(resolveCredit(undefined, null)).toEqual({ author: null, addedBy: null });
  });

  it("keeps both names when one person made AND added the game", () => {
    // Resolution does not collapse them — the store page decides to render one
    // line instead of two. Keeping the data honest here means the dashboard can
    // still show both fields filled in.
    expect(
      resolveCredit(undefined, row({ authorName: "Ateş", uploaderName: "Ateş" })),
    ).toEqual({ author: "Ateş", addedBy: "Ateş" });
  });
});
