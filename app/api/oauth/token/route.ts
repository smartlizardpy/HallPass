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

import { timingSafeSecretEqual } from "@/app/lib/admin-secret";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  OAUTH_SCOPE,
  hashSecret,
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
import { resolveOauthClient } from "@/app/lib/mcp/oauth/client";
import { consumeRefreshToken, issueTokens, redeemCode } from "@/app/lib/mcp/oauth/store";

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
  // A confidential client may send its credentials as HTTP Basic instead of in
  // the body — RFC 6749 §2.3.1 says a server MUST support Basic and MAY support
  // the body form, and connector UIs differ on which they use.
  const basic = basicCredentials(req.headers);
  const clientId = field("client_id") || basic?.id || "";

  if (!clientId) {
    return oauthError("invalid_client", "client_id is required.", 401);
  }
  // Every client here is public and holds no secret, so "does this client
  // resolve" is the whole of client authentication. It is still worth doing: it
  // stops a code being redeemed under a client id that was never registered —
  // and for a CIMD client it re-checks that the document still exists and still
  // names this id.
  const resolved = await resolveOauthClient(clientId);
  if (!resolved.ok) {
    return oauthError("invalid_client", resolved.reason, 401);
  }

  // ── CONFIDENTIAL CLIENTS ────────────────────────────────────────────────
  // A client created by hand at /dashboard/mcp may hold a secret, because some
  // connector forms (Gemini Enterprise's, for one) have a box for one and no
  // way to register automatically. When a client HAS a secret the token
  // endpoint requires it; when it does not, PKCE is the only binding and
  // presenting a secret is refused rather than ignored — a client that believes
  // it is authenticating and is not should be told so.
  const presentedSecret = field("client_secret") || basic?.secret || "";
  const expectedHash = resolved.client.secretHash;

  if (expectedHash) {
    if (!presentedSecret) {
      return oauthError(
        "invalid_client",
        "This client is registered with a secret, which must be sent as client_secret or HTTP Basic.",
        401,
      );
    }
    // Constant-time, and over the hash both sides — the stored value IS a hash,
    // so the presented secret is hashed to compare like with like.
    if (!timingSafeSecretEqual(hashSecret(presentedSecret), expectedHash)) {
      return oauthError("invalid_client", "The client secret is not correct.", 401);
    }
  } else if (presentedSecret) {
    return oauthError(
      "invalid_client",
      "This client is public and holds no secret. Remove client_secret from the request.",
      401,
    );
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

/**
 * Pull `client_id` / `client_secret` from an `Authorization: Basic` header.
 *
 * RFC 6749 §2.3.1 form-encodes both halves before base64, because either may
 * contain characters that would otherwise be ambiguous around the colon. Ours
 * are base64url and never do, but decoding per the spec is what makes this
 * correct for a client that follows it to the letter.
 */
function basicCredentials(headers: Headers): { id: string; secret: string } | null {
  const header = headers.get("authorization");
  if (!header) return null;
  const match = /^Basic\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(match[1], "base64").toString("utf8");
  } catch {
    return null;
  }
  const colon = decoded.indexOf(":");
  if (colon === -1) return null;
  return {
    id: decodeURIComponent(decoded.slice(0, colon)),
    secret: decodeURIComponent(decoded.slice(colon + 1)),
  };
}
