"use client";

import { useState } from "react";
import {
  HANDLE_MAX_LENGTH,
  HANDLE_REJECTION_MESSAGES,
  validateHandle,
} from "../lib/handle";

/**
 * The "pick a name" step shown once, right after a first Google sign-in.
 *
 * WHY IT EXISTS. Until a player sets a handle, `effectiveHandle()` falls back to
 * `players.name` — the Google account name, which for most people is their FULL
 * REAL NAME — and that is what appears on every leaderboard they enter. Asking
 * once at sign-in means a new player's real name is never published by default.
 *
 * Used by BOTH sign-in flows, which is why it is a component rather than a page:
 *   - `/play/welcome`, the full-page step for an ordinary sign-in;
 *   - `/play/auth/complete`, the SDK's popup, where the player is mid-game.
 *
 * Shape feedback is live because `validateHandle` is pure and ships to the
 * browser. The slur check runs server-side only and therefore surfaces on submit
 * — the same deliberate asymmetry as usernames, for the same reason: a shipped
 * blocklist is a shipped evasion dictionary.
 */
export function HandleChooser({
  action,
  suggestion,
  error,
  next,
  compact = false,
}: {
  /** Server action; receives `handle` plus whatever hidden fields the page adds. */
  action: (formData: FormData) => void | Promise<void>;
  /** First name from the Google profile, or "" — never the full name. */
  suggestion: string;
  /** Server-side rejection from a previous submit. */
  error?: string | null;
  /**
   * Where to land afterwards, carried as a hidden field INSIDE this form.
   *
   * It has to be in the form rather than captured in the action's closure so the
   * server re-validates it on submit (`safeRelativePath`) rather than trusting
   * whatever the page happened to render with.
   */
  next?: string;
  /** Tighter spacing for the 480px sign-in popup. */
  compact?: boolean;
}) {
  const [value, setValue] = useState(suggestion);

  const trimmed = value.trim();
  const check = trimmed.length > 0 ? validateHandle(trimmed) : null;
  const shapeError =
    check && !check.ok ? HANDLE_REJECTION_MESSAGES[check.reason] : null;
  const remaining = HANDLE_MAX_LENGTH - [...trimmed].length;

  return (
    <form action={action} className={compact ? "mt-4 text-left" : "mt-6 text-left"}>
      {next !== undefined && <input type="hidden" name="next" value={next} />}
      <label className="block text-sm font-extrabold text-zinc-900">
        What should we call you?
        <input
          name="handle"
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={HANDLE_MAX_LENGTH}
          autoComplete="off"
          autoFocus
          placeholder="e.g. NeonRunner"
          aria-describedby="handle-help"
          className="mt-2 w-full rounded-full border border-border bg-white px-4 py-3 text-base font-semibold text-zinc-900 placeholder:text-muted outline-none transition focus:ring-4 focus:ring-brand/20"
        />
      </label>

      <p id="handle-help" className="mt-2 text-xs font-bold text-muted">
        This is shown publicly on leaderboards and reviews. You can change it any
        time in your account.
      </p>

      {(shapeError || error) && (
        <p role="alert" className="mt-2 text-xs font-bold text-red-700">
          {shapeError ?? error}
        </p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="submit"
          disabled={!check?.ok}
          className="rounded-full bg-brand px-6 py-3 text-sm font-extrabold text-white transition hover:bg-brand-600 disabled:opacity-50"
        >
          Continue
        </button>
        {trimmed.length > 0 && (
          <span className="text-xs font-bold text-muted">{remaining}</span>
        )}
      </div>
    </form>
  );
}
