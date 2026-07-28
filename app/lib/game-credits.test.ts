/**
 * Tests for credit resolution.
 *
 * `resolveCredit` is the one piece of `game-credits.ts` that is pure, and the one
 * with a decision in it: which of TWO sources wins. Games arrive two ways — the
 * `add-game` skill appends to the static catalogue from a local machine and
 * commits, while dashboard uploads and external games write a database row — so
 * both sources are real and either can be missing.
 *
 * `vi.mock("server-only")` because the module imports it; the same pattern
 * `favorites.test.ts` already uses.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { resolveCredit } = await import("./game-credits");

/** A database row, with only the field resolution reads. */
function row(uploaderName: string) {
  return {
    slug: "duskfall",
    uploaderName,
    firstUploadedAt: "2026-07-28T00:00:00.000Z",
  };
}

describe("resolveCredit", () => {
  it("uses the static catalogue when there is no database row", () => {
    // The skill's path: committed to games.ts, never written to a database.
    expect(resolveCredit({ author: "Ozan Kaygusuz" }, null)).toBe("Ozan Kaygusuz");
  });

  it("uses the database row when there is no static entry", () => {
    // The dashboard/external path: no static catalogue entry exists at all.
    expect(resolveCredit(undefined, row("Ateş Demir"))).toBe("Ateş Demir");
  });

  it("lets the database win, because it is the editable source", () => {
    // An admin correcting a credit in the dashboard must not be silently
    // overridden by a stale value someone committed months ago.
    expect(resolveCredit({ author: "Wrong Person" }, row("Ateş Demir"))).toBe(
      "Ateş Demir",
    );
  });

  it("falls back to the static name when the row is blank", () => {
    // Whitespace is not a credit. Without the trim this would render an empty
    // "By" row, which looks like a rendering bug rather than a missing value.
    expect(resolveCredit({ author: "Ateş Demir" }, row("   "))).toBe("Ateş Demir");
  });

  it("treats a blank static author as absent too", () => {
    expect(resolveCredit({ author: "  " }, null)).toBeNull();
  });

  it("returns null for a game nobody has credited", () => {
    // The store page then omits the row entirely rather than guessing — which is
    // most games, so this is the common case rather than an edge one.
    expect(resolveCredit(undefined, null)).toBeNull();
  });

  it("returns null rather than throwing when handed nothing at all", () => {
    // A byline is decoration. `GameStore` defaults the prop for the same reason:
    // an uncredited game must not be able to take its own page down.
    expect(resolveCredit(undefined, null)).toBeNull();
    expect(resolveCredit({}, null)).toBeNull();
  });
});
