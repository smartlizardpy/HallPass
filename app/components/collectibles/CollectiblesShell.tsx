import { ArcadeShell } from "@/app/components/ArcadeShell";
import { resolveCategories, resolveGames } from "@/app/lib/games-store";

/**
 * The site chrome around a collectibles page. Reads only the (cached) game
 * catalogue, never the session, so the pages that use it stay static.
 *
 * `wide`: the page lays out its own width (the Pack Room's scene runs the full
 * width of the content area), so the children are not put in the reading column.
 */
export async function CollectiblesShell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  const [games, categories] = await Promise.all([resolveGames(), resolveCategories()]);
  return (
    <ArcadeShell games={games} categories={categories} activeCategory="">
      {wide ? <div className="w-full pb-12">{children}</div> : <div className="mx-auto w-full max-w-4xl space-y-6 px-3 pb-12 pt-4 sm:px-8">{children}</div>}
    </ArcadeShell>
  );
}
