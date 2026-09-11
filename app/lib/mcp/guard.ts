/**
 * HallPass — who may drive the bug MCP.
 *
 * PURE and free of `server-only`, like `alerts/guard.ts` and `scoreboard/guard.ts`:
 * it reads request headers and environment secrets and touches nothing else, so
 * it unit-tests in the plain `node` environment. The comparison itself lives in
 * `app/lib/admin-secret.ts` — sha256 both sides to a fixed length, then
 * `timingSafeEqual` — shared with the site admin login, the board-provisioning
 * gate and the alerts cron.
 *
 * ── ONE SECRET, AND DELIBERATELY NO FALLBACK ───────────────────────────────
 * This is the one place this module differs from `alerts/guard.ts`, and the
 * difference is the point.
 *
 * The alerts gate accepts `ALERTS_SECRET`, then `SCOREBOARD_ADMIN_SECRET`, then
 * `ADMIN_HTML_PASSWORD`, and argues for it: an operator can turn the feature on
 * with what they already have, and adding the dedicated secret later is a
 * strictly narrowing change. That reasoning is sound for two endpoints that read
 * counts and file notifications.
 *
 * It is wrong here. This surface DELETES reports and PAYS XP — irreversibly, by
 * construction, because closing a report as fixed removes the row (see
 * `beta/store.ts`'s `payAndRemoveReport`). A capability like that must not
 * switch itself on as a side effect of an unrelated password being set years
 * earlier for the legacy `/admin/html` login. So `MCP_SECRET` is checked and
 * nothing else is: with no value set the endpoint answers 503 and refuses
 * everybody, and turning it on is a deliberate act.
 *
 * The corollary is that this credential is also independently ROTATABLE. Nothing
 * else authenticates with it, so revoking the agent's access is one variable
 * change and breaks nothing that is not the agent.
 *
 * ── ENV IS READ AT CALL TIME, NEVER AT IMPORT ─────────────────────────────
 * Same rule as everywhere else here: a value set after import — by Vercel, or by
 * a test — has to be seen.
 */

import { verifySecret, type AdminAuthResult } from "@/app/lib/admin-secret";

/**
 * This surface's own header, alongside `Authorization: Bearer`.
 *
 * Named for the thing it was issued for so a leaked credential is traceable,
 * exactly as `admin-secret.ts` argues. In practice MCP clients send `Bearer`;
 * the named header is what makes the endpoint testable with a bare `curl` that
 * is not going to collide with a proxy rewriting `Authorization`.
 */
export const MCP_SECRET_HEADER = "x-hallpass-mcp-secret";

/** The accepted secret. `undefined` when none is set — never a fallback. */
function expectedSecret(): string | undefined {
  return process.env.MCP_SECRET || undefined;
}

/**
 * Whether the MCP endpoint is provisioned at all.
 *
 * Distinct from "was the right key presented": a deploy with no secret answers
 * 503 rather than 401, so an operator reading a client's connection error can
 * tell "I never set this up" from "my key is wrong", which are two very
 * different afternoons.
 */
export function isMcpConfigured(): boolean {
  return Boolean(expectedSecret()?.trim());
}

/**
 * Gate the MCP endpoint.
 *  - `"unconfigured"` — no `MCP_SECRET` is set; the caller should answer 503.
 *  - `"unauthorized"` — a secret is required but missing or wrong (→ 401).
 *  - `"ok"` — presented secret matches in constant time.
 */
export function verifyMcpSecret(headers: Headers): AdminAuthResult {
  return verifySecret(expectedSecret(), headers, MCP_SECRET_HEADER);
}
