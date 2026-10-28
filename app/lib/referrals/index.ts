/**
 * Fright Fest referrals — the live store bound to the shared Neon client.
 *
 * `server-only`, like `candy/index.ts`: the factory stays testable with a fake
 * `sql`; this module holds the real connection.
 *
 * FAIL-SOFT. Migration 052 is applied by hand, so this code can be live against
 * a database without the referral tables. The two hooks into the run flow
 * (`attributeFromRequest`, `qualifyAfterRun`) swallow every error: a referral
 * problem must never fail a run start or a score submission. The panel's read
 * (`getMine`) reports `available: false` instead of 500ing.
 */

import "server-only";
import { isMissingColumnError, isUnconfiguredDbError, sql } from "@/app/lib/db";
import { REFERRAL_FRIGHT_FEST_2026, normalizeReferralToken } from "./config";
import { createReferralStore, type MyReferrals } from "./store";

export const referralStore = createReferralStore(sql);
export const REFERRALS = REFERRAL_FRIGHT_FEST_2026;

function expected(error: unknown): boolean {
  return isMissingColumnError(error) || isUnconfiguredDbError(error) || /relation "referral/.test(String((error as Error)?.message));
}

/** The pending token from the request's Cookie header, or null. */
export function tokenFromCookieHeader(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === REFERRALS.cookie) return normalizeReferralToken(decodeURIComponent(part.slice(i + 1)));
  }
  return null;
}

/** Attribute a signed-in player to the token in their cookie. Never throws. */
export async function attributeFromRequest(req: Request, playerId: string): Promise<void> {
  try {
    const token = tokenFromCookieHeader(req.headers.get("cookie"));
    if (token) await referralStore.claim(playerId, token);
  } catch (error) {
    if (!expected(error)) console.error("referrals.attributeFromRequest failed:", error);
  }
}

/** A run was just accepted: pay the player's referrer, if any. Never throws. */
export async function qualifyAfterRun(playerId: string): Promise<void> {
  try {
    await referralStore.qualifyReferred(playerId);
  } catch (error) {
    if (!expected(error)) console.error("referrals.qualifyAfterRun failed:", error);
  }
}

export type MineResult = ({ available: true } & MyReferrals) | { available: false };

export async function getMine(playerId: string): Promise<MineResult> {
  try {
    return { available: true, ...(await referralStore.mine(playerId)) };
  } catch (error) {
    if (!expected(error)) console.error("referrals.getMine failed:", error);
    return { available: false };
  }
}
