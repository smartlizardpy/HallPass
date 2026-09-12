/**
 * HallPass — validating an OAuth authorization request, as pure data.
 *
 * PURE and free of `server-only` and of React: the authorize PAGE decides what
 * to render, this decides what is wrong. Splitting them is what makes the
 * nastiest rule in the whole feature testable —
 *
 *   AN INVALID CLIENT OR REDIRECT URI IS RENDERED, NEVER REDIRECTED.
 *
 * That distinction is the difference between an authorization server and an
 * open redirector. Once the redirect URI is known-registered, an error may be
 * sent BACK to it as `?error=...`, which is what RFC 6749 §4.1.2.1 requires so
 * the client learns why it failed. Before that point there is nowhere safe to
 * send anything, and a server that redirects anyway will happily bounce a
 * browser — and, on a near miss, an authorization code — to whatever the query
 * string asked for.
 *
 * So the result type below has exactly three shapes, and the page cannot
 * accidentally collapse them: `render-error` (no safe redirect exists),
 * `redirect-error` (one does), and `ok`.
 */

import {
  OAUTH_SCOPE,
  isRegisteredRedirectUri,
  isValidCodeChallenge,
  resourceMatches,
} from "./config";

/** The query parameters an authorization request carries. */
export type AuthorizeParams = {
  clientId: string;
  redirectUri: string;
  responseType: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  state: string | null;
  scope: string | null;
  resource: string | null;
};

/** What the page must do about a request. */
export type AuthorizeCheck =
  | { kind: "ok"; params: AuthorizeParams }
  /** Nothing may be redirected anywhere. Render this, with a 400-ish tone. */
  | { kind: "render-error"; title: string; detail: string }
  /** The redirect URI is trusted; tell the client why it failed. */
  | { kind: "redirect-error"; redirectUri: string; error: string; detail: string; state: string | null };

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

/**
 * Check an authorization request against a client already loaded from the
 * database (`null` when the `client_id` matched nothing).
 *
 * The order of the checks is the security property, not a style choice: the
 * client and the redirect URI are settled FIRST, because every check after them
 * is allowed to answer by redirecting and none before them is.
 */
export function checkAuthorizeRequest(
  query: Record<string, string | string[] | undefined>,
  client: { clientId: string; redirectUris: string[] } | null,
  serverResource: string,
  /**
   * WHY the client could not be resolved, when it could not be.
   *
   * Added after a real failure that took server logs to diagnose. A client that
   * identifies with a Client ID Metadata Document is never "not registered" —
   * there is nothing to register — so when its document cannot be fetched or
   * does not validate, `resolveOauthClient` produces a precise reason and this
   * function used to THROW IT AWAY, reporting "no client with that id has
   * registered" instead. That sentence is not merely unhelpful, it is wrong,
   * and it sends somebody to re-add a connection that was never the problem.
   */
  clientError?: string,
): AuthorizeCheck {
  const clientId = first(query.client_id);
  const redirectUri = first(query.redirect_uri);

  if (!clientId) {
    return {
      kind: "render-error",
      title: "This link is missing its client",
      detail:
        "The request arrived without a client_id, so there is no way to tell which application is asking. Start the connection again from your MCP client.",
    };
  }

  if (!client) {
    // A URL client_id is a Client ID Metadata Document, so "not registered" is
    // never the right diagnosis for one — see `clientError` above.
    const isUrlClientId = /^https:\/\//i.test(clientId);
    return {
      kind: "render-error",
      title: isUrlClientId
        ? "This application's details could not be read"
        : "This application is not registered",
      detail:
        clientError ??
        (isUrlClientId
          ? `HallPass could not use the client metadata document at ${clientId}.`
          : "No client with that id has registered with HallPass. If the deployment was reset, remove the connection in your MCP client and add it again."),
    };
  }

  if (!redirectUri) {
    return {
      kind: "render-error",
      title: "This link is missing its return address",
      detail:
        "The request arrived without a redirect_uri. HallPass will not guess one, because guessing is how an authorization code ends up somewhere it was never meant to go.",
    };
  }

  if (!isRegisteredRedirectUri(client.redirectUris, redirectUri)) {
    return {
      kind: "render-error",
      title: "That return address is not registered",
      detail:
        "The redirect_uri does not exactly match one this application registered, so HallPass will not send anything to it. This is the check that stops an authorization code being delivered to the wrong place.",
    };
  }

  // From here the redirect URI is trusted, so failures are reported to the
  // client rather than to the person — which is what lets an MCP client say
  // something useful instead of hanging on a browser tab that went quiet.
  const state = first(query.state) || null;
  const responseType = first(query.response_type);
  const codeChallenge = first(query.code_challenge);
  const codeChallengeMethod = first(query.code_challenge_method) || "plain";
  const resource = first(query.resource) || null;
  const scope = first(query.scope) || null;

  if (responseType !== "code") {
    return {
      kind: "redirect-error",
      redirectUri,
      state,
      error: "unsupported_response_type",
      detail: "Only the authorization code flow is supported.",
    };
  }

  if (codeChallengeMethod !== "S256") {
    return {
      kind: "redirect-error",
      redirectUri,
      state,
      error: "invalid_request",
      detail:
        "PKCE with code_challenge_method=S256 is required. Every client here is public, so the verifier is the only thing binding the redemption to this browser.",
    };
  }

  if (!isValidCodeChallenge(codeChallenge)) {
    return {
      kind: "redirect-error",
      redirectUri,
      state,
      error: "invalid_request",
      detail: "code_challenge must be 43–128 characters of base64url.",
    };
  }

  // `resource` is optional for older clients and pinned when present. An
  // explicitly WRONG audience is refused rather than quietly overwritten: a
  // client that believes it is talking to another server should be told it is
  // not.
  if (resource && !resourceMatches(resource, serverResource)) {
    return {
      kind: "redirect-error",
      redirectUri,
      state,
      error: "invalid_target",
      detail: `This server only issues tokens for ${serverResource}.`,
    };
  }

  // Scope is likewise optional. There is one scope, so a request for something
  // else is refused rather than silently narrowed — a client told it got what
  // it asked for when it did not will fail later and further away.
  if (scope && !scope.split(/\s+/).every((s) => s === OAUTH_SCOPE)) {
    return {
      kind: "redirect-error",
      redirectUri,
      state,
      error: "invalid_scope",
      detail: `The only scope this server grants is ${OAUTH_SCOPE}.`,
    };
  }

  return {
    kind: "ok",
    params: {
      clientId,
      redirectUri,
      responseType,
      codeChallenge,
      codeChallengeMethod,
      state,
      scope,
      resource: resource ?? serverResource,
    },
  };
}

/** Build the client-bound error redirect for a {@link AuthorizeCheck}. */
export function errorRedirectUrl(
  redirectUri: string,
  error: string,
  description: string,
  state: string | null,
): string {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  url.searchParams.set("error_description", description);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

/** Build the success redirect carrying the authorization code. */
export function codeRedirectUrl(
  redirectUri: string,
  code: string,
  state: string | null,
): string {
  const url = new URL(redirectUri);
  url.searchParams.set("code", code);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}
