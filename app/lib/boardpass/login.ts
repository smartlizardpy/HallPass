/**
 * BoardPass — the login decision, kept out of the route so it can be tested.
 *
 * ORDER IS THE SECURITY.
 *   1. Network buckets — one cheap row update, BEFORE any hashing. A flood costs a
 *      counter, not 64 MiB of memory a request. Over the cap → `throttled`.
 *   2. The account's guess is RESERVED in one statement (see `credentials.ts`).
 *      Nothing to verify — no such username, no PIN set, account locked — gets a
 *      dummy Argon2 run of the same cost, then the SAME `invalid` answer.
 *   3. Wrong PIN → `invalid`. Right PIN → reset the counter.
 *   4. Rollout mode (`staff`) is applied AFTER the PIN is proven and answers
 *      `invalid`, so it cannot be used to learn who has BoardPass.
 *   5. Only now does anything become observable: duplicate / full are reported,
 *      because the caller has proved they know this account's PIN.
 *
 * `invalid` is one outcome for every way in, and the UI shows one message for it.
 */

import "server-only";
import { normalizeUsername } from "@/app/lib/username";
import { cleanupAttempts, reserveLoginAttempt } from "./attempts";
import { recordSuccess, reserveAccountAttempt } from "./credentials";
import { boardPassAllowedFor } from "./flag";
import { dummyVerify, isValidPinFormat, verifyPin } from "./pin";
import { cleanupSessions, createSession, joinSession } from "./sessions";
import { hashSessionToken, newSessionToken } from "./token";

export type LoginOutcome =
  | { kind: "invalid" }
  | { kind: "throttled" }
  | { kind: "duplicate" }
  | { kind: "full" }
  | {
      kind: "ok";
      participantId: string;
      /** Set only when a NEW session was created: the cookie to hand out. */
      newToken: string | null;
    };

export async function attemptLogin(input: {
  username: unknown;
  pin: unknown;
  ipHash: string;
  /** Hash of the request's existing board cookie, if any. */
  tokenHash: string | null;
}): Promise<LoginOutcome> {
  const username = typeof input.username === "string" ? normalizeUsername(input.username) : "";
  const pin = typeof input.pin === "string" ? input.pin : "";

  // 1. Cheap network limits, before any hashing.
  if (!(await reserveLoginAttempt(input.ipHash, username))) return { kind: "throttled" };

  // 2. Reserve the account's guess. A malformed username/PIN never reaches SQL as
  //    a match, but still pays the same cost below so timing stays flat.
  const wellFormed = /^[a-z0-9_]{3,20}$/.test(username) && isValidPinFormat(pin);
  const reserved = wellFormed ? await reserveAccountAttempt(username) : null;
  if (!reserved) {
    await dummyVerify(pin);
    return { kind: "invalid" };
  }

  // 3. Verify.
  if (!(await verifyPin(reserved.playerId, pin, reserved.pinHash))) {
    return { kind: "invalid" };
  }
  await recordSuccess(reserved.playerId);

  // 4. Rollout mode, after the PIN is proven.
  if (!(await boardPassAllowedFor(reserved.playerId))) return { kind: "invalid" };

  // 5. Join the board's live session, or start one.
  const seat = { playerId: reserved.playerId, pinVersion: reserved.pinVersion };
  if (input.tokenHash) {
    const joined = await joinSession({ tokenHash: input.tokenHash, ...seat });
    if (joined.ok) return { kind: "ok", participantId: joined.participantId, newToken: null };
    if (joined.reason === "duplicate") return { kind: "duplicate" };
    if (joined.reason === "full") return { kind: "full" };
    // "gone": the old session expired. Fall through and start a fresh one.
  }
  const token = newSessionToken();
  const created = await createSession({ tokenHash: hashSessionToken(token), ...seat });

  // Housekeeping, occasionally, off the response path.
  if (Math.random() < 0.05) {
    void Promise.all([cleanupSessions(), cleanupAttempts()]).catch(() => {});
  }
  return { kind: "ok", participantId: created.participantId, newToken: token };
}
