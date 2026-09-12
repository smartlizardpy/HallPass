/**
 * HallPass — what the bug MCP endpoint says to a caller it will not serve.
 *
 * Sibling of `alerts/http.ts`, and pure of the database and of `server-only` for
 * the same reason: it reads headers and builds responses, so it unit-tests in
 * the plain `node` environment and the route handler stays thin.
 *
 * ── WHY THESE ARE PLAIN JSON AND NOT JSON-RPC ERRORS ───────────────────────
 * Every reply the MCP protocol itself makes is a JSON-RPC envelope, and the SDK
 * builds those. Nothing here is one, deliberately: an auth failure happens
 * BEFORE the protocol is engaged — there is no negotiated session, and on a
 * malformed or unauthenticated request there may not even be a parseable
 * request id to answer. HTTP status codes are the layer that carries "you may
 * not do this at all", and an MCP client reads a 401 as a credential problem
 * rather than as a tool that failed. Wrapping it in a JSON-RPC error would tell
 * the client the opposite: that the call was accepted and the SERVER broke.
 */

import type { ApiError } from "@/sdk/src/contract";
import type { McpDenial } from "./actor";
import { OAUTH_SCOPE } from "./oauth/config";
import { protectedResourceMetadataUrl } from "./oauth/metadata";

/**
 * Render a refusal from {@link McpDenial}.
 *
 * ── THE 401 IS THE MOST LOAD-BEARING LINE IN THIS FILE ────────────────────
 * `WWW-Authenticate: Bearer resource_metadata="…"` is what RFC 9728 and the MCP
 * specification use to tell a client WHERE to go and sign in. Without the
 * `resource_metadata` parameter a client reports "unauthorized" and stops — it
 * never opens a browser, never discovers the authorization server, and the
 * whole OAuth flow appears to be broken while every route works perfectly. It
 * is the single easiest way to ship this feature dead.
 *
 * ── FOUR OUTCOMES, NOT TWO ────────────────────────────────────────────────
 * The original gate had two, and both survive with their reasoning intact:
 * `unconfigured` is 503 so an operator can tell "I never set this up" from "my
 * key is wrong", and `unauthorized` is 401. Two are new:
 *
 *   * `forbidden` (403) — the credential is GOOD and the account has lost its
 *     dashboard role. A 401 here would send the client round the entire browser
 *     sign-in flow, which would succeed and change nothing.
 *   * `unavailable` (503) — the credential could not be CHECKED because the
 *     database is unreachable. Reporting an outage as a bad credential sends
 *     somebody to rotate a key that was never the problem.
 */
export function mcpDenialResponse(denial: McpDenial, origin: string): Response {
  if (denial.kind === "unconfigured") {
    return Response.json(
      {
        error:
          "The HallPass MCP is not configured. Set MCP_SECRET for the bug tools, " +
          "or MCP_OAUTH_ENABLED=1 to let dashboard accounts sign in for analytics.",
      } satisfies ApiError,
      { status: 503 },
    );
  }

  if (denial.kind === "unavailable") {
    return Response.json({ error: denial.detail } satisfies ApiError, { status: 503 });
  }

  if (denial.kind === "forbidden") {
    return Response.json({ error: denial.detail } satisfies ApiError, { status: 403 });
  }

  return Response.json(
    { error: denial.detail ?? "Unauthorized" } satisfies ApiError,
    {
      status: 401,
      headers: {
        "www-authenticate":
          `Bearer resource_metadata="${protectedResourceMetadataUrl(origin)}", ` +
          `scope="${OAUTH_SCOPE}"`,
      },
    },
  );
}

/** One error body, shaped like every other error this API answers. */
export function mcpError(message: string, status: number): Response {
  return Response.json({ error: message } satisfies ApiError, { status });
}
