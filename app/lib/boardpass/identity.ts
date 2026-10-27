/**
 * BoardPass — the identity a game is shown for the player chosen on a board.
 *
 * Same SHAPE as `getPublicIdentity` (so the SDK needs no new type), but built for a
 * shared screen: the name is `publicDisplayName` (handle → @username → "Player"),
 * never the Google account name, and `id` is the player's PUBLIC id rather than the
 * Google subject. A classmate watching the board, or a game's own code, learns
 * nothing that is not already on the public leaderboard.
 */

import "server-only";
import { memeAvatarFor } from "@/app/lib/avatars";
import { sql } from "@/app/lib/db";
import { publicDisplayName } from "@/app/lib/players";
import type { PlayerIdentity } from "@/sdk/src/contract";

export async function getBoardIdentity(
  playerId: string,
): Promise<(PlayerIdentity & { publicId: string }) | null> {
  const rows = (await sql`
    SELECT public_id, handle, username, avatar_meme, avatar_colour
    FROM players WHERE id = ${playerId}
  `) as {
    public_id: string;
    handle: string | null;
    username: string | null;
    avatar_meme: string | null;
    avatar_colour: string | null;
  }[];
  const row = rows[0];
  if (!row) return null;
  const publicId = String(row.public_id);
  const name = publicDisplayName({ handle: row.handle, username: row.username });
  return {
    id: publicId,
    publicId,
    name,
    handle: name,
    image: memeAvatarFor(publicId, { meme: row.avatar_meme, colour: row.avatar_colour }),
  };
}
