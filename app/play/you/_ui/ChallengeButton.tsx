"use client";

/**
 * HallPass — "Challenge" on a row of your own leaderboards.
 *
 * Until now the ONLY way to send a challenge was from inside a game, through
 * `HallPass.challenge()` and the picker at `/embed/challenge`. That meant a
 * score you set last week was inert: to dare anybody to beat it you had to go
 * and play the game again. This is the same picker, reached from the standings
 * list on `/play/you`, where the score already is.
 *
 * ── IT PASSES A BOARD, AND THAT IS WHY IT NEEDS NOTHING ELSE ───────────────
 * `POST /api/v1/me/challenges` derives the number to beat in SQL as the
 * challenger's own best on that board (`challenges/store.ts` — "WHAT THE SCORE
 * TO BEAT IS"), so this sends an id and no score. Nothing here can dare
 * somebody to beat a number the player never scored, and the `no-score` refusal
 * is unreachable from this surface by construction: the standings list is built
 * from boards they have posted a score on.
 *
 * `game` is passed alongside `board` only so the confirmation can name it. The
 * route prefers an explicit `board` and never has to disambiguate — which is
 * the case `resolveBoard` otherwise refuses, since one game may own several
 * boards.
 *
 * ── FRIENDS ARE FETCHED WHEN IT OPENS, NOT WHEN THE PAGE RENDERS ───────────
 * The profile page is a server component that already makes four reads; adding
 * the friend list to them would cost every visitor a query to render a button
 * most of them will not press. So the list arrives from
 * `GET /api/v1/me/friends` on first open and is then kept for the life of this
 * row, which makes reopening free without introducing a cache that could go
 * stale across a sign-out.
 *
 * ── WHAT `role="dialog" aria-modal="true"` PROMISES ────────────────────────
 * `StealthSettings` documents at length what happened when a panel in this
 * codebase made that claim and kept none of it — no Escape, no scroll lock, no
 * focus trap, and a `FeaturePromo` that mounted underneath it because the
 * shared lock said nothing owned the screen. This keeps all four, and takes the
 * lock through {@link acquireOverlayLock} rather than writing `body.overflow`
 * itself, so `isOverlayOpen()` can see it.
 *
 * A PASSIVE effect is correct for the release here, per the ordering rule in
 * `lib/overlay-lock.ts`: that rule binds overlays which can be torn down in the
 * same commit that a non-participant takes the body, and nothing in this dialog
 * raises another overlay. There is no "preview the panic screen" path to trip
 * over.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ChallengePicker } from "@/app/components/challenges/ChallengePicker";
import { acquireOverlayLock } from "@/app/lib/overlay-lock";
import { CHALLENGE_REFUSAL_TEXT } from "@/app/lib/challenges/copy";
import type { PublicProfile } from "@/app/lib/social/store";

/** Where the friend list is in its journey from the API to the picker. */
type Load =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; friends: PublicProfile[] }
  /** The schema is behind the deploy, or the read failed. One message covers both. */
  | { kind: "unavailable" };

