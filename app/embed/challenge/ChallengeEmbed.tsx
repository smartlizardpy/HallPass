"use client";

/**
 * The challenge picker's FRAME half — everything about living inside a game.
 *
 * The picking, sending and confirming all moved to
 * `app/components/challenges/ChallengePicker.tsx` when `/play/you` needed the
 * same body. What is left here is the part that only makes sense in a frame,
 * and it is the part with the hazards in it.
 *
 * ── HOW IT TALKS BACK TO THE SDK ───────────────────────────────────────────
 * Exactly the three transports `sdk/src/auth-flow.ts` uses, keyed off one pinned
 * string, because the same hazards apply: Cross-Origin-Opener-Policy can sever
 * `postMessage`, and a browser may allow one channel while blocking another.
 *   - `postMessage` to the opener (popup) or parent (inline frame)
 *   - `BroadcastChannel("hallpass:challenge")` — same-origin only
 *   - a `localStorage` write, seen cross-tab as a `storage` event
 *
 * THE KEY IS MIRRORED BY HAND from `sdk/src/challenge.ts`. It cannot be
 * imported: the SDK must not pull in app code, and `contract.ts` — the one
 * module both sides share — is types-only by rule, so it can carry no runtime
 * value. Change one and change the other.
 *
 * `targetOrigin` is `"*"`, which is deliberate and bounded. The opener may be a
 * third-party game whose origin we do not know, so a specific target is not
 * available. What crosses is only what the game is being told anyway — that a
 * challenge went out, to which display name, at what score. No id, no friend
 * list, and nothing about anybody the player did not pick.
 *
 * ── THE PLAYER CLOSES IT, NOT US ───────────────────────────────────────────
 * Sending does not dismiss the panel. This host tears the frame down the moment
 * a signal lands, so a signal at send time would destroy the confirmation as it
 * rendered and leave the player guessing whether it worked. That is why the
 * picker's `onDone` fires on CLOSE rather than on send — see its header, where
 * the contract now lives — and why {@link dismiss} is wired to it and to
 * nothing else.
 */

import { useCallback } from "react";
import type { PublicProfile } from "@/app/lib/social/store";
import {
  ChallengePicker,
  type PickerOutcome,
} from "@/app/components/challenges/ChallengePicker";

/** Mirrored by hand in `sdk/src/challenge.ts`. */
const SIGNAL_KEY = "hallpass:challenge";

/** What the SDK will see. Shaped like `ChallengeResult` in the contract. */
type Signal = {
  type: typeof SIGNAL_KEY;
  sent: boolean;
  reason?: string;
  challenge?: { to: string; targetScore: number; board: string; game: string | null };
};

/**
 * Announce on all three channels, then ask the host to take the frame away.
 *
 * Every step is individually guarded: a sandboxed frame, a storage-less private
 * mode or a COOP-severed opener must not stop the other two from landing, and
 * none of them may throw into a React event handler.
 */
function signal(payload: Signal): void {
  try {
    const host = window.opener ?? window.parent;
    if (host && host !== window) host.postMessage(payload, "*");
  } catch {
    // COOP can make even reading `opener` throw.
  }
  try {
    const channel = new BroadcastChannel(SIGNAL_KEY);
    channel.postMessage(payload);
    channel.close();
  } catch {
    // No BroadcastChannel in this browser, or blocked.
  }
  try {
    // The value must differ each time or a repeat write fires no `storage`
    // event. `Date.now()` is enough: two signals cannot share a millisecond
    // from one user's clicking.
    window.localStorage.setItem(
      SIGNAL_KEY,
      JSON.stringify({ ...payload, t: Date.now() }),
    );
  } catch {
    // Private mode, or storage is full.
  }
}

/** A popup closes itself; an inline frame is removed by the SDK on the signal. */
function closeSelf(): void {
  try {
    if (window.opener) window.close();
  } catch {
    // Nothing more to do — the signal above already told the SDK to tear down.
  }
}

export function ChallengeEmbed({
  signedIn,
  friends,
  board,
  game,
}: {
  signedIn: boolean;
  friends: PublicProfile[];
  board: string | null;
  game: string | null;
}) {
  /**
   * The ONLY place a signal is sent, and the picker's only way out.
   *
   * The SDK tears the frame down on receipt, so signalling anywhere else would
   * close the panel out from under the player.
   */
  const dismiss = useCallback((outcome: PickerOutcome) => {
    signal({
      type: SIGNAL_KEY,
      sent: outcome.sent,
      reason: outcome.reason,
      challenge: outcome.challenge,
    });
    closeSelf();
  }, []);

  return (
    <div className="rounded-2xl border border-border bg-white p-4 shadow-sm">
      <h1 className="text-sm font-black tracking-tight text-zinc-900">
        Challenge a friend
      </h1>
      <ChallengePicker
        signedIn={signedIn}
        friends={friends}
        board={board}
        game={game}
        onDone={dismiss}
      />
    </div>
  );
}
