import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/app/lib/app-settings", () => ({ readAppSetting: vi.fn() }));
vi.mock("@/app/lib/dashboard-users", () => ({ getSessionRole: vi.fn() }));
vi.mock("@/app/lib/beta", () => ({ isBetaTester: vi.fn() }));
vi.mock("@/app/lib/db", () => ({ sql: vi.fn() }));

import { readAppSetting } from "@/app/lib/app-settings";
import { getBoardPassMode, modeAllows, parseMode } from "./flag";

describe("parseMode", () => {
  it("defaults anything unknown to off", () => {
    for (const v of [null, undefined, "", "ON", "true", "1", "everyone"]) {
      expect(parseMode(v)).toBe("off");
    }
  });
  it("accepts the three modes", () => {
    expect(parseMode("off")).toBe("off");
    expect(parseMode("staff")).toBe("staff");
    expect(parseMode("on")).toBe("on");
  });
});

describe("modeAllows", () => {
  it("off allows nobody, on allows everybody, staff allows staff", () => {
    expect(modeAllows("off", true)).toBe(false);
    expect(modeAllows("on", false)).toBe(true);
    expect(modeAllows("staff", true)).toBe(true);
    expect(modeAllows("staff", false)).toBe(false);
  });
});

describe("getBoardPassMode", () => {
  it("reads the setting", async () => {
    vi.mocked(readAppSetting).mockResolvedValue("staff");
    expect(await getBoardPassMode()).toBe("staff");
  });
  it("fails to off when the read throws", async () => {
    vi.mocked(readAppSetting).mockRejectedValue(new Error("db down"));
    expect(await getBoardPassMode()).toBe("off");
  });
});
