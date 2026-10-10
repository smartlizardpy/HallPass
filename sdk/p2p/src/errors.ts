/**
 * Every error the SDK raises is a `P2PError` with a stable `code` (and, for
 * `connect-failed`, a `reason`). `message` is written for PLAYERS: a game can
 * show `err.message` as is.
 */

import type { ErrorCode } from "./types";

export class P2PError extends Error {
  code: ErrorCode;
  reason?: string;
  constructor(code: ErrorCode, message: string, reason?: string) {
    super(message);
    this.name = "P2PError";
    this.code = code;
    if (reason) this.reason = reason;
  }
}

const REASONS: Record<string, string> = {
  "no-turn-restrictive-network":
    "Couldn't connect to the other player. Your network (often a school or office network) blocks direct connections, and no relay server is available.",
  "turn-failed": "Couldn't connect, even through the relay server. Check your internet connection and try again.",
  "relay-unavailable":
    "Private relay mode is on, but no relay server is available right now, so you can't connect.",
  "peer-unreachable": "Connected to the host, but couldn't reach every other player in the room.",
  "signaling-unreachable": "Couldn't reach HallPass to set up the game. Check your internet connection and try again.",
  "signaling-unavailable": "Online play is unavailable on HallPass right now. Try again later.",
  "rate-limited": "Too many attempts. Wait a minute, then try again.",
  "unknown-game": "HallPass doesn't recognise this game, so it can't host a room for it.",
  "room-closed": "The room closed while you were joining.",
};

export function connectFailed(reason: string): P2PError {
  return new P2PError("connect-failed", REASONS[reason] ?? REASONS["signaling-unreachable"], reason);
}

export function roomError(code: ErrorCode, extra?: { code?: string; hostVersion?: string; mine?: string; reason?: string }): P2PError {
  switch (code) {
    case "room-not-found":
      return new P2PError(
        code,
        extra?.code
          ? `No room with code ${extra.code} is open. Check the code and try again.`
          : "That room isn't open. Check the code and try again.",
      );
    case "room-full":
      return new P2PError(code, "That room is full.");
    case "room-locked":
      return extra?.reason === "kicked"
        ? new P2PError(code, "You were removed from that room.", "kicked")
        : new P2PError(code, "That room is locked, or its game has already started.");
    case "version-mismatch":
      return new P2PError(
        code,
        extra?.hostVersion
          ? `The host is running version ${extra.hostVersion} of the game and you have ${extra.mine || "another version"}. Reload the page to update, then try again.`
          : "You and the host are running different versions of the game. Reload the page to update, then try again.",
      );
    case "timeout":
      return new P2PError(code, "The host didn't respond. They may have left, or their tab may be asleep.");
    default:
      return new P2PError(code, "Something went wrong with the connection.");
  }
}
