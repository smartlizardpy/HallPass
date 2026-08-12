"use client";

/**
 * The interactive half of `/c/<code>`: one button, the game, and then the ask.
 *
 * ── THE ORDER IS THE WHOLE DESIGN ──────────────────────────────────────────
 * Play first, convert on the win. A visitor arriving from a group chat is not
 * asked for anything before they play — no account, no interstitial. The ask
 * comes after they have a score, when there is something concrete to keep, and
 * it is phrased as keeping it rather than as making an account.
 *
 * Beyond conversion, that order is also the only one that WORKS for a big share
 * of this audience: Google Workspace for Education blocks under-18 accounts
 * from unapproved third-party apps, and no school IT admin is going to approve
 * an unblocked-games site. Putting sign-in first would be a wall with nothing
 * behind it. Putting it last means those players still get the game.
 *
 * ── NOTHING HERE EVER NAVIGATES ────────────────────────────────────────────
 * The player mounts in place and sign-in opens a POPUP. See the page's header
 * for why: the SDK's anonymous claim tokens live in the game frame's memory and
 * die with it, so a same-tab redirect would discard the score we are asking
 * them to keep. This is the single highest-value constraint in the feature, and
 * it is why {@link signInPopup} exists instead of a `<Link>`.
 *
 * ── HOW "DID I BEAT IT?" IS ANSWERED WITHOUT SEEING THE SCORE ──────────────
 * The SDK posts scores straight to `/api/` from inside the game frame, so this
 * page never sees one. For a SIGNED-IN player it does not need to: taking a
 * link up writes a `link_claim` row, that row is target-shaped, and the score
 * route resolves it the moment a qualifying score lands. `listIncoming` returns
 * OPEN challenges only — so the claim disappearing from the inbox IS the win,
 * and no new endpoint is needed to learn it. The only other way a challenge
 * leaves that list is being dismissed, which nothing on this page can do.
 *
 * For a SIGNED-OUT player it genuinely cannot be known here, and the copy says
 * something true instead of guessing: their scores are held and signing in
 * keeps them. That is literally accurate — `/api/v1/me/claim` accepts up to
 * `MAX_CLAIM_TOKENS` from one visit — and it is the honest version of the ask
 * for the ~70% of players who will not beat the score anyway.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Game } from "@/app/lib/games";
import type { PublicLink } from "@/app/lib/challenges/store";
import { PlayerOverlay } from "@/app/components/PlayerOverlay";
import { Wordmark } from "@/app/components/Wordmark";

/** Where the visitor is in the one flow this page has. */
type Stage =
  | { kind: "intro" }
  | { kind: "playing" }
  | { kind: "checking" }
  | { kind: "won" }
  | { kind: "missed" };

const BTN_PRIMARY =
  "rounded-full bg-brand px-7 py-3 text-base font-extrabold text-white transition hover:bg-brand-600 disabled:opacity-50";
const BTN_SECONDARY =
  "rounded-full border border-border bg-white px-5 py-2.5 text-sm font-bold text-zinc-700 transition hover:bg-surface-2";

/**
 * Open sign-in in a POPUP, never in this tab.
 *
 * THE `callbackUrl` IS THE LOAD-BEARING PART, not the popup. It sends the
 * completed sign-in to `/play/auth/complete`, which broadcasts the auth signal
 * on all three transports — and the SDK, still running in the game frame
 * behind this dialog, is listening for exactly that signal and flushes its held
 * claim tokens when it arrives. This is how the anonymous score just played
 * becomes the new account's score. Point this anywhere else and the sign-in
 * still works while the score is silently lost.
 *
 * Mirrors what `sdk/src/client.ts:405` does for a game asking the same
 * question, including the window name, so two of these can never fight over
 * one popup.
 *
 * A blocked popup falls back to a new TAB, which still preserves this document
 * — the thing that matters. It deliberately never falls back to
 * `location.href`: that would take the game frame with it and bin the very
 * score being claimed.
 */
const AUTH_COMPLETE_PATH = "/play/auth/complete";

function signInPopup(): void {
  const url = `/play/signin?callbackUrl=${encodeURIComponent(AUTH_COMPLETE_PATH)}`;
  const opened = window.open(url, "hallpass-auth", "popup=yes,width=480,height=680");
  if (!opened) window.open(url, "_blank", "noopener");
}

