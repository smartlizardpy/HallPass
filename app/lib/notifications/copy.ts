/**
 * HallPass — what every notification actually says.
 *
 * PURE. No database, no `window`, no clock — so the wording, which is the part
 * with a safety argument attached, unit-tests in the plain `node` environment.
 *
 * ── WHY ALL THE WORDING IS IN ONE FILE ─────────────────────────────────────
 * Each builder here is called from a producer scattered across routes and server
 * actions, and it would have been natural to write the strings inline at each of
 * those. They live together instead because the wording carries three rules that
 * are only checkable when you can see them side by side:
 *
 *   1. THE FULL VERSION IS WHAT A BYSTANDER MIGHT READ. Every one of these is a
 *      candidate lock-screen banner on a school Chromebook. The discreet
 *      counterpart lives in `config.ts` per kind, and `copy.test.ts` asserts
 *      across the whole set that no discreet string can leak a name.
 *   2. PLAYER-SUPPLIED TEXT IS BOUNDED HERE, NOT AT THE CALL SITE. Handles, game
 *      titles and review excerpts all reach these strings. {@link shortName}
 *      bounds them so a long handle cannot push the verb off a banner, and
 *      `deliver.ts` applies the hard ceiling from `config.ts` on top.
 *   3. THE SAME STRING GOES TO BOTH SURFACES. What is stored in the bell and
 *      what is pushed to a device are the SAME title and body — built once,
 *      here. Deriving them separately is how a notification comes to say one
 *      thing on a phone and another in the inbox.
 *
 * ── NO SCORES, NO EXCERPTS, NO COUNTS ──────────────────────────────────────
 * Carried over from the challenge wording these builders replace: the number
 * belongs on the page, where it arrives with a Play button. The same reasoning
 * extends to the moderation kinds — an admin banner names the game, never the
 * reported text, because a report is frequently about the text being vile.
 */

import { NOTIFICATION_BODY_MAX, NOTIFICATION_TITLE_MAX } from "./config";

/** One rendering of a notification: what it says, and where a tap lands. */
export type NotificationCopy = {
  title: string;
  body: string;
  url: string;
};

/**
 * Trim and bound a name so a long handle cannot push the verb off the banner.
 *
 * Unchanged from the challenge notification this generalises, including the
 * `"A friend"` fallback for a blank name — a banner reading "  challenged you"
 * is worse than a vague one.
 */
export function shortName(name: string, fallback = "A friend"): string {
  const clean = name.trim();
  if (clean.length === 0) return fallback;
  return clean.length > 24 ? `${clean.slice(0, 23)}…` : clean;
}

/**
 * Apply the hard ceilings from `config.ts`.
 *
 * Belt and braces over {@link shortName}: that bounds ONE interpolated value,
 * while this bounds the finished string, so a builder that interpolates two long
 * values still cannot produce an unbounded row. Applied at build time rather
 * than at insert time so what is stored and what is pushed are identical.
 */
function bound(copy: NotificationCopy): NotificationCopy {
  return {
    title: copy.title.slice(0, NOTIFICATION_TITLE_MAX),
    body: copy.body.slice(0, NOTIFICATION_BODY_MAX),
    url: copy.url,
  };
}

// ---------------------------------------------------------------------------
// Social
// ---------------------------------------------------------------------------

/**
 * "Ozan challenged you."
 *
 * WORD FOR WORD what `push/payload.ts` sent before the inbox existed, so the one
 * kind that already shipped keeps its copy — including omitting the SCORE from
 * even the full version.
 *
 * Lands on the inbox rather than the game: a challenge might be one of several,
 * and that is the screen that can show all of them with a way to act on each.
 */
export function challengeCopy(input: {
  from: string;
  /**
   * The game's DISPLAY TITLE ("Neon Velocity"), never its slug. A slug reads as
   * "Beat their score on neon-velocity-hyperdrive", which looks fine in a test
   * fixture and wrong on a lock screen. The caller resolves it; `null` falls
   * back to the board title.
   */
  game: string | null;
  boardTitle: string;
}): NotificationCopy {
  const from = shortName(input.from);
  const where = input.game ?? input.boardTitle;
  return bound({
    title: `${from} challenged you`,
    body: where ? `Beat their score on ${where}.` : "Beat their score.",
    url: "/play/you/friends",
  });
}

