/**
 * HallPass — is a review off-limits because its game is staged?
 *
 * The review sub-routes (`translate`, `helpful`, `report`) are addressed by a
 * SEQUENTIAL numeric review id, not by slug. Left alone, anyone could count
 * upwards through the ids and read, vote on or report a staged game's reviews,
 * which would confirm the game exists and leak what testers wrote about it. So
 * each resolves the id back to its game (`reviews.slugForReview`) and asks this.
 *
 * `true` only when the review's game is staged AND the viewer may not see staged
 * games. The callers answer `true` exactly as they answer a review that does not
 * exist, so a denied request reveals nothing.
 *
 * `canViewStaged()` (which reads the session) runs ONLY on the staged branch — an
 * ordinary review costs one slug lookup and a cached catalogue read, and keeps
 * today's headers and CDN caching. Throws if the slug lookup does; callers call
 * it inside the same try/catch that already covers their review query.
 */

import "server-only";
import { canViewStaged } from "@/app/lib/beta/staged-access";
import { isStagedSlug } from "@/app/lib/games-store";
import { reviews } from "@/app/lib/reviews";

export async function isReviewHiddenFromViewer(reviewId: number): Promise<boolean> {
  const slug = await reviews.slugForReview(reviewId);
  if (slug === null || !(await isStagedSlug(slug))) return false;
  return !(await canViewStaged());
}
