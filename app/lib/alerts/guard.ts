/**
 * HallPass — who may ask the site how it is doing, and tell it to say so.
 *
 * PURE and free of `server-only`, like `scoreboard/guard.ts`: it reads request
 * headers and environment secrets and touches nothing else, so it unit-tests in
 * the plain `node` environment. The comparison itself lives in
 * `app/lib/admin-secret.ts` and is shared with the site admin login and the
 * board-provisioning gate.
 *
 * ── A SEPARATE SECRET, WITH A FALLBACK THAT MEANS "WORKS TODAY" ────────────
 * `ALERTS_SECRET` is checked first and is what the GitHub Actions cron should
 * hold. It exists because the credential lives in somebody else's
 * infrastructure: a key pasted into a repository's secrets is a key that can be
 * read by anyone who can edit a workflow file, and it should therefore be
 * ROTATABLE ON ITS OWN and grant as little as possible. It gates two endpoints
 * that read counts and file notifications; it cannot provision boards, and it is
 * not the password to `/admin/html`.
 *
 * It falls back to `SCOREBOARD_ADMIN_SECRET` and then `ADMIN_HTML_PASSWORD` for
 * the same reason the scoreboard gate does — an operator can turn the feature on
 * with what they already have, and adding the dedicated secret later is a
 * strictly narrowing change. The order matters: setting `ALERTS_SECRET` REPLACES
 * the fallbacks rather than joining them, so rotating it actually revokes the
 * old one.
 *
 * ── ENV IS READ AT CALL TIME, NEVER AT IMPORT ─────────────────────────────
 * Same rule as everywhere else here: a value set after import — by Vercel, or by
 * a test — has to be seen.
 */

import { verifySecret, type AdminAuthResult } from "@/app/lib/admin-secret";

/**
 * The alerts secret's own header, alongside `Authorization: Bearer`.
 *
 * Named for this surface so a leaked credential is traceable to the thing it was
 * issued for — see `admin-secret.ts`.
 */
export const ALERTS_SECRET_HEADER = "x-hallpass-alerts-secret";

/** The accepted secret, in precedence order. `undefined` when none is set. */
function expectedSecret(): string | undefined {
  return (
    process.env.ALERTS_SECRET ||
    process.env.SCOREBOARD_ADMIN_SECRET ||
    process.env.ADMIN_HTML_PASSWORD ||
    undefined
  );
}

/**
 * Whether the alerts endpoints are provisioned at all.
 *
 * Distinct from "is anything wrong with the site" — this is about OUR
 * credentials. A deploy with no secret answers 503 rather than 401, so an
 * operator reading the cron's log can tell "I never set this up" from "my key is
 * wrong", which are two very different afternoons.
 */
export function isAlertsConfigured(): boolean {
  return Boolean(expectedSecret()?.trim());
}

/**
 * Gate an alerts endpoint.
 *  - `"unconfigured"` — no secret is set anywhere; the caller should answer 503.
 *  - `"unauthorized"` — a secret is required but missing or wrong (→ 401).
 *  - `"ok"` — presented secret matches in constant time.
 */
export function verifyAlertsSecret(headers: Headers): AdminAuthResult {
  return verifySecret(expectedSecret(), headers, ALERTS_SECRET_HEADER);
}
