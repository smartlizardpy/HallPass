"use client";

import { useState } from "react";
import type { Review } from "../../lib/reviews/store";
import { REPORT_REASONS } from "../../lib/reviews/config";
import { Avatar } from "../friends/Avatar";
import { ThumbIcon } from "./ReviewComposer";

/**
 * One review: author, verdict badge, body, helpful vote, report control.
 *
 * The layout follows the reference — avatar left, name and handle on one line, a
 * coloured Recommended / Not-recommended badge beneath, then the body, then the
 * helpful count, with the report control top-right.
 *
 * Two details that are safety rather than style:
 *
 * 1. THE @USERNAME AND THE #TAG ARE ALWAYS SHOWN. Display handles are NOT unique
 *    and `effectiveHandle` falls back to the Google name, so two players can
 *    present identically. Without a discriminator, impersonating someone beside
 *    their own review is a two-second attack. The tag is a salted hash of the
 *    player id, never the raw Google subject, which would otherwise be a durable
 *    cross-site identifier for a minor.
 *
 * 2. THE BODY IS PLAIN TEXT. Never `dangerouslySetInnerHTML` — React escapes by
 *    default and that is the entire XSS story here. `whitespace-pre-wrap` keeps
 *    the author's line breaks; `break-words` stops a 500-character unbroken
 *    string blowing out the layout.
 */
export function ReviewRow({
  review,
  onChanged,
}: {
  review: Review;
  onChanged: () => void;
}) {
  const [helpful, setHelpful] = useState(review.helpfulCount);
  const [voted, setVoted] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);
  const [busy, setBusy] = useState(false);

  const vote = async () => {
    setBusy(true);
    // Optimistic: the endpoint is idempotent per (review, voter), so a
    // double-click cannot inflate anything even if this races.
    const next = !voted;
    setVoted(next);
    setHelpful((n) => Math.max(0, n + (next ? 1 : -1)));
    try {
      const res = await fetch(`/api/v1/reviews/${review.id}/helpful`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("failed");
      const data = (await res.json()) as { helpful?: boolean; count?: number };
      if (typeof data.count === "number") setHelpful(data.count);
      if (typeof data.helpful === "boolean") setVoted(data.helpful);
    } catch {
      // Roll the optimistic change back rather than leaving a wrong number.
      setVoted(!next);
      setHelpful((n) => Math.max(0, n + (next ? -1 : 1)));
    } finally {
      setBusy(false);
    }
  };

  const report = async (reason: string) => {
    setBusy(true);
    try {
      await fetch(`/api/v1/reviews/${review.id}/report`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      // Always reports success — the endpoint answers ok whether or not this
      // person had already reported it, so it never leaks that either.
      setReported(true);
      setReporting(false);
      onChanged();
    } catch {
      setReported(true);
      setReporting(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="relative rounded-2xl bg-surface-2/50 p-4">
      <div className="flex items-start gap-3">
        <Avatar person={review.author} size={36} />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 pr-8">
            <span className="truncate text-[15px] font-extrabold text-zinc-900">
              {review.author.displayName}
            </span>
            {review.author.username && (
              <span className="truncate text-[13px] font-bold text-muted">
                @{review.author.username}
              </span>
            )}
            {review.author.tag && (
              <span className="text-[11px] font-bold text-muted/70">
                #{review.author.tag}
              </span>
            )}
            <span className="text-[12px] font-bold text-muted">
              · {formatDate(review.createdAt)}
              {review.edited && " · edited"}
            </span>
          </div>

          <span
            className={`mt-1.5 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-wide ${
              review.recommended
                ? "bg-emerald-100 text-emerald-900"
                : "bg-red-100 text-red-900"
            }`}
          >
            <ThumbIcon up={review.recommended} />
            {review.recommended ? "Recommended" : "Not for me"}
          </span>

          <p className="mt-2 whitespace-pre-wrap break-words text-[15px] font-semibold leading-relaxed text-zinc-700">
            {review.body}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={vote}
              disabled={busy}
              aria-pressed={voted}
              className={`text-[12px] font-bold transition disabled:opacity-50 ${
                voted ? "text-brand" : "text-muted hover:text-zinc-900"
              }`}
            >
              Helpful{helpful > 0 && ` (${helpful})`}
            </button>
          </div>
        </div>
      </div>

      {/* Report control, top-right as in the reference. */}
      {reported ? (
        <span className="absolute right-3 top-3 text-[11px] font-bold text-muted">
          Reported
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setReporting((v) => !v)}
          aria-label="Report this review"
          aria-expanded={reporting}
          className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full text-muted transition hover:bg-white hover:text-zinc-900"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="pointer-events-none"
          >
            <path d="M4 21V4a1 1 0 0 1 1-1h11l-2 4 2 4H5" />
          </svg>
        </button>
      )}

      {reporting && (
        <div className="mt-3 rounded-xl border border-border bg-white p-3">
          <p className="text-[12px] font-black uppercase tracking-wide text-muted">
            Why are you reporting this?
          </p>
          <ul className="mt-2 space-y-1">
            {REPORT_REASONS.map((reason) => (
              <li key={reason.value}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => report(reason.value)}
                  className="w-full rounded-lg px-2 py-1.5 text-left text-[13px] font-bold text-zinc-700 transition hover:bg-surface-2 disabled:opacity-50"
                >
                  {reason.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

/**
 * Fixed locale so the server and client agree — the same reason
 * `formatMonthYear` on the account page pins `en-US`.
 */
function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
