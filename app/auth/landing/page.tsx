/**
 * Post-sign-in router.
 *
 * Google sends every successful sign-in here (see `startSignIn`). We read the
 * resolved session and route by ROLE: a dashboard admin goes to `/dashboard`,
 * an ordinary player to the arcade home `/`. Either way we append a `?welcome`
 * flag the client-side toast picks up.
 *
 * A player with no handle is routed through `/play/welcome` first, so their real
 * Google name is never what lands on a leaderboard by default.
 *
 * Returning-vs-first-time: the player's row is upserted during the auth callback
 * (so `last_login` is already ~now). On a brand-new player `created_at` is also
 * ~now, so a `last_login - created_at` gap above a few seconds means a returning
 * visitor → "Welcome back", otherwise "Welcome".
 */

import { redirect } from "next/navigation";
import { auth } from "@/app/lib/auth";
import { getPlayerById } from "@/app/lib/players";

// Reads the session cookie, so this route is inherently per-request.
export const dynamic = "force-dynamic";

const RETURNING_GAP_MS = 5_000;

export default async function AuthLandingPage() {
  const session = await auth();
  const playerId = session?.user?.playerId;

  // Not actually signed in (e.g. landed here directly) — nothing to route.
  if (!playerId) redirect("/");

  let returning = false;
  let needsHandle = false;
  try {
    const player = await getPlayerById(playerId);
    if (player) {
      // No handle yet -> send them through the one-time chooser first. Gating on
      // the COLUMN rather than on "is this their first login" also catches
      // existing players who never picked one, which is precisely the population
      // whose real Google name is on the leaderboards today.
      needsHandle = !player.handle;
      const created = Date.parse(player.createdAt);
      const last = player.lastLogin ? Date.parse(player.lastLogin) : created;
      returning =
        Number.isFinite(created) &&
        Number.isFinite(last) &&
        last - created > RETURNING_GAP_MS;
    }
  } catch {
    // Identity lookup failed — default to a plain "Welcome".
  }

  const destination = `${session?.user?.role ? "/dashboard" : "/"}?welcome=${
    returning ? "back" : "new"
  }`;
  if (needsHandle) {
    redirect(`/play/welcome?next=${encodeURIComponent(destination)}`);
  }
  redirect(destination);
}
