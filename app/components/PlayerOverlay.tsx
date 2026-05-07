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
      onClick={onClose}
    >
      {/* Top bar */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-14 shrink-0 items-center justify-between gap-4 bg-white px-5"
      >
        <h2 className="truncate text-base font-extrabold text-zinc-900">
          {game.title}
          <span className="ml-2 text-sm font-semibold text-muted">
            · {game.category}
          </span>
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleFullscreen}
            className="rounded-full bg-surface-2 px-4 py-2 text-xs font-extrabold text-zinc-700 transition hover:bg-brand-50 hover:text-brand"
            title="Fullscreen"
          >
            ⛶ Fullscreen
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-brand px-4 py-2 text-xs font-extrabold text-white transition hover:bg-brand-600"
          >
            Close ✕
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
