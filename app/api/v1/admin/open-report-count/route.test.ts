import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), count: vi.fn() }));
vi.mock("@/app/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/app/lib/open-report-count", () => ({ countOpenReports: mocks.count }));

import { GET } from "./route";

beforeEach(() => {
  mocks.auth.mockReset();
  mocks.count.mockReset().mockResolvedValue(3);
});

describe("GET /api/v1/admin/open-report-count", () => {
  it("401s without a session and never counts", async () => {
    mocks.auth.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(mocks.count).not.toHaveBeenCalled();
  });

  it("403s a signed-in user below admin", async () => {
    mocks.auth.mockResolvedValue({ user: { email: "a@b.c", role: "beta_admin" } });
    const res = await GET();
    expect(res.status).toBe(403);
    expect(mocks.count).not.toHaveBeenCalled();
  });

  it("returns the count, privately, to an admin", async () => {
    mocks.auth.mockResolvedValue({ user: { email: "a@b.c", role: "admin" } });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 3 });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});
