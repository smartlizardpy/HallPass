// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANALYTICS_OPTOUT_KEY } from "./analytics-consent";
import { recordPlayTotal } from "./play-beacon";

const fetchMock = vi.fn(async () => new Response("{}"));

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("recordPlayTotal", () => {
  it("posts the slug, keepalive, once", () => {
    recordPlayTotal("last-bell");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/plays");
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(String(init.body))).toEqual({ slug: "last-bell" });
  });

  it("sends nothing once the device has opted out of analytics", () => {
    localStorage.setItem(ANALYTICS_OPTOUT_KEY, "1");
    recordPlayTotal("last-bell");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never throws if the request fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect(() => recordPlayTotal("last-bell")).not.toThrow();
    await Promise.resolve();
  });
});
