"use server";

/**
 * Player sign-in / sign-out server actions for the PUBLIC site header.
 *
 * The account menu (a client component) cannot call `signIn`/`signOut` directly
 * — those are server-only — so it submits these tiny actions from a `<form>`.
 * Sign-in always returns through `/auth/landing`, which reads the resolved
 * session and routes by role (admin → dashboard, player → home) and shows the
 * welcome toast. Sign-out returns to the arcade home.
 */

import { signIn, signOut } from "@/app/lib/auth";

/** Begin Google sign-in; land on the role-aware router afterwards. */
export async function startSignIn(): Promise<void> {
  await signIn("google", { redirectTo: "/auth/landing" });
}

/** Sign the player out and return to the arcade home. */
export async function startSignOut(): Promise<void> {
  await signOut({ redirectTo: "/" });
}
