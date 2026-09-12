/**
 * `POST /api/oauth/revoke` — RFC 7009 token revocation.
 *
 * ── IT ANSWERS 200 EVEN FOR A TOKEN THAT DOES NOT EXIST ───────────────────
 * That is the RFC's requirement (§2.2) and it is not a shrug: the client's
 * goal is "this token is no longer usable", and an unknown token already
 * satisfies it. Answering 404 would also turn this endpoint into a free oracle
 * for testing whether a stolen token is still live, which is precisely what an
 * attacker holding one wants to know.
 *
 * Revoking ANY token of a grant revokes the whole grant — see `oauth/store.ts`.
 * A client disconnecting has not decided to leave its access token behind.
 */

import { isOauthEnabled } from "@/app/lib/mcp/oauth/config";
import { oauthPreflight, oauthUnconfigured } from "@/app/lib/mcp/oauth/http";
import { OAUTH_CORS_HEADERS } from "@/app/lib/mcp/oauth/http";
import { revokeByToken } from "@/app/lib/mcp/oauth/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  if (!isOauthEnabled()) return oauthUnconfigured();

  let token = "";
  try {
    const form = await req.formData();
    const value = form.get("token");
    token = typeof value === "string" ? value.trim() : "";
  } catch {
    // A malformed body is still "this token is not usable" as far as the caller
    // is concerned. Nothing is revoked and nothing is leaked.
  }

  if (token) {
    // Deliberately unawaited-for-its-value: how many rows were touched is not
    // the caller's business, for the reason in the header.
    await revokeByToken(token);
  }

  return new Response(null, {
    status: 200,
    headers: { ...OAUTH_CORS_HEADERS, "cache-control": "no-store" },
  });
}

export async function OPTIONS(): Promise<Response> {
  return oauthPreflight();
}
