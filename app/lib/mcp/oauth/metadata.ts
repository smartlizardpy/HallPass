/**
 * HallPass — the two discovery documents an MCP client reads before it can sign
 * in.
 *
 * PURE and free of `server-only`, like the rest of `mcp/oauth/`: these are
 * string builders over an origin, so they unit-test in plain node and the route
 * handlers stay three lines each.
 *
 * ── WHY THE ORIGIN COMES FROM THE REQUEST, NOT FROM `SITE_URL` ────────────
 * `app/lib/site.ts` pins the canonical production origin, and it is right for
 * canonical URLs, sitemaps and OG images. It is wrong here.
 *
 * Everything in an OAuth flow has to agree on ONE origin: the client discovers
 * metadata at whatever host it was pointed at, is redirected to an
 * `authorization_endpoint` from that document, posts to a `token_endpoint` from
 * it, and finally presents a token whose `resource` this server compares
 * against itself. Hard-coding production into those fields means a preview
 * deployment advertises production's endpoints, sends the browser there to sign
 * in, and then refuses the resulting token because its audience names the wrong
 * host — a failure that looks like a broken protocol and is actually a config
 * mismatch. Deriving every field from the incoming request keeps localhost,
 * preview and production each internally consistent.
 *
 * Trusting the request's host is the posture this app already takes: Auth.js is
 * configured `trustHost: true` (`app/lib/auth.ts`) and resolves its own callback
 * origin the same way.
 */

import { OAUTH_SCOPE } from "./config";

/**
 * The path `/api/mcp` lives at. The protected RESOURCE identifier is this
 * joined to the origin, and it is what a token's audience must name.
 */
export const MCP_RESOURCE_PATH = "/api/mcp";

/**
 * Where RFC 9728 says a resource's metadata lives: the well-known prefix with
 * the resource's PATH appended.
 *
 * Both this and the bare `/.well-known/oauth-protected-resource` are served,
 * because clients differ on which they try and the spec requires a client to
 * support the `WWW-Authenticate` pointer as well. Answering all three costs one
 * catch-all route and removes a whole class of "it just says unauthorized".
 */
export const PROTECTED_RESOURCE_METADATA_PATH =
  `/.well-known/oauth-protected-resource${MCP_RESOURCE_PATH}`;

/** The origin of a request, with no trailing slash. */
export function originOf(url: string | URL): string {
  return new URL(url).origin;
}

/** The resource identifier this server will accept tokens for. */
export function mcpResource(origin: string): string {
  return `${origin}${MCP_RESOURCE_PATH}`;
}

/** The full URL of the protected-resource metadata, for `WWW-Authenticate`. */
export function protectedResourceMetadataUrl(origin: string): string {
  return `${origin}${PROTECTED_RESOURCE_METADATA_PATH}`;
}

/**
 * RFC 9728 protected resource metadata.
 *
 * `authorization_servers` names this same origin: HallPass is both the resource
 * and the authorization server. Splitting them would be the right shape for an
 * organisation with a central identity provider, and is a needless second
 * deployment for a site with one Google client already configured.
 */
export function protectedResourceMetadata(origin: string) {
  return {
    resource: mcpResource(origin),
    authorization_servers: [origin],
    scopes_supported: [OAUTH_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "HallPass analytics",
    resource_documentation: `${origin}/dashboard/mcp`,
  };
}

/**
 * RFC 8414 authorization server metadata.
 *
 * Three fields are load-bearing rather than boilerplate:
 *
 *   * `code_challenge_methods_supported: ["S256"]` — advertising `plain` as
 *     well would invite a client to use it, and `oauth/config.ts` refuses it.
 *     What is advertised and what is accepted must be the same list.
 *   * `token_endpoint_auth_methods_supported: ["none"]` — every client here is
 *     public. Claiming otherwise would have clients trying to authenticate with
 *     a secret they were never issued.
 *   * `registration_endpoint` — the MCP spec makes dynamic client registration
 *     optional, but omitting it means a client with no pre-registered id has no
 *     way in at all, which in practice means Claude cannot connect.
 */
export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    revocation_endpoint: `${origin}/api/oauth/revoke`,
    scopes_supported: [OAUTH_SCOPE],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
  };
}
