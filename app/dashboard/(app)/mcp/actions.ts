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
import { revokeGrant } from "@/app/lib/mcp/oauth/store";

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
