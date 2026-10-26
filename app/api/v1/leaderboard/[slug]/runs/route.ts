/**
 * HallPass run start — `POST /api/v1/leaderboard/<board>/runs`.
 *
 * Hands a signed-in player a single-use run token for a championship board
 * (SDK `runStart`). Ordinary boards have no runs: they answer 404. See
 * `app/lib/championship/http.ts` for why this is same-origin and uncached.
 */

import type { ApiError } from "@/sdk/src/contract";
import { championshipBoard } from "@/app/lib/championship/config";
import { postRunStart } from "@/app/lib/championship/http";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const entry = championshipBoard(slug);
  if (!entry) {
    return Response.json({ error: "This board does not take runs" } satisfies ApiError, {
      status: 404,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  return postRunStart(req, entry);
}
