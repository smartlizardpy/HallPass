import { beforeEach, describe, expect, it, vi } from "vitest";

const mode = vi.hoisted(() => ({ value: "auto" as "auto" | "off" }));
vi.mock("@/app/lib/events/game-event-mode", () => ({ getGameEventMode: async () => mode.value }));

import { GET } from "./route";

beforeEach(() => {
  mode.value = "auto";
  vi.useFakeTimers();
});

describe("GET /api/v1/event", () => {
  it("is public, cross-origin and briefly cacheable", async () => {
    vi.setSystemTime(new Date("2026-10-29T12:00:00Z"));
    const res = await GET();
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toMatch(/s-maxage=30/);
  });

  it("says active inside the window", async () => {
    vi.setSystemTime(new Date("2026-10-29T12:00:00Z"));
    const body = await (await GET()).json();
    expect(body).toMatchObject({ active: true, event: "fright-fest", phase: "live" });
  });

  it("says nothing exists after the window", async () => {
    vi.setSystemTime(new Date("2026-11-04T00:00:00Z"));
    const body = await (await GET()).json();
    expect(body).toMatchObject({ active: false, event: null, phase: "ended", endAt: null });
  });

  it("the dashboard off switch removes it mid-event", async () => {
    vi.setSystemTime(new Date("2026-10-29T12:00:00Z"));
    mode.value = "off";
    const body = await (await GET()).json();
    expect(body).toMatchObject({ active: false, event: null });
  });
});
