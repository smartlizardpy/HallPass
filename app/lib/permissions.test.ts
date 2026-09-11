/**
 * Tests for the dashboard permission ladder.
 *
 * The module is pure, so these are ordinary unit tests — but they are not
 * box-ticking. Each one pins an invariant whose violation is SILENT in
 * production:
 *
 *   * A beta admin who can write outside the beta programme looks exactly like
 *     a working dashboard until something is edited that should not have been.
 *   * A `DASHBOARD_HOME` entry pointing above its own role's reach is a redirect
 *     loop, and `requireRole` is the only thing between that and a browser
 *     hammering the same route.
 *   * A missing `ROLE_LABEL`/`ROLE_HINT` entry prints a raw column value at
 *     somebody, or offers a role with no explanation of what it grants.
 *   * `canConfirmOwnWork` is the one rule that is NOT the ladder. Written as a
 *     rank ("admin and up may self-confirm") it would read almost identically
 *     and mean the opposite of what it is for.
 *   * A seat count that reads `undefined` refuses every grant on an empty
 *     database, and one that goes negative reads as free seats to anything
 *     doing arithmetic on it. Both look like a working screen until somebody
 *     tries to invite a colleague.
 */

import { describe, expect, it } from "vitest";
import type { Role } from "./dashboard-users";
import {
  atLeast,
  canConfirmOwnWork,
  canEditSite,
  canManageTesters,
  mustRequestTesters,
  BETA_MIN_ROLE,
  DASHBOARD_HOME,
  DASHBOARD_MIN_ROLE,
  ROLES,
  ROLE_HINT,
  ROLE_LABEL,
  ROLE_RANK,
  SITE_WRITE_ROLE,
  toRole,
  ROLE_SEATS,
  emptySeatCounts,
  firstFreeRole,
  isOverSeats,
  isRoleFull,
  roleFullMessage,
  seatsLeft,
  seatSummary,
  type SeatCounts,
} from "./permissions";

describe("the ladder", () => {
  it("lists every role exactly once, weakest first", () => {
    // `ROLES` is the runtime twin of the `Role` union; every assertion below
    // that says "every role" is only as complete as this list is.
    expect([...ROLES]).toEqual(["beta_admin", "admin", "super_admin"]);
    expect(Object.keys(ROLE_RANK).sort()).toEqual([...ROLES].sort());
  });

  it("ranks them strictly ascending", () => {
    const ranks = ROLES.map((role) => ROLE_RANK[role]);
    for (let i = 1; i < ranks.length; i += 1) {
      expect(ranks[i]).toBeGreaterThan(ranks[i - 1]);
    }
  });

  it("lets a role satisfy itself and everything below it", () => {
    expect(atLeast("super_admin", "admin")).toBe(true);
    expect(atLeast("admin", "admin")).toBe(true);
    expect(atLeast("admin", "beta_admin")).toBe(true);
    expect(atLeast("beta_admin", "beta_admin")).toBe(true);
  });

  it("refuses a role below the minimum", () => {
    // THE regression this whole module exists to prevent: before the ladder was
    // real, `requireRole("admin")` passed for every role that existed.
    expect(atLeast("beta_admin", "admin")).toBe(false);
    expect(atLeast("beta_admin", "super_admin")).toBe(false);
    expect(atLeast("admin", "super_admin")).toBe(false);
  });
});

describe("what a beta admin may do", () => {
  it("cannot write anything outside the beta programme", () => {
    expect(canEditSite("beta_admin")).toBe(false);
    expect(canEditSite("admin")).toBe(true);
    expect(canEditSite("super_admin")).toBe(true);
  });

  it("cannot add or remove testers, and must ask instead", () => {
    expect(canManageTesters("beta_admin")).toBe(false);
    expect(mustRequestTesters("beta_admin")).toBe(true);
    // Exact complements — the invite UI branches on one and the action on the
    // other, so a drift between them is a form that promises what it cannot do.
    for (const role of ROLES) {
      expect(mustRequestTesters(role)).toBe(!canManageTesters(role));
    }
  });

  it("may still open the dashboard and work the beta programme", () => {
    expect(atLeast("beta_admin", DASHBOARD_MIN_ROLE)).toBe(true);
    expect(atLeast("beta_admin", BETA_MIN_ROLE)).toBe(true);
  });

  it("keeps the site-write floor above the dashboard floor", () => {
    // If these ever collapse to the same rung, "read-only elsewhere" silently
    // becomes "write everywhere".
    expect(ROLE_RANK[SITE_WRITE_ROLE]).toBeGreaterThan(
      ROLE_RANK[DASHBOARD_MIN_ROLE],
    );
  });
});

describe("four eyes", () => {
  it("binds a full admin, not only a beta admin", () => {
    // The rule is about the DECISION, not about how much the person is trusted.
    expect(canConfirmOwnWork("beta_admin")).toBe(false);
    expect(canConfirmOwnWork("admin")).toBe(false);
  });

  it("exempts only the super admin, so a solo site cannot deadlock", () => {
    expect(canConfirmOwnWork("super_admin")).toBe(true);
    expect(ROLES.filter(canConfirmOwnWork)).toEqual(["super_admin"]);
  });

  it("is not the ladder in disguise", () => {
    // Expressed as a rank it would read almost the same and mean the opposite
    // of its purpose: an admin would be able to pay themselves.
    const asLadder = ROLES.filter((role) => atLeast(role, "admin"));
    expect(asLadder).not.toEqual(ROLES.filter(canConfirmOwnWork));
  });
});

