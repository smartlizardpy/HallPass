<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into HALLPASS. The following files were created or modified:

- **`instrumentation-client.ts`** (created) — Initializes PostHog client-side using the Next.js 15.3+ `instrumentation-client` convention, with EU host, exception capture enabled, and a reverse proxy via `/ingest`.
- **`next.config.ts`** (modified) — Added `/ingest` rewrites pointing to `eu.i.posthog.com` and `eu-assets.i.posthog.com`, plus `skipTrailingSlashRedirect: true`.
- **`.env.local`** (created) — Contains `NEXT_PUBLIC_POSTHOG_TOKEN` and `NEXT_PUBLIC_POSTHOG_HOST` (gitignored).
- **`app/components/Arcade.tsx`** (modified) — Added `posthog-js` import and event captures for game starts, game closes, featured game plays, category selection, game search, and ad clicks.
- **`app/components/PlayerOverlay.tsx`** (modified) — Added `posthog-js` import and `fullscreen_toggled` event capture.

| Event | Description | File |
|---|---|---|
| `game_started` | User clicks to play any game | `app/components/Arcade.tsx` |
| `game_closed` | User closes the game player overlay | `app/components/Arcade.tsx` |
| `featured_game_played` | User clicks the featured hero banner to play | `app/components/Arcade.tsx` |
| `category_selected` | User selects a category from the sidebar | `app/components/Arcade.tsx` |
| `game_searched` | User types a search query (≥3 chars) | `app/components/Arcade.tsx` |
| `ad_clicked` | User clicks a sponsor/ad strip | `app/components/Arcade.tsx` |
| `fullscreen_toggled` | User toggles fullscreen in the game player | `app/components/PlayerOverlay.tsx` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- **Dashboard — Analytics basics**: https://eu.posthog.com/project/155984/dashboard/611558
- **Game starts over time**: https://eu.posthog.com/project/155984/insights/fStR9dFR
- **Top games by plays**: https://eu.posthog.com/project/155984/insights/1iOJ8ZDY
- **Game session funnel (start → close)**: https://eu.posthog.com/project/155984/insights/kjH6zmZG
- **Category popularity**: https://eu.posthog.com/project/155984/insights/vuGOW7eo
- **Ad clicks over time**: https://eu.posthog.com/project/155984/insights/vu0eWiXk

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
