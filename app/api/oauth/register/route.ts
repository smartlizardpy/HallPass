/**
 * `POST /api/oauth/register` — RFC 7591 dynamic client registration.
 *
 * ── THIS ENDPOINT IS DELIBERATELY UNAUTHENTICATED ─────────────────────────
 * That reads alarming and is what the spec asks for, because the alternative is
 * that no MCP client can ever connect without an operator hand-provisioning a
 * client id first. It is safe because **registering grants nothing**: a client
 * id is a name, not a credential. Every path from here to data passes through
 * `/oauth/authorize`, which requires a signed-in dashboard account and an
 * explicit approval. The worst an unauthenticated caller can do is add rows.
 *
 * So the control that matters is on the rows, not on the caller: the INSERT is
 * rate-limited in its own statement (`oauth/store.ts`), and the whole thing is
 * behind `MCP_OAUTH_ENABLED`, which is off by default.
 *
 * ── PUBLIC CLIENTS ONLY, AND SAYING SO IS THE POINT ───────────────────────
 * A client asking for `client_secret_post` is told plainly that it will not get
 * one rather than being silently downgraded to `none`. A client that believes
 * it holds a secret and does not will fail its token request with a confusing
 * `invalid_client`; being refused at registration puts the error where the
 * mistake is.
 */

import {
  isOauthEnabled,
  normalizeClientName,
  validateRedirectUris,
  OAUTH_SCOPE,
} from "@/app/lib/mcp/oauth/config";
import {
  oauthError,
  oauthJson,
  oauthPreflight,
  oauthUnconfigured,
} from "@/app/lib/mcp/oauth/http";
import { registerClient } from "@/app/lib/mcp/oauth/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  if (!isOauthEnabled()) return oauthUnconfigured();

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return oauthError("invalid_client_metadata", "Body must be a JSON object.");
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return oauthError("invalid_client_metadata", "Body must be valid JSON.");
  }

  const authMethod = body.token_endpoint_auth_method;
  if (authMethod != null && authMethod !== "none") {
    return oauthError(
      "invalid_client_metadata",
      "Only public clients are supported; token_endpoint_auth_method must be \"none\".",
    );
  }

  const redirects = validateRedirectUris(body.redirect_uris);
  if (!redirects.ok) {
    return oauthError("invalid_redirect_uri", redirects.reason);
  }

  const client = await registerClient({
    clientName: normalizeClientName(body.client_name),
    redirectUris: redirects.uris,
  });

  // The rate limit refused the INSERT. 429 rather than 503: the deployment is
  // fine and the caller may try later, which is exactly what the status means.
  if (!client) {
    return oauthError(
      "temporarily_unavailable",
      "Too many clients have registered recently. Try again in an hour.",
      429,
    );
  }

  // RFC 7591 §3.2.1: 201, and echo back the metadata as REGISTERED rather than
  // as requested — a client must be able to see that its name was trimmed and
  // that it is public, without having to ask again.
  return oauthJson(
    {
      client_id: client.clientId,
      client_id_issued_at: Math.floor(new Date(client.createdAt).getTime() / 1000),
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: OAUTH_SCOPE,
    },
    201,
  );
}

export async function OPTIONS(): Promise<Response> {
  return oauthPreflight();
}
