/**
 * HallPass — the notification catalogue and its vocabulary.
 *
 * Mirrors `challenges/config.ts`, `social/config.ts` and `reviews/config.ts`:
 * PURE — no database, no `server-only`, no `window`. Read by the store, the
 * delivery path, the API routes AND the client islands, so what the settings
 * page offers cannot drift from what the server actually honours.
 *
 * ── THE CATALOGUE LIVES IN CODE, NOT IN A TABLE ────────────────────────────
 * There is deliberately no `notification_kinds` table. A kind is not data an
 * admin edits — it is a branch of the program, with a producer that has to be
 * written and copy that has to be worded. A table would let somebody create a
 * kind nothing can ever emit, and it would put the DEFAULTS — which are a
 * product judgement about whose phone buzzes — behind a migration.
 *
 * The database stores only DEVIATIONS from what is here (`notification_prefs` is
 * sparse), which is what lets a new kind go live for every player the moment it
 * deploys, with no backfill.
 *
 * ── EVERY KIND SHIPS DISCREET COPY ─────────────────────────────────────────
 * `push/payload.ts` explains at length why a push payload carries BOTH a full
 * and a discreet rendering and lets the device pick: a service worker cannot
 * read `localStorage`, which is where the stealth preferences live. That
 * argument was never challenge-specific — a banner reading "You unlocked
 * Deathless on Duskfall" during a lesson is exactly what the panic key exists to
 * prevent — so {@link NotificationKindDef.discreet} is REQUIRED on every entry
 * and the generic payload builder refuses to guess one.
 *
 * ── UNKNOWN KINDS DEGRADE, THEY DO NOT THROW ───────────────────────────────
 * `kind` is free TEXT in the database with no CHECK (024's header says why), so
 * a row written by a newer deploy can be read by an older one. Everything here
 * that takes a kind narrows it first and drops what it does not recognise, so
 * the worst case is a notification that does not render rather than a bell that
 * 500s.
 */

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

/**
 * How loudly a kind is delivered. ORDERED, quietest first — the settings UI
 * renders it as a scale, and {@link isAtLeast} depends on the order.
 *
 * `push` IMPLIES `bell`. There is deliberately no "push but not inbox": a push
 * that leaves no trace is a message you cannot go back and re-read, and the
 * whole reason this feature exists is that the pre-024 transport did exactly
 * that.
 */
