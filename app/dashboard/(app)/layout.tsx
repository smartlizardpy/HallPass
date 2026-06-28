/**
 * Authenticated dashboard shell + role guard.
 *
 * This layout wraps every route inside the `(app)` route group — the parenthesised
 * segment is transparent in the URL, so `/dashboard`, `/dashboard/boards`, and
 * `/dashboard/users` all render through here while the public `/dashboard/signin`
 * page (which lives OUTSIDE this group) does not. Keeping sign-in out of the guard
 * is what prevents the classic redirect loop: an unauthenticated visitor is sent to
 * a page that is not itself gated.
 *
 * The guard fails closed. We resolve the Auth.js session once on the server and
 * redirect to sign-in unless BOTH a session and a role are present — the role is
 * the authorization signal (Google only proves identity; see `app/lib/auth.ts`).
 * Authorization is then reflected in the navigation: the Users link, which targets
 * the super-admin-only user-management surface, is rendered only for
 * `role === "super_admin"`. The downstream pages still enforce their own role
 * checks; hiding the link is UX, not security.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/app/lib/auth";
import { Wordmark } from "@/app/components/Wordmark";
import { DashNav } from "./_ui/DashNav";

export const metadata: Metadata = {
  title: "Dashboard",
  robots: { index: false, follow: false },
};

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super admin",
  admin: "Admin",
};

export default async function DashboardAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const role = session?.user?.role;

  // Fail closed: no verified identity, or a verified identity with no granted
  // role, is bounced to the public sign-in page (outside this route group).
  if (!session || !role) {
    redirect("/dashboard/signin");
  }

  const email = session.user?.email ?? "";
  const roleLabel = ROLE_LABEL[role] ?? role;

  return (
    <div className="min-h-screen bg-background md:flex">
      <aside className="border-b border-border bg-surface md:sticky md:top-0 md:h-dvh md:w-64 md:shrink-0 md:overflow-y-auto md:border-b-0 md:border-r">
        <div className="flex h-full flex-col gap-6 px-5 py-6">
          <Link href="/dashboard" className="block">
            <Wordmark />
            <span className="mt-0.5 block text-[11px] font-bold uppercase tracking-wider text-muted">
              Dashboard
            </span>
          </Link>

          <DashNav isSuperAdmin={role === "super_admin"} />

          <div className="mt-auto space-y-3 border-t border-border pt-4">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-foreground">
                {email}
              </div>
              <span className="mt-1 inline-block rounded-full bg-brand-50 px-2 py-0.5 text-xs font-bold text-brand">
                {roleLabel}
              </span>
            </div>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/dashboard/signin" });
              }}
            >
              <button
                type="submit"
                className="w-full rounded-full border border-border bg-white px-5 py-2 text-sm font-bold text-zinc-700 hover:bg-surface-2"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <main className="mx-auto w-full max-w-7xl px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
