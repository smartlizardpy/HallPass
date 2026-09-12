"use server";

/**
 * The two buttons on the consent screen.
 *
 * ── THE FORM IS NOT TRUSTED, AND THAT IS THE WHOLE POINT ──────────────────
 * The page has already validated the client and the redirect URI before it
 * rendered anything. This re-validates BOTH from the database before minting
 * anything, because a server action is a public endpoint: the hidden fields
 * below arrive from whatever posted them, not necessarily from the page that
 * rendered them. Skipping the re-check would let a crafted POST mint an
 * authorization code for a redirect URI nobody registered — the exact hole the
 * render-vs-redirect split in `oauth/request.ts` exists to close.
 *
 * The role is re-checked here too, for the same reason: `requireRole` on the
 * page guards the render, and a render is not a write.
 */

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/app/lib/auth";
import { getUserRole } from "@/app/lib/dashboard-users";
import { DASHBOARD_MIN_ROLE, atLeast } from "@/app/lib/permissions";
import { OAUTH_SCOPE, isOauthEnabled } from "@/app/lib/mcp/oauth/config";
import { mcpResource } from "@/app/lib/mcp/oauth/metadata";
import { checkAuthorizeRequest, codeRedirectUrl, errorRedirectUrl } from "@/app/lib/mcp/oauth/request";
import { resolveOauthClient } from "@/app/lib/mcp/oauth/client";
import { issueCode } from "@/app/lib/mcp/oauth/store";

/** Re-derive this deployment's own origin, as the discovery documents do. */
async function currentOrigin(): Promise<string> {
  const head = await headers();
  const host = head.get("x-forwarded-host") ?? head.get("host") ?? "localhost:3000";
  const proto = head.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** The query the consent form round-trips, rebuilt from its hidden fields. */
function queryFrom(form: FormData): Record<string, string> {
  const get = (key: string) => {
    const value = form.get(key);
    return typeof value === "string" ? value : "";
  };
  return {
    client_id: get("client_id"),
    redirect_uri: get("redirect_uri"),
    response_type: get("response_type"),
    code_challenge: get("code_challenge"),
    code_challenge_method: get("code_challenge_method"),
    state: get("state"),
    scope: get("scope"),
    resource: get("resource"),
  };
}

/**
 * Approve the connection: mint a code and hand the browser back to the client.
 *
 * `redirect()` throws to unwind, so it is called OUTSIDE the try/catch that
 * would otherwise swallow it — `unstable_rethrow` exists for the same hazard.
 * Here the shape avoids needing it: nothing after the mint can throw.
 */
export async function approveConnection(form: FormData): Promise<void> {
  if (!isOauthEnabled()) redirect("/dashboard");

  const session = await auth().catch(() => null);
  const email = session?.user?.email?.trim().toLowerCase();
  if (!email) redirect("/dashboard/signin");

  // Re-resolved rather than read off the session, so a role revoked between
  // render and click is honoured on the click.
  const role = await getUserRole(email);
  if (!role || !atLeast(role, DASHBOARD_MIN_ROLE)) redirect("/dashboard/signin");

  const origin = await currentOrigin();
  const query = queryFrom(form);
  const resolved = await resolveOauthClient(query.client_id);
  const checked = checkAuthorizeRequest(
    query,
    resolved.ok ? resolved.client : null,
    mcpResource(origin),
    resolved.ok ? undefined : resolved.reason,
  );

  // A crafted POST lands here. There is still nowhere safe to redirect, so it
  // goes to the dashboard rather than to anything the form named.
  if (checked.kind === "render-error") redirect("/dashboard");
  if (checked.kind === "redirect-error") {
    redirect(errorRedirectUrl(checked.redirectUri, checked.error, checked.detail, checked.state));
  }

  const code = await issueCode({
    clientId: checked.params.clientId,
    email,
    playerId: session?.user?.playerId ?? null,
    redirectUri: checked.params.redirectUri,
    codeChallenge: checked.params.codeChallenge,
    scope: OAUTH_SCOPE,
    resource: checked.params.resource ?? mcpResource(origin),
  });

  redirect(codeRedirectUrl(checked.params.redirectUri, code, checked.params.state));
}

/**
 * Decline: tell the client so, rather than dead-ending on a blank tab.
 *
 * RFC 6749 §4.1.2.1 specifies `access_denied` for exactly this, and a client
 * that receives it can say "you cancelled" instead of timing out. The redirect
 * URI is re-validated first — a cancel button is not a reason to send a browser
 * somewhere unregistered.
 */
export async function denyConnection(form: FormData): Promise<void> {
  const origin = await currentOrigin();
  const query = queryFrom(form);
  const resolved = await resolveOauthClient(query.client_id);
  const checked = checkAuthorizeRequest(
    query,
    resolved.ok ? resolved.client : null,
    mcpResource(origin),
    resolved.ok ? undefined : resolved.reason,
  );

  if (checked.kind === "render-error") redirect("/dashboard");

  const redirectUri =
    checked.kind === "redirect-error" ? checked.redirectUri : checked.params.redirectUri;
  const state = checked.kind === "redirect-error" ? checked.state : checked.params.state;

  redirect(
    errorRedirectUrl(
      redirectUri,
      "access_denied",
      "The signed-in HallPass user declined the connection.",
      state,
    ),
  );
}
