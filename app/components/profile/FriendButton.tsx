"use client";

import { useState, useSyncExternalStore } from "react";

/**
 * The "Add friend" control on `/u/<username>` — a client island over the existing
 * `POST /api/v1/me/friends`.
 *
 * IT IS ONLY EVER RENDERED WHEN `canSendFriendRequest` IS TRUE. That decision
 * belongs to the page, not to this component, and the reason is worth stating: a
 * block is enforced on the profile page ENTIRELY by that flag being false, so the
 * button is simply ABSENT — no message, no disabled state, no "you cannot do
 * this". A disabled button with a tooltip would announce the block, and among
 * 13-year-olds an announced block escalates the same afternoon. Absent is
 * indistinguishable from "we are already friends", from "a request is pending",
 * and from "you are signed out", which is what makes it deniable.
 *
 * RENDERS `null` UNTIL HYDRATED, matching `AccountMenu` and `FriendsIsland`. Two
 * reasons, and neither is a fashion: this app has ZERO Suspense boundaries and
 * must not grow one here, and a button that exists in the HTML before its
 * JavaScript does is a button that silently does nothing when a school laptop on
 * a bad connection lands on the page mid-hydration. Appearing a beat late is a
 * much smaller failure than appearing dead.
 *
 * IT SENDS `publicId`, NEVER an internal id. `players.id` is the Google subject
 * for a minor; the wire format for every social endpoint is the `public_id` UUID,
 * and this component never sees anything else.
 */

/** Every outcome `POST /api/v1/me/friends` can report, mapped to player-facing copy. */
const OUTCOME_COPY: Record<string, string> = {
  sent: "Request sent",
  // Reachable as a race: they requested you between the page render and the tap,
  // and the store accepts rather than creating a second row.
  accepted: "You're friends now",
  // The server treats a duplicate as a no-op. Saying "already sent" would leak
  // that a request exists in the OTHER direction too, so both read the same.
  already: "Request sent",
};

/**
 * Failure copy. Every one of these is deliberately unspecific about the OTHER
 * player: `unavailable` covers "no such person", "they blocked you" and "you
 * blocked them", and the endpoint collapses them on purpose so this page cannot
 * be used as an existence oracle. Repeating that distinction in the UI would
 * undo it.
 */
const FAILURE_COPY: Record<string, string> = {
  cooldown: "Try that again in a bit.",
  "rate-limited": "You've sent a lot of requests today — try tomorrow.",
  "at-capacity": "That friend list is full.",
  unavailable: "Couldn't send that request.",
};

const GENERIC_FAILURE = "Couldn't send that request.";

/**
 * "Are we past hydration?", as a store rather than as a `useState` flipped in a
 * `useEffect`.
 *
 * The effect version is what `AccountMenu` looks like it does, but its flag is
 * set inside a `fetch().finally()` — asynchronously, as a genuine subscription to
 * an external system. This component has nothing to fetch (the page already
 * handed it everything), so the equivalent effect would be a synchronous
 * `setState` in an effect body, which the React compiler's lint rules reject and
 * which really does cause a cascading render.
 *
 * `useSyncExternalStore` with a never-firing subscription is the supported way to
 * ask the question: the SERVER snapshot is `false` and the CLIENT snapshot is
 * `true`, so the markup is identical on both sides of hydration and React
 * re-renders exactly once when it takes over. `personalization.ts` already leans
 * on the same server-snapshot trick for favourites.
 */
const NEVER_CHANGES = () => () => {};
const SERVER_SNAPSHOT = () => false;
const CLIENT_SNAPSHOT = () => true;

type Phase = "idle" | "sending" | "done";

export function FriendButton({
  publicId,
  displayName,
}: {
  /** `players.public_id` — the only identifier that crosses to the client. */
  publicId: string;
  /** From `publicDisplayName()`. Never the Google name — used for the a11y label. */
  displayName: string;
}) {
  const hydrated = useSyncExternalStore(
    NEVER_CHANGES,
    CLIENT_SNAPSHOT,
    SERVER_SNAPSHOT,
  );
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setPhase("sending");
    setError(null);
    try {
      const res = await fetch("/api/v1/me/friends", {
        method: "POST",
        // Cookie-credentialed and same-origin: the endpoint checks the referrer
        // against an allowlist that includes `/u/`, so this call is trusted from
        // here and would be rejected from inside a game iframe.
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: publicId }),
      });
      // Parsed even on a non-2xx: 409/429/404 all carry a `state` that says more
      // than the status code does.
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        state?: string;
      };
      const state = typeof body.state === "string" ? body.state : "";
      const success = OUTCOME_COPY[state];
      if (success) {
        setResult(success);
        setPhase("done");
        return;
      }
      setError(FAILURE_COPY[state] ?? GENERIC_FAILURE);
      setPhase("idle");
    } catch {
      // Offline. `/api/` is never intercepted by the service worker, so this is
      // a genuine network failure rather than a cache miss.
      setError("You appear to be offline.");
      setPhase("idle");
    }
  }

  if (!hydrated) return null;

  if (phase === "done" && result) {
    return (
      // `role="status"` so the swap is announced: the control the user pressed
      // has just been replaced, and a screen-reader user would otherwise be left
      // on a button that no longer exists.
      <p
        role="status"
        className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-4 py-2 text-sm font-extrabold text-brand"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M4 12.5l5.2 5.2L20 7"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {result}
      </p>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={send}
        disabled={phase === "sending"}
        aria-label={`Send ${displayName} a friend request`}
        className="inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-extrabold text-white transition hover:bg-brand-600 active:scale-95 disabled:opacity-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/30"
      >
        {/* Hand-inlined, per the repo convention: there is no icon library. */}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M12 5v14M5 12h14"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>
        {phase === "sending" ? "Sending…" : "Add friend"}
      </button>
      {error && (
        <p role="status" className="mt-2 text-[13px] font-bold text-muted">
          {error}
        </p>
      )}
    </div>
  );
}
