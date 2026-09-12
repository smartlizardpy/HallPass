"use server";

/**
 * Revoking an MCP connection.
 *
 * ── THE OWNERSHIP CHECK IS IN THE SQL, NOT IN THIS FILE ───────────────────
 * `revokeGrant` takes the email as part of its `WHERE`, so an ordinary
 * dashboard user cannot revoke somebody else's connection by guessing a
 * `grant_id` — the statement simply matches nothing. A check here instead would
 * be a read followed by a write with a round trip in between, which is the
 * shape `role-seats-design.md` argues against for exactly this reason.
 *
 * A super admin passes `null` for the email and the guard becomes the role
 * check below. That asymmetry is deliberate and is why the store's parameter is
 * explicitly `string | null` rather than optional: "revoke anyone's" should
 * have to be asked for, not fallen into by forgetting an argument.
 */

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/app/lib/auth";
import { getUserRole } from "@/app/lib/dashboard-users";
import { DASHBOARD_MIN_ROLE, atLeast } from "@/app/lib/permissions";
import { updateTag } from "next/cache";
import { APP_SETTINGS_CACHE_TAG, writeAppSetting } from "@/app/lib/app-settings";
import {
  OUTPUT_MODES,
  OUTPUT_MODE_KEY,
  OUTPUT_MODE_LABEL,
  toOutputMode,
  type OutputMode,
} from "@/app/lib/mcp/analytics/output-mode";
import { normalizeClientName, validateRedirectUris } from "@/app/lib/mcp/oauth/config";
import {
  createManualClient,
  deleteManualClient,
  revokeGrant,
} from "@/app/lib/mcp/oauth/store";

const MCP_PATH = "/dashboard/mcp";

function back(kind: "ok" | "error", message: string): never {
  redirect(`${MCP_PATH}?${kind}=${encodeURIComponent(message)}`);
}

export async function revokeConnectionAction(form: FormData): Promise<void> {
  const grantId = String(form.get("grantId") ?? "").trim();
  const scope = String(form.get("scope") ?? "own");

  const session = await auth().catch(() => null);
  const email = session?.user?.email?.trim().toLowerCase();
  if (!email) redirect("/dashboard/signin");

  // Re-resolved rather than read off the session, like every other guard here:
  // a role revoked since the page rendered must be honoured on the click.
  const role = await getUserRole(email).catch(() => null);
  if (!role || !atLeast(role, DASHBOARD_MIN_ROLE)) redirect("/dashboard/signin");

  if (!grantId) back("error", "That connection could not be identified.");

  // Only a super admin may reach past their own connections, and the page only
  // renders that button for one. Re-checked because a server action is a public
  // endpoint and the form is not evidence.
  const all = scope === "all" && role === "super_admin";

  let revoked: number;
  try {
    revoked = await revokeGrant({ grantId, email: all ? null : email });
  } catch (error) {
    console.error("MCP connection revoke failed:", error);
    back("error", "The connection could not be revoked. Try again.");
  }

  revalidatePath(MCP_PATH);

  // Zero rows is a refusal, not a success: somebody else revoked it first, it
  // expired, or it was never this account's to revoke. Reporting "revoked" for
  // a statement that changed nothing is how a person comes to believe access is
  // closed when it is not — the same argument `bug-mcp-design.md` §5 makes
  // about writes that match no rows.
  if (revoked === 0) {
    back("error", "Nothing was revoked — that connection is already gone.");
  }

  back("ok", "Connection revoked. Its next request will be refused.");
}


/**
 * Create a connector by hand, for a UI that cannot register itself.
 *
 * ── WHY THE SECRET IS RETURNED IN THE URL ────────────────────────────────
 * It is shown once and never stored, so it has to survive the redirect that
 * server actions use to report back. The alternatives are worse: storing it to
 * render on the next page defeats hashing it, and a client component holding it
 * in state loses it on any refresh. A URL is short-lived, and the page tells
 * the reader plainly that it will not be shown again.
 *
 * It does land in browser history. That is the accepted cost, stated here
 * rather than left to be discovered, and the mitigation is that the secret can
 * be replaced at any time by deleting the connector and making another.
 */
