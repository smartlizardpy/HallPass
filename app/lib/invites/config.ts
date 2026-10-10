/**
 * HallPass — game-invite tunables and vocabulary.
 *
 * Mirrors `challenges/config.ts` and `p2p/config.ts`: PURE — no database, no
 * `server-only`, no `window`. Read by the store, the route AND the picker, so
 * what the picker promises cannot drift from what the server enforces.
 * `docs/invites-design.md` has the whole design.
 *
 * THE ANTI-HARASSMENT DOCTRINE IS INHERITED FROM `social/config.ts`. A friend
 * invite makes somebody's phone buzz, so:
 *
 *  1. EVERYTHING IS KEYED BY `playerId` WHEN THERE IS ONE. A school NATs a whole
 *     computing lab to one address. Only GUEST links, which have no player, are
 *     keyed by IP — by a SALTED hash of it, never the address — and their limit
 *     is generous for exactly that reason.
 *  2. THERE IS NO CAP ON *INBOUND* INVITES. Inbound volume is bounded by limiting
 *     the SENDER (a rate and a per-pair cooldown), never the recipient, because an
 *     inbound cap is a denial of service aimed at the victim.
 */

/** The two kinds of row. A friend invite has a recipient; a link has none. */
export const INVITE_KINDS = ["friend", "link"] as const;
export type InviteKind = (typeof INVITE_KINDS)[number];

// ---------------------------------------------------------------------------
// Expiry
// ---------------------------------------------------------------------------

/** Minutes an invite lives when the game does not say. */
export const DEFAULT_EXPIRY_MINUTES = 30;

/**
 * The longest an invite may live. Invites are "come and play now": a room code
 * is worthless an hour later, and a short life is what lets this table need no
 * revocation UI and no cron.
 */
export const MAX_EXPIRY_MINUTES = 120;

/** The shortest. Anything below a minute could expire before the tap. */
export const MIN_EXPIRY_MINUTES = 1;

/**
 * Turn whatever a game passed into whole minutes in range, or `null` when it is
 * not a number at all (the route answers that with `bad-request`).
 *
 * Out-of-range numbers are CLAMPED rather than refused: "keep it for a day" is
 * an understandable request with an obvious nearest answer, and refusing it
 * would cost the player their invite over a developer's guess.
 */
export function clampExpiryMinutes(value: unknown): number | null {
  if (value === undefined || value === null) return DEFAULT_EXPIRY_MINUTES;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const whole = Math.round(value);
  return Math.min(MAX_EXPIRY_MINUTES, Math.max(MIN_EXPIRY_MINUTES, whole));
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export interface RateLimit {
  maxPerWindow: number;
  windowSeconds: number;
}

/**
 * Friend invites one player may send in a rolling hour. Each RECIPIENT counts,
 * so inviting five friends at once spends five. The same number as the
 * challenge sender limit, for the same reason: it is the ordinary loop of the
 * feature, and still a hard ceiling on how many phones one account can buzz.
 */
export const FRIEND_INVITE_RATE_LIMIT = {
  maxPerWindow: 20,
  windowSeconds: 3600,
} as const satisfies RateLimit;

/**
 * How long before the same sender may invite the same friend to the same game
 * again. The anti-nag window: a second invite inside it is a poke, not news.
 * A re-send inside the window is SKIPPED, not refused — the friend already has
 * an invite that works.
 */
export const INVITE_PAIR_COOLDOWN_SECONDS = 600;

/** Links one signed-in player may make in a rolling hour. They notify nobody. */
export const LINK_RATE_LIMIT = {
  maxPerWindow: 30,
  windowSeconds: 3600,
} as const satisfies RateLimit;

/**
 * Links made by GUESTS behind one IP in a rolling hour. Generous on purpose: a
 * whole school shares one address, and a link notifies nobody — this exists to
 * bound how many rows a script can write, not to stop a class from playing.
 */
export const GUEST_LINK_RATE_LIMIT = {
  maxPerWindow: 200,
  windowSeconds: 3600,
} as const satisfies RateLimit;

/** Friends one request may name. Never more than the hourly allowance. */
export const MAX_RECIPIENTS_PER_REQUEST = FRIEND_INVITE_RATE_LIMIT.maxPerWindow;

/**
 * How long an EXPIRED row is kept before a write collects it. It must be at
 * least the longest rate-limit window above: the limits count rows, so a row
 * collected early would hand its sender their allowance back.
 */
export const GC_GRACE_SECONDS = 3600;

/** Largest JSON body the route will read. `data` is 1 KB; the rest is ids. */
export const MAX_BODY_BYTES = 8 * 1024;

// ---------------------------------------------------------------------------
// Reasons
// ---------------------------------------------------------------------------

/**
 * Why `POST /api/v1/me/invites` refused. The picker turns each into a sentence
 * with {@link inviteRefusalText}.
 *
 * THERE IS NO `"blocked"` AND NO `"not-friends"`. A recipient who fails a gate is
 * skipped and the response reports only how many were sent, for the reason
 * `challenges/config.ts` gives: a separate answer would confirm to somebody that
 * a specific person blocked them.
 */
export const INVITE_REASONS = [
  "forbidden", // not from one of our own pages
  "bad-request", // malformed body, data or recipients
  "signed-out", // friend invites need a session
  "unknown-game", // not a catalogue game — ALSO what a hidden staged game reads as
  "rate-limited", // a sender limit refused it
  "unavailable", // schema not deployed / database unreachable
] as const;
export type InviteReason = (typeof INVITE_REASONS)[number];

/** Player-facing words for each refusal. Shared by the picker. */
export const INVITE_REFUSAL_TEXT: Record<InviteReason, string> = {
  forbidden: "Invites can only be sent from HallPass.",
  "bad-request": "This game sent an invite we can't read.",
  "signed-out": "Sign in to invite friends.",
  "unknown-game": "This game can't send invites.",
  "rate-limited": "That's a lot of invites. Try again in a little while.",
  unavailable: "Invites aren't available right now.",
};

/** The sentence for a reason the server sent, defaulting to "unavailable". */
export function inviteRefusalText(reason: unknown): string {
  return (INVITE_REASONS as readonly string[]).includes(String(reason))
    ? INVITE_REFUSAL_TEXT[reason as InviteReason]
    : INVITE_REFUSAL_TEXT.unavailable;
}
