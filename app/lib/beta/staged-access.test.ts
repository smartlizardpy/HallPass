/**
 * Tests for `canViewStaged()` with `auth` and the beta membership check mocked.
 * The contract under test is FAIL CLOSED: anything short of a positive answer is
 * `false`, and nothing here ever throws or redirects.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  isBetaTester: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/app/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/app/lib/beta", () => ({ isBetaTester: h.isBetaTester }));

import { canViewStaged } from "@/app/lib/beta/staged-access";

beforeEach(() => {
  h.auth.mockReset();
  h.isBetaTester.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("canViewStaged", () => {
  it("is false for a signed-out visitor, without asking the beta store", async () => {
    h.auth.mockResolvedValue(null);
    expect(await canViewStaged()).toBe(false);
    expect(h.isBetaTester).not.toHaveBeenCalled();
  });

  it("is false for a session with no playerId", async () => {
    h.auth.mockResolvedValue({ user: {} });
    expect(await canViewStaged()).toBe(false);
  });

  it.each(["beta_admin", "admin", "super_admin"])(
    "is true for the %s dashboard role, with no membership lookup",
    async (role) => {
      h.auth.mockResolvedValue({ user: { role } });
      expect(await canViewStaged()).toBe(true);
      expect(h.isBetaTester).not.toHaveBeenCalled();
    },
  );

  it("is true for an active beta tester", async () => {
    h.auth.mockResolvedValue({ user: { playerId: "p1" } });
    h.isBetaTester.mockResolvedValue(true);
    expect(await canViewStaged()).toBe(true);
    expect(h.isBetaTester).toHaveBeenCalledWith("p1");
  });

  it("is false for a signed-in player who is not a tester", async () => {
    h.auth.mockResolvedValue({ user: { playerId: "p1" } });
    h.isBetaTester.mockResolvedValue(false);
    expect(await canViewStaged()).toBe(false);
  });

  it("fails closed when auth() throws", async () => {
    h.auth.mockRejectedValue(new Error("boom"));
    await expect(canViewStaged()).resolves.toBe(false);
  });

  it("fails closed when the membership check throws", async () => {
    h.auth.mockResolvedValue({ user: { playerId: "p1" } });
    h.isBetaTester.mockRejectedValue(new Error("neon down"));
    await expect(canViewStaged()).resolves.toBe(false);
  });
});
