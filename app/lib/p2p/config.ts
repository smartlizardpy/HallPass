/**
 * HallPass P2P signaling — tunables.
 *
 * Pure, no `server-only`, no database — the same shape as `challenges/config.ts`
 * and `scoreboard/config.ts`, so the store, the routes and the tests read one set
 * of numbers. `docs/p2p-design.md` explains the design these bound.
 *
 * RATE LIMITS ARE KEYED BY PLAYER WHEN WE CAN, BY IP ONLY FOR GUESTS. A school
 * NATs a whole computing lab to one address (see `challenges/config.ts`), so the
 * per-IP numbers are deliberately generous: they exist to make guessing room
 * codes slow, not to stop a class from playing.
 */

/** A room whose host has not polled for this long is gone. */
export const ROOM_TTL_SECONDS = 180;

/** Unread signals older than this are collected. */
export const SIGNAL_TTL_SECONDS = 600;

/** Rate-limit rows older than this are collected (must exceed every window). */
export const ATTEMPT_TTL_SECONDS = 3600;

export interface RateLimit {
  maxPerWindow: number;
  windowSeconds: number;
}

export const RATE_LIMITS = {
  /** Rooms one player/IP may open. */
  create: { maxPerWindow: 20, windowSeconds: 600 },
  /** Join attempts, successful or not. */
  join: { maxPerWindow: 40, windowSeconds: 600 },
  /** Join attempts that named a room that does not exist — the code-guessing signal. */
  miss: { maxPerWindow: 60, windowSeconds: 600 },
  /** TURN credentials minted. */
  ice: { maxPerWindow: 60, windowSeconds: 600 },
} as const satisfies Record<string, RateLimit>;

export type AttemptKind = keyof typeof RATE_LIMITS;

/** One signaling message body, serialised. SDP with many candidates is ~5 KB. */
export const MAX_SIGNAL_BYTES = 16 * 1024;

/** Messages one request may send. */
export const MAX_SIGNALS_PER_REQUEST = 32;

/** Messages one poll may return. */
export const MAX_SIGNALS_PER_POLL = 64;

/** Pending (unacknowledged) rows one room may hold before sends are refused. */
export const MAX_PENDING_PER_ROOM = 400;

/** Poll interval hint returned to clients, in ms. The SDK owns the real policy. */
export const POLL_HINT_MS = 250;

/** Default TURN credential lifetime. Longer than any play session. */
export const DEFAULT_TURN_TTL_SECONDS = 4 * 3600;

/** Public STUN servers used when `P2P_STUN_URLS` is unset. */
export const DEFAULT_STUN_URLS = ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"];

/**
 * Whether the HallPass avatar (usually a Google profile photo) is shared with
 * other players in a room. OFF: a HallPass avatar is "frequently a real
 * photograph of a child" (`app/u/[username]/page.tsx`), and peers in a room are
 * whoever knew or guessed a 4-character code. Flip it here if that changes.
 */
export const SHARE_AVATAR_WITH_PEERS = false;

/** True when an operator switched the whole feature off (`P2P_DISABLED=1`). */
export function isP2PDisabled(): boolean {
  return /^(1|true|yes|on)$/i.test(process.env.P2P_DISABLED?.trim() ?? "");
}

/** True when every client must use relay-only ICE (`P2P_FORCE_RELAY=1`). */
export function isRelayForced(): boolean {
  return /^(1|true|yes|on)$/i.test(process.env.P2P_FORCE_RELAY?.trim() ?? "");
}
