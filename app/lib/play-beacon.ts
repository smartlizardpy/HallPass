import { isAnalyticsOptedOut } from "./analytics-consent";

/**
 * Report one play to the permanent per-game total (`POST /api/v1/plays`).
 *
 * Fired by `PlayerOverlay` beside `game_started`, so the two stay the same
 * definition of "a play": a game was opened, once per open, from any entry path.
 *
 * Respects the per-device analytics choice (`analytics-consent.ts`, the same flag
 * that switches PostHog off). The counter stores nothing about the
 * visitor, but it is the same act `game_started` records, so someone who has
 * opted out of analytics is not counted by one and silently counted by the other.
 *
 * Fire-and-forget with a swallowed catch, and `keepalive: true` for the same
 * reason as `recordPlayServerSide`: the overlay mounts right as the page may
 * navigate, and without the flag the request can be cancelled in flight.
 */
export function recordPlayTotal(slug: string): void {
  if (!slug) return;
  if (isAnalyticsOptedOut()) return;
  void fetch("/api/v1/plays", {
    method: "POST",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug }),
  }).catch(() => {});
}
