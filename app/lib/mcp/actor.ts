import "server-only";

/**
 * HallPass — who is driving `/api/mcp` on this request.
 *
 * SERVER-ONLY, unlike `guard.ts` beside it, and the split is deliberate:
 * `guard.ts` compares a secret against an environment variable and stays pure
 * so its refusals are unit-tested, while resolving an OAuth token means reading
 * the database and the role ladder. Putting both in one module would drag the
 * database into the test that pins "there is no fallback to an older secret",
 * which is the single most important assertion about this endpoint.
 *
 * ── TWO CREDENTIALS, AND THEY ARE INDEPENDENT ─────────────────────────────
 * `MCP_SECRET` behaves exactly as it always has. OAuth is added BESIDE it, not
 * in front of it: either can be unconfigured without disabling the other, and
 * rotating one does not touch the other. `analytics-mcp-design.md` §2 records
 * why this reverses `bug-mcp-design.md` §2's argument against OAuth.
 *
 * ── THE ROLE IS RESOLVED PER REQUEST, NOT BAKED INTO THE TOKEN ────────────
 * Same decision the `jwt` callback in `app/lib/auth.ts` makes, for the same
 * reason: a token lives eight hours and a revoked role has to take effect on
 * the next call, not at expiry. It costs one extra round trip on a surface
 * whose every tool call already makes several.
 *
 * ── A DATABASE FAILURE IS A 503, NEVER A 401 ──────────────────────────────
 * `resolveAccessToken` throws rather than answering "not found" when Neon is
 * unreachable (`oauth/store.ts`), and that distinction is carried through here.
 * An outage reported as "your credential is bad" sends an operator to rotate a
 * key that was never the problem.
 */

import type { Role } from "@/app/lib/dashboard-users";
import { getUserRole } from "@/app/lib/dashboard-users";
import { DASHBOARD_MIN_ROLE, atLeast } from "@/app/lib/permissions";
import { presentedSecret } from "@/app/lib/admin-secret";
import { isOauthEnabled, resourceMatches } from "@/app/lib/mcp/oauth/config";
import { resolveAccessToken } from "@/app/lib/mcp/oauth/store";
import { MCP_SECRET_HEADER, isMcpConfigured, verifyMcpSecret } from "./guard";
import { mcpActor } from "./config";

/** Who the caller is, and therefore which tools they get (`server.ts`). */
export type McpActor =
  /** A holder of `MCP_SECRET`. Gets the bug tools and the analytics tools. */
  | { kind: "secret"; actor: string }
  /** A signed-in dashboard account. Gets the analytics tools only. */
  | { kind: "user"; email: string; role: Role; playerId: string | null; clientName: string };

/** Why a request was refused, for the HTTP layer to render. */
export type McpDenial =
  /** Neither credential is provisioned on this deployment → 503. */
  | { kind: "unconfigured" }
  /** A credential was presented and is not good → 401. */
  | { kind: "unauthorized"; detail?: string }
  /** Authenticated, but the account may not use this → 403. */
  | { kind: "forbidden"; detail: string }
  /** The backing store could not answer → 503, and NOT a credential problem. */
  | { kind: "unavailable"; detail: string };

export type McpAuthResult = { ok: true; actor: McpActor } | { ok: false; denial: McpDenial };

/**
 * Authenticate a request against both credentials.
 *
 * ORDER MATTERS, and the secret goes first. It is a constant-time string
 * compare against an environment variable with no round trip, so a bug-fixing
 * agent's every call is resolved without touching the database — exactly as it
 * was before OAuth existed. Only a bearer that is NOT the secret is looked up
 * as a token.
 *
 * `resource` is this deployment's own MCP resource identifier, and comparing it
 * against the token's is required by the MCP specification: a server must
 * refuse a token that was issued for somebody else, or a token minted by a
 * preview deployment would work against production.
 */
export async function authenticateMcp(
  headers: Headers,
  resource: string,
): Promise<McpAuthResult> {
  const secretResult = verifyMcpSecret(headers);
  if (secretResult === "ok") {
    return { ok: true, actor: { kind: "secret", actor: mcpActor() } };
  }

  const oauthOn = isOauthEnabled();

  // Neither door exists on this deployment. 503 naming both, never a silent
  // accept and never a 401 — "I never set this up" and "my key is wrong" are
  // two different afternoons (`mcp/http.ts`).
  if (!isMcpConfigured() && !oauthOn) return { ok: false, denial: { kind: "unconfigured" } };

  const presented = presentedSecret(headers, MCP_SECRET_HEADER);
  if (!presented) return { ok: false, denial: { kind: "unauthorized" } };

  // A wrong secret on a deployment with no OAuth is just a wrong secret.
  if (!oauthOn) return { ok: false, denial: { kind: "unauthorized" } };

  let token;
  try {
    token = await resolveAccessToken(presented);
  } catch (error) {
    console.error("MCP token lookup failed:", error);
    return {
      ok: false,
      denial: {
        kind: "unavailable",
        detail:
          "The credential could not be checked because the database is unreachable. " +
          "This is not a problem with your token.",
      },
    };
  }

  if (!token) return { ok: false, denial: { kind: "unauthorized" } };

  // Audience. The spec requires this and the failure it prevents is subtle: a
  // token minted against a preview deployment is a perfectly valid row here.
  if (!resourceMatches(token.resource, resource)) {
    return {
      ok: false,
      denial: {
        kind: "unauthorized",
        detail: `This token was issued for ${token.resource}, not for ${resource}.`,
      },
    };
  }

  // Re-resolved, never read off the token. See the header.
  let role: Role | null;
  try {
    role = await getUserRole(token.email);
  } catch (error) {
    console.error("MCP role lookup failed:", error);
    return {
      ok: false,
      denial: {
        kind: "unavailable",
        detail: "The account's role could not be read because the database is unreachable.",
      },
    };
  }

  // 403 and not 401: the credential is GOOD and the account is simply not
  // allowed any more. Answering 401 would send a client round the whole browser
  // sign-in flow again, which would succeed and change nothing.
  if (!role || !atLeast(role, DASHBOARD_MIN_ROLE)) {
    return {
      ok: false,
      denial: {
        kind: "forbidden",
        detail:
          "This HallPass account no longer holds a dashboard role, so its analytics " +
          "access has been withdrawn. Signing in again will not restore it.",
      },
    };
  }

  return {
    ok: true,
    actor: {
      kind: "user",
      email: token.email,
      role,
      playerId: token.playerId,
      clientName: token.clientName,
    },
  };
}
