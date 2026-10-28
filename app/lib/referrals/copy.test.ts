import { describe, expect, it } from "vitest";
import { REFERRAL_FRIGHT_FEST_2026 as C, normalizeReferralToken, cookieMaxAgeSec, rulesFrom, inWindow } from "./config";
import { buildComment, buildInviteMessage, buildPost, eventDates, referralLink } from "./copy";

const TOKEN = "7CDFGHJKMNPQ";

describe("eventDates", () => {
  it("names the last FULL day, not the exclusive close", () => {
    const d = eventDates(C);
    expect(d.long).toBe("October 28 to November 2");
    expect(d.short).toBe("Oct 28 – Nov 2");
    expect(d.endLong).toBe("November 2");
  });
});

describe("referralLink", () => {
  it("is the event URL with no token", () => {
    expect(referralLink(C, null, "https://x.test")).toBe("https://x.test/fright-fest");
  });
  it("appends the token under fref, never ref", () => {
    const link = referralLink(C, TOKEN, "https://x.test");
    expect(link).toBe(`https://x.test/fright-fest?fref=${TOKEN}`);
    expect(link).not.toContain("?ref=");
  });
});

describe("the copied texts", () => {
  const link = referralLink(C, TOKEN);
  it("the post carries the dates and the link", () => {
    const t = buildPost(C, link);
    expect(t).toContain("October 28 to November 2");
    expect(t).toContain(link);
    expect(t).toContain("#FrightFest");
  });
  it("the comment is under 300 characters and keeps the code", () => {
    const t = buildComment(C, link);
    expect(t.length).toBeLessThan(300);
    expect(t).toContain(TOKEN);
  });
  it("the invite message carries the link", () => {
    expect(buildInviteMessage(C, link)).toContain(link);
  });
  it("works with no token (signed out)", () => {
    const plain = referralLink(C, null);
    expect(buildComment(C, plain)).toContain("/fright-fest");
    expect(buildComment(C, plain)).not.toContain("fref");
  });
});

describe("tokens, rules and the window", () => {
  it("accepts a well-formed token, folds case, refuses the rest", () => {
    expect(normalizeReferralToken(TOKEN.toLowerCase())).toBe(TOKEN);
    expect(normalizeReferralToken("short")).toBeNull();
    expect(normalizeReferralToken("AEIOUAEIOUAE")).toBeNull();
    expect(normalizeReferralToken(42)).toBeNull();
  });
  it("applies admin overrides over the defaults", () => {
    expect(rulesFrom(C, null)).toEqual({ enabled: true, bonus: 10, cap: 4 });
    expect(rulesFrom(C, { cap: 3, enabled: false })).toEqual({ enabled: false, bonus: 10, cap: 3 });
  });
  it("is open inside the window only", () => {
    expect(inWindow(C, Date.parse("2026-10-27T23:59:59Z"))).toBe(false);
    expect(inWindow(C, Date.parse("2026-10-28T00:00:00Z"))).toBe(true);
    expect(inWindow(C, Date.parse("2026-11-03T00:00:00Z"))).toBe(false);
  });
  it("keeps the cookie between a day and 30 days", () => {
    expect(cookieMaxAgeSec(C, Date.parse("2026-11-02T23:00:00Z"))).toBe(86400);
    expect(cookieMaxAgeSec(C, Date.parse("2026-10-28T12:00:00Z"))).toBeGreaterThan(86400);
  });
});
