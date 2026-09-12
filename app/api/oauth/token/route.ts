/**
 * `POST /api/oauth/token` — where a code or a refresh token becomes an access
 * token.
 *
 * Form-encoded, as RFC 6749 §4.1.3 requires; a JSON body is refused rather than
 * quietly accepted, because a client sending JSON here will send it everywhere
 * and the failure should land on the first request rather than the fifth.
 *
 * ── A CODE IS BURNED BEFORE PKCE IS CHECKED, ON PURPOSE ───────────────────
 * `redeemCode` marks the code consumed in the same statement that reads it, so
 * by the time the verifier is compared the code is already spent — and a failed
 * comparison does NOT put it back. That looks harsh and is the correct
 * behaviour: a code presented with the wrong verifier is, by construction,
 * either a bug or a stolen code being replayed by somebody who never saw the
 * verifier. Leaving it live so the thief can try again is the only worse
 * option. The legitimate client's remedy is to start the flow over, which costs
 * it one redirect.
 *
 * ── EVERY FAILURE IS THE SAME `invalid_grant` ─────────────────────────────
 * No such code, already used, expired, wrong client, wrong redirect URI, wrong
 * verifier — one error, one message. Distinguishing them would tell an attacker
 * holding a candidate code which part of their guess was right, which is an
 * oracle. The cost is a slightly worse debugging experience for a legitimate
 * client, and that client has the dev server logs.
 */

import {
  ACCESS_TOKEN_TTL_SECONDS,
  OAUTH_SCOPE,
  isOauthEnabled,
  isValidCodeVerifier,
  verifyPkceS256,
} from "@/app/lib/mcp/oauth/config";
import {
  oauthError,
  oauthJson,
  oauthPreflight,
  oauthUnconfigured,
} from "@/app/lib/mcp/oauth/http";
import { consumeRefreshToken, getClient, issueTokens, redeemCode } from "@/app/lib/mcp/oauth/store";

export const dynamic = "force-dynamic";

/** The one message every grant failure answers with. See the header. */
const INVALID_GRANT =
  "The code or refresh token is not valid, has already been used, or has expired. Start the connection again.";

export async function POST(req: Request): Promise<Response> {
  if (!isOauthEnabled()) return oauthUnconfigured();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return oauthError(
      "invalid_request",
      "The token endpoint takes application/x-www-form-urlencoded, not JSON.",
    );
  }
  const field = (key: string): string => {
    const value = form.get(key);
    return typeof value === "string" ? value.trim() : "";
  };

  const grantType = field("grant_type");
  const clientId = field("client_id");

  if (!clientId) {
    return oauthError("invalid_client", "client_id is required.", 401);
  }
  // Every client here is public and holds no secret, so "does this client
  // exist" is the whole of client authentication. It is still worth doing: it
  // stops a code being redeemed under a client id that was never registered.
  const client = await getClient(clientId);
  if (!client) {
    return oauthError("invalid_client", "No such client is registered.", 401);
  }

  if (grantType === "authorization_code") {
    const code = field("code");
    const redirectUri = field("redirect_uri");
    const verifier = field("code_verifier");

    if (!code || !redirectUri) {
      return oauthError("invalid_request", "code and redirect_uri are required.");
    }
    if (!isValidCodeVerifier(verifier)) {
      return oauthError(
        "invalid_request",
        "code_verifier is required and must be 43–128 characters of base64url.",
      );
    }

    const redeemed = await redeemCode({ code, clientId, redirectUri });
    if (!redeemed) return oauthError("invalid_grant", INVALID_GRANT);

    if (!verifyPkceS256(verifier, redeemed.codeChallenge)) {
      return oauthError("invalid_grant", INVALID_GRANT);
    }

    const tokens = await issueTokens({
      clientId,
      email: redeemed.email,
      playerId: redeemed.playerId,
      scope: redeemed.scope,
      resource: redeemed.resource,
    });
    return tokenResponse(tokens);
  }

  if (grantType === "refresh_token") {
    const refreshToken = field("refresh_token");
    if (!refreshToken) {
      return oauthError("invalid_request", "refresh_token is required.");
    }

    // Rotation: the presented token is revoked as it is read, and the
    // replacement pair rides on the SAME grant_id — so the connection the
    // dashboard lists survives a refresh instead of multiplying.
    const previous = await consumeRefreshToken({ refreshToken, clientId });
    if (!previous) return oauthError("invalid_grant", INVALID_GRANT);

    const tokens = await issueTokens({
      grantId: previous.grantId,
      clientId,
      email: previous.email,
      playerId: previous.playerId,
      scope: previous.scope,
      resource: previous.resource,
    });
    return tokenResponse(tokens);
  }

  return oauthError(
    "unsupported_grant_type",
    "Supported grant types are authorization_code and refresh_token.",
  );
}

function tokenResponse(tokens: {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}): Response {
  return oauthJson({
    access_token: tokens.accessToken,
    token_type: "Bearer",
    expires_in: tokens.expiresInSeconds ?? ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: tokens.refreshToken,
    scope: OAUTH_SCOPE,
  });
}

export async function OPTIONS(): Promise<Response> {
  return oauthPreflight();
}