export function ChallengeLanding({
  link,
  game,
}: {
  link: PublicLink;
  game: Game | null;
}) {
  const [stage, setStage] = useState<Stage>({ kind: "intro" });
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [plays, setPlays] = useState(0);
  const claimed = useRef(false);

  const score = link.targetScore.toLocaleString("en-US");

  // Who is looking, asked once. Fail-soft to "signed out", which is the safe
  // assumption: the worst outcome is offering sign-in to somebody who already
  // has an account, and they will simply not press it.
  useEffect(() => {
    let live = true;
    fetch("/api/v1/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { player?: unknown } | null) => {
        if (live) setSignedIn(Boolean(d?.player));
      })
      .catch(() => live && setSignedIn(false));
    return () => {
      live = false;
    };
  }, []);

  /**
   * Press "Beat it": count it, take the link up if we can, and start the game.
   *
   * The claim POST is NOT awaited before the game opens. It records a row and
   * bumps a counter, and neither is worth a millisecond between a child and the
   * game they were promised — the endpoint answers 200 for every refusal for
   * the same reason. It is fired once per visit; pressing "Play again" does not
   * re-claim, because the claim is idempotent anyway and the counter should
   * measure people rather than attempts.
   */
  const start = useCallback(() => {
    if (!claimed.current) {
      claimed.current = true;
      void fetch(`/api/v1/challenges/link/${encodeURIComponent(link.code)}`, {
        method: "POST",
        credentials: "include",
      }).catch(() => {
        // A counter is never worth an error in front of a game.
      });
    }
    setPlays((n) => n + 1);
    setStage({ kind: "playing" });
  }, [link.code]);

  /**
   * They closed the game. Work out what to say.
   *
   * See the header: for a signed-in player the claim leaving their open inbox
   * IS the win. For everybody else there is nothing to check.
   */
  const finish = useCallback(async () => {
    if (!signedIn) {
      setStage({ kind: "missed" });
      return;
    }
    setStage({ kind: "checking" });
    try {
      const res = await fetch(
        `/api/v1/me/challenges?game=${encodeURIComponent(link.gameSlug ?? "")}`,
        { credentials: "include" },
      );
      const data = (await res.json()) as { incoming?: { boardId: string }[] };
      const stillOpen = (data.incoming ?? []).some((c) => c.boardId === link.boardId);
      setStage({ kind: stillOpen ? "missed" : "won" });
    } catch {
      // Cannot tell. "Not yet" is the honest, non-celebratory default — telling
      // somebody they won when they may not have is far worse than the reverse.
      setStage({ kind: "missed" });
    }
  }, [signedIn, link.gameSlug, link.boardId]);

  if (stage.kind === "playing" && game) {
    return <PlayerOverlay game={game} onClose={finish} />;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-10">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center">
        <Wordmark size="text-2xl" dotClass="h-1.5 w-1.5" />

        {stage.kind === "won" ? (
          <>
            <h1 className="mt-4 text-2xl font-black tracking-tight text-zinc-900">
              You beat {link.owner.displayName}.
            </h1>
            <p className="mt-2 text-sm font-semibold text-muted">
              Their {score} is yours now. Send one back?
            </p>
            <div className="mt-6 flex flex-col items-center gap-3">
              <a href="/play/you" className={BTN_PRIMARY}>
                Set your own challenge
              </a>
              <button type="button" className={BTN_SECONDARY} onClick={start}>
                Play again
              </button>
            </div>
          </>
        ) : stage.kind === "checking" ? (
          <p className="mt-6 text-sm font-semibold text-muted">Checking the board…</p>
        ) : stage.kind === "missed" ? (
          <>
            <h1 className="mt-4 text-2xl font-black tracking-tight text-zinc-900">
              {signedIn ? "Not this time." : "Nice try."}
            </h1>
            <p className="mt-2 text-sm font-semibold text-muted">
              {link.owner.displayName} is still on {score}.
            </p>
            <div className="mt-6 flex flex-col items-center gap-3">
              <button type="button" className={BTN_PRIMARY} onClick={start}>
                Try again
              </button>
              {/*
                THE SECOND, WEAKER ASK — for the players who did not win, who are
                most of them. Held back until the third go so it reads as an
                offer rather than a toll booth, and shown once.
              */}
              {!signedIn && plays >= 3 ? (
                <button type="button" className={BTN_SECONDARY} onClick={signInPopup}>
                  Sign in to keep your scores
                </button>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <h1 className="mt-4 text-2xl font-black tracking-tight text-zinc-900">
              {link.owner.displayName} says you can&rsquo;t beat this.
            </h1>
            <p className="mt-3 text-sm font-semibold text-muted">
              {link.boardTitle}
            </p>
            <div className="mt-4 text-5xl font-black tabular-nums text-brand">
              {score}
            </div>
            <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted">
              {link.scoreLabel} to beat
            </p>

            {game ? (
              <button type="button" className={`${BTN_PRIMARY} mt-7`} onClick={start}>
                Beat it
              </button>
            ) : (
              <p className="mt-7 text-sm font-semibold text-muted">
                This game isn&rsquo;t playable here right now.
              </p>
            )}
            <p className="mt-4 text-xs font-semibold text-muted">
              No account needed — just play.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
