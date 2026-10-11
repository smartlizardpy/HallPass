/**
 * Which sign-up step the signed-in player still owes — `GET /api/v1/me/onboarding`.
 *
 * Read by `OnboardingGate`, the client-side backstop that sends a player with no
 * handle to `/play/welcome` on a normal page load. Its own endpoint, like the
 * friends count, so the append-only public `MeResponse` SDK contract does not
 * grow a field no game needs.
 *
 * Fail-soft to `done`: a signed-out visitor, a missing row (a session cookie that
 * outlived a deleted account) or a database blip all answer `done`, because a
 * gate that misfires is far worse than one that misses.
 */

import { AVATAR_SKIP_COOKIE, nextOnboardingStep } from "@/app/lib/onboarding";
import { getPlayerById } from "@/app/lib/players";
import { social } from "@/app/lib/social";
import { NO_STORE, currentPlayerId } from "@/app/lib/social/request-guard";
import { cookies } from "next/headers";

export async function GET(): Promise<Response> {
  const playerId = await currentPlayerId();
  if (!playerId) return Response.json({ step: "done" }, { headers: NO_STORE });

  try {
    const player = await getPlayerById(playerId);
    if (!player) return Response.json({ step: "done" }, { headers: NO_STORE });
    // A failed social read counts as "has a username" so a blip cannot add a step.
    const own = await social.getOwnSocial(playerId).catch(() => null);
    const step = nextOnboardingStep({
      handle: player.handle,
      username: own ? own.username : "unknown",
      avatarMeme: player.avatarMeme,
      avatarSkipped: Boolean((await cookies()).get(AVATAR_SKIP_COOKIE)),
    });
    return Response.json({ step }, { headers: NO_STORE });
  } catch (error) {
    console.error("me/onboarding failed:", error);
    return Response.json({ step: "done" }, { headers: NO_STORE });
  }
}
