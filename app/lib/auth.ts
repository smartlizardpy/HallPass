/**
 * HallPass dashboard authentication — Auth.js v5 (next-auth) wired to Google.
 *
 * Division of responsibility:
 *   Google proves *identity* (who the person is). It does NOT grant dashboard
 *   access. Sign-in is OPEN — any verified Google account may sign in, because
 *   ordinary PLAYERS sign in only to tag their leaderboard scores. DASHBOARD
 *   authorization is separate: the `dashboard_users` allow-list (plus the
 *   `SUPER_ADMIN_EMAILS` env list) decides who holds a `Role`, and `requireRole`
 *   is the gate. A signed-in player with no role gets a verified identity but
 *   cannot pass that guard.
 *
 * Session strategy is `"jwt"` (no database adapter). The dashboard role is
 * re-resolved from the store on EVERY request (see the `jwt` callback), so a
 * revoked or demoted user loses access on their next request rather than at
 * token expiry. The immutable player identity (`playerId`) is pinned once at
 * login and rides the token thereafter.
 *
 * Email normalisation: identity providers may return mixed-case addresses, but
 * the allow-list PRIMARY KEY is lowercase. Every email crossing this boundary is
 * lowercased before it is compared or stored, so the JWT, the session, and the
 * `dashboard_users` row all agree on one canonical form.
 *
 * `trustHost: true` is required on Vercel/self-host where the host header is the
 * authority for the callback URL; `AUTH_URL` pins it for local development.
 */

