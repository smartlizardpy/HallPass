"use client";

/**
 * HallPass — pick a friend and dare them to beat your score.
 *
 * The interactive body of a challenge, and nothing around it. It was the whole
 * of `ChallengeEmbed`; it moved here when the profile page needed the same
 * thing, and what stayed behind is exactly the part that is about being in a
 * frame — the postMessage/BroadcastChannel/localStorage signal and the popup
 * teardown.
 *
 * ── IT RENDERS A BODY, NOT A CARD ──────────────────────────────────────────
 * No wrapper, no border, no heading. Each host supplies those, because the two
 * hosts genuinely disagree about them: the embed is a whole document, so its
 * title is an `<h1>` inside a card that floats over a running game, while the
 * profile page opens this inside a dialog that already has a frame and whose
 * heading has to sit at the right level under the page's own `<h1>`. A shared
 * component that hard-coded either one would be wrong on the other surface,
 * and heading level is not a detail — it is how a screen-reader user knows
 * where they are.
 *
 * ── `onDone` FIRES WHEN THE PLAYER LEAVES, NOT WHEN THE CHALLENGE SENDS ────
 * This is the contract, and it is load-bearing rather than incidental. A
 * successful send swaps this to a confirmation the player reads and then
 * dismisses themselves; `onDone` is what that dismissal calls. The embed
 * depends on it — its host tears the frame down the instant a signal lands, so
 * announcing at send time would destroy the confirmation as it rendered and
 * leave the player never knowing whether it worked. `sdk/src/contract.ts` makes
 * the same promise outward: `challenge()` resolves when the picker CLOSES.
 *
 * It fires at most once, and every exit goes through it — sent, refused,
 * signed out, no friends, or simply closed.
 */

import { useCallback, useState } from "react";
import type { PublicProfile } from "@/app/lib/social/store";
import { Avatar } from "@/app/components/friends/Avatar";
import {
  CHALLENGE_REFUSAL_TEXT,
  challengeRefusalText,
} from "@/app/lib/challenges/copy";

const BTN_PRIMARY =
  "rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white transition hover:bg-brand-600 disabled:opacity-50";
const BTN_SECONDARY =
  "rounded-full border border-border bg-white px-4 py-2 text-sm font-bold text-zinc-700 transition hover:bg-surface-2 disabled:opacity-50";

/** What was sent, in the shape `ChallengeResult` promises a game. */
export type SentChallenge = {
  to: string;
  targetScore: number;
  board: string;
  game: string | null;
};

/**
 * How the picker ended.
 *
 * `reason` is `"closed"` when the player simply left — which is NOT one of the
 * server's `ChallengeReason` members, deliberately. Nothing refused it; there
 * was no request.
 */
export type PickerOutcome = {
  sent: boolean;
  reason?: string;
  challenge?: SentChallenge;
};

type Phase =
  | { kind: "picking" }
  | { kind: "sending" }
  | {
      kind: "sent";
      to: string;
      targetScore: number;
      /** Carried so the Close button can announce what was sent. */
      challenge: SentChallenge;
    }
  | { kind: "failed"; message: string };

export function ChallengePicker({
  signedIn,
  friends,
  board,
  game,
  onDone,
}: {
  signedIn: boolean;
  friends: PublicProfile[];
  board: string | null;
  game: string | null;
  onDone: (outcome: PickerOutcome) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "picking" });
  const [chosen, setChosen] = useState<string | null>(null);

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
        challenge?: SentChallenge;
      };

      if (!res.ok || !data.ok || !data.challenge) {
        setPhase({ kind: "failed", message: challengeRefusalText(data.reason) });
        return;
      }

      // Deliberately does NOT call `onDone` — see the contract in the header.
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

  if (phase.kind === "sent") {
    return (
      <>
        <p className="mt-2 text-[13px] font-semibold text-muted">
          Challenged <span className="text-zinc-900">{phase.to}</span>. They need
          to beat{" "}
          <span className="text-zinc-900">
            {phase.targetScore.toLocaleString()}
          </span>
          .
        </p>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            className={BTN_PRIMARY}
            onClick={() => onDone({ sent: true, challenge: phase.challenge })}
          >
            Close
          </button>
        </div>
      </>
    );
  }

  if (!signedIn) {
    return (
      <Notice
        text={CHALLENGE_REFUSAL_TEXT["signed-out"]}
        onClose={() => onDone({ sent: false, reason: "signed-out" })}
      />
    );
  }

  if (friends.length === 0) {
    // NOT the `not-friends` refusal sentence. "You can only challenge friends"
    // is the right answer to picking someone who is not one; it is a dead end
    // when the list is empty and the answer is to go and add somebody.
    return (
      <Notice
        text="Add a friend first, then you can dare them to beat your score."
        onClose={() => onDone({ sent: false, reason: "not-friends" })}
      />
    );
  }

  return (
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
          onClick={() => onDone({ sent: false, reason: "closed" })}
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