/**
 * "Deniz beat your score."
 *
 * THE ONE PLACE A NUMBER IS ALLOWED, and only the one the reader already knows.
 * Every other builder here omits scores on the grounds that the number belongs
 * on the page, where it arrives with a Play button. This notification IS about
 * a number changing hands, and "beat your 4,200" is what makes it worth
 * reading — but it is the RECIPIENT'S OWN score, which they set and which is
 * already public on the board, so a bystander reading it over their shoulder
 * learns nothing they could not see on the leaderboard.
 *
 * The winning score is deliberately NOT included. That one belongs to somebody
 * else, and a lock-screen banner is not the place to publish a third party's
 * result to whoever is holding the phone.
 *
 * Lands on the challenges tab rather than the board, because the useful next
 * action is sending one back rather than looking at a table.
 */
export function challengeBeatenCopy(input: {
  by: string;
  /** The DISPLAY TITLE, never the slug — see {@link challengeCopy}. */
  game: string | null;
  boardTitle: string;
  /** The recipient's own score, the one that was beaten. */
  targetScore: number;
}): NotificationCopy {
  const by = shortName(input.by, "Someone");
  const where = input.game ?? input.boardTitle;
  return bound({
    title: `${by} beat your score`,
    body: where
      ? `Your ${input.targetScore.toLocaleString("en-US")} on ${where} has gone.`
      : `Your ${input.targetScore.toLocaleString("en-US")} has gone.`,
    url: "/play/you/friends",
  });
}

/** "Ayşe wants to be friends." */
export function friendRequestCopy(input: { from: string }): NotificationCopy {
  return bound({
    title: `${shortName(input.from, "Someone")} wants to be friends`,
    body: "Accept to see what they're playing.",
    url: "/play/you/friends",
  });
}

/** "Ayşe accepted your friend request." */
export function friendAcceptedCopy(input: { from: string }): NotificationCopy {
  return bound({
    title: `${shortName(input.from, "Someone")} accepted your request`,
    body: "You can challenge each other now.",
    url: "/play/you/friends",
  });
}

// ---------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------

/**
 * "Duskfall just landed."
 *
 * The one BROADCAST kind, so it is written for everybody at once: no "you", no
 * assumption the reader has played anything before, and it lands on the game's
 * own page because that is the only useful destination for an announcement about
 * one game.
 */
export function gameDropCopy(input: {
  title: string;
  slug: string;
}): NotificationCopy {
  const name = shortName(input.title, "A new game");
  return bound({
    title: `${name} just landed`,
    body: "A new game is in the arcade. Go and play it.",
    url: `/game/${input.slug}`,
  });
}

/** "You unlocked Deathless." */
export function achievementCopy(input: {
  achievement: string;
  gameTitle: string;
  slug: string;
}): NotificationCopy {
  return bound({
    title: `You unlocked ${shortName(input.achievement, "an achievement")}`,
    body: `On ${shortName(input.gameTitle, "a game")}.`,
    url: `/game/${input.slug}`,
  });
}

// ---------------------------------------------------------------------------
// Beta
// ---------------------------------------------------------------------------

/** "Duskfall is yours to test." */
export function betaAssignmentCopy(input: {
  gameTitle: string;
}): NotificationCopy {
  return bound({
    title: `${shortName(input.gameTitle, "A game")} is yours to test`,
    body: "Play it, break it, and file what you find for XP.",
    url: "/beta",
  });
}

// ---------------------------------------------------------------------------
// Moderation (admin)
// ---------------------------------------------------------------------------

/**
 * "New review on Duskfall."
 *
 * NAMES THE GAME, NEVER THE REVIEW TEXT. An admin notification is still a
 * banner on somebody's phone, and the content is exactly what has not been
 * moderated yet — quoting it would push unmoderated text onto a lock screen,
 * which is the one place it cannot be taken back from.
 */
export function reviewPostedCopy(input: {
  gameTitle: string;
  slug: string;
}): NotificationCopy {
  return bound({
    title: `New review on ${shortName(input.gameTitle, "a game")}`,
    body: "Someone posted a review. Open moderation to read it.",
    url: "/dashboard/moderation",
  });
}

/** "A review was reported." Names neither the text nor the reporter. */
export function reviewReportedCopy(input: {
  gameTitle: string;
}): NotificationCopy {
  return bound({
    title: `A review was reported`,
    body: `On ${shortName(input.gameTitle, "a game")}. Open moderation to decide.`,
    url: "/dashboard/moderation",
  });
}

