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

import { useCallback, useEffect, useRef, useState } from "react";
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
 *
 * EVERY WAY OUT IS A WAY OUT. On a phone this is a bottom sheet, and tapping the
 * dimmed area above it is the first thing anyone tries — it used to do nothing at
 * all, on a component whose whole purpose is to be easy to wave away. Escape did
 * nothing either, and focus stayed on the ▶ behind the sheet, so a keyboard player
 * was answering a question they had not been shown. Backdrop, Escape and "Back"
 * now all cancel, and the sheet takes focus when it appears.
 *
 * The dialog is what receives focus, not "Play anyway". Landing on the primary
 * button would mean a stray Enter — from the very keypress that opened the sheet —
 * silently confirming past a warning the player never read, which is the one
 * outcome this component exists to prevent. Focusing the panel announces the
 * heading and leaves "Play anyway" one Tab away.
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
  const panelRef = useRef<HTMLDivElement>(null);
  const open = game !== null;

  // Focus in on appear, and back to the ▶ they pressed on the way out. Keyed on
  // `open` alone so a caller passing an inline `onCancel` cannot turn a re-render
  // into a focus jump — the same split `StealthSettings` uses.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => {
      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!game) return null;

  const wantsMobile = game.platform === "mobile";

  return (
    // The backdrop is `presentation` and the panel is the dialog — the arrangement
    // `FeaturePromo` uses — because the click-to-cancel target must not also be the
    // thing assistive tech is told to treat as the dialog.
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
      onClick={onCancel}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="platform-gate-title"
        // Clicks inside the sheet are not "outside" it. Without this, every button
        // press would also hit the backdrop handler on its way up and cancel.
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
        className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl outline-none"
      >
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