import NextAuth, { type DefaultSession } from "next-auth";
import Google from "next-auth/providers/google";
// Imported only to anchor the `declare module "next-auth/jwt"` augmentation
// below: under `moduleResolution: "bundler"` TypeScript will not augment a
// subpath module it has not otherwise resolved (TS2664).
import type { JWT } from "next-auth/jwt";
import { redirect } from "next/navigation";
import {
  getUserRole,
  upsertUserOnLogin,
  isSuperAdminEmail,
  type Role,
} from "@/app/lib/dashboard-users";
import { upsertPlayerOnLogin } from "@/app/lib/players";

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/dashboard/signin" },
  /**
   * `prompt=select_account` — ALWAYS SHOW THE ACCOUNT CHOOSER.
   *
   * Two reasons, and both are specific to who uses this site.
   *
   * SHARED DEVICES. A school laptop or a family tablet usually has somebody
   * else's Google session already live in the browser. Without this, "sign in"
   * silently adopts whoever that is — so a child's scores, friends and
   * notifications attach to their sibling's or their classmate's account, and
   * the only way out is a sign-out flow they will not find.
   *
   * SCHOOL ACCOUNTS. Google Workspace for Education blocks users marked
   * under 18 from signing in to third-party apps their admin has not approved,
   * and no school IT admin is going to approve an unblocked-games site. A pupil
   * on a Chromebook is signed into exactly that account, so the default path is
   * a hard "Access blocked" they can do nothing about. The chooser is what lets
   * them pick their personal account instead — it does not fix the block, but
   * it puts a working option in front of the people who have one.
   *
   * Costs one extra tap for everybody else, which is the right trade against
   * signing somebody in as the wrong person.
   */
  providers: [
    Google({ authorization: { params: { prompt: "select_account" } } }),
  ],
  callbacks: {
    /**
     * Sign-in is now OPEN to any verified Google identity — players sign in only
     * to TAG their leaderboard scores, so a verified email + subject id is all
     * that is required here. Authorization for the DASHBOARD is unchanged and
     * still lives downstream in `requireRole`: a player with no role gets an
     * identity but cannot pass that guard.
     *
     * Two provisioning steps, both keyed independently:
     *   - if the email carries a dashboard role, refresh their `dashboard_users`
     *     row (never downgrading role — see `upsertUserOnLogin`);
     *   - always upsert the `players` row, keyed by the Google subject id
     *     (`user.id`), so every signed-in person has a verified identity.
     */
    async signIn({ user, account, profile }) {
      const email = user.email?.toLowerCase();
      // STABLE identity key. `user.id` is a fresh random UUID on EVERY login in
      // this Auth.js version, so it must never be the player PK — a returning user
      // would mint a new id each time and collide on the UNIQUE `email` column
      // (duplicate key → the sign-in throws → AccessDenied). The provider's subject
      // id (`account.providerAccountId`, i.e. the Google `sub`) is immutable per
      // account and is the correct key; `profile.sub`/`user.id` are last-ditch
      // fallbacks so a provider that omits the account never hard-fails sign-in.
      const subjectId = account?.providerAccountId ?? profile?.sub ?? user.id;
      if (!email || !subjectId) return false;
      const role = await getUserRole(email);
      if (role) {
        await upsertUserOnLogin({
          email,
          name: user.name,
          image: user.image,
          role,
        });
      }
      await upsertPlayerOnLogin({
        id: subjectId,
        email,
        name: user.name,
        image: user.image,
      });
      return true;
    },

    /**
     * Re-resolve the role from the store on EVERY request, not just at login.
     * The token carries identity (`email`), but authorization (`role`) is read
     * live so that revoking or demoting a user in `dashboard_users` takes effect
     * on their very next request — rather than lingering until the JWT expires
     * (Auth.js v5's default is 30 days). On the login pass `user.email` seeds the
     * token; thereafter we fall back to `token.email`. The per-request DB read is
     * a deliberate, cheap price for correct revocation on an admin surface.
     */
    async jwt({ token, user, account, profile }) {
      const email = (user?.email ?? token.email)?.toLowerCase();
      if (email) {
        token.email = email;
        token.role = await getUserRole(email);
      }
      // Pin the player identity ONCE, on the login pass, to the provider's STABLE
      // subject id (`account.providerAccountId`, i.e. the Google `sub`) — never
      // `user.id`, which is a fresh random UUID per login here. `account`/`profile`
      // are present only on the sign-in pass; thereafter the pinned id rides the
      // token. Must match the key used by `upsertPlayerOnLogin` in `signIn`.
      const subjectId = account?.providerAccountId ?? profile?.sub;
      if (subjectId) {
        token.playerId = subjectId;
      }
      return token;
    },

    /**
     * Surface the token's role AND player identity on the session. `role` is the
     * dashboard authorization (may be undefined for a plain player); `playerId`
     * is the verified Google subject id used to tag leaderboard scores.
     */
    async session({ session, token }) {
      if (session.user) {
        session.user.role = (token.role as Role | null) ?? undefined;
        session.user.playerId = token.playerId;
      }
      return session;
    },
  },
});

/**
 * Server guard for dashboard routes. Resolves the current session and asserts a
 * minimum role, redirecting instead of returning on failure:
 *   - no session/role            → `/dashboard/signin`
 *   - `min === "super_admin"` and the caller is a plain `admin` → `/dashboard`
 * On success returns the authenticated `{ email, role }`. Call at the top of a
 * server component or server action to fail closed before doing any work.
 */
export async function requireRole(
  min: Role,
): Promise<{ email: string; role: Role }> {
  const session = await auth();
  const role = session?.user?.role;
  const email = session?.user?.email;
  if (!role || !email) redirect("/dashboard/signin");
  if (min === "super_admin" && role !== "super_admin") redirect("/dashboard");
  return { email, role };
}

/**
 * Module augmentation — teach TypeScript about the `role` we thread through the
 * session and JWT. `isSuperAdminEmail` is re-exported for callers that need the
 * env allow-list check without reaching into `dashboard-users` directly.
 */
export { isSuperAdminEmail };

declare module "next-auth" {
  interface Session {
    user: { role?: Role; playerId?: string } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: Role | null;
    email?: string;
    playerId?: string;
  }
}
