"use client";

import { useState } from "react";
import Link from "next/link";
import type { Review } from "../../lib/reviews/store";
import { REPORT_REASONS } from "../../lib/reviews/config";
import { normalizeTargetLang } from "../../lib/reviews/translate";
import { Avatar } from "../friends/Avatar";
import { ThumbIcon } from "./ReviewComposer";

/**
 * The reader's preferred language as a code the translate route accepts, or null
 * when we cannot offer a translation (no `navigator`, or an unsupported locale).
 * `navigator.languages` is tried in order so a reader whose top choice we cannot
 * serve still gets their second. Normalised through the SAME function the server
 * uses, so both agree on the cache key and region variants (`en-GB`, `en-US`) fold
 * to one upstream call.
 */
function readerLang(): string | null {
  if (typeof navigator === "undefined") return null;
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const lang of langs) {
    const normalized = normalizeTargetLang(lang);
    if (normalized) return normalized;
  }
  return null;
}

/** A human language name for a code (`es` → "Spanish"), in the reader's own locale. */
function languageName(code: string): string {
  try {
    const names = new Intl.DisplayNames(
      typeof navigator === "undefined" ? undefined : [navigator.language],
      { type: "language" },
    );
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * What came back from the report endpoint.
 *
 * ONE STATE, NOT A `reported` BOOLEAN, and the difference is the bug this
 * replaces. The boolean was set on every path — including the `catch` — so a
 * 401, a 403, a 503 and a dead network all rendered the same "Reported" as a
 * report sitting in the moderation queue. On a site for children the report
 * button is the safeguarding path: the one thing it must never do is say an
 * adult has been told when nobody has.
 */
type ReportResult = { kind: "done" } | { kind: "error"; message: string };

/** Says nothing about the review — only that the report did not get through. */
const REPORT_FAILED = "That report didn't send. Try again.";

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
 *    Both stay legible: the tag is the thing that tells two same-named players
 *    apart, so it is real content and is sized and coloured as such — a dimmed
 *    `text-muted/70` lands near 2.9:1, well under AA, on the one element a
 *    reader has to be able to read to spot an impersonation.
 *
 *    THE @USERNAME LINKS TO `/u/<username>`, and only the @username does. The
 *    display name is not linked: it can be a copied handle, whereas the username
 *    is the unique address the profile actually lives at, so the linked text and
 *    the destination always agree. The link is a SIBLING of the helpful/report
 *    buttons, never an ancestor — a button inside an anchor is invalid HTML that
 *    browsers resolve inconsistently, the invariant `GameCard` and `PersonRow`
 *    both document. A player with no username is not linkable at all (`/u/` is
 *    the only profile route there is) and stays plain text.
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
  const [result, setResult] = useState<ReportResult | null>(null);
  const [busy, setBusy] = useState(false);

  // Translation is fetched once, lazily, and then toggled locally. `target` is
  // computed a single time on the client; when it is null we never render the
  // control. `native` means the review is already in the reader's language, so the
  // offer is replaced by a quiet note rather than a toggle to an identical string.
  const [target] = useState<string | null>(() => readerLang());
  const [translation, setTranslation] = useState<string | null>(null);
  const [source, setSource] = useState("");
  const [showTranslated, setShowTranslated] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [transError, setTransError] = useState(false);
  const [native, setNative] = useState(false);

  const translate = async () => {
    // Already have it — this is a pure show/hide toggle, no network.
    if (translation) {
      setShowTranslated((v) => !v);
      return;
    }
    if (!target) return;
    setTranslating(true);
    setTransError(false);
    try {
      const res = await fetch(
        `/api/v1/reviews/${review.id}/translate?to=${encodeURIComponent(target)}`,
      );
      const data = (await res.json()) as {
        ok?: boolean;
        text?: string;
        source?: string;
      };
      if (data.ok && typeof data.text === "string") {
        const src = String(data.source ?? "");
        // Source detected as the reader's own language: nothing to translate.
        if (src.split("-")[0] === target.split("-")[0]) {
          setNative(true);
        } else {
          setTranslation(data.text);
          setSource(src);
          setShowTranslated(true);
        }
      } else {
        setTransError(true);
      }
    } catch {
      // Offline or a soft upstream miss — keep the original, say so quietly.
      setTransError(true);
    } finally {
      setTranslating(false);
    }
  };

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
      const res = await fetch(`/api/v1/reviews/${review.id}/report`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        reason?: string;
      };
      if (res.ok && data.ok) {
        setResult({ kind: "done" });
        onChanged();
      } else {
        // The endpoint's own words when it has any — it is the half that knows
        // WHY, and the only refusal it spells out is one that leaks nothing
        // (reporting your own review). Everything else gets the generic line.
        setResult({ kind: "error", message: data.reason ?? REPORT_FAILED });
      }
      setReporting(false);
    } catch {
      // The fetch never completed, so nothing was filed. Saying "Reported" here
      // — which this used to do — is the version of this bug that hides itself
      // best: the reader believes an adult has been told, and nobody has.
      setResult({ kind: "error", message: "You appear to be offline." });
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
              <Link
                href={`/u/${encodeURIComponent(review.author.username)}`}
                className="truncate rounded text-[13px] font-bold text-muted transition hover:text-brand focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/30"
              >
                @{review.author.username}
              </Link>
            )}
            {review.author.tag && (
              <span className="text-[12px] font-bold text-muted">
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

          {/* PLAIN TEXT still — a machine translation is as untrusted as the
              original body, so it is rendered as a text child (React escapes it),
              never via dangerouslySetInnerHTML. */}
          <p className="mt-2 whitespace-pre-wrap break-words text-[15px] font-semibold leading-relaxed text-zinc-700">
            {showTranslated && translation ? translation : review.body}
          </p>

          {showTranslated && translation && (
            <p className="mt-1 text-[11px] font-bold text-muted">
              Translated from {languageName(source)} · machine translation
            </p>
          )}

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

            {/* Translation offer. Hidden entirely when we cannot serve the reader's
                language; replaced by a quiet note when the review already is in it. */}
            {target &&
              (native ? (
                <span className="text-[12px] font-bold text-muted">
                  Already in your language
                </span>
              ) : (
                <button
                  type="button"
                  onClick={translate}
                  disabled={translating}
                  aria-pressed={showTranslated}
                  className="text-[12px] font-bold text-muted transition hover:text-zinc-900 disabled:opacity-50"
                >
                  {translating
                    ? "Translating…"
                    : translation
                      ? showTranslated
                        ? "Show original"
                        : "Show translation"
                      : "Translate"}
                </button>
              ))}

            {transError && (
              <span className="text-[12px] font-bold text-muted">
                Translation unavailable
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Report control, top-right as in the reference. It goes away only on a
          report the server confirmed it filed; a failed one leaves the button
          there, because the reader's next move is to try again. */}
      {result?.kind === "done" ? (
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

      {/* Why it did not send. Amber and quiet, matching the card's own failure
          notice in `GameReviews` — the reader did nothing wrong, and a red
          block beside a review they just objected to reads as a telling-off. */}
      {result && result.kind !== "done" && (
        <p
          role="status"
          className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] font-bold text-amber-900"
        >
          {result.message}
        </p>
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
