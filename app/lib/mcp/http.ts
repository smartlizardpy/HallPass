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

/**
 * Origins allowed to reach `/api/mcp` from a browser.
 *
 * ── WHY THIS EXISTS AT ALL, GIVEN THE ROUTE SAYS "NO CORS" ────────────────
 * It said that when the only caller was a coding agent's own process, which is
 * not a browser and has no origin. A web-based MCP client IS a browser, and
 * without a preflight answer it cannot reach the endpoint at all — the OAuth
 * flow would complete and then the first tool call would fail on a CORS error
 * that names nothing useful.
 *
 * ── AND WHY IT IS AN ALLOW-LIST RATHER THAN `*` ───────────────────────────
 * `*` would in fact be SAFE here: every credential this endpoint accepts is a
 * bearer token in a header, never a cookie, so a browser on a hostile page
 * gains nothing it could not already do with `curl`. The allow-list is not
 * defending against that. It is defending against the next person to read this
 * file concluding that the endpoint is origin-agnostic and adding a
 * cookie-based path to it — at which point `*` becomes a hole and nobody
 * remembers why it was there.
 *
 * Defaults to the hosted assistants this server is meant to be added to,
 * extended by `MCP_CORS_ORIGINS` (comma-separated). Read at call time, like
 * every other env read here.
 *
 * The list is origins, not products: `chat.openai.com` is still in it because
 * it still resolves for existing sessions, and dropping an origin somebody is
 * mid-conversation on is a silent breakage.
 */
export const DEFAULT_MCP_CORS_ORIGINS = [
  "https://claude.ai",
  "https://www.claude.ai",
  "https://chatgpt.com",
  "https://chat.openai.com",
  "https://gemini.google.com",
  "https://aistudio.google.com",
] as const;

function allowedOrigins(): string[] {
  const extra = (process.env.MCP_CORS_ORIGINS ?? "")
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  return [...DEFAULT_MCP_CORS_ORIGINS, ...extra];
}

/**
 * The CORS headers for a request, or `{}` when its origin is not allowed.
 *
 * A disallowed origin gets NO headers rather than a refusal: that is how CORS
 * is specified to fail, and the browser produces the error. Answering 403 here
 * would break non-browser callers, which send no `Origin` at all.
 */
export function mcpCorsHeaders(headers: Headers): Record<string, string> {
  const origin = headers.get("origin");
  if (!origin || !allowedOrigins().includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    // Without this an intermediary may serve one origin's response to another.
    vary: "origin",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers":
      "content-type, authorization, mcp-protocol-version, mcp-session-id, last-event-id",
    "access-control-expose-headers": "mcp-protocol-version, mcp-session-id, www-authenticate",
    "access-control-max-age": "86400",
  };
}

/** One error body, shaped like every other error this API answers. */
export function mcpError(message: string, status: number): Response {
  return Response.json({ error: message } satisfies ApiError, { status });
}
