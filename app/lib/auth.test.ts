/**
 * Tests for `requireRole` — the guard itself, not the ladder it consults.
 *
 * `permissions.test.ts` already pins the rank comparisons. What was untested is
 * the WIRING: that the guard actually calls the comparison, that it sends a
 * refused caller somewhere they can open, and that it hands back the identity
 * the four-eyes rule needs. All three were changed together, and all three fail
 * silently in the same direction — a guard that returns instead of redirecting
 * looks exactly like a working page until the wrong person edits something.
 *
 * The whole Auth.js surface is mocked because `auth.ts` calls `NextAuth()` at
 * module load: the module cannot be imported at all without it. `redirect` is
 * mocked to THROW, which is what the real one does — it signals by throwing, and
 * a mock that merely records the call would let execution continue past a
 * redirect and test a code path that cannot happen in production.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "./dashboard-users";

/** The session `auth()` resolves to for the case under test. */
const session = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/app/lib/db", () => ({
  sql: () => Promise.resolve([]),
  isDbConfigured: () => true,
  isUnconfiguredDbError: () => false,
  isMissingColumnError: () => false,
}));
vi.mock("next-auth", () => ({
  default: () => ({
    handlers: {},
    auth: () => session(),
    signIn: vi.fn(),
    signOut: vi.fn(),
  }),
}));
vi.mock("next-auth/providers/google", () => ({ default: () => ({}) }));

/**
 * Marks a redirect so a test can assert the destination. A plain `Error` would
 * be indistinguishable from a genuine failure inside the guard.
 */
class Redirected extends Error {
  constructor(readonly to: string) {
    super(`redirect:${to}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));

import { requireRole } from "./auth";

/** Run the guard and report where it went, or what it returned. */
async function attempt(min: Role) {
  try {
    return { returned: await requireRole(min), to: null as string | null };
  } catch (error) {
    if (error instanceof Redirected) return { returned: null, to: error.to };
    throw error;
  }
}

function signedInAs(role: Role | undefined, playerId?: string) {
  session.mockResolvedValue({
    user: { email: "someone@example.com", role, playerId },
  });
}

beforeEach(() => {
  session.mockReset();
});

describe("requireRole", () => {
  it("sends a caller with no session to sign-in", async () => {
    session.mockResolvedValue(null);
    expect((await attempt("beta_admin")).to).toBe("/dashboard/signin");
  });

  it("sends a signed-in player with no role to sign-in", async () => {
    // A verified Google identity is NOT dashboard authorization; an ordinary
    // player signs in just to tag their scores.
    signedInAs(undefined, "player-1");
    expect((await attempt("beta_admin")).to).toBe("/dashboard/signin");
  });

  it("lets each role through a guard at or below its own rung", async () => {
    for (const [role, min] of [
      ["beta_admin", "beta_admin"],
      ["admin", "beta_admin"],
      ["admin", "admin"],
      ["super_admin", "admin"],
      ["super_admin", "super_admin"],
    ] as const) {
      signedInAs(role);
      const { returned, to } = await attempt(min);
      expect(to).toBeNull();
      expect(returned?.role).toBe(role);
    }
  });

  it("turns a beta admin away from an admin guard", async () => {
    // THE regression the ladder exists to prevent: this passed before, at every
    // requireRole("admin") call site in the codebase.
    signedInAs("beta_admin");
    expect((await attempt("admin")).to).toBe("/dashboard/beta");
    expect((await attempt("super_admin")).to).toBe("/dashboard/beta");
  });

  it("still turns a plain admin away from a super-admin guard", async () => {
    signedInAs("admin");
    expect((await attempt("super_admin")).to).toBe("/dashboard");
  });

  it("never sends anyone to a page their own role cannot open", async () => {
    // A destination above the caller's rung is a redirect loop: bounced there,
    // bounced back. Asserted by re-running the guard AT the destination's own
    // requirement rather than by trusting the map.
    signedInAs("beta_admin");
    const { to } = await attempt("super_admin");
    expect(to).toBe("/dashboard/beta");
    // `/dashboard/beta` guards at BETA_MIN_ROLE, which this role satisfies.
    expect((await attempt("beta_admin")).to).toBeNull();
  });

  it("hands back the player id the four-eyes rule compares against", async () => {
    signedInAs("admin", "player-42");
    expect((await attempt("admin")).returned?.playerId).toBe("player-42");
  });

  it("hands back undefined when the session carries no player id", async () => {
    // A token minted before `playerId` was pinned. The callers must be able to
    // SEE that absence — they refuse the decision rather than assuming it is
    // not the caller's own work.
    signedInAs("admin");
    expect((await attempt("admin")).returned?.playerId).toBeUndefined();
  });
});
