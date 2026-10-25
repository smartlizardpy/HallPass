"use client";

import { GameCard } from "../components/GameCard";
import { useOpenGame } from "../components/ArcadeShell";
import type { Game } from "../lib/games";

export function FrightFestGames({ games }: { games: Game[] }) {
  const open = useOpenGame();
  return (
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      {games.map((g) => (
        <li key={g.slug}>
          <GameCard game={g} onPlay={open} />
        </li>
      ))}
    </ul>
  );
}
