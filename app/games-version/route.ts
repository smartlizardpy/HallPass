/**
 * HallPass — the games-version poll endpoint.
 *
 * Answers `{ version }`. `app/components/PWA.tsx` polls this every 30s and
 * forwards the value to the service worker, which re-fetches every cached
 * `/game-html/` entry when it moves.
 *
 * THE RESPONSE STAYS UNCACHED, THE LOOKUP BEHIND IT DOES NOT. Clients must never
 * be served a stale version from an HTTP cache — that is the whole point of the
 * poll — so the response keeps `no-store`. The lookup is a cached read of
 * `app_settings`, so a poll from every open tab every 30 seconds costs at most
 * one Neon query an hour and no Blob operation at all.
 *
 * IT USED TO BE A BLOB `head()`, which was a billed simple operation per poll —
 * 95% of the monthly allowance before it was cached. See
 * `app/lib/games-version.ts` for the full history and the unchanged contract.
 *
 * FAIL-SOFT lives in `readGamesVersion()`, which degrades to `"0"`. The service
 * worker treats an unchanged version as "nothing to do", so a store failure
 * means no refresh rather than a spurious full-corpus re-download.
 */

import { readGamesVersion } from "@/app/lib/games-version";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    { version: await readGamesVersion() },
    {
      headers: { "cache-control": "no-store, must-revalidate" },
    },
  );
}
