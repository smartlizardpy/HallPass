"use client";

/**
 * HallPass — "share a link", the outward half of a challenge.
 *
 * Mints (or refreshes) this player's link for one board and hands it to
 * whatever the device is best at: the native share sheet, else the clipboard,
 * else the bare URL on screen to be copied by hand. Every rung of that ladder
 * ends with the player holding the link, which is the only outcome that counts.
 *
 * ── THE URL IS BUILT FROM `location.origin` ────────────────────────────────
 * The route returns a site-relative path and this joins it. Threading
 * `SITE_URL` into a browser bundle would hard-code production into every
 * preview deployment, so a link shared while testing would send people to the
 * live site and quietly fail to find the code.
 *
 * ── WHY PRESSING IT TWICE IS SAFE ──────────────────────────────────────────
 * The endpoint is an upsert keyed on (owner, board): it hands back the SAME
 * code every time and only refreshes the score under it. So this never has to
 * cache, never has to disable itself against a double tap, and a player who
 * shares the same board in three different chats is sharing one link.
 *
 * ── `navigator.share` IS TRIED, NOT ASSUMED ────────────────────────────────
 * It is absent on most desktops, and on the browsers that have it a user who
 * dismisses the sheet rejects the promise with `AbortError`. That is not a
 * failure to report — they changed their mind — so it falls through to the
 * copy path rather than showing an error for a thing that worked.
 */

import { useCallback, useState } from "react";
import posthog from "posthog-js";

/** Why a link could not be minted, in words for the person who asked. */
const REFUSAL_TEXT: Record<string, string> = {
  "no-board": "This game has no leaderboard to share.",
  "no-score": "Set a score here first, then share it.",
  // The one refusal unique to links. `sdk/src/client.ts` only mints a claim
  // token for a same-origin submission, so on a game hosted elsewhere nobody
  // who follows the link could ever keep what they scored.
  external: "This game is hosted elsewhere, so it can't be shared this way.",
  "bad-request": "Something about this leaderboard is not set up right.",
  unavailable: "Sharing is unavailable at the moment.",
};

type State =
  | { kind: "idle" }
  | { kind: "working" }
  /** Shared or copied — `url` is kept so it can still be read off the screen. */
  | { kind: "done"; url: string; copied: boolean }
  | { kind: "failed"; message: string };

export function ShareChallenge({
  boardId,
  title,
  className,
}: {
  boardId: string;
  title: string;
  className?: string;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });

  const share = useCallback(async () => {
    setState({ kind: "working" });
    let url: string;
    try {
      const res = await fetch("/api/v1/me/challenges/link", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ board: boardId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        reason?: string;
        path?: string;
      };
      if (!res.ok || !data.ok || !data.path) {
        const text = REFUSAL_TEXT[data.reason ?? ""] ?? REFUSAL_TEXT.unavailable;
        setState({ kind: "failed", message: text });
        return;
      }
      url = new URL(data.path, window.location.origin).toString();
    } catch {
      setState({ kind: "failed", message: "No connection. Try again in a moment." });
      return;
    }

    // The share sheet first, where there is one.
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: "Beat my score",
          text: `Think you can beat my score on ${title}?`,
          url,
        });
        // The other end of the funnel `/c/<code>` measures. `board` rather than
        // the code, because this is the OWNER's side and the code is already
        // theirs — nothing here needs to identify a person.
        posthog.capture("challenge_link_shared", { board: boardId, via: "sheet" });
        setState({ kind: "done", url, copied: false });
        return;
      } catch {
        // Dismissed, or the sheet refused. Fall through and copy instead —
        // showing an error for a cancelled share would be a lie.
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      posthog.capture("challenge_link_shared", { board: boardId, via: "clipboard" });
      setState({ kind: "done", url, copied: true });
    } catch {
      // No clipboard permission, or an insecure context. The URL is on screen
      // either way, which is the last rung of the ladder and still works.
      posthog.capture("challenge_link_shared", { board: boardId, via: "manual" });
      setState({ kind: "done", url, copied: false });
    }
  }, [boardId, title]);

  if (state.kind === "done") {
    return (
      <div className={className}>
        <p className="text-xs font-bold text-brand">
          {state.copied ? "Link copied" : "Your link"}
        </p>
        {/*
          `readOnly` and not `disabled`: a disabled input cannot be focused, so
          somebody without a working clipboard could not select the text to copy
          it by hand — which is the whole point of still showing it.
        */}
        <input
          readOnly
          value={state.url}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="Your challenge link"
          className="mt-1 w-full rounded-lg border border-border bg-surface-2 px-2 py-1 text-xs text-muted"
        />
      </div>
    );
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={share}
        disabled={state.kind === "working"}
        className="shrink-0 rounded-full border border-border bg-white px-3 py-1 text-xs font-bold text-zinc-700 transition hover:border-brand hover:text-brand disabled:opacity-50"
      >
        {state.kind === "working" ? "…" : "Share"}
        <span className="sr-only"> a challenge link for {title}</span>
      </button>
      {state.kind === "failed" ? (
        <p role="alert" className="mt-1 text-xs font-semibold text-rose-700">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
