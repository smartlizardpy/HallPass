"use client";

import { useEffect, useRef } from "react";
import posthog from "posthog-js";
import type { Game } from "../lib/games";

const HALLPASS_MSG_SOURCE = "hallpass";
const HANDLE_KEY = "hallpass:handle";
const HANDLE_RE = /^[A-Za-z0-9 _-]{1,12}$/;

type HallPassInbound =
  | { source: "hallpass"; type: "ready" }
  | { source: "hallpass"; type: "score"; score: number; meta?: unknown }
  | {
      source: "hallpass";
      type: "getScores";
      token?: string;
      limit?: number;
      period?: string;
    };

function readStoredHandle(): string | null {
  try {
    const h = window.localStorage.getItem(HANDLE_KEY);
    return h && HANDLE_RE.test(h) ? h : null;
  } catch {
    return null;
  }
}

function sanitizeHandle(value: string | null): string {
  if (!value) return "ANON";
  const cleaned = value.replace(/[^A-Za-z0-9 _-]/g, "").slice(0, 12).trim();
  return cleaned && HANDLE_RE.test(cleaned) ? cleaned : "ANON";
}

// Get a handle, prompting once for initials and persisting. Degrades to ANON
// if prompt is unavailable. Never throws.
function ensureHandle(): string {
  const existing = readStoredHandle();
  if (existing) return existing;
  let entered: string | null = null;
  try {
    if (typeof window.prompt === "function") {
      entered = window.prompt(
        "Enter your initials for the leaderboard (3 letters):",
        ""
      );
    }
  } catch {
    entered = null;
  }
  const clean = sanitizeHandle(entered);
  try {
    window.localStorage.setItem(HANDLE_KEY, clean);
  } catch {
    /* storage may be blocked */
  }
  return clean;
}

export function PlayerOverlay({
  game,
  onClose,
}: {
  game: Game | null;
  onClose: () => void;
}) {
  const frameWrapRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

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

  // HallPass SDK bridge: relay leaderboard messages from the game iframe to the
  // API and back. Entirely defensive — a failure here must never break play.
  useEffect(() => {
    if (!game) return;
    const slug = game.slug;

    const replyToFrame = (msg: Record<string, unknown>) => {
      try {
        iframeRef.current?.contentWindow?.postMessage(
          { ...msg, source: HALLPASS_MSG_SOURCE },
          "*"
        );
      } catch {
        /* ignore */
      }
    };

    const onMessage = async (event: MessageEvent) => {
      // Only trust messages from THIS game's iframe with the hallpass marker.
      const data = event.data as HallPassInbound | undefined;
      if (
        !data ||
        typeof data !== "object" ||
        data.source !== HALLPASS_MSG_SOURCE
      ) {
        return;
      }
      if (
        !iframeRef.current ||
        event.source !== iframeRef.current.contentWindow
      ) {
        return;
      }

      try {
        if (data.type === "ready") {
          replyToFrame({
            type: "ready",
            game: slug,
            handle: readStoredHandle(),
          });
          return;
        }

        if (data.type === "getScores") {
          const limit = Number.isFinite(data.limit) ? Number(data.limit) : 10;
          const period = data.period === "day" ? "day" : "all";
          const res = await fetch(
            `/api/v1/leaderboard/${encodeURIComponent(
              slug
            )}?limit=${limit}&period=${period}`,
            { method: "GET" }
          );
          const json = res.ok ? await res.json() : { scores: [] };
          replyToFrame({
            type: "scores",
            game: slug,
            token: data.token,
            scores: json.scores ?? [],
          });
          return;
        }

        if (data.type === "score") {
          const score = Number(data.score);
          if (!Number.isFinite(score) || score < 0) return;
          const handle = ensureHandle();
          const res = await fetch(
            `/api/v1/leaderboard/${encodeURIComponent(slug)}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ score, handle }),
            }
          );
          const json = res.ok ? await res.json() : null;
          if (json?.ok) {
            replyToFrame({ type: "submitted", rank: json.rank });
          } else {
            replyToFrame({
              type: "error",
              message: json?.error ?? "Submit failed",
            });
          }
          return;
        }
      } catch {
        replyToFrame({ type: "error", message: "Bridge error" });
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [game]);

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
          ref={iframeRef}
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
