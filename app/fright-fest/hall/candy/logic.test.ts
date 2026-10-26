import { describe, expect, it } from "vitest";
import { CANDY_FRIGHT_FEST_2026 as C } from "@/app/lib/candy/fright-fest-2026";
import { buttonState, candyPhase, noticeStatus, spendMessage } from "./logic";

const D = { opensAt: C.opensAt, closesAt: C.closesAt, spendUntil: C.spendUntil };
const L = { opens: "28 Oct", spendEnds: "30 Nov" };
const at = (iso: string) => Date.parse(iso);

describe("candyPhase", () => {
  it("follows the clock through every phase, at the exact edges", () => {
    expect(candyPhase(at(C.opensAt) - 1, D)).toBe("before");
    expect(candyPhase(at(C.opensAt), D)).toBe("earning");
    expect(candyPhase(at(C.closesAt) - 1, D)).toBe("earning");
    expect(candyPhase(at(C.closesAt), D)).toBe("spending");
    expect(candyPhase(at(C.spendUntil) - 1, D)).toBe("spending");
    expect(candyPhase(at(C.spendUntil), D)).toBe("over");
  });
  it("is unknown without a clock, and the server's flags win over the device", () => {
    expect(candyPhase(null, D)).toBeNull();
    expect(candyPhase(at(C.opensAt) - 1, D, { earnOpen: true, spendOpen: true })).toBe("earning");
    expect(candyPhase(0, D, { earnOpen: false, spendOpen: true })).toBe("spending");
    expect(candyPhase(0, D, { earnOpen: false, spendOpen: false })).toBe("before");
    expect(candyPhase(at(C.spendUntil), D, { earnOpen: false, spendOpen: false })).toBe("over");
  });
});

describe("noticeStatus", () => {
  it("has words for every phase and none before the clock is known", () => {
    expect(noticeStatus("before", L)).toBe("from 28 Oct");
    expect(noticeStatus("earning", L)).toBe("open");
    expect(noticeStatus("spending", L)).toBe("spend by 30 Nov");
    expect(noticeStatus("over", L)).toBe("over");
    expect(noticeStatus(null, L)).toBeNull();
  });
});

describe("buttonState", () => {
  const ok = { signedIn: true, phase: "earning" as const, balance: 130, busy: false };
  it("enables Buy when signed in, open and affordable", () => {
    expect(buttonState(100, ok, L)).toEqual({ disabled: false, label: "Buy", reason: null });
  });
  it("says Buying… while in flight", () => {
    expect(buttonState(100, { ...ok, busy: true }, L)).toMatchObject({ disabled: true, label: "Buying…" });
  });
  it("says why it is disabled", () => {
    expect(buttonState(30, { ...ok, signedIn: false }, L)).toMatchObject({ disabled: true, label: "Sign in" });
    expect(buttonState(30, { ...ok, phase: "before" }, L)).toMatchObject({ disabled: true, label: "From 28 Oct" });
    expect(buttonState(30, { ...ok, phase: "over" }, L)).toMatchObject({ disabled: true, label: "Ended" });
    expect(buttonState(100, { ...ok, balance: 30 }, L)).toMatchObject({ disabled: true, label: "70 more candy" });
    expect(buttonState(30, { ...ok, balance: 0 }, L)).toMatchObject({ disabled: true, label: "30 more candy" });
  });
  it("spends during the spend-only phase", () => {
    expect(buttonState(30, { ...ok, phase: "spending" }, L).disabled).toBe(false);
  });
  it("pauses spending on a negative balance", () => {
    expect(buttonState(30, { ...ok, balance: -5 }, L)).toMatchObject({
      disabled: true,
      label: "30 more candy",
      reason: "Spending is paused until your balance is above 0",
    });
  });
});

describe("spendMessage", () => {
  const ctx = { price: 100, balance: 60 };
  it("200 is success (a repeat, alreadySpent, is the same 200)", () => {
    expect(spendMessage(200, { balance: 30 }, ctx)).toMatchObject({ tone: "ok", sealed: true, balance: 30, text: "Sealed in your Pack Room" });
  });
  it("409 says how much more is needed, from the server's balance", () => {
    expect(spendMessage(409, { balance: 40, price: 100 }, ctx).text).toBe("You need 60 more candy");
    expect(spendMessage(409, null, ctx).text).toBe("You need 40 more candy");
  });
  it("410 is worded by reason", () => {
    expect(spendMessage(410, { reason: "expired" }, ctx).text).toMatch(/spend-by date has passed/);
    expect(spendMessage(410, { reason: "not-open-yet" }, ctx).text).toMatch(/can't be spent yet/);
  });
  it("401 asks to sign in; 400 says not for sale", () => {
    expect(spendMessage(401, null, ctx).tone).toBe("signin");
    expect(spendMessage(400, null, ctx).text).toBe("That pack isn't for sale");
  });
  it("503 and a network failure (0) say nothing was spent and offer a retry", () => {
    for (const s of [503, 0]) expect(spendMessage(s, null, ctx)).toMatchObject({ text: "Nothing was spent. Try again.", retry: true, sealed: false });
  });
});
