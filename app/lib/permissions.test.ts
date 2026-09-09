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
