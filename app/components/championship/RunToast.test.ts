import { describe, expect, it } from "vitest";
import { noticeFor, readSignal } from "./RunToast";

const sig = (over: Record<string, unknown>) => ({ type: "hallpass:championship", phase: "submit", ok: true, board: "last-bell-halloween-shift", ...over });

describe("readSignal", () => {
  it("reads only known, well-typed fields", () => {
    expect(readSignal(null)).toBeNull();
    expect(readSignal({ type: "something-else" })).toBeNull();
    expect(readSignal(sig({ phase: "evil" }))).toBeNull();
    const s = readSignal(sig({ rank: 3, status: "accepted", extra: "<img onerror=x>", detail: "x".repeat(500) }))!;
    expect(s.rank).toBe(3);
    expect("extra" in s).toBe(false);
    expect(readSignal(sig({ rank: -1 }))!.rank).toBeUndefined();
    expect(readSignal(sig({ ok: false, reason: "rejected", detail: "y".repeat(500) }))!.detail).toHaveLength(160);
  });
});

describe("noticeFor", () => {
  it("says where the run landed, or that it is held", () => {
    expect(noticeFor(readSignal(sig({ status: "accepted", rank: 3, best: true }))!)!.text).toMatch(/3rd on the board/);
    expect(noticeFor(readSignal(sig({ status: "accepted", rank: 1, best: false }))!)!.text).toMatch(/best run still stands \(you're 1st\)/);
    expect(noticeFor(readSignal(sig({ status: "flagged" }))!)!.text).toMatch(/person checks it/);
  });
  it("tells a signed-out player before they play, and only failures at start", () => {
    expect(noticeFor(readSignal(sig({ phase: "start", ok: true }))!)).toBeNull();
    const n = noticeFor(readSignal(sig({ phase: "start", ok: false, reason: "signed-out" }))!)!;
    expect(n.signIn).toBe(true);
    expect(n.text).toMatch(/won't be ranked/);
  });
  it("passes the server's reason through as text", () => {
    expect(noticeFor(readSignal(sig({ ok: false, reason: "rejected", detail: "The clock did not match." }))!)!.text).toMatch(/wasn't ranked: The clock did not match\./);
    expect(noticeFor(readSignal(sig({ ok: false, reason: "unavailable" }))!)!.text).toMatch(/having trouble/);
  });
});
