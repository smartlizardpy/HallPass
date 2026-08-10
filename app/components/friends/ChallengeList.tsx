"use client";

/**
 * The Challenges tab's body: dares aimed at you, and the ones you sent.
 *
 * PRESENTATIONAL PLUS ITS OWN MUTATIONS, but not its own fetch — `FriendsIsland`
 * already polls `/api/v1/me/challenges` to badge the tab, and a second fetch
 * here would double the requests to say the same thing. It calls `onChanged`
 * after a write and lets the parent reload, which is how the count and the list
 * stay in agreement.
 *
 * ── PRESSING PLAY IS WHAT ACCEPTING MEANS ──────────────────────────────────
 * There is no Accept button, on purpose. Consent is already covered (only
 * friends can challenge you), so a separate confirmation would be a tap between
 * a player and the game for no gain. Play stamps `accepted_at` and then
 * navigates, which tells the challenger somebody is on it without asking anybody
 * to press anything extra.
 *
 * The accept is fire-and-forget: if it fails, the player still gets their game.
 * The signal is a courtesy to the sender, and losing it must not cost the
 * receiver the thing they actually pressed the button for.
 *
 * ── WHAT THE SENDER IS NOT TOLD ────────────────────────────────────────────
 * Dismissed challenges never appear in `outgoing` — the API omits them. So this
 * component has no "declined" state to render and could not add one, which is
 * deliberate: `social/config.ts` avoids telling a child that a named friend
 * turned them down, and the same courtesy applies here.
 */

import { useCallback, useState } from "react";
import type {
  IncomingChallenge,
  OutgoingChallenge,
} from "@/app/lib/challenges/store";
import { scoreToBeat } from "@/app/lib/challenges/resolve";
import { Avatar } from "./Avatar";

const BTN_PRIMARY =
  "rounded-full bg-brand px-4 py-1.5 text-sm font-extrabold text-white transition hover:bg-brand-600 disabled:opacity-50";
const BTN_SECONDARY =
  "rounded-full border border-border bg-white px-3 py-1.5 text-sm font-bold text-zinc-700 transition hover:bg-surface-2 disabled:opacity-50";

/** "4,200" — grouped, because a bare 5-digit score is hard to read at a glance. */
function fmt(score: number): string {
  return score.toLocaleString();
}

export function ChallengeList({
  incoming,
  outgoing,
  onChanged,
}: {
  incoming: IncomingChallenge[];
  outgoing: OutgoingChallenge[];
  onChanged: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState<number | null>(null);

  /** PATCH one challenge. Resolves whether it changed anything. */
  const patch = useCallback(async (id: number, action: "accept" | "dismiss") => {
    try {
      const res = await fetch(`/api/v1/me/challenges/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      return res.ok;
    } catch {
      // Offline. `/api/` is never intercepted by the service worker, so this is
      // simply no network.
      return false;
    }
  }, []);

  const dismiss = useCallback(
    async (id: number) => {
      setBusy(id);
      await patch(id, "dismiss");
      setBusy(null);
      await onChanged();
    },
    [onChanged, patch],
  );

  const play = useCallback(
    async (challenge: IncomingChallenge) => {
      setBusy(challenge.id);
      // Fire-and-forget: the accept is a courtesy to the sender, and a failed
      // one must not stand between this player and the game.
      void patch(challenge.id, "accept");
      if (challenge.gameSlug) {
        window.location.href = `/game/${encodeURIComponent(challenge.gameSlug)}`;
        return;
      }
      // A board with no game linked has nowhere to send them; the stamp still
      // lands and the row stays open.
      setBusy(null);
      await onChanged();
    },
    [onChanged, patch],
  );

  if (incoming.length === 0 && outgoing.length === 0) {
    return (
      <p className="text-[15px] font-bold text-muted">
        No challenges yet. Beat a score, then dare a friend from inside the game.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {incoming.length > 0 && (
        <section>
          <h2 className="mb-3 text-[11px] font-black uppercase tracking-wider text-muted">
            For you
          </h2>
          <ul className="space-y-2">
            {incoming.map((challenge) => (
              <li
                key={challenge.id}
                className="flex flex-wrap items-center gap-3 rounded-2xl bg-surface-2 px-3 py-2"
              >
                <Avatar person={challenge.from} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-zinc-900">
                    {challenge.from.displayName}
                  </p>
                  <p className="truncate text-[13px] font-semibold text-muted">
                    {challenge.boardTitle} — get{" "}
                    {fmt(scoreToBeat(challenge.targetScore, challenge.sort))} to win
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className={BTN_SECONDARY}
                    disabled={busy === challenge.id}
                    onClick={() => void dismiss(challenge.id)}
                  >
                    Dismiss
                  </button>
                  <button
                    type="button"
                    className={BTN_PRIMARY}
                    disabled={busy === challenge.id}
                    onClick={() => void play(challenge)}
                  >
                    Play
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {outgoing.length > 0 && (
        <section>
          <h2 className="mb-3 text-[11px] font-black uppercase tracking-wider text-muted">
            You sent
          </h2>
          <ul className="space-y-2">
            {outgoing.map((challenge) => (
              <li
                key={challenge.id}
                className="flex items-center gap-3 rounded-2xl bg-surface-2 px-3 py-2"
              >
                <Avatar person={challenge.to} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-zinc-900">
                    {challenge.to.displayName}
                  </p>
                  <p className="truncate text-[13px] font-semibold text-muted">
                    {challenge.resolvedAt !== null && challenge.resolvedScore !== null
                      ? `Beat your ${fmt(challenge.targetScore)} with ${fmt(challenge.resolvedScore)}`
                      : `${challenge.boardTitle} — beat ${fmt(challenge.targetScore)}`}
                  </p>
                </div>
                {challenge.resolvedAt !== null && (
                  <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-black text-amber-900">
                    Beaten
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
