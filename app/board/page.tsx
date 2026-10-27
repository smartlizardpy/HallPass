import type { Metadata } from "next";
import { resolveGames } from "@/app/lib/games-store";
import { BoardMode } from "./_ui/BoardMode";

/**
 * BoardPass: the shared school-board lobby. The page ships only the PUBLIC game
 * catalogue; who is signed in comes from `/api/v1/boardpass/session` after load,
 * so this document is identical for everyone and carries no personal data.
 * Framing, caching and indexing are locked down by the `/board` header block in
 * `next.config.ts`.
 */
export const metadata: Metadata = {
  title: "Board Mode · HallPass",
  robots: { index: false, follow: false },
};

export default async function BoardPage() {
  const games = await resolveGames();
  return <BoardMode games={games} />;
}