export async function createConnectorAction(form: FormData): Promise<void> {
  const session = await auth().catch(() => null);
  const email = session?.user?.email?.trim().toLowerCase();
  if (!email) redirect("/dashboard/signin");

  const role = await getUserRole(email).catch(() => null);
  // Creating a credential another service holds is a different act from
  // revoking your own, so it sits a rung higher than the page itself.
  if (role !== "super_admin") {
    back("error", "Only a super admin may create a connector.");
  }

  const name = normalizeClientName(form.get("clientName"));
  const raw = String(form.get("redirectUris") ?? "")
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean);

  const redirects = validateRedirectUris(raw);
  if (!redirects.ok) back("error", redirects.reason);

  const withSecret = form.get("withSecret") === "on";

  let created;
  try {
    created = await createManualClient({
      clientName: name,
      redirectUris: redirects.uris,
      withSecret,
      createdBy: email,
    });
  } catch (error) {
    console.error("Manual MCP connector creation failed:", error);
    back("error", "The connector could not be created. Try again.");
  }

  revalidatePath(MCP_PATH);
  const params = new URLSearchParams({ created: created.client.clientId });
  if (created.secret) params.set("secret", created.secret);
  redirect(`${MCP_PATH}?${params.toString()}`);
}

/**
 * Delete a hand-made connector.
 *
 * The cascade on `mcp_oauth_codes` and `mcp_oauth_tokens` means this also
 * revokes every grant made through it, which is the behaviour somebody deleting
 * a connector expects — and is why the store refuses to touch a self-registered
 * client by the same route.
 */
export async function deleteConnectorAction(form: FormData): Promise<void> {
  const session = await auth().catch(() => null);
  const email = session?.user?.email?.trim().toLowerCase();
  if (!email) redirect("/dashboard/signin");

  const role = await getUserRole(email).catch(() => null);
  if (role !== "super_admin") {
    back("error", "Only a super admin may delete a connector.");
  }

  const clientId = String(form.get("clientId") ?? "").trim();
  if (!clientId) back("error", "That connector could not be identified.");

  let deleted = false;
  try {
    deleted = await deleteManualClient(clientId);
  } catch (error) {
    console.error("Manual MCP connector deletion failed:", error);
    back("error", "The connector could not be deleted. Try again.");
  }

  revalidatePath(MCP_PATH);
  back(
    deleted ? "ok" : "error",
    deleted
      ? "Connector deleted, along with every connection made through it."
      : "Nothing was deleted — that connector is already gone.",
  );
}


/**
 * Switch between cards and text.
 *
 * ── WHY THIS IS A BUTTON AND NOT A DEPLOY ────────────────────────────────
 * Whether an MCP Apps card renders is a fact about somebody else's client, and
 * it changes without warning: Claude's support is tracked as not planned today
 * and could ship tomorrow, and a client that half-implements it shows an EMPTY
 * BOX rather than falling back to the text. The person who can see that is the
 * one holding the phone, and they should be able to fix it in the ten seconds
 * before they give up on the feature — not file an issue and wait for a build.
 *
 * `updateTag` rather than `revalidatePath`: the setting is read through the
 * cached `readAppSettings`, whose tag every other writer in this codebase also
 * invalidates. Revalidating this page alone would leave `/api/mcp` serving the
 * old value for up to an hour, which is precisely the wait this exists to
 * avoid.
 */
export async function setOutputModeAction(form: FormData): Promise<void> {
  const session = await auth().catch(() => null);
  const email = session?.user?.email?.trim().toLowerCase();
  if (!email) redirect("/dashboard/signin");

  const role = await getUserRole(email).catch(() => null);
  // A rung higher than reading the page: this changes what every OTHER
  // connected account sees, so it is not a personal preference.
  if (role !== "super_admin") {
    back("error", "Only a super admin may change how answers are presented.");
  }

  const raw = String(form.get("mode") ?? "");
  // Narrowed rather than trusted: a form value is a public input, and an
  // unrecognised one must land on the default rather than be written.
  const mode: OutputMode = toOutputMode(raw);
  if (!OUTPUT_MODES.includes(raw as OutputMode)) {
    back("error", "That is not a presentation mode.");
  }

  try {
    await writeAppSetting(OUTPUT_MODE_KEY, mode, email);
  } catch (error) {
    console.error("Failed to write the MCP output mode:", error);
    // Never report a saved setting that was not saved: the operator would
    // believe a switch was thrown when it was not. Same argument as
    // `writeAppSetting`'s own docblock for throwing rather than swallowing.
    back("error", "That setting could not be saved. Try again.");
  }

  updateTag(APP_SETTINGS_CACHE_TAG);
  revalidatePath(MCP_PATH);
  back("ok", `Answers will now use: ${OUTPUT_MODE_LABEL[mode]}.`);
}
