"use client";

import { useCallback, useEffect, useState } from "react";
import type { MeResponse } from "@/sdk/src/contract";
import { MAX_REVIEW_LENGTH } from "../../lib/reviews/validate";

/**
 * The write half of the reviews section: sign-in prompt for guests, a
 * recommend/not + text form for signed-in players.
 *
 * Identity comes from a client-side `/api/v1/me` call, the same trick
 * `AccountMenu` uses — the store page must stay statically prerendered, so it can
 * never read the session on the server.
 *
 * ONE REVIEW PER PLAYER PER GAME, editable in place. That is the whole model: the
 * write is an upsert, so a player who already reviewed sees their existing text
 * prefilled and "Update" rather than a second box. It caps the moderation
 * surface, keeps the recommend ratio honest, and removes the pile-on surface
 * entirely by giving nothing to reply to.
 */

const BTN =
  "rounded-full bg-brand px-5 py-2.5 text-sm font-extrabold text-white transition hover:bg-brand-600 disabled:opacity-50";

export function ReviewComposer({
  slug,
  title,
  onPosted,
}: {
  slug: string;
  title: string;
  onPosted: () => void;
}) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [recommended, setRecommended] = useState<boolean | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/v1/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { player: null }))
      .then((d: MeResponse) => active && setMe(d))
      .catch(() => {})
      .finally(() => active && setLoaded(true));
    return () => {
      active = false;
    };
  }, []);

  const submit = useCallback(async () => {
    if (recommended === null) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/games/${encodeURIComponent(slug)}/reviews`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recommended, body }),
      });
      const data = (await res.json()) as { ok?: boolean; reason?: string; pending?: boolean };
      if (data.ok) {
        setDone(true);
        setMessage(
          data.pending
            ? "Thanks — your review will appear once it's been checked."
            : "Thanks for reviewing!",
        );
        setBody("");
        setRecommended(null);
        onPosted();
      } else {
        setMessage(data.reason ?? "Could not post that.");
      }
    } catch {
      setMessage("You appear to be offline.");
    } finally {
      setBusy(false);
    }
  }, [body, onPosted, recommended, slug]);

  // Hold no space until identity lands, matching AccountMenu's `loaded` flag.
  if (!loaded) return null;

  if (!me?.player) {
    return (
      <div className="mt-4 rounded-2xl bg-brand-50 px-5 py-6 text-center">
        <p className="text-[15px] font-bold text-zinc-900">
          Sign in to review {title}
        </p>
        <a
          href={`/play/signin?callbackUrl=${encodeURIComponent(`/game/${slug}`)}`}
          className={`${BTN} mt-3 inline-block`}
        >
          Sign in
        </a>
      </div>
    );
  }

  if (done) {
    return (
      <p
        role="status"
        className="mt-4 rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900"
      >
        {message}
      </p>
    );
  }

  const remaining = MAX_REVIEW_LENGTH - [...body].length;

  return (
    <div className="mt-4 rounded-2xl bg-surface-2/60 p-4">
      <p className="text-sm font-extrabold text-zinc-900">
        Would you recommend {title}?
      </p>

      <div className="mt-3 flex gap-2">
        <RecommendButton
          active={recommended === true}
          tone="yes"
          onClick={() => setRecommended(true)}
        >
          Recommended
        </RecommendButton>
        <RecommendButton
          active={recommended === false}
          tone="no"
          onClick={() => setRecommended(false)}
        >
          Not for me
        </RecommendButton>
      </div>

      <label className="mt-3 block">
        <span className="sr-only">Your review</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          maxLength={MAX_REVIEW_LENGTH}
          placeholder="What did you think? No links or personal info."
          className="w-full rounded-xl border border-border bg-white px-3 py-2 text-[15px] font-semibold text-zinc-900 placeholder:text-muted outline-none transition focus:ring-4 focus:ring-brand/20"
        />
      </label>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        {/* The rules ARE the empty state. Visible rules are the cheapest
            deterrent available and double as evidence of policy. */}
        <p className="text-xs font-bold text-muted">
          Be kind. No links, no personal info. Reviews can be reported.
        </p>
        <span className="text-xs font-bold text-muted">{remaining}</span>
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={busy || recommended === null || body.trim().length < 2}
        className={`${BTN} mt-3`}
      >
        Post review
      </button>

      {message && (
        <p role="status" className="mt-3 text-sm font-bold text-red-700">
          {message}
        </p>
      )}
    </div>
  );
}

function RecommendButton({
  active,
  tone,
  onClick,
  children,
}: {
  active: boolean;
  tone: "yes" | "no";
  onClick: () => void;
  children: React.ReactNode;
}) {
  const base =
    "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-extrabold transition border";
  // Semantic colours rather than the brand purple: this is a judgement, not a
  // primary action, and the repo already uses emerald/red for exactly that.
  const skin = active
    ? tone === "yes"
      ? "border-emerald-300 bg-emerald-100 text-emerald-900"
      : "border-red-300 bg-red-100 text-red-900"
    : "border-border bg-white text-zinc-700 hover:bg-surface-2";

  return (
    <button type="button" aria-pressed={active} onClick={onClick} className={`${base} ${skin}`}>
      <ThumbIcon up={tone === "yes"} />
      {children}
    </button>
  );
}

export function ThumbIcon({ up }: { up: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="pointer-events-none shrink-0"
      style={up ? undefined : { transform: "rotate(180deg)" }}
      aria-hidden
    >
      <path d="M2 10h4v12H2zM22 11a2 2 0 0 0-2-2h-6l1-4.5A2.5 2.5 0 0 0 12.5 2L8 10v12h11a2 2 0 0 0 2-1.6l1.9-8.4z" />
    </svg>
  );
}
