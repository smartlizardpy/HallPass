import { Arcade } from "./components/Arcade";
import { resolveCategories, resolveGames } from "./lib/games-store";
import { getGamePlayCounts } from "./lib/stats";

export default async function Home() {
  const [games, categories, playCounts] = await Promise.all([
    resolveGames(),
    resolveCategories(),
    getGamePlayCounts(),
  ]);
  return <Arcade games={games} categories={categories} playCounts={playCounts} />;
}
