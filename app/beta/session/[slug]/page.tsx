/**
 * A beta tester's playtest session for one game.
 *
 * WHY THIS IS A SEPARATE PAGE AND NOT A MODE OF `PlayerOverlay`. That component
 * is mounted by `/` and `/game/[slug]`, both of which MUST stay statically
 * prerenderable — one `auth()` reachable from either drops the route out of
 * `.next/prerender-manifest.json`, which drops it from `public/sw-manifest.js`,
 * which breaks offline play with no error anywhere. Tester logic lives here,
 * where the page is dynamic by design and shares nothing with those routes.
 *
 * The server half is deliberately thin: guard, resolve the game, hand off. All
 * the capture machinery is in the client island, because `getDisplayMedia`,
 * `<canvas>` and `MediaRecorder` have no server equivalent.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolveGame } from "@/app/lib/games-store";
import { getAssignments, requireBetaTester } from "@/app/lib/beta";
import { reviews } from "@/app/lib/reviews";
import { TestSessionClient } from "./TestSessionClient";

export const metadata: Metadata = {
  title: "Test session · HallPass",
  robots: { index: false, follow: false },
};

export default async function BetaSessionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { playerId } = await requireBetaTester(`/beta/session/${slug}`);

  const game = await resolveGame(slug);
  // `resolveGame` covers the static catalogue, overrides AND external games —
  // an off-site game is exactly the kind that most needs testing.
  if (!game) notFound();

  const [assignments, ownReview] = await Promise.all([
    getAssignments(playerId),
    // Finishing an assignment REQUIRES a review, so the session screen needs to
    // know up front whether one exists — a "Done" button that only explains
    // itself after being pressed is a worse experience than one that says so.
    // Fail-soft: showing the prompt to someone who already reviewed is harmless,
    // and `finishAssignmentAction` re-checks authoritatively.
    reviews.ownReview(slug, playerId).catch(() => null),
  ]);
  const assignment = assignments.find((a) => a.slug === slug);

  return (
    <TestSessionClient
      game={{
        slug: game.slug,
        title: game.title,
        externalUrl: game.externalUrl ?? null,
      }}
      brief={assignment?.brief ?? ""}
      hasAssignment={Boolean(assignment)}
      initiallyReviewed={ownReview != null}
    />
  );
}
