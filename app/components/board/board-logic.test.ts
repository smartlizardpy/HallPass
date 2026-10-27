import { describe, expect, it } from "vitest";
import { validateUsernameFormat } from "@/app/lib/username";
import { applyKey, BACKSPACE, CLEAR, rowsFor, SEARCH_MAX_LENGTH } from "./keyboard-keys";
import { planLaunch } from "./launch-decision";

describe("keyboard-keys", () => {
  it("offers every username character and nothing else", () => {
    const keys = rowsFor("username").flat();
    for (const ch of "abcdefghijklmnopqrstuvwxyz0123456789_") expect(keys).toContain(ch);
    expect(keys).toHaveLength(37);
    expect(new Set(keys).size).toBe(37);
  });
  it("only ever builds usernames the format check accepts", () => {
    let v = "";
    for (const ch of "ab_c9z") v = applyKey(v, ch, "username");
    expect(v).toBe("ab_c9z");
    expect(validateUsernameFormat(v).ok).toBe(true);
  });
  it("rejects characters outside the username charset", () => {
    expect(applyKey("ab", "A", "username")).toBe("ab");
    expect(applyKey("ab", " ", "username")).toBe("ab");
    expect(applyKey("ab", "-", "username")).toBe("ab");
    expect(applyKey("ab", "é", "username")).toBe("ab");
    expect(applyKey("ab", "ab", "username")).toBe("ab");
  });
  it("caps usernames at 20 characters", () => {
    let v = "";
    for (let i = 0; i < 30; i++) v = applyKey(v, "a", "username");
    expect(v).toHaveLength(20);
  });
  it("backspace and clear", () => {
    expect(applyKey("abc", BACKSPACE, "username")).toBe("ab");
    expect(applyKey("", BACKSPACE, "username")).toBe("");
    expect(applyKey("abc", CLEAR, "username")).toBe("");
  });
  it("search mode also allows space and hyphen, with a longer cap", () => {
    expect(applyKey("a", " ", "search")).toBe("a ");
    expect(applyKey("a", "-", "search")).toBe("a-");
    expect(rowsFor("search").flat()).toContain("-");
    let v = "";
    for (let i = 0; i < 60; i++) v = applyKey(v, "a", "search");
    expect(v).toHaveLength(SEARCH_MAX_LENGTH);
  });
});

describe("planLaunch", () => {
  it("needs a player when nobody is signed in", () => {
    expect(planLaunch([])).toEqual({ kind: "needs-player" });
  });
  it("launches directly for one player", () => {
    expect(planLaunch(["ava"])).toEqual({ kind: "launch", who: "ava" });
  });
  it("asks who is playing for several", () => {
    expect(planLaunch(["ava", "ben"])).toEqual({ kind: "pick" });
  });
});
