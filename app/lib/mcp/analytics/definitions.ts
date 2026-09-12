/**
 * HallPass — what the numbers MEAN, handed to the model that is about to
 * recompute them.
 *
 * PURE, and the single most valuable thing in this feature.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * `run_analytics_sql` and `run_analytics_hogql` let a language model write its
 * own query. A model handed a schema and left to infer the metrics will infer
 * them plausibly and wrongly, and the failure is SILENT: there is no error, no
 * empty result and no type mismatch — just a confident number that disagrees
 * with the dashboard by 30% for a reason nobody can reconstruct a week later.
 *
 * Every line below is a definition this codebase has already paid for, written
 * down at length in `stats.ts` and `overview.ts` after somebody got it wrong.
 * Repeating them to the model is cheaper than having it rediscover them.
 */

/** The metric definitions `describe_analytics_schema` hands back. */
export const METRIC_DEFINITIONS: readonly string[] = [
  "A PLAY is the event `game_started`, and only that event. The featured banner " +
    "ALSO fires `featured_game_opened` for the same play, so counting both " +
    "double-counts every featured play. This was a real bug; see stats.ts.",

  "HOUR OF DAY from PostHog (`toHour`) is on the PostHog PROJECT's clock — not " +
    "UTC, and not the player's local time. The arcade is played from school, so " +
    "the shape of the day is the point and the offset matters.",

  "`toDayOfWeek` in HogQL is ISO: 1 = Monday … 7 = Sunday. NOT JavaScript's " +
    "0 = Sunday. Mixing them relabels every bar by one.",

  "ACTIVE (Neon) means `players.last_login` within the window: the player came " +
    "back to the SITE. It does not mean they played — plays are anonymous and " +
    "live in PostHog.",

  "RETURNING (Neon) means a login on a LATER DAY than sign-up " +
    "(`last_login > created_at + INTERVAL '1 day'`), deliberately not 'more than " +
    "one login'. One evening's session refreshes the cookie many times and is " +
    "still one visit.",

  "IDENTIFIED SCORES are `scores` rows with a player. The rest are anonymous " +
    "handle-only scores that still count on the board, so the ratio measures how " +
    "much of the score traffic the sign-in flow is reaching — not how much play " +
    "is real.",

  "THE TWO SOURCES COUNT DIFFERENT THINGS. PostHog counts anonymous DEVICES " +
    "(`distinct_id`); Neon counts signed-in PEOPLE. A ratio with one on each side " +
    "— 'plays per player', 'scores per visitor' — is almost always a mistake. Say " +
    "which source a number came from.",

  "POSTHOG IS A 30-DAY WINDOW in every panel the dashboard draws, and the " +
    "comparison is against the 30 days before it. Neon has full history.",

  "A GAP IN A DAILY SERIES IS A ZERO, not a missing point. `GROUP BY day` only " +
    "returns days with rows, so an unfilled series draws a straight line across a " +
    "quiet weekend as though play were continuous.",

  "A PERCENTAGE CHANGE FROM A ZERO BASELINE IS UNDEFINED, not 100% and not " +
    "infinity. The dashboard renders that case as '— new'.",

  "SEARCH TERMS are collapsed by PREFIX per five-minute burst per person and " +
    "ranked by DISTINCT PEOPLE. Raw `GROUP BY properties.query` ranks KEYSTROKE " +
    "PREFIXES: typing 'duskfall' once emits six events. `properties.results = 0` " +
    "only exists on events captured after the debounce shipped, so a search with " +
    "no `results` property is unknown, not zero.",

  "IN THE `mcp` SCHEMA every player is `player_public_id` (`players.public_id`). " +
    "There is no email, real name or photo in any view, and no way to join to " +
    "one. A NULL `player_public_id` means the row is genuinely anonymous, not " +
    "that the join failed.",
] as const;

/** The custom events PostHog carries, and what each one means. */
export const POSTHOG_EVENTS: readonly { event: string; meaning: string }[] = [
  { event: "game_started", meaning: "A game was opened. THE definition of a play. Properties: game_slug, game_category." },
  { event: "game_closed", meaning: "The player overlay was closed." },
  { event: "featured_game_opened", meaning: "The featured banner was used. Fires ALONGSIDE game_started — never count both as plays." },
  { event: "game_searched", meaning: "Debounced search. Properties: query, results (result count; absent on older events)." },
  { event: "day_played", meaning: "First play of a day. Properties: days_played, returning. The retention signal." },
  { event: "category_selected", meaning: "A category was chosen from the sidebar." },
  { event: "game_favorited / game_unfavorited", meaning: "A game was favourited or unfavourited." },
  { event: "game_video_played", meaning: "A game's trailer was played." },
  { event: "ad_clicked", meaning: "A sponsor strip was clicked." },
  { event: "surprise_me_clicked", meaning: "The random-game button." },
  { event: "fullscreen_toggled", meaning: "Fullscreen toggled inside the player." },
  { event: "feature_promo_shown / feature_promo_closed", meaning: "The in-site promo modal." },
  { event: "challenge_link_shared / _viewed / _started / _result / _escape / _signin", meaning: "The challenge-link share loop, in order of the funnel." },
  { event: "friends_board_shown", meaning: "The friends leaderboard was rendered." },
  { event: "$exception", meaning: "An uncaught error, captured automatically — from the site AND from the games it hosts." },
  { event: "$pageview / $autocapture", meaning: "PostHog defaults." },
] as const;

/** Super properties that ride on every event from a browser. */
export const POSTHOG_PROPERTIES: readonly { property: string; meaning: string }[] = [
  { property: "hp_initial_ref_channel", meaning: "First-touch acquisition channel, from the ?ref= parameter. Set once per browser and never overwritten." },
  { property: "$geoip_country_name", meaning: "Country, from PostHog's own GeoIP." },
  { property: "$device_type", meaning: "Desktop / Mobile / Tablet." },
  { property: "$referring_domain", meaning: "Referrer host. Exclude %hallpass% to see external referrers only." },
  { property: "$pathname", meaning: "Path. argMin over a session gives the entry page." },
] as const;
