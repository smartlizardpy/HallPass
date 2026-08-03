"use client";

/**
 * HallPass — the "this game wants a different device" confirm.
 *
 * WHY A CONFIRM AND NOT A BLOCK. The platform tag is set by a human who played
 * the game once, and the device guess behind it is a media query, not a fact
 * (`use-device-platform.ts` explains why `(pointer: coarse)` is a heuristic). Two
 * fallible inputs must not add up to a locked door. So this warns, and "Play
 * anyway" is one tap away and always works.
 *
 * WHY NOT `window.confirm`. A native dialog blocks the whole page — and in the
 * player's case it would sit on top of a fullscreen iframe with no way to style or
 * dismiss it consistently across mobile browsers.
 *
 * WHY A SHARED HOOK RATHER THAN A CHECK AT EACH BUTTON. Play is reachable from the
 * catalogue grid, the store page's Play button, and the related-games rail. Those
 * would otherwise each grow their own copy of the same state and the same sheet,
 * and the third one added would be the one that forgot. The guard deliberately
 * does NOT live in `ArcadeShell` alongside `useOpenGame`: the shell's job is
 * owning the player overlay, not adjudicating who may open it.
 */

import { useCallback, useState } from "react";
import type { Game } from "../lib/games";
import { playsOn, useDevicePlatform } from "../lib/use-device-platform";

/**
 * Wrap an `openGame` callback so a device-mismatched game asks first.
 *
 * `requestPlay` has the same `(slug: string) => void` shape as the `openGame` it
 * wraps, so it drops straight into every existing `onPlay` prop.
 */
export function usePlayGuard(
  games: Game[],
  openGame: (slug: string) => void,
): {
  requestPlay: (slug: string) => void;
  pending: Game | null;
  confirmPlay: () => void;
  cancelPlay: () => void;
} {
  const device = useDevicePlatform();
  const [pending, setPending] = useState<Game | null>(null);

  const requestPlay = useCallback(
    (slug: string) => {
      const game = games.find((g) => g.slug === slug);
      // `=== false` and not a falsy check: an UNKNOWN game (null) opens straight
      // away, because we have no business warning about something nobody checked.
      // A null `device` (pre-mount) does the same.
      if (game && device && playsOn(game, device) === false) {
        setPending(game);
        return;
      }
      openGame(slug);
    },
    [games, device, openGame],
  );

  const confirmPlay = useCallback(() => {
    setPending((game) => {
      if (game) openGame(game.slug);
      return null;
    });
  }, [openGame]);

  const cancelPlay = useCallback(() => setPending(null), []);

  return { requestPlay, pending, confirmPlay, cancelPlay };
}

/**
 * The sheet itself. Renders nothing when `game` is null, so a page can mount it
 * unconditionally next to its grid.
 */
export function PlatformConfirmSheet({
  game,
  onConfirm,
  onCancel,
}: {
  game: Game | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!game) return null;

  const wantsMobile = game.platform === "mobile";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="platform-gate-title"
    >
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl">
        <h2
          id="platform-gate-title"
          className="text-lg font-black tracking-tight text-zinc-900"
        >
          {wantsMobile ? "Built for a phone" : "Built for a keyboard"}
        </h2>
        <p className="mt-2 text-sm font-semibold text-muted">
          {wantsMobile
            ? `${game.title} is made for touch controls, so it may not work well with a mouse and keyboard.`
            : `${game.title} is played with a keyboard, so it may not respond to touch.`}
        </p>
        <div className="mt-5 flex gap-2">
          {/* "Play anyway" is the PRIMARY action on purpose. The visitor asked to
              play; we are offering information, not permission. */}
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 rounded-full bg-brand px-5 py-2.5 text-sm font-extrabold text-white hover:bg-brand-600"
          >
            Play anyway
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-border px-5 py-2.5 text-sm font-extrabold text-zinc-900 hover:border-brand"
          >
            Back
          </button>
        </div>
      </div>
    </div>
  );
}
