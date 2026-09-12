/**
 * HallPass — what the OAuth endpoints say, and to whom.
 *
 * Sibling of `mcp/http.ts`, and pure of the database and of `server-only` for
 * the same reason: it builds responses, so the route handlers stay thin and
 * this unit-tests in plain node.
 *
 * ── OAUTH ERRORS ARE NOT THIS APP'S ERROR SHAPE ───────────────────────────
 * Every other route here answers `{ error: string }` (`ApiError` in
 * `sdk/src/contract`). OAuth answers `{ error, error_description }` where
 * `error` is one of a FIXED set of machine-readable codes — `invalid_grant`,
 * `invalid_client`, `invalid_request` — and clients branch on it. Substituting
 * a human sentence into that field, which is what using `ApiError` here would
 * do, produces a client that cannot tell "your code expired, start again" from
 * "your redirect URI is wrong, stop retrying". The shapes are compatible enough
 * that a reader might not notice the difference matters, so it is written down.
 *
 * ── CORS IS WIDE OPEN AND THAT IS SAFE HERE ───────────────────────────────
 * These endpoints are reached cross-origin by browser-based MCP clients, and
 * they carry NO cookies: every one of them authenticates with a bearer token or
 * a PKCE verifier in the request body. A wildcard ACAO therefore grants a
 * browser nothing a plain `curl` did not already have. The endpoints that DO
 * ride on the session cookie — `/oauth/authorize` above all — are pages, emit
 * no CORS headers at all, and must not start.
 */

/** The RFC 6749 §5.2 / RFC 7591 §3.2.2 error codes this server can answer. */
export type OauthErrorCode =
  | "invalid_request"
  | "invalid_client"
  | "invalid_grant"
  | "unauthorized_client"
  | "unsupported_grant_type"
  | "invalid_scope"
  | "invalid_redirect_uri"
  | "invalid_client_metadata"
  | "access_denied"
  | "server_error"
  | "temporarily_unavailable";

/** Headers every uncredentialed OAuth endpoint answers with. */
export const OAUTH_CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, mcp-protocol-version",
  "access-control-max-age": "86400",
};

/**
 * A token/registration response.
 *
 * `no-store` is REQUIRED by RFC 6749 §5.1 on anything carrying a credential,
 * and it is not decoration: a token response cached by an intermediary is a
 * credential handed to the next caller.
 */
export function oauthJson(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      ...OAUTH_CORS_HEADERS,
      "cache-control": "no-store",
      pragma: "no-cache",
    },
  });
}

/** An OAuth error, in the shape clients branch on. */
export function oauthError(
  error: OauthErrorCode,
  description: string,
  status = 400,
): Response {
  return oauthJson({ error, error_description: description }, status);
}

/**
 * The answer when `MCP_OAUTH_ENABLED` is unset.
 *
 * 503 and not 401, exactly as `mcp/http.ts` argues: "I never set this up" and
 * "my credential is wrong" are two different afternoons, and the message names
 * the variable because the alternative is reading the source to find out.
 */
export function oauthUnconfigured(): Response {
  return oauthError(
    "temporarily_unavailable",
    "Signing in to the HallPass MCP is not enabled on this deployment. Set MCP_OAUTH_ENABLED=1 to turn it on.",
    503,
  );
}

/** Preflight for the uncredentialed endpoints. */
export function oauthPreflight(): Response {
  return new Response(null, { status: 204, headers: OAUTH_CORS_HEADERS });
}
