import { describe, expect, it } from "vitest";
import {
  ANALYTICS_NOTICE_SEEN_KEY,
  ANALYTICS_OPTOUT_KEY,
  hasSeenAnalyticsNotice,
  isAnalyticsOptedOut,
  markAnalyticsNoticeSeen,
  setAnalyticsOptOut,
} from "./analytics-consent";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

const throwing = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

describe("analytics opt-out", () => {
  it("defaults to analytics ON", () => {
    expect(isAnalyticsOptedOut(fakeStorage())).toBe(false);
    expect(isAnalyticsOptedOut(null)).toBe(false);
  });

  it("stores and reads the choice", () => {
    const s = fakeStorage();
    setAnalyticsOptOut(true, s);
    expect(s.data.get(ANALYTICS_OPTOUT_KEY)).toBe("1");
    expect(isAnalyticsOptedOut(s)).toBe(true);
  });

  it("opting back in leaves no trace", () => {
    const s = fakeStorage({ [ANALYTICS_OPTOUT_KEY]: "1" });
    setAnalyticsOptOut(false, s);
    expect(s.data.has(ANALYTICS_OPTOUT_KEY)).toBe(false);
    expect(isAnalyticsOptedOut(s)).toBe(false);
  });

  it("ignores unexpected stored values", () => {
    expect(
      isAnalyticsOptedOut(fakeStorage({ [ANALYTICS_OPTOUT_KEY]: "true" })),
    ).toBe(false);
  });

  it("survives storage that throws", () => {
    expect(isAnalyticsOptedOut(throwing)).toBe(false);
    expect(() => setAnalyticsOptOut(true, throwing)).not.toThrow();
  });
});

describe("analytics notice flag", () => {
  it("is unseen until marked", () => {
    const s = fakeStorage();
    expect(hasSeenAnalyticsNotice(s)).toBe(false);
    markAnalyticsNoticeSeen(s);
    expect(s.data.get(ANALYTICS_NOTICE_SEEN_KEY)).toBe("1");
    expect(hasSeenAnalyticsNotice(s)).toBe(true);
  });

  it("counts as seen when storage is unreadable, so it never nags", () => {
    expect(hasSeenAnalyticsNotice(throwing)).toBe(true);
    expect(() => markAnalyticsNoticeSeen(throwing)).not.toThrow();
  });
});
