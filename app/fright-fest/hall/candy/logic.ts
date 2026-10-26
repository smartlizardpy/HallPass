/**
 * Candy Hunt's words and arithmetic, pure: the phase from the clock, the
 * noticeboard status, each Buy button and what each spend response says. No
 * clock, DOM or fetch (the island supplies those), so every state is a unit test.
 */

import type { CandyDates, CandyLabels } from "./props";

export type CandyPhase = "before" | "earning" | "spending" | "over";

/** The server's own flags, when its answer has arrived; they win over the device clock. */
export interface PhaseFlags {
  earnOpen: boolean;
  spendOpen: boolean;
}

/**
 * Before the opening, earning (28 Oct to 1 Nov), spending only (to 30 Nov), over.
 * Display only: the database clock decides a spend.
 */
export function candyPhase(nowMs: number | null, d: CandyDates, flags?: PhaseFlags | null): CandyPhase | null {
  if (flags) {
    if (flags.earnOpen) return "earning";
    if (flags.spendOpen) return "spending";
    if (nowMs === null) return null;
    return nowMs < Date.parse(d.opensAt) ? "before" : "over";
  }
  if (nowMs === null) return null;
  if (nowMs < Date.parse(d.opensAt)) return "before";
  if (nowMs < Date.parse(d.closesAt)) return "earning";
  if (nowMs < Date.parse(d.spendUntil)) return "spending";
  return "over";
}

/** The word after "Candy Hunt ·" on the noticeboard. `null` (clock not known) adds nothing. */
export function noticeStatus(phase: CandyPhase | null, l: Pick<CandyLabels, "opens" | "spendEnds">): string | null {
  switch (phase) {
    case "before":
      return `from ${l.opens}`;
    case "earning":
      return "open";
    case "spending":
      return `spend by ${l.spendEnds}`;
    case "over":
      return "over";
    default:
      return null;
  }
}

export interface ButtonContext {
  signedIn: boolean;
  phase: CandyPhase | null;
  balance: number;
  /** A request is in flight. */
  busy: boolean;
}

export interface ButtonState {
  disabled: boolean;
  label: string;
  /** Extra words for a hint under the button; null when the label says it all. */
  reason: string | null;
}

/** The Buy button of one item. Never relies on colour: a disabled button says why. */
export function buttonState(price: number, ctx: ButtonContext, l: Pick<CandyLabels, "opens">): ButtonState {
  if (ctx.busy) return { disabled: true, label: "Buying…", reason: null };
  if (!ctx.signedIn) return { disabled: true, label: "Sign in", reason: null };
  if (ctx.phase === "before") return { disabled: true, label: `From ${l.opens}`, reason: null };
  if (ctx.phase === "over") return { disabled: true, label: "Ended", reason: null };
  if (ctx.balance < price) {
    const n = price - Math.max(ctx.balance, 0);
    return { disabled: true, label: `${n} more candy`, reason: ctx.balance < 0 ? "Spending is paused until your balance is above 0" : null };
  }
  return { disabled: false, label: "Buy", reason: null };
}

export type SpendTone = "ok" | "error" | "signin";

export interface SpendMessage {
  tone: SpendTone;
  text: string;
  /** Show a retry that reuses the same requestId. */
  retry: boolean;
  /** The balance the response carries, if any. */
  balance: number | null;
  /** The purchase went through (a repeat of it counts). */
  sealed: boolean;
}

export interface SpendBody {
  balance?: number;
  price?: number;
  reason?: string;
}

/** What a spend response (or a failed request: `status` 0) says. */
export function spendMessage(status: number, body: SpendBody | null, ctx: { price: number; balance: number }): SpendMessage {
  const balance = typeof body?.balance === "number" ? body.balance : null;
  switch (status) {
    case 200:
      return { tone: "ok", text: "Sealed in your Pack Room", retry: false, balance, sealed: true };
    case 409: {
      const have = balance ?? ctx.balance;
      const price = typeof body?.price === "number" ? body.price : ctx.price;
      return { tone: "error", text: `You need ${Math.max(price - have, 1)} more candy`, retry: false, balance, sealed: false };
    }
    case 410:
      return {
        tone: "error",
        text: body?.reason === "expired" ? "Candy can no longer be spent: the spend-by date has passed" : "Candy can't be spent yet",
        retry: false,
        balance,
        sealed: false,
      };
    case 401:
      return { tone: "signin", text: "Sign in to buy", retry: false, balance, sealed: false };
    case 400:
      return { tone: "error", text: "That pack isn't for sale", retry: false, balance, sealed: false };
    default:
      return { tone: "error", text: "Nothing was spent. Try again.", retry: true, balance, sealed: false };
  }
}
