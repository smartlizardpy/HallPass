import { Arcade } from "./components/Arcade";
import { getGamePlayCounts } from "./lib/stats";

export default async function Home() {
  const playCounts = await getGamePlayCounts();
  return <Arcade playCounts={playCounts} />;
}
