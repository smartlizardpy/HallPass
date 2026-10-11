/**
 * Post-sign-in router.
 *
 * Google sends every successful sign-in here (see `startSignIn`). We read the
 * resolved session and route by ROLE: a dashboard admin goes to `/dashboard`,
 * an ordinary player to the arcade home `/`. Either way we append a `?welcome`
 * flag the client-side toast picks up.
 *
 * `?next=` (same-origin relative, validated) overrides the destination: the
 * other sign-in entry points (`/play/signin`, OAuth consent, the dashboard) send
 * Google here so that NO sign-in path skips the sign-up steps.
 *
 * A player with no handle is routed through `/play/welcome` first, so they get
 * to choose the name that lands on a leaderboard. It is no longer the LAST line
 * of defence — `getTopScores` cannot publish a Google name at all now — but a
 * name somebody chose still beats the generated stand-in they get otherwise.
 *
 * Returning-vs-first-time: the player's row is upserted during the auth callback
 * (so `last_login` is already ~now). On a brand-new player `created_at` is also
 * ~now, so a `last_login - created_at` gap above a few seconds means a returning
 * visitor → "Welcome back", otherwise "Welcome".
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/app/lib/auth";
import { getPlayerById } from "@/app/lib/players";
import { AVATAR_SKIP_COOKIE, landingTarget } from "@/app/lib/onboarding";
import { safeRelativePath } from "@/app/lib/safe-redirect";
import { social } from "@/app/lib/social";

// Reads the session cookie, so this route is inherently per-request.
export const dynamic = "force-dynamic";

const RETURNING_GAP_MS = 5_000;

export default async function AuthLandingPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next: rawNext } = await searchParams;
  // Optional caller-chosen destination (`/play/signin?callbackUrl=...`, the OAuth
  // consent page). Same-origin relative paths only.
  const explicitNext = rawNext ? safeRelativePath(rawNext, "") : "";
  const session = await auth();
  const playerId = session?.user?.playerId;

  // Not actually signed in (e.g. landed here directly) — nothing to route.
  if (!playerId) redirect("/");

  let returning = false;
  let handle: string | null = null;
  let username: string | null = null;
  let avatarMeme: string | null = null;
  try {
    const player = await getPlayerById(playerId);
    if (player) {
      // No handle yet -> send them through the one-time chooser first. Gating on
      // the COLUMN rather than on "is this their first login" also catches
      // existing players who never picked one — the population that otherwise
      // appears under a generated name rather than one they chose.
      handle = player.handle ?? null;
      avatarMeme = player.avatarMeme;
      // Fail-soft: if the social read hiccups, treat the username as present so a
      // database blip cannot insert an extra step into everybody's sign-in.
      const own = await social.getOwnSocial(playerId).catch(() => null);
      username = own ? (own.username ?? null) : "unknown";
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

  const destination =
    explicitNext ||
    `${session?.user?.role ? "/dashboard" : "/"}?welcome=${
      returning ? "back" : "new"
    }`;
  const avatarSkipped = Boolean((await cookies()).get(AVATAR_SKIP_COOKIE));

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
  //
  // The decision itself is `landingTarget` (pure, unit-tested). A failed identity
  // lookup leaves handle null, which routes to welcome; that page re-reads and
  // self-guards, so the worst case is one extra, harmless step.
  redirect(
    landingTarget({ handle, username, avatarMeme, avatarSkipped }, destination),
  );
}
