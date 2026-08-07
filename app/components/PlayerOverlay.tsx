"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import posthog from "posthog-js";
import type { Game } from "../lib/games";
import { recordPlayServerSide, recordRecentPlay } from "../lib/personalization";
import { recordPlay as recordStreakPlay } from "../lib/streak/store";

/**
 * The fullscreen game player.
 *
 * THIS COMPONENT OWNS PLAY TELEMETRY. It used to be fired by `Arcade.setPlaying`,
 * which meant it only fired for plays that started from a catalog card — a direct
 * link, a shared URL, or a PWA launch went through `initialPlaying` instead and
 * fired `recordRecentPlay` but NOT `game_started`. So `getGamePlayCounts()` in
 * `app/lib/stats.ts`, which counts `game_started`, has been under-reporting every
 * one of those. Firing from the overlay makes it exactly once, from one place,
 * for every entry path.
 *
 * Expect a step change in the plays chart when this ships — it is the previously
 * uncounted plays appearing, not a traffic spike. Worth annotating in PostHog.
 */
export function PlayerOverlay({
  game,
  onClose,
}: {
  game: Game | null;
  onClose: () => void;
}) {
  const frameWrapRef = useRef<HTMLDivElement>(null);

  // External games embed a third-party origin we don't control. Some sites send
  // X-Frame-Options / frame-ancestors that refuse embedding — and the browser
  // gives us NO reliable, cross-origin signal when that happens. Heuristic: when
  // an external game opens, start a ~4s timer; if the iframe's onLoad hasn't
  // fired by then, assume it may be blocked and surface an "open in new tab" CTA.
  const isExternal = Boolean(game?.externalUrl);
  const [maybeBlocked, setMaybeBlocked] = useState(false);
  const blockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset + (re)arm the block-detection timer whenever the active game changes.
  // Non-external games never arm the timer, so they behave exactly as before.
  useEffect(() => {
    setMaybeBlocked(false);
    blockTimerRef.current = null;
    if (game?.externalUrl) {
      blockTimerRef.current = setTimeout(() => setMaybeBlocked(true), 4000);
    }
    return () => {
      if (blockTimerRef.current) {
        clearTimeout(blockTimerRef.current);
        blockTimerRef.current = null;
      }
    };
  }, [game]);

  // onLoad fired => the frame embedded fine; cancel the pending block guess.
  const handleFrameLoad = () => {
    if (blockTimerRef.current) {
      clearTimeout(blockTimerRef.current);
      blockTimerRef.current = null;
    }
    setMaybeBlocked(false);
  };

  /**
   * User-initiated close (Esc, ✕, backdrop). Goes through history rather than
   * calling `onClose` directly: opening pushed an entry, so closing must POP it,
   * or the entry would linger and the next Back would leave the page instead of
   * doing nothing visible. The `popstate` listener below is what actually clears
   * the state, so both the button and the Back gesture take one identical path.
   */
  const closingRef = useRef(false);
  const requestClose = useCallback(() => {
    // Guarded: `history.back()` is async, so React has not unmounted this overlay
    // by the time a second Esc or ✕ press lands. Without the latch, two quick
    // presses pop TWO entries and the user is thrown back past the page they
    // opened the game from. The latch is released when the overlay actually
    // closes (the effect below reruns with a null slug).
    if (closingRef.current) return;
    closingRef.current = true;
    window.history.back();
  }, []);

  useEffect(() => {
    if (!game) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [game, requestClose]);

  /**
   * Play telemetry + a history entry, keyed on the SLUG rather than the `game`
   * object so a re-render that produces a new object identity does not re-fire.
   *
   * The close event is emitted from the cleanup, using values captured in the
   * effect body — reading `game` there would see the NEXT value (or null) by the
   * time cleanup runs, so a close would be attributed to the wrong game or
   * dropped entirely.
   */
  const slug = game?.slug ?? null;
  const title = game?.title;
  const categoryName = game?.category;
  useEffect(() => {
    if (!slug) {
      // Overlay is closed: re-arm the close latch for the next open.
      closingRef.current = false;
      return;
    }

    recordRecentPlay(slug);
    // Server-side play history, which is what makes "friends who play this"
    // answerable — `hp:recent` above is device-local and never synced. Debounced
    // per slug and a no-op for guests.
    recordPlayServerSide(slug);
    // Count this open toward the device-local daily streak. Idempotent per
    // calendar day, so replays later today don't double-count or re-toast.
    recordStreakPlay();
    posthog.capture("game_started", {
      game_slug: slug,
      game_title: title,
      game_category: categoryName,
    });

    // A history entry so Back closes the game, uniformly from every page.
    //
    // The URL is deliberately left UNCHANGED. A `?play=1`-style URL would be
    // shareable, but it would also have to auto-open on load, and `caches.match`
    // is exact on the query string — so a shared link opened offline would miss
    // the precached document for the page it names. Not worth it for a link
    // nobody asked for; `/game/<slug>` already shares fine.
    //
    // `pushState` rather than `router.push`: the route's SERVER output cannot
    // differ (nothing here reads the query), so an RSC round trip buys nothing.
    window.history.pushState({ hpOverlay: slug }, "");

    const onPop = () => onClose();
    window.addEventListener("popstate", onPop);

    return () => {
      window.removeEventListener("popstate", onPop);
      posthog.capture("game_closed", {
        game_slug: slug,
        game_title: title,
        game_category: categoryName,
      });
    };
    // `onClose` is intentionally excluded: callers pass a stable useCallback, and
    // including it would re-run the whole effect (re-firing game_started and
    // pushing a second history entry) on any parent re-render that broke that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, title, categoryName]);

  const handleFullscreen = () => {
    const el = frameWrapRef.current;
    if (!el) return;
    const entering = !document.fullscreenElement;
    if (entering) el.requestFullscreen?.();
    else document.exitFullscreen();
    posthog.capture("fullscreen_toggled", {
      game_slug: game?.slug,
      game_title: game?.title,
      entering_fullscreen: entering,
    });
  };

  if (!game) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-zinc-900/80 backdrop-blur-md"
      style={{ height: "100dvh" }}
      onClick={requestClose}
    >
      {/* Top bar */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex shrink-0 items-center justify-between gap-3 bg-white px-3 sm:h-14 sm:px-5"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <h2 className="min-w-0 flex-1 truncate py-3 text-sm font-extrabold text-zinc-900 sm:py-0 sm:text-base">
          {game.title}
          <span className="ml-2 hidden text-sm font-semibold text-muted sm:inline">
            · {game.category}
          </span>
        </h2>
        <div className="flex shrink-0 items-center gap-2">
          {/* Persistent escape hatch for external games: a third-party site may
              refuse embedding, so always offer a real new-tab link. The centred
              block-detection overlay is only a HEURISTIC (a refused frame can still
              fire onLoad on the browser's error page, cancelling it), so this link
              must be reachable at EVERY width — otherwise a mobile user left with a
              blank frame has no way out. Desktop shows the labelled pill; mobile
              gets the icon-only variant below (mirrors the fullscreen button). */}
          {isExternal && game.externalUrl && (
            <a
              href={game.externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden rounded-full bg-surface-2 px-4 py-2 text-xs font-extrabold text-zinc-700 transition hover:bg-brand-50 hover:text-brand sm:inline-flex sm:items-center"
              title="Open in new tab"
            >
              Open in new tab ↗
            </a>
          )}
          {isExternal && game.externalUrl && (
            <a
              href={game.externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open in new tab"
              title="Open in new tab"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-surface-2 text-base font-extrabold text-zinc-700 transition hover:bg-brand-50 hover:text-brand sm:hidden"
            >
              ↗
            </a>
          )}
          <button
            type="button"
            onClick={handleFullscreen}
            className="hidden rounded-full bg-surface-2 px-4 py-2 text-xs font-extrabold text-zinc-700 transition hover:bg-brand-50 hover:text-brand sm:inline-flex sm:items-center"
            title="Fullscreen"
          >
            ⛶ Fullscreen
          </button>
          <button
            type="button"
            onClick={handleFullscreen}
            aria-label="Toggle fullscreen"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-surface-2 text-base font-extrabold text-zinc-700 transition hover:bg-brand-50 hover:text-brand sm:hidden"
          >
            ⛶
          </button>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close game"
            className="inline-flex h-11 min-w-11 items-center justify-center rounded-full bg-brand px-4 text-xs font-extrabold text-white transition hover:bg-brand-600 sm:h-auto sm:min-w-0 sm:py-2"
          >
            <span className="hidden sm:inline">Close ✕</span>
            <span className="sm:hidden text-lg leading-none">✕</span>
          </button>
        </div>
      </div>

      {/* Game iframe — fills remaining space */}
      <div
        ref={frameWrapRef}
        onClick={(e) => e.stopPropagation()}
        className="relative flex-1 bg-black"
      >
        <iframe
          key={game.slug}
          // External games point at their own origin. Local games load from
          // /game-html/<slug>/ — the trailing slash is load-bearing: it makes the
          // game's relative asset URLs (./main.js) resolve under that folder.
          src={game.externalUrl ?? `/game-html/${game.slug}/`}
          title={game.title}
          onLoad={handleFrameLoad}
          className="absolute inset-0 h-full w-full border-0"
          allow="autoplay; fullscreen; gamepad; pointer-lock"
          allowFullScreen
        />

        {/* Block-detection fallback: the frame didn't load in time, so it may be
            refusing to embed. Offer a centred CTA to open the game directly. */}
        {maybeBlocked && game.externalUrl && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/80 p-6 backdrop-blur-sm">
            <div className="max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl">
              <p className="text-sm font-bold text-zinc-900">
                This game may not embed here.
              </p>
              <a
                href={game.externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center justify-center rounded-full bg-brand px-5 py-2.5 text-sm font-extrabold text-white transition hover:bg-brand-600"
              >
                Open in new tab ↗
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
