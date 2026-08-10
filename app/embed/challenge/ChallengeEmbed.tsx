"use client";

/**
 * The challenge picker's interactive half.
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
 * Sending does not dismiss the panel. It swaps to a confirmation the player
 * reads and then closes, which is what was asked for and is also the honest
 * shape: a panel that vanishes on success leaves them guessing whether it
 * worked.
 */

import { useCallback, useState } from "react";
import type { PublicProfile } from "@/app/lib/social/store";
import { Avatar } from "@/app/components/friends/Avatar";

/** Mirrored by hand in `sdk/src/challenge.ts`. */
const SIGNAL_KEY = "hallpass:challenge";

const BTN_PRIMARY =
  "rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white transition hover:bg-brand-600 disabled:opacity-50";
const BTN_SECONDARY =
  "rounded-full border border-border bg-white px-4 py-2 text-sm font-bold text-zinc-700 transition hover:bg-surface-2 disabled:opacity-50";

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

type Phase =
  | { kind: "picking" }
  | { kind: "sending" }
  | {
      kind: "sent";
      to: string;
      targetScore: number;
      /** Carried so the Close button can announce what was sent. */
      challenge: NonNullable<Signal["challenge"]>;
    }
  | { kind: "failed"; message: string };

/** What each refusal should say to a player. Never mentions blocks — see the API. */
const REFUSAL_TEXT: Record<string, string> = {
  "no-board": "This game has no leaderboard to challenge on.",
  "no-score": "Set a score here first, then dare a friend to beat it.",
  "not-friends": "You can only challenge friends.",
  self: "You cannot challenge yourself.",
  "signed-out": "Sign in to challenge a friend.",
  "bad-request": "Something about this game's leaderboard is not set up right.",
  "rate-limited": "Not right now — give it a little while.",
  unavailable: "Challenges are unavailable at the moment.",
};

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
  const [phase, setPhase] = useState<Phase>({ kind: "picking" });
  const [chosen, setChosen] = useState<string | null>(null);

  /**
   * Announce the outcome and ask the host to take the frame away.
   *
   * The ONLY place a signal is sent. The SDK tears the frame down on receipt, so
   * signalling anywhere else would close the panel out from under the player —
   * which is what "THE PLAYER CLOSES IT, NOT US" in the header means in practice.
   */
  const dismiss = useCallback(
    (
      sent: boolean,
      reason?: string,
      challenge?: NonNullable<Signal["challenge"]>,
    ) => {
      signal({ type: SIGNAL_KEY, sent, reason, challenge });
      closeSelf();
    },
    [],
  );

  const send = useCallback(async () => {
    if (!chosen) return;
    setPhase({ kind: "sending" });
    try {
      const res = await fetch("/api/v1/me/challenges", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: chosen, board, game }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        reason?: string;
        challenge?: { to: string; targetScore: number; board: string; game: string | null };
      };

      if (!res.ok || !data.ok || !data.challenge) {
        const reason = data.reason ?? "unavailable";
        setPhase({
          kind: "failed",
          message: REFUSAL_TEXT[reason] ?? REFUSAL_TEXT.unavailable,
        });
        return;
      }

      // DO NOT SIGNAL YET. The SDK tears the frame down the moment a signal
      // lands, so announcing the send here would destroy the confirmation panel
      // as it rendered — the player would see the picker vanish and never learn
      // whether it worked. The signal goes out when they press Close, which is
      // also exactly what the contract promises: `challenge()` resolves when the
      // picker closes.
      setPhase({
        kind: "sent",
        to: data.challenge.to,
        targetScore: data.challenge.targetScore,
        challenge: data.challenge,
      });
    } catch {
      // Offline, or the request never left. `/api/` is never intercepted by the
      // service worker, so this is the ordinary no-network case.
      setPhase({ kind: "failed", message: "No connection. Try again in a moment." });
    }
  }, [board, chosen, game]);

  return (
    <div className="rounded-2xl border border-border bg-white p-4 shadow-sm">
      <h1 className="text-sm font-black tracking-tight text-zinc-900">
        Challenge a friend
      </h1>

      {phase.kind === "sent" ? (
        <>
          <p className="mt-2 text-[13px] font-semibold text-muted">
            Challenged <span className="text-zinc-900">{phase.to}</span>. They
            need to beat{" "}
            <span className="text-zinc-900">
              {phase.targetScore.toLocaleString()}
            </span>
            .
          </p>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              className={BTN_PRIMARY}
              onClick={() => dismiss(true, undefined, phase.challenge)}
            >
              Close
            </button>
          </div>
        </>
      ) : !signedIn ? (
        <Notice text="Sign in to challenge a friend." onClose={() => dismiss(false, "signed-out")} />
      ) : friends.length === 0 ? (
        <Notice
          text="Add a friend first, then you can dare them to beat your score."
          onClose={() => dismiss(false, "not-friends")}
        />
      ) : (
        <>
          <p className="mt-1 text-[13px] font-semibold text-muted">
            They&rsquo;ll have to beat your best score here.
          </p>

          {/* A radiogroup rather than buttons: one choice, arrow-key navigable,
              and it announces itself correctly to a screen reader. */}
          <div
            role="radiogroup"
            aria-label="Choose a friend"
            className="mt-3 max-h-56 space-y-1 overflow-y-auto"
          >
            {friends.map((friend) => (
              <button
                key={friend.id}
                type="button"
                role="radio"
                aria-checked={chosen === friend.id}
                onClick={() => setChosen(friend.id)}
                className={`flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left transition ${
                  chosen === friend.id ? "bg-brand-50" : "hover:bg-surface-2"
                }`}
              >
                <Avatar person={friend} size={28} />
                <span className="truncate text-[13px] font-bold text-zinc-900">
                  {friend.displayName}
                </span>
              </button>
            ))}
          </div>

          {phase.kind === "failed" ? (
            <p role="alert" className="mt-3 text-[13px] font-semibold text-rose-700">
              {phase.message}
            </p>
          ) : null}

          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              className={BTN_SECONDARY}
              onClick={() => dismiss(false, "closed")}
            >
              Close
            </button>
            <button
              type="button"
              className={BTN_PRIMARY}
              disabled={!chosen || phase.kind === "sending"}
              onClick={send}
            >
              {phase.kind === "sending" ? "Sending…" : "Challenge"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** The dead-end states: something to read, and one way out. */
function Notice({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <>
      <p className="mt-2 text-[13px] font-semibold text-muted">{text}</p>
      <div className="mt-4 flex justify-end">
        <button type="button" className={BTN_SECONDARY} onClick={onClose}>
          Close
        </button>
      </div>
    </>
  );
}
