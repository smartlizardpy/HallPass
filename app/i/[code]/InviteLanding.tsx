"use client";

/**
 * The interactive half of `/i/<code>`: the card, the Play button, the game.
 *
 * ── THE HANDOFF ────────────────────────────────────────────────────────────
 * {@link play} writes the invite to `sessionStorage` for this game's slug
 * (`writeLaunch`, the same pure module the SDK reads with) and THEN mounts the
 * overlay, so the entry exists before the game frame's SDK looks for it. The
 * SDK takes it once and removes it. When the overlay closes the entry is
 * cleared again here, in case the game never loaded the SDK — a later visit to
 * the same game in this tab must not join a room from an old invite. "Play
 * again" writes it afresh while the invite is still live.
 *
 * Nothing here navigates, for the reason `/c/<code>` gives: the game frame
 * holds the anonymous player's progress, and this page is where they play.
 *
 * No identity in analytics: the events carry the game slug and nothing else.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import posthog from "posthog-js";
import type { Game } from "@/app/lib/games";
import { PlayerOverlay } from "@/app/components/PlayerOverlay";
import { Wordmark } from "@/app/components/Wordmark";
import { clearLaunch, writeLaunch } from "@/sdk/src/launch";

const BTN_PRIMARY =
  "rounded-full bg-brand px-7 py-3 text-base font-extrabold text-white transition hover:bg-brand-600 disabled:opacity-50";
const BTN_SECONDARY =
  "rounded-full border border-border bg-surface px-5 py-2.5 text-sm font-bold text-foreground-2 transition hover:bg-surface-2";

type Stage = "intro" | "playing" | "closed" | "expired";

export function InviteLanding({
  game,
  from,
  data,
  expiresAt,
  minutesLeft,
}: {
  game: Game;
  /** The inviter's public display name, or `null` for a guest's link. */
  from: string | null;
  data: Record<string, unknown>;
  /** Epoch milliseconds. */
  expiresAt: number;
  minutesLeft: number;
}) {
  const [stage, setStage] = useState<Stage>("intro");

  useEffect(() => {
    posthog.capture("game_invite_viewed", { game: game.slug, kind: from ? "friend" : "link" });
  }, [game.slug, from]);

  const play = useCallback(() => {
    // Judged on the visitor's clock at the moment of the tap: a page left open
    // past the deadline must not start a game into a room that has closed.
    if (Date.now() >= expiresAt) {
      setStage("expired");
      return;
    }
    writeLaunch(game.slug, { data, from, expiresAt });
    posthog.capture("game_invite_started", { game: game.slug });
    setStage("playing");
  }, [data, expiresAt, from, game.slug]);

  const close = useCallback(() => {
    clearLaunch(game.slug);
    setStage(Date.now() >= expiresAt ? "expired" : "closed");
  }, [expiresAt, game.slug]);

  if (stage === "playing") {
    return <PlayerOverlay game={game} onClose={close} />;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-10">
      <div className="w-full max-w-md rounded-2xl bg-surface p-8 text-center">
        <Wordmark size="text-2xl" dotClass="h-1.5 w-1.5" />

        {stage === "expired" ? (
          <>
            <h1 className="mt-4 text-2xl font-black tracking-tight text-foreground">
              This invite has run out
            </h1>
            <p className="mt-2 text-sm font-semibold text-muted">
              You can still play {game.title} on your own.
            </p>
            <div className="mt-6 flex flex-col items-center gap-3">
              <Link href={`/game/${encodeURIComponent(game.slug)}`} className={BTN_PRIMARY}>
                Play {game.title}
              </Link>
            </div>
          </>
        ) : (
          <>
            <h1 className="mt-4 text-2xl font-black tracking-tight text-foreground">
              {/* One string, so JSX cannot drop a space between the parts. */}
              {from ? `${from} invited you to play ${game.title}` : `You're invited to play ${game.title}`}
            </h1>
            <p className="mt-2 text-sm font-semibold text-muted">
              {stage === "closed"
                ? "Want to jump back in?"
                : `${from ? "Tap play to join them." : "Tap play to join in."} The invite runs out in ${minutesLeft} ${minutesLeft === 1 ? "minute" : "minutes"}.`}
            </p>
            <div className="mt-6 flex flex-col items-center gap-3">
              <button type="button" className={BTN_PRIMARY} onClick={play}>
                {stage === "closed" ? "Play again" : "Play"}
              </button>
              {stage === "closed" ? (
                <Link href="/" className={BTN_SECONDARY}>
                  More games
                </Link>
              ) : null}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
