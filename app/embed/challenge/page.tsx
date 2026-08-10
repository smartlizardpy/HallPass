/**
 * The challenge picker — the small panel a game opens through
 * `HallPass.challenge()`.
 *
 * ── WHY THIS IS A PAGE AND NOT A WIDGET THE SDK DRAWS ──────────────────────
 * The SDK is a dependency-free IIFE that must never grow a UI framework, and it
 * runs INSIDE the game — where it can see nothing about the player. Rendering
 * the picker here instead means the friend list is fetched by a first-party page
 * with the session cookie, the markup is ours rather than reconstructed in
 * string concatenation, and the game gets no way to read who somebody's friends
 * are. The SDK's whole job is to size a frame and listen for a signal.
 *
 * ── IT IS DELIBERATELY SMALL ───────────────────────────────────────────────
 * A compact card, not a full-page takeover: the game stays visible behind it.
 * The frame is sized by the SDK to match, so this page styles a panel and never
 * a viewport.
 *
 * ── PER-VIEWER, AND PROTECTED IN TWO PLACES ────────────────────────────────
 * It calls `auth()`, so it is dynamic and never enters the precache. Separately
 * `sw.js` lists `/embed/` as a private path, because an iframe load still
 * reaches the fetch handler as a navigate request and `hp-runtime` is shared by
 * everyone on the browser profile. Both are needed; neither substitutes.
 *
 * `robots: noindex` for the same reason `/play/friends` carries it — this is a
 * personal surface, and one that only makes sense inside a frame.
 */

import type { Metadata } from "next";
import { auth } from "@/app/lib/auth";
import { social } from "@/app/lib/social";
import { isMissingColumnError } from "@/app/lib/db";
import type { PublicProfile } from "@/app/lib/social/store";
import { ChallengeEmbed } from "./ChallengeEmbed";

export const metadata: Metadata = {
  title: "Challenge a friend",
  robots: { index: false, follow: false },
};

/**
 * Read the viewer's friends, degrading to an empty list.
 *
 * Fail-soft for the same reason every social read is: schema here is applied by
 * hand, so there is always a window where this runs against a database without
 * the tables. An empty list renders "add a friend first", which is a true and
 * useful thing to say in both cases.
 */
async function friendsOf(playerId: string): Promise<PublicProfile[]> {
  try {
    return await social.listFriends(playerId);
  } catch (error) {
    if (!isMissingColumnError(error)) {
      console.error("[challenge-embed] listFriends failed:", error);
    }
    return [];
  }
}

export default async function ChallengeEmbedPage({
  searchParams,
}: {
  searchParams: Promise<{ board?: string; game?: string }>;
}) {
  const { board, game } = await searchParams;

  // `auth()` rather than `currentPlayerId()`: that helper lives in the social
  // request-guard and is for route handlers. Same source of truth either way —
  // `playerId` is the Google subject pinned at login, never `user.id`, which
  // `app/lib/auth.ts` documents as a fresh UUID on every login.
  const session = await auth().catch(() => null);
  const playerId = session?.user?.playerId ?? null;

  const friends = playerId ? await friendsOf(playerId) : [];

  return (
    <main className="p-3">
      <ChallengeEmbed
        signedIn={Boolean(playerId)}
        friends={friends}
        board={board ?? null}
        game={game ?? null}
      />
    </main>
  );
}
