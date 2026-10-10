/**
 * The pure halves of invites: tunables, codes and the game's payload. These are
 * what the picker, the route and the migration's CHECKs must agree on.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FRIEND_CODE_ALPHABET } from "@/app/lib/username";
import {
  DEFAULT_EXPIRY_MINUTES,
  FRIEND_INVITE_RATE_LIMIT,
  GC_GRACE_SECONDS,
  GUEST_LINK_RATE_LIMIT,
  INVITE_REASONS,
  INVITE_REFUSAL_TEXT,
  LINK_RATE_LIMIT,
  MAX_EXPIRY_MINUTES,
  MAX_RECIPIENTS_PER_REQUEST,
  clampExpiryMinutes,
  inviteRefusalText,
} from "./config";
import {
  INVITE_CODE_LENGTH,
  generateInviteCode,
  invitePath,
  isValidInviteCode,
  normalizeInviteCode,
} from "./code";
import { MAX_INVITE_DATA_BYTES, parseInviteData, parseInviteDataParam } from "./data";

describe("config", () => {
  it("defaults to 30 minutes and clamps into 1–120", () => {
    expect(clampExpiryMinutes(undefined)).toBe(DEFAULT_EXPIRY_MINUTES);
    expect(clampExpiryMinutes(null)).toBe(30);
    expect(clampExpiryMinutes(45)).toBe(45);
    expect(clampExpiryMinutes(44.6)).toBe(45);
    expect(clampExpiryMinutes(0)).toBe(1);
    expect(clampExpiryMinutes(-10)).toBe(1);
    expect(clampExpiryMinutes(24 * 60)).toBe(MAX_EXPIRY_MINUTES);
  });

  it("refuses an expiry that is not a number", () => {
    expect(clampExpiryMinutes("30")).toBeNull();
    expect(clampExpiryMinutes(Number.NaN)).toBeNull();
    expect(clampExpiryMinutes(Number.POSITIVE_INFINITY)).toBeNull();
    expect(clampExpiryMinutes({})).toBeNull();
  });

  it("keeps the limits the design promises", () => {
    expect(FRIEND_INVITE_RATE_LIMIT).toEqual({ maxPerWindow: 20, windowSeconds: 3600 });
    expect(MAX_RECIPIENTS_PER_REQUEST).toBeLessThanOrEqual(FRIEND_INVITE_RATE_LIMIT.maxPerWindow);
    expect(GUEST_LINK_RATE_LIMIT.maxPerWindow).toBeGreaterThan(LINK_RATE_LIMIT.maxPerWindow);
  });

  it("keeps collected rows around for at least the longest rate window", () => {
    for (const limit of [FRIEND_INVITE_RATE_LIMIT, LINK_RATE_LIMIT, GUEST_LINK_RATE_LIMIT]) {
      expect(GC_GRACE_SECONDS).toBeGreaterThanOrEqual(limit.windowSeconds);
    }
  });

  it("has words for every reason and a safe default", () => {
    for (const reason of INVITE_REASONS) expect(INVITE_REFUSAL_TEXT[reason]).toBeTruthy();
    expect(inviteRefusalText("rate-limited")).toBe(INVITE_REFUSAL_TEXT["rate-limited"]);
    expect(inviteRefusalText("blocked")).toBe(INVITE_REFUSAL_TEXT.unavailable);
    expect(inviteRefusalText(undefined)).toBe(INVITE_REFUSAL_TEXT.unavailable);
  });

  it("never has a reason that would reveal a block", () => {
    expect(INVITE_REASONS).not.toContain("blocked");
    expect(INVITE_REASONS).not.toContain("not-friends");
  });
});

describe("codes", () => {
  it("are 12 characters of the friend-code alphabet", () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateInviteCode();
      expect(code).toHaveLength(INVITE_CODE_LENGTH);
      expect([...code].every((c) => FRIEND_CODE_ALPHABET.includes(c))).toBe(true);
      expect(isValidInviteCode(code)).toBe(true);
    }
  });

  it("are not repeated", () => {
    const seen = new Set(Array.from({ length: 500 }, generateInviteCode));
    expect(seen.size).toBe(500);
  });

  it("satisfy the migration's CHECK", () => {
    const sqlText = readFileSync(
      path.resolve(__dirname, "../scoreboard/migrations/041_game_invites.sql"),
      "utf8",
    );
    const match = sqlText.match(/code ~ '(\^\[[^\]]+\]\{\d+\}\$)'/);
    expect(match).not.toBeNull();
    const re = new RegExp(match![1]);
    for (let i = 0; i < 50; i += 1) expect(re.test(generateInviteCode())).toBe(true);
    expect(re.source).toContain(`{${INVITE_CODE_LENGTH}}`);
  });

  it("normalise what a person or a URL might do to them", () => {
    expect(normalizeInviteCode("k7qx-m3pd-ght9")).toBe("K7QXM3PDGHT9");
    // Confusables fold onto the alphabet: O→0, I/L→1, S→5, B→8, Z→2.
    expect(normalizeInviteCode("OILSBZ")).toBe("011582");
    // A leading HP is kept (it is two valid characters, not a prefix here).
    expect(normalizeInviteCode("HPCDFG")).toBe("HPCDFG");
    // Punctuation goes; letters outside the alphabet fold or go.
    expect(normalizeInviteCode("<script>")).toBe("5CR1PT");
    expect(normalizeInviteCode(undefined)).toBe("");
  });

  it("reject the wrong shape", () => {
    expect(isValidInviteCode("")).toBe(false);
    expect(isValidInviteCode("K7QXM3PDGHT")).toBe(false);
    expect(isValidInviteCode("K7QXM3PDGHT9X")).toBe(false);
    expect(isValidInviteCode("K7QXM3PDGHTA")).toBe(false);
  });

  it("live at /i/<code>", () => {
    expect(invitePath("K7QXM3PDGHT9")).toBe("/i/K7QXM3PDGHT9");
  });
});

describe("invite data", () => {
  it("accepts a small JSON object and returns its canonical form", () => {
    expect(parseInviteData({ room: "ABCD" })).toEqual({
      data: { room: "ABCD" },
      json: '{"room":"ABCD"}',
    });
    expect(parseInviteData({})).toEqual({ data: {}, json: "{}" });
  });

  it("refuses anything but a plain object", () => {
    for (const bad of [null, undefined, "room", 4, true, [], [{ room: "A" }], new Date(), new Map()]) {
      expect(parseInviteData(bad)).toBeNull();
    }
  });

  it("drops what JSON drops, and refuses what JSON cannot hold", () => {
    expect(parseInviteData({ a: 1, b: undefined })?.data).toEqual({ a: 1 });
    expect(parseInviteData({ when: new Date(0) })?.data).toEqual({ when: "1970-01-01T00:00:00.000Z" });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(parseInviteData(cyclic)).toBeNull();
    expect(parseInviteData({ n: BigInt(1) })).toBeNull();
  });

  it("measures the limit in UTF-8 bytes", () => {
    const pad = (n: number) => ({ s: "x".repeat(n) }); // {"s":"…"} is 8 bytes + n
    expect(parseInviteData(pad(MAX_INVITE_DATA_BYTES - 8))).not.toBeNull();
    expect(parseInviteData(pad(MAX_INVITE_DATA_BYTES - 7))).toBeNull();
    // 300 emoji are 600 UTF-16 units but 1200 bytes.
    expect(parseInviteData({ s: "😀".repeat(300) })).toBeNull();
  });

  it("parses the picker's query parameter", () => {
    expect(parseInviteDataParam('{"room":"ABCD"}')?.data).toEqual({ room: "ABCD" });
    expect(parseInviteDataParam("")).toBeNull();
    expect(parseInviteDataParam("{nope")).toBeNull();
    expect(parseInviteDataParam("[1]")).toBeNull();
    expect(parseInviteDataParam(undefined)).toBeNull();
    expect(parseInviteDataParam(JSON.stringify({ s: "x".repeat(2000) }))).toBeNull();
  });
});
