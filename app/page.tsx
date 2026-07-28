import { Arcade } from "./components/Arcade";
import { SiteJsonLd } from "./components/SiteJsonLd";
import { resolveCategories, resolveGames } from "./lib/games-store";
import { getGamePlayCounts } from "./lib/stats";

export default async function Home() {
  const [games, categories, playCounts] = await Promise.all([
    resolveGames(),
    resolveCategories(),
    getGamePlayCounts(),
  ]);
  return (
    <>
      <SiteJsonLd />
      <h1 className="sr-only">Unblocked Games — Play Free Online at HALLPASS</h1>
      <Arcade games={games} categories={categories} playCounts={playCounts} />
    </>
  );
}