describe("toRole", () => {
  it("accepts every role and nothing else", () => {
    for (const role of ROLES) expect(toRole(role)).toBe(role);
    expect(toRole("owner")).toBeNull();
    expect(toRole("")).toBeNull();
    expect(toRole(undefined)).toBeNull();
    // `String(value)` is what does the comparing, so a value that stringifies
    // to a role name must still be refused — it is not one.
    expect(toRole({ toString: () => "admin" })).toBeNull();
  });
});

describe("presentation", () => {
  it("labels and explains every role", () => {
    for (const role of ROLES) {
      expect(ROLE_LABEL[role]).toBeTruthy();
      expect(ROLE_HINT[role]).toBeTruthy();
    }
  });

  it("sends each role home to a page it can actually open", () => {
    // A `DASHBOARD_HOME` above its own role's reach is a redirect loop: the
    // guard bounces them there, and that page's guard bounces them back.
    expect(DASHBOARD_HOME.beta_admin.startsWith("/dashboard/beta")).toBe(true);
    for (const role of ROLES) {
      expect(DASHBOARD_HOME[role].startsWith("/dashboard")).toBe(true);
    }
  });
});

describe("exhaustiveness", () => {
  it("fails to compile if a role is added without ranking it", () => {
    // A compile-time assertion with a runtime body, in the shape the tracker
    // config uses: `Record<Role, …>` in the module already rejects a missing
    // rank, and this pins the same for the maps a page reads.
    const everyRole: Record<Role, true> = {
      beta_admin: true,
      admin: true,
      super_admin: true,
    };
    expect(Object.keys(everyRole).sort()).toEqual([...ROLES].sort());
  });
});

describe("seats", () => {
  /** A `SeatCounts` from a partial, so each case states only what it cares about. */
  const held = (counts: Partial<SeatCounts>): SeatCounts => ({
    ...emptySeatCounts(),
    ...counts,
  });

  it("caps the ladder at one, one and three", () => {
    // The numbers themselves, pinned. They are policy, so a change to them
    // should have to be a deliberate edit here rather than a silent widening.
    expect(ROLE_SEATS).toEqual({ super_admin: 1, admin: 1, beta_admin: 3 });
  });

  it("gives every role a seat count", () => {
    // An uncapped rung is precisely the one that grows without anybody noticing.
    for (const role of ROLES) {
      expect(ROLE_SEATS[role]).toBeGreaterThan(0);
      expect(Number.isInteger(ROLE_SEATS[role])).toBe(true);
    }
  });

  it("starts every role at zero, not undefined", () => {
    // `undefined` here would make `taken < limit` read `NaN < 1` and refuse
    // every grant on a database that simply has no rows yet.
    for (const role of ROLES) expect(emptySeatCounts()[role]).toBe(0);
  });

  it("counts a role full at its cap, not past it", () => {
    expect(isRoleFull(held({ admin: 0 }), "admin")).toBe(false);
    expect(isRoleFull(held({ admin: 1 }), "admin")).toBe(true);
    expect(isRoleFull(held({ beta_admin: 2 }), "beta_admin")).toBe(false);
    expect(isRoleFull(held({ beta_admin: 3 }), "beta_admin")).toBe(true);
  });

  it("never reports a negative number of free seats", () => {
    // Over capacity is reachable (see `isOverSeats`), and a negative "free"
    // count reads as free seats to anything doing arithmetic on it.
    expect(seatsLeft(held({ super_admin: 3 }), "super_admin")).toBe(0);
    expect(seatsLeft(held({ beta_admin: 1 }), "beta_admin")).toBe(2);
  });

  it("separates full from over capacity", () => {
    // Full is the ordinary end state; over capacity is the one the Users page
    // calls out, and only the env allow-list can produce it.
    const atCap = held({ super_admin: 1 });
    expect(isRoleFull(atCap, "super_admin")).toBe(true);
    expect(isOverSeats(atCap, "super_admin")).toBe(false);

    const over = held({ super_admin: 2 });
    expect(isRoleFull(over, "super_admin")).toBe(true);
    expect(isOverSeats(over, "super_admin")).toBe(true);
  });

  it("falls back to the WEAKEST free role, never a stronger one", () => {
    // This picks a form's default. Falling back upward would answer "the rung
    // you asked for is full" by preselecting more access than was asked for.
    expect(firstFreeRole(emptySeatCounts())).toBe("beta_admin");
    expect(firstFreeRole(held({ beta_admin: 3 }))).toBe("admin");
    expect(firstFreeRole(held({ beta_admin: 3, admin: 1 }))).toBe("super_admin");
  });

  it("returns null only when every single seat is taken", () => {
    const full = held({ beta_admin: 3, admin: 1, super_admin: 1 });
    expect(firstFreeRole(full)).toBeNull();
    for (const role of ROLES) expect(isRoleFull(full, role)).toBe(true);
  });

  it("pluralises the seat summary", () => {
    expect(seatSummary(held({ admin: 1 }), "admin")).toBe("1 of 1 seat used");
    expect(seatSummary(held({ beta_admin: 1 }), "beta_admin")).toBe(
      "1 of 3 seats used",
    );
  });

  it("names the role and the count in the refusal", () => {
    // The person reading it is deciding who loses a seat, so the sentence has
    // to say which role is full and how full it is — not merely "full".
    const message = roleFullMessage(held({ admin: 1 }), "admin");
    expect(message).toContain("admin");
    expect(message).toContain("1 of 1");
    for (const role of ROLES) {
      expect(roleFullMessage(emptySeatCounts(), role)).toBeTruthy();
    }
  });
});
