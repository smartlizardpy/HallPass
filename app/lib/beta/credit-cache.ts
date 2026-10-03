/**
 * HallPass — keeping the public tester credit on `/game/<slug>` in step with the
 * rows and names it is built from.
 *
 * The credit is a cached read (`readTestersCached` in `./index.ts`) of every
 * finished assignment JOINED to the tester's current display name, rendered on
 * a prerendered page. So it goes stale when an assignment stops counting
 * (re-assigned or withdrawn) AND when a credited tester renames or deletes
 * their account — and the deleted-account case is the one that matters: until
 * the cache moves, a name the player asked us to remove stays on an indexed
 * page. The cache lifetime is only a backstop; every one of those writes calls
 * {@link expireTesterCredits}.
 *
 * Kept free of `server-only` and the database so it can be unit-tested with
 * `next/cache` mocked; `./index.ts` re-exports the tag for existing importers.
 */

import { revalidatePath, revalidateTag, updateTag } from "next/cache";

/**
 * Cache tag for the tester-credit read. Invalidated when an assignment reaches
 * or leaves a finished state, and when a credited tester's name changes.
 */
export const BETA_CREDITS_CACHE_TAG = "beta-game-credits";

/**
 * Expire the tester-credit cache and the game pages that render it.
 *
 * `slugs` are the games whose credit changed. `[]` means "none did" and touches
 * nothing, so a rename by a player who never finished a playtest costs no
 * regeneration. `null` means "could not tell" and expires the tag alone, which
 * refreshes every page that read it — the safe answer when the lookup failed.
 *
 * `from` picks the API Next allows in the caller: `updateTag` (read-your-own-
 * writes) exists only in Server Actions, and a Route Handler must use
 * `revalidateTag` with an immediate expiry instead.
 */
export function expireTesterCredits(
  slugs: readonly string[] | null,
  from: "action" | "route",
): void {
  if (slugs !== null && slugs.length === 0) return;
  if (from === "action") updateTag(BETA_CREDITS_CACHE_TAG);
  else revalidateTag(BETA_CREDITS_CACHE_TAG, { expire: 0 });
  for (const slug of new Set(slugs ?? [])) revalidatePath(`/game/${slug}`);
}
