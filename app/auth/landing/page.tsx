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
import { social } from "@/app/lib/social";

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
  let needsUsername = false;
  try {
    const player = await getPlayerById(playerId);
    if (player) {
      // No handle yet -> send them through the one-time chooser first. Gating on
      // the COLUMN rather than on "is this their first login" also catches
      // existing players who never picked one, which is precisely the population
      // whose real Google name is on the leaderboards today.
      needsHandle = !player.handle;
      // Fail-soft: if the social read hiccups, treat the username as present so a
      // database blip cannot insert an extra step into everybody's sign-in.
      const own = await social.getOwnSocial(playerId).catch(() => null);
      needsUsername = own ? !own.username : false;
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

  // Route to the sign-up steps when EITHER name is missing, not just the handle.
  //
  // Gating on the handle alone left every existing player without a username, and
  // a username is the only thing friend SEARCH can match — so the friends feature
  // was unusable for everybody: nobody was findable, and nobody could find anyone.
  // `/play/welcome` decides which step to show from the player's actual state, so
  // somebody who already has a handle goes straight to the username step and
  // somebody who has both is redirected onward without seeing anything.
  //
  // Safe to ask on every sign-in because the username step is SKIPPABLE and the
  // page self-guards: once a username exists this branch stops firing. It is not a
  // gate, and sign-in can never dead-end on it.
  if (needsHandle || needsUsername) {
    redirect(`/play/welcome?next=${encodeURIComponent(destination)}`);
  }
  redirect(destination);
}
