/**
 * HallPass — the reviews barrel: the live store bound to the shared Neon client.
 *
 * Mirrors `scoreboard/index.ts` and `social/index.ts`. The factory in `store.ts`
 * stays free of `server-only` so it can be unit-tested with a fake tagged
 * template; THIS module reaches for the real connection, so it is the one that
 * must never reach a client bundle.
 */

import "server-only";
import { createHash } from "node:crypto";
import { sql } from "@/app/lib/db";
import { createReviewStore } from "./store";

export const reviews = createReviewStore(sql);

export type { ReportOutcome, Review, ReviewSort, SubmitOutcome } from "./store";

/**
 * Salt for the per-author display tag (`Alex #7f3a`).
 *
 * Reuses the same env chain as `hashIp()` in `scoreboard/guard.ts` so no new
 * variable is required. The salt is what stops the tag being a durable
 * cross-service identifier: an unsalted hash of the Google subject would be
 * stable everywhere and trivially correlatable, which is exactly what must not be
 * published about a minor.
 */
export function authorTagSalt(): string {
  return (
    process.env.SCOREBOARD_IP_SALT ||
    process.env.SCOREBOARD_ADMIN_SECRET ||
    process.env.ADMIN_HTML_PASSWORD ||
    "hallpass-author-tag-pepper"
  );
}

/** sha256 of the canonicalised body, for double-submit suppression. */
export function hashBody(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}
