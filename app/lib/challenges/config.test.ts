/**
 * Tests for the challenge vocabulary.
 *
 * Everything here is pure, so these are cheap. They exist to pin the invariants
 * a database CHECK enforces but TypeScript cannot — the kind list has a
 * counterpart in `scoreboard/migrations/022_challenges.sql` — and the cooldown
 * rule, which is the anti-harassment policy expressed as code and therefore the
 * thing most worth catching a "tidy" of.
 */

import { describe, expect, it } from "vitest";
import {
  CHALLENGE_DISMISSED_COOLDOWN_SECONDS,
  CHALLENGE_KINDS,
  CHALLENGE_REASONS,
  CHALLENGE_RESEND_COOLDOWN_SECONDS,
  CHALLENGE_RESOLVED_COOLDOWN_SECONDS,
  CHALLENGE_SENDER_RATE_LIMIT,
  cooldownSecondsFor,
  isOpen,
  toChallengeKind,
} from "./config";

const OPEN = { acceptedAt: null, resolvedAt: null, dismissedAt: null };

describe("kinds", () => {
  it("matches the CHECK in 022_challenges.sql", () => {
    // If this list changes, `challenges_kind_chk` changes with it or every
    // insert of the new kind fails at runtime.
    expect([...CHALLENGE_KINDS]).toEqual(["friend", "seasonal"]);
  });

  it("narrows a known kind and rejects everything else", () => {
    expect(toChallengeKind("friend")).toBe("friend");
    expect(toChallengeKind("seasonal")).toBe("seasonal");
    expect(toChallengeKind("weekly")).toBeNull();
    expect(toChallengeKind("")).toBeNull();
    expect(toChallengeKind(undefined)).toBeNull();
    expect(toChallengeKind(null)).toBeNull();
    expect(toChallengeKind(7)).toBeNull();
  });
});

describe("isOpen", () => {
  it("is open only when nobody has won it and nobody has binned it", () => {
    expect(isOpen(OPEN)).toBe(true);
    expect(isOpen({ ...OPEN, resolvedAt: "2026-01-01T00:00:00Z" })).toBe(false);
    expect(isOpen({ ...OPEN, dismissedAt: "2026-01-01T00:00:00Z" })).toBe(false);
  });

  it("ignores acceptedAt — accepting is a signal, not an ending", () => {
    expect(isOpen({ ...OPEN, acceptedAt: "2026-01-01T00:00:00Z" })).toBe(true);
  });
});

describe("cooldownSecondsFor", () => {
  it("charges nothing for a rematch after a resolved challenge", () => {
    // The one loop worth having: they beat your score, you beat theirs, you
    // send it straight back. A cooldown here would throttle the whole feature.
    expect(
      cooldownSecondsFor({ ...OPEN, resolvedAt: "2026-01-01T00:00:00Z" }),
    ).toBe(0);
    expect(CHALLENGE_RESOLVED_COOLDOWN_SECONDS).toBe(0);
  });

  it("charges the long cooldown after a dismissal", () => {
    expect(
      cooldownSecondsFor({ ...OPEN, dismissedAt: "2026-01-01T00:00:00Z" }),
    ).toBe(CHALLENGE_DISMISSED_COOLDOWN_SECONDS);
  });

  it("charges the nag cooldown while a challenge is still open", () => {
    expect(cooldownSecondsFor(OPEN)).toBe(CHALLENGE_RESEND_COOLDOWN_SECONDS);
  });

  it("prefers resolved over dismissed when both are somehow set", () => {
    // `challenges_ending_chk` makes this unreachable from the database, so this
    // pins the function's own precedence rather than a real state.
    expect(
      cooldownSecondsFor({
        ...OPEN,
        resolvedAt: "2026-01-01T00:00:00Z",
        dismissedAt: "2026-01-02T00:00:00Z",
      }),
    ).toBe(0);
  });

  it("orders the cooldowns dismissed > open > resolved", () => {
    // The policy in one assertion: saying no buys the most quiet, nagging buys
    // some, and winning buys none.
    expect(CHALLENGE_DISMISSED_COOLDOWN_SECONDS).toBeGreaterThan(
      CHALLENGE_RESEND_COOLDOWN_SECONDS,
    );
    expect(CHALLENGE_RESEND_COOLDOWN_SECONDS).toBeGreaterThan(
      CHALLENGE_RESOLVED_COOLDOWN_SECONDS,
    );
  });
});

describe("limits", () => {
  it("rate-limits the sender, which is the only side it is safe to limit", () => {
    // Capping INBOUND would be a denial of service aimed at the victim — see the
    // module header and `social/config.ts`. There is deliberately no such value
    // to assert here; this pins that the sender-side one exists and is finite.
    expect(CHALLENGE_SENDER_RATE_LIMIT.maxPerWindow).toBeGreaterThan(0);
    expect(CHALLENGE_SENDER_RATE_LIMIT.windowSeconds).toBeGreaterThan(0);
  });
});

describe("reasons", () => {
  it("has no duplicates", () => {
    expect(new Set(CHALLENGE_REASONS).size).toBe(CHALLENGE_REASONS.length);
  });

  it("covers every refusal the create path can produce", () => {
    // Mirrored BY HAND into sdk/src/contract.ts as `ChallengeReason`; this list
    // is the server-side original.
    for (const reason of [
      "no-board",
      "no-score",
      "not-friends",
      "self",
      "signed-out",
      "bad-request",
      "rate-limited",
      "unavailable",
    ]) {
      expect(CHALLENGE_REASONS).toContain(reason);
    }
  });

  it("never exposes a 'blocked' reason", () => {
    // A block deletes the friendship, so this could only ever fire behind a
    // not-friends that is already true — and reporting it would confirm to
    // somebody that a specific person blocked them. The gate stays in the SQL;
    // the disclosure does not.
    expect(CHALLENGE_REASONS).not.toContain("blocked");
  });
});
