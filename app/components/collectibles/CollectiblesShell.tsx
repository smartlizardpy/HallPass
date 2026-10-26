import { ArcadeShell } from "@/app/components/ArcadeShell";
import { resolveCategories, resolveGames } from "@/app/lib/games-store";

/**
 * The site chrome around a collectibles page. Reads only the (cached) game
 * catalogue, never the session, so the pages that use it stay static.
 */
export async function CollectiblesShell({ children }: { children: React.ReactNode }) {
  const [games, categories] = await Promise.all([resolveGames(), resolveCategories()]);
  return (
    <ArcadeShell games={games} categories={categories} activeCategory="">
      <div className="mx-auto w-full max-w-4xl space-y-6 px-3 pb-12 pt-4 sm:px-8">{children}</div>
    </ArcadeShell>
  );
}