export const NOTIFICATION_CHANNELS = ["off", "bell", "push"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** Narrow an untrusted value (a request body, a database row) to a channel. */
export function toChannel(value: unknown): NotificationChannel | null {
  return (NOTIFICATION_CHANNELS as readonly string[]).includes(String(value))
    ? (value as NotificationChannel)
    : null;
}

/** Whether `channel` is at least as loud as `floor`. */
export function isAtLeast(
  channel: NotificationChannel,
  floor: NotificationChannel,
): boolean {
  return (
    NOTIFICATION_CHANNELS.indexOf(channel) >= NOTIFICATION_CHANNELS.indexOf(floor)
  );
}

/** Does this land in the bell at all? */
export function deliversToBell(channel: NotificationChannel): boolean {
  return isAtLeast(channel, "bell");
}

/** Does this also leave the browser as a Web Push? */
export function deliversToPush(channel: NotificationChannel): boolean {
  return channel === "push";
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

/**
 * The headings the settings page renders, in order.
 *
 * `moderation` is the admin one and is filtered out for everybody else by
 * {@link kindsForAudience} rather than by the page — a surface that decided its
 * own visibility would be one `&&` away from listing admin kinds to a player.
 */
export const NOTIFICATION_GROUPS = [
  { id: "social", label: "Friends", blurb: "Challenges and friend requests." },
  { id: "games", label: "Games", blurb: "New games and what you unlock." },
  { id: "beta", label: "Beta testing", blurb: "Games assigned to you to break." },
  {
    id: "moderation",
    label: "Moderation",
    blurb: "What players post and report, for admins.",
  },
] as const;

export type NotificationGroup = (typeof NOTIFICATION_GROUPS)[number]["id"];

/** Who a kind is for. Resolved at SEND time for `admin` — see `deliver.ts`. */
export type NotificationAudience = "player" | "admin";

/**
 * Whether a kind is aimed at one person or at the whole site.
 *
 * `broadcast` is the nullable-`player_id` row from 024. It is a property of the
 * KIND rather than of a call, so a producer cannot accidentally send a game drop
 * to one player or a challenge to everybody.
 */
export type NotificationScope = "personal" | "broadcast";

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

export type NotificationKindDef = {
  audience: NotificationAudience;
  scope: NotificationScope;
  group: NotificationGroup;
  /** The row label on the settings page. */
  label: string;
  /** One line under the label, saying what actually triggers it. */
  description: string;
  /**
   * The glyph the bell and the settings page draw beside a row.
   *
   * PART OF THE CATALOGUE rather than a lookup table next to the components, so
   * the two surfaces cannot disagree about what a kind looks like and adding a
   * kind cannot leave one of them blank. Always rendered `aria-hidden` — it
   * decorates a label that already says the same thing in words.
   */
  icon: string;
  /**
   * What a player who has never touched their settings gets.
   *
   * THE LOUD DEFAULTS ARE THE ONES ABOUT YOU. A friend challenging you is a
   * message from a person and defaults to `push`. A game drop fires for the
   * entire site at once, so it defaults to `bell` — a default-on push for
   * everybody is precisely how an arcade teaches people to turn notifications
   * off altogether. Push for drops is one toggle away for anyone who wants it.
   */
  defaultChannel: NotificationChannel;
  /**
   * The discreet BODY, for a device with quiet notifications on. Required — see
   * the module docblock.
   *
   * It must name NOBODY AND NOTHING: not the sender, not the game, not the
   * score. Somebody who switched quiet mode on did so to stop a bystander
   * learning any of those, and the only job left is to be enough to make them
   * open the site. The title is always "HallPass" (see `push/payload.ts`), so
   * this is the whole of what a shoulder-surfer can read.
   */
  discreet: string;
};

/**
 * Every kind the site can emit.
 *
 * Adding one is: an entry here, a producer that calls `notify`, and nothing
 * else. No migration, no backfill, and it is live for every player at their
 * chosen default immediately.
 */
export const NOTIFICATION_KINDS = {
  challenge_received: {
    audience: "player",
    scope: "personal",
    group: "social",
    label: "Challenges",
    icon: "⚔️",
    description: "A friend dares you to beat their score.",
    defaultChannel: "push",
    // Unchanged from the pre-024 wording, so the one kind that already shipped
    // keeps the exact copy `push/payload.test.ts` pins.
    discreet: "You have a new challenge.",
  },
  friend_request: {
    audience: "player",
    scope: "personal",
    group: "social",
    label: "Friend requests",
    icon: "🤝",
    description: "Someone asks to be your friend.",
    defaultChannel: "push",
    discreet: "You have a new friend request.",
  },
  friend_accepted: {
    audience: "player",
    scope: "personal",
    group: "social",
    label: "Accepted requests",
    icon: "✅",
    description: "Someone accepts the request you sent.",
    // Quieter than the request itself: this is good news you will see next time
    // you look, not something that needs your attention now.
    defaultChannel: "bell",
    discreet: "One of your friend requests was accepted.",
  },
  game_drop: {
    audience: "player",
    scope: "broadcast",
    group: "games",
    label: "New games",
    icon: "🎮",
    description: "A new game lands in the arcade.",
    // Bell by default — see `defaultChannel`'s docblock. This is the kind that
    // fires for everybody at once.
    defaultChannel: "bell",
    discreet: "There is something new to play.",
  },
  achievement_unlocked: {
    audience: "player",
    scope: "personal",
    group: "games",
    label: "Achievements",
    icon: "👑",
    description: "You unlock something in a game.",
    // You were looking at the screen when it happened — a push would buzz your
    // pocket about a thing you just did.
    defaultChannel: "bell",
    discreet: "You unlocked something.",
  },
  beta_assignment: {
    audience: "player",
    scope: "personal",
    group: "beta",
    label: "Playtest assignments",
    icon: "🐛",
    description: "A game is assigned to you to test.",
    // Assignments are work with a queue behind them, and testers asked to be in
    // the programme.
    defaultChannel: "push",
    discreet: "You have a new playtest assignment.",
  },
  review_posted: {
    audience: "admin",
    scope: "personal",
    group: "moderation",
    label: "New reviews",
    icon: "📝",
    description: "A player posts a review on a game.",
    // Routine volume. The bell is a queue to work through, not an interruption.
    defaultChannel: "bell",
    discreet: "There is something new to moderate.",
  },
  review_reported: {
    audience: "admin",
    scope: "personal",
    group: "moderation",
    label: "Reported reviews",
    icon: "🚩",
    description: "A player reports a review for moderation.",
    // A report is somebody saying something is wrong RIGHT NOW, and it is rare
    // enough that a push is not noise.
    defaultChannel: "push",
    discreet: "Something needs moderating.",
  },
  bug_report_filed: {
    audience: "admin",
    scope: "personal",
    group: "moderation",
    label: "Bug reports",
    icon: "🔧",
    description: "A beta tester files a bug report.",
    defaultChannel: "bell",
    discreet: "A new bug report was filed.",
  },
} as const satisfies Record<string, NotificationKindDef>;

export type NotificationKind = keyof typeof NOTIFICATION_KINDS;

/** Every kind, as a plain array. */
export const NOTIFICATION_KIND_IDS = Object.keys(
  NOTIFICATION_KINDS,
) as NotificationKind[];

/** Narrow an untrusted value to a known kind. */
export function isNotificationKind(value: unknown): value is NotificationKind {
  return typeof value === "string" && value in NOTIFICATION_KINDS;
}

/** The definition for a kind, or `null` if this deploy does not know it. */
export function kindDef(kind: string): NotificationKindDef | null {
  return isNotificationKind(kind) ? NOTIFICATION_KINDS[kind] : null;
}

/**
 * The kinds one audience may see and set.
 *
 * An admin sees BOTH — they are a player as well — while a player never sees the
 * admin ones. Done here rather than in the settings page so a surface cannot
 * decide its own visibility and get it wrong.
 */
export function kindsForAudience(
  audience: NotificationAudience,
): NotificationKind[] {
  if (audience === "admin") return NOTIFICATION_KIND_IDS;
  return NOTIFICATION_KIND_IDS.filter(
    (kind) => NOTIFICATION_KINDS[kind].audience === "player",
  );
}

/**
 * The channel actually in force: the player's stored deviation, or the kind's
 * default when they have never expressed one.
 *
 * `stored` is whatever came out of `notification_prefs` — including a value
 * written by a newer deploy — so it is narrowed rather than trusted. An
 * unreadable preference falls back to the default rather than to silence: a
 * corrupt row must not be able to mute somebody.
 */
export function resolveChannel(
  kind: NotificationKind,
  stored: unknown,
): NotificationChannel {
  return toChannel(stored) ?? NOTIFICATION_KINDS[kind].defaultChannel;
}

/**
 * The service worker `tag` for a kind.
 *
 * PER KIND, not one shared tag. A tag collapses banners, which is what makes
 * four challenges arriving while a phone is in a bag show up as one — but a
 * SHARED tag would make a friend request replace the challenge underneath it,
 * and the player would never learn the challenge existed. Same-kind collapsing
 * is a feature; cross-kind collapsing is data loss.
 */
export function notificationTag(kind: NotificationKind): string {
  return `hp-${kind}`;
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/**
 * Personal notifications kept per player, and broadcasts kept site-wide.
 *
 * These are RETENTION, not pagination, and they are what makes the table bounded
 * with no cron to sweep with: each insert evicts past its own cap in the SAME
 * statement, exactly as `push_subscriptions` caps devices. Eviction is by
 * `created_at` and never by read state — an old notification you never opened is
 * still old.
 */
export const NOTIFICATIONS_KEEP_PER_PLAYER = 100;
export const NOTIFICATIONS_KEEP_BROADCASTS = 100;

/** Rows the `/play/you/notifications` list renders. */
export const NOTIFICATION_LIST_LIMIT = 50;

/** Rows the header bell's dropdown renders. Small: it is a peek, not the page. */
export const BELL_LIST_LIMIT = 12;

/**
 * Ceiling on stored copy, applied by the delivery path.
 *
 * A notification body is written by a producer, but several producers
 * interpolate PLAYER-SUPPLIED text (a handle, a game title, a review excerpt).
 * Bounding it here means one long handle cannot push a row's layout apart or
 * bloat every bell poll for the rest of that player's retention window.
 */
export const NOTIFICATION_TITLE_MAX = 120;
export const NOTIFICATION_BODY_MAX = 240;
