"use client";

import { useEffect, useRef, useState } from "react";
import posthog from "posthog-js";
import type { Game } from "../lib/games";

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

  useEffect(() => {
    if (!game) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [game, onClose]);

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
      onClick={onClose}
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
            onClick={onClose}
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
