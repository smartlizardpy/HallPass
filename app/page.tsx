import type { Metadata } from "next";
import { Arcade } from "./components/Arcade";
import { SiteJsonLd } from "./components/SiteJsonLd";
import { resolveCategories, resolveGames } from "./lib/games-store";
import { getGamePlayCounts } from "./lib/stats";

/**
 * The home grid declares its own canonical, and that is the whole reason this
 * export exists — title, description and the social card all come from the root
 * layout and are deliberately not repeated here.
 *
 * `/game/[slug]` and `/category/[category]` have both declared one for a while;
 * this page never did, which was harmless only for as long as nothing appended a
 * query string to it. Marketing links carry `?ref=…`, and the home grid is the
 * URL that gets shared most, so without this Google would be free to treat
 * `/?ref=tiktok`, `/?ref=discord` and `/` as three pages that happen to look
 * identical — splitting the ranking signal of the single most important URL on
 * the site across however many channels we advertise on.
 *
 * The grid also reads `?q=` for search (see `SiteJsonLd`'s `SearchAction`), so
 * the parameter-shaped duplicate already existed in principle. This closes both.
 *
 * A static `metadata` export adds no request-time work, so the page stays
 * prerenderable and stays in the service-worker precache.
 */
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

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