/** "New bug report from a tester." */
export function bugReportCopy(input: { gameTitle: string }): NotificationCopy {
  return bound({
    title: "New bug report filed",
    body: `A tester found something on ${shortName(input.gameTitle, "a game")}.`,
    url: "/dashboard/beta",
  });
}

// ---------------------------------------------------------------------------
// Site health (admin)
// ---------------------------------------------------------------------------

/**
 * THE NUMBER IS THE MESSAGE HERE, AND THAT IS A DELIBERATE EXCEPTION.
 *
 * Everything above omits counts on the grounds that the number belongs on the
 * page, where it arrives with a Play button. These three have no Play button
 * behind them: they are measurements, sent because a measurement crossed a line,
 * and "traffic is spiking" without a figure cannot be acted on or even sanity
 * checked — an admin would have to open the dashboard to learn whether it meant
 * forty players or four hundred. Stripping the number would leave a notification
 * whose only content is that a notification was sent.
 *
 * The bystander argument that motivates the rule does not carry over either. A
 * lock screen reading "312 players in the last hour" names no person, no game
 * and no score; it is a fact about the site, published to the person who runs
 * it. The discreet counterparts in `config.ts` stay figure-free regardless, so a
 * device in quiet mode shows none of it.
 *
 * All three land on `/dashboard/growth`, which is where the panels that explain
 * the number already live.
 */
const OPS_URL = "/dashboard/growth";

/** Whole numbers, grouped, matching {@link challengeBeatenCopy}'s formatting. */
function count(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/**
 * A multiplier as an admin would say it out loud: "4×", "2.5×".
 *
 * One decimal place only below ten, and none above it — "12.4× the usual" is
 * false precision on a median of seven days, and the difference between 12× and
 * 13× changes nothing about what anybody does next.
 */
function times(ratio: number): string {
  return ratio >= 10 ? `${Math.round(ratio)}×` : `${Math.round(ratio * 10) / 10}×`;
}

/**
 * "Traffic is spiking."
 *
 * The one piece of GOOD news the site sends itself, and the reason the alerts
 * exist at all: a spike is only worth knowing about while it is still happening.
 */
export function trafficSpikeCopy(input: {
  /** Distinct players in the measured window. */
  visitors: number;
  /** How many times the usual figure for this hour of the day. */
  ratio: number;
}): NotificationCopy {
  return bound({
    title: "Traffic is spiking",
    body:
      `${count(input.visitors)} players in the last hour — about ` +
      `${times(input.ratio)} the usual for this time of day.`,
    url: OPS_URL,
  });
}

/**
 * "Errors are spiking."
 *
 * Names the count and nothing about the errors themselves. The message that
 * comes with a JavaScript exception is written by a game nobody here wrote, and
 * a lock screen is the one place it could not be taken back from — the same
 * argument `reviewPostedCopy` makes about unmoderated text.
 */
export function errorSpikeCopy(input: {
  /** Exceptions captured in the measured window. */
  errors: number;
  /** How many times the usual figure, or `null` when there is no baseline. */
  ratio: number | null;
}): NotificationCopy {
  const scale =
    input.ratio === null
      ? "The site is usually quiet."
      : `About ${times(input.ratio)} the usual for this time of day.`;
  return bound({
    title: "Errors are spiking",
    body: `${count(input.errors)} errors in the last hour. ${scale}`,
    url: OPS_URL,
  });
}

/**
 * "Players are searching for a game you do not have."
 *
 * The search term IS quoted, unlike a review excerpt, and the difference is who
 * wrote it: a review is one person's prose about somebody else, while a search
 * term is a game's name typed by however many players this alert counted. It is
 * also the entire actionable content — the alert exists to name the next game to
 * add, and "several players searched for something" names nothing.
 *
 * It is still player-typed text, so it goes through {@link shortName} like any
 * other interpolated value.
 */
export function contentGapCopy(input: {
  /** The most-searched term that matched no game. */
  term: string;
  /** How many distinct players searched it. */
  people: number;
}): NotificationCopy {
  const term = shortName(input.term, "something");
  return bound({
    title: "A game people want is missing",
    body:
      `${count(input.people)} players searched for “${term}” today ` +
      "and found nothing.",
    url: OPS_URL,
  });
}
