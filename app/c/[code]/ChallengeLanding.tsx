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
import posthog from "posthog-js";
import type { Game } from "@/app/lib/games";
import type { PublicLink } from "@/app/lib/challenges/store";
import { PlayerOverlay } from "@/app/components/PlayerOverlay";
import { Wordmark } from "@/app/components/Wordmark";
import {
  ESCAPE_BAILOUT_MS,
  ESCAPE_FLAG,
  detectInAppBrowser,
  detectMobileOs,
  escapeUrlFor,
} from "./webview";

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
  const escaped = useRef(false);

  const score = link.targetScore.toLocaleString("en-US");

  /**
   * Attempt to reopen this page in the real browser. Returns `true` when an
   * attempt is in flight, in which case the caller must NOT start the game yet.
   *
   * Everything about this is defensive:
   *
   *   - OFF unless the PostHog flag says otherwise. The escape schemes are
   *     undocumented, reportedly patched in some hosts, and absent on TikTok, so
   *     this ships dark and the telemetry decides whether it earns its place —
   *     the same posture push took while its VAPID keys were missing.
   *   - Attempted at most ONCE per visit. A second try after a silent failure
   *     would just be a second delay.
   *   - Raced against `ESCAPE_BAILOUT_MS`. A working hop backgrounds this
   *     document, which `visibilitychange` sees immediately; anything else falls
   *     through to playing here.
   */
  const tryEscapeWebview = useCallback((): boolean => {
    if (escaped.current) return false;
    const host = detectInAppBrowser(navigator.userAgent);
    if (!host) return false;
    if (posthog.isFeatureEnabled(ESCAPE_FLAG) !== true) return false;

    const target = escapeUrlFor(detectMobileOs(navigator.userAgent), window.location.href);
    if (!target) return false;

    escaped.current = true;
    let settled = false;
    const give = (result: "left" | "stayed") => {
      if (settled) return;
      settled = true;
      document.removeEventListener("visibilitychange", onHide);
      posthog.capture("challenge_link_escape", { host, result });
      // Play here after a failed hop. After a successful one this page is in
      // the background and about to be replaced, so starting the game would
      // only run it where nobody is looking.
      if (result === "stayed") {
        setPlays((n) => n + 1);
        setStage({ kind: "playing" });
      }
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") give("left");
    };
    document.addEventListener("visibilitychange", onHide);
    window.setTimeout(() => give("stayed"), ESCAPE_BAILOUT_MS);

    // A blocked scheme typically does nothing at all, which is the failure the
    // timer above is for. Assigning can still throw in a locked-down webview.
    try {
      window.location.href = target;
    } catch {
      give("stayed");
    }
    return true;
  }, []);

  /**
   * The top of the funnel.
   *
   * Every event below carries `code` so one link's journey can be followed end
   * to end, and NOTHING carries the owner's name or the viewer's identity —
   * this is a page for people with no account, and a funnel is not a reason to
   * start profiling children. PostHog no-ops entirely when the project token is
   * absent, so this is free in development.
   */
  useEffect(() => {
    posthog.capture("challenge_link_viewed", { code: link.code });
  }, [link.code]);

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

    // Try to leave the chat app's browser before anything exists to lose. See
    // `webview.ts` — this is the only moment a hop is safe, and it is expected
    // to fail often, so it is raced against a short timer and never blocks.
    if (tryEscapeWebview()) return;

    posthog.capture("challenge_link_started", { code: link.code, attempt: plays + 1 });
    setPlays((n) => n + 1);
    setStage({ kind: "playing" });
  }, [link.code, plays, tryEscapeWebview]);

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
      posthog.capture("challenge_link_result", {
        code: link.code,
        won: !stillOpen,
        attempts: plays,
      });
      setStage({ kind: stillOpen ? "missed" : "won" });
    } catch {
      // Cannot tell. "Not yet" is the honest, non-celebratory default — telling
      // somebody they won when they may not have is far worse than the reverse.
      setStage({ kind: "missed" });
    }
  }, [signedIn, plays, link.code, link.gameSlug, link.boardId]);

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
                <>
                  <button
                    type="button"
                    className={BTN_SECONDARY}
                    onClick={() => {
                      posthog.capture("challenge_link_signin", {
                        code: link.code,
                        attempts: plays,
                      });
                      signInPopup();
                    }}
                  >
                    Sign in to keep your scores
                  </button>
                  {/*
                    WARN BEFORE THE TAP, not after it. Google Workspace for
                    Education blocks under-18 accounts from apps a school admin
                    has not approved, and this site will never be approved — so
                    a pupil on a Chromebook meets a dead "Access blocked" screen
                    with no explanation and no way forward. One grey line turns
                    that into a choice they can actually make. `select_account`
                    in `lib/auth.ts` is what gives them something to switch to.
                  */}
                  <p className="max-w-[22rem] text-xs font-semibold text-muted">
                    Use a personal Google account — school ones are usually
                    blocked from signing in here.
                  </p>
                </>
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
