"use client";

import { useEffect, useRef } from "react";
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
          src={`/game-html/${game.slug}`}
          title={game.title}
          className="absolute inset-0 h-full w-full border-0"
          allow="autoplay; fullscreen; gamepad; pointer-lock"
          allowFullScreen
        />
      </div>
    </div>
  );
}