export function ChallengeButton({
  boardId,
  gameSlug,
  title,
}: {
  boardId: string;
  gameSlug: string | null;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const [load, setLoad] = useState<Load>({ kind: "idle" });
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  /**
   * Also the picker's single exit. It reports an outcome and this surface has
   * no use for it — the challenge is already sent and the confirmation has
   * already been read by the time the player presses Close. A function taking
   * no arguments is a valid handler for one that supplies them.
   */
  const close = useCallback(() => setOpen(false), []);

  /**
   * Open, and start the load if this row has never done one.
   *
   * The transition to `loading` belongs HERE, in the event, and not in the
   * effect below — a synchronous `setState` inside an effect schedules a second
   * render pass before paint, which React 19 flags. It also reads better: the
   * click is what decides to load, and the effect is only what performs it.
   */
  const openDialog = useCallback(() => {
    setOpen(true);
    setLoad((current) => (current.kind === "idle" ? { kind: "loading" } : current));
  }, []);

  // Perform the load. Keyed on the phase rather than on `open`, so closing the
  // dialog mid-flight lets the request finish and makes the next open instant.
  useEffect(() => {
    if (load.kind !== "loading") return;

    const controller = new AbortController();
    fetch("/api/v1/me/friends", {
      credentials: "include",
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("bad status"))))
      .then((data: { enabled?: boolean; friends?: PublicProfile[] }) => {
        // `enabled: false` is the route's own fail-soft for a database without
        // migration 007. An empty list would render "add a friend first", which
        // would be a confident lie about why this is not working.
        if (data.enabled === false) {
          setLoad({ kind: "unavailable" });
          return;
        }
        setLoad({ kind: "ready", friends: data.friends ?? [] });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error("[challenge-button] friends read failed:", error);
        setLoad({ kind: "unavailable" });
      });

    // Only fires when the row itself goes away (a route change), which is the
    // one case where nobody is left to receive the answer.
    return () => controller.abort();
  }, [load.kind]);

  // The scroll lock and the focus round trip, together — they share a lifetime.
  useEffect(() => {
    if (!open) return;
    const releaseLock = acquireOverlayLock();
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Our own Close button on the loading and unavailable states; the PANEL
    // otherwise. The fallback is not theoretical: reopening a row whose friend
    // list is already loaded renders the picker immediately, so `closeRef` is
    // unattached and focus would be left on the trigger BEHIND an `aria-modal`
    // dialog — which is the exact defect the trap below exists to prevent.
    // Focusing the panel is deliberate over focusing the picker's first friend,
    // which would announce a radio option as though it were the whole dialog.
    (closeRef.current ?? panelRef.current)?.focus();

    return () => {
      releaseLock();
      // Back to the row's own Challenge button, so a keyboard player is not
      // dropped at the top of the page.
      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [open]);

  // Escape closes. Bubble phase on `document`, matching `StealthSettings`.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  /**
   * Keep Tab inside the panel. Hand-rolled for the same reason `FeaturePromo`
   * and `StealthSettings` hand-roll it: this is not a native `<dialog>`, so
   * nothing traps focus for free.
   *
   * Recomputed per keystroke rather than cached on open, because the contents
   * genuinely move: the friend list replaces a spinner, and the Challenge
   * button is `disabled` — and so out of the tab order — until somebody is
   * chosen.
   */
  const onKeyDownTrap = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !panelRef.current) return;
    const focusable = panelRef.current.querySelectorAll<HTMLElement>(
      "a[href], button:not([disabled])",
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const headingId = `challenge-${boardId}`;

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="shrink-0 rounded-full border border-border bg-white px-3 py-1 text-xs font-bold text-zinc-700 transition hover:border-brand hover:text-brand"
      >
        Challenge
        {/* The row's rank badge and title are adjacent, but a screen reader
            reading the button alone would hear "Challenge" thirty times. */}
        <span className="sr-only"> a friend on {title}</span>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[120] flex items-end justify-center sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby={headingId}
        >
          <div
            className="absolute inset-0 bg-zinc-900/50 backdrop-blur-sm"
            onClick={close}
          />

          <div
            ref={panelRef}
            onKeyDown={onKeyDownTrap}
            // Focusable so the panel itself can take initial focus when there
            // is no Close button of ours to give it to — see the focus effect.
            tabIndex={-1}
            className="relative z-10 max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-t-3xl bg-white p-6 shadow-2xl sm:rounded-3xl focus:outline-none"
          >
            <h2
              id={headingId}
              className="text-sm font-black tracking-tight text-zinc-900"
            >
              Challenge a friend
            </h2>
            <p className="mt-0.5 truncate text-xs font-semibold text-muted">
              {title}
            </p>

            {load.kind === "ready" ? (
              <ChallengePicker
                // This surface only renders for a signed-in owner — `layout.tsx`
                // does not render `children` without one.
                signedIn
                friends={load.friends}
                board={boardId}
                game={gameSlug}
                onDone={close}
              />
            ) : (
              <>
                <p className="mt-2 text-[13px] font-semibold text-muted">
                  {load.kind === "unavailable"
                    ? CHALLENGE_REFUSAL_TEXT.unavailable
                    : "Loading your friends…"}
                </p>
                <div className="mt-4 flex justify-end">
                  <button
                    ref={closeRef}
                    type="button"
                    onClick={close}
                    className="rounded-full border border-border bg-white px-4 py-2 text-sm font-bold text-zinc-700 transition hover:bg-surface-2"
                  >
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
