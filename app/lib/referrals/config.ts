/**
 * Fright Fest friend referrals — THE REFERRAL DEFINITION. The one place to edit.
 *
 * Pure and client-safe (no `server-only`, no database): the panel imports it for
 * the link and the copy, the store imports it for the rules. Reasoning for every
 * rule is in docs/referrals-design.md.
 *
 * THE WINDOW is the championship's own, read from `FRIGHT_FEST_2026` rather than
 * retyped, so a moved event moves the referrals with it.
 *
 * `bonus` and `cap` here are DEFAULTS. An admin can override `enabled`, `bonus`
 * and `cap` on the dashboard (the `referral_settings` row); the server always
 * enforces the effective values, never the browser.
 *
 * WHY `fref` AND NOT `ref`: `ref` is already the marketing-channel parameter
 * (`growth/first-touch.ts`, PostHog `custom_campaign_params`). A friend code in
 * it would read as an acquisition channel on the growth dashboard.
 */

import { FRIGHT_FEST_2026 } from "../championship/fright-fest-2026";
import { SITE_URL } from "../site";

export interface ReferralConfig {
  /** The event's id: `referral_codes.event_id`, and the candy ledger's. */
  eventId: string;
  /** The page a referral link lands on. */
  path: string;
  /** The query parameter carrying the token. */
  param: string;
  /** The first-party cookie holding a visitor's pending token. */
  cookie: string;
  /** Referral window, ISO UTC; `opensAt` inclusive, `closesAt` exclusive. */
  opensAt: string;
  closesAt: string;
  /** Candy a rewarded referral pays the referrer. */
  bonus: number;
  /** Most rewarded friends per player. */
  cap: number;
  enabled: boolean;
}

export const REFERRAL_FRIGHT_FEST_2026: ReferralConfig = {
  eventId: FRIGHT_FEST_2026.id,
  path: FRIGHT_FEST_2026.href,
  param: "fref",
  cookie: "hp_fref",
  opensAt: FRIGHT_FEST_2026.opensAt,
  closesAt: FRIGHT_FEST_2026.closesAt,
  bonus: 10,
  cap: 4,
  enabled: true,
};

/** 12 characters of the friend-code alphabet (no vowels, no confusable pairs). */
export const REFERRAL_TOKEN_RE = /^[0-9CDFGHJKMNPQRTVWXY]{12}$/;

/** Canonicalise a token from a URL or cookie: uppercase, trimmed. `null` when it cannot be one. */
export function normalizeReferralToken(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toUpperCase();
  return REFERRAL_TOKEN_RE.test(t) ? t : null;
}

/** The effective rules: code defaults with the admin's overrides applied. */
export interface ReferralRules {
  enabled: boolean;
  bonus: number;
  cap: number;
}

export function rulesFrom(
  config: ReferralConfig,
  override: Partial<ReferralRules> | null | undefined,
): ReferralRules {
  return {
    enabled: override?.enabled ?? config.enabled,
    bonus: override?.bonus ?? config.bonus,
    cap: override?.cap ?? config.cap,
  };
}

/** Whether `nowMs` is inside the referral window. */
export function inWindow(config: ReferralConfig, nowMs: number): boolean {
  return nowMs >= Date.parse(config.opensAt) && nowMs < Date.parse(config.closesAt);
}

/** Seconds a pending-referral cookie should live: until the window closes, at least a day, at most 30. */
export function cookieMaxAgeSec(config: ReferralConfig, nowMs: number): number {
  const left = Math.floor((Date.parse(config.closesAt) - nowMs) / 1000);
  return Math.min(30 * 86400, Math.max(86400, left));
}

export { SITE_URL };
