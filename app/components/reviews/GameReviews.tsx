"use client";

import { useCallback, useEffect, useState } from "react";
import type { Review } from "../../lib/reviews/store";
import { ReviewComposer } from "./ReviewComposer";
import { ReviewRow } from "./ReviewRow";

/**
 * The reviews section of a game's store page.
 *
 * A CLIENT ISLAND, and it has to be. `/game/[slug]` must stay statically
 * prerendered: one `auth()` on that page makes the route dynamic, drops it from
 * `prerender-manifest.json`, and therefore drops all 27 game pages from the
 * service-worker precache — silently breaking offline play with no error
 * anywhere. Server-rendering reviews would also bake a snapshot into the
 * prerender that the PWA then serves indefinitely.
 *
 * The service worker never intercepts `/api/`, so this simply fails offline and
 * says so, rather than spinning.
 *
 * ── THE CARD IS NEVER BLANK ─────────────────────────────────────────────────
 *
 * Fetching on the client means there is always a moment with no reviews, and
 * every one of those moments has to say which it is. There are four:
 *
 *   loading   → `ReviewsSkeleton`, at roughly the height of the real thing
 *   offline   → amber notice + retry
 *   error     → amber notice + retry (a non-ok response, NOT a silent no-op)
 *   disabled  → amber notice, no retry; the server answered, the answer is no
 *
 * The two failures share the treatment on purpose — see `FailureNotice` — and
 * the skeleton reserves height on purpose — see `ReviewsSkeleton`. Before this,
 * `!res.ok` returned without touching state, which left `data` null forever and
 * rendered the "Reviews" heading over an empty white card: a 500 and a slow
 * network were pixel-identical, and both looked like a bug in the page.
 *
 * A failure keeps whatever `data` is already on screen. A sort re-fetch that
 * fails should not blank out the reviews the reader is in the middle of.
 */

type ReviewsResponse = {
  reviews: Review[];
  total: number;
  recommended: number;
  enabled: boolean;
};

type Sort = "recent" | "helpful";

/**
 * Why the load failed, or `null` when it has not.
 *
 * ONE STATE, NOT TWO BOOLEANS. The two failures are mutually exclusive by
 * construction — a rejected fetch means no response to check, a non-ok response
 * means the network worked — and separate flags would let a stale `offline`
 * survive a later server error and stack two amber notices.
 *
 * `"error"` covers a non-ok response, which used to be `return`ed on silently:
 * `data` then stayed `null` for good and the card rendered its heading over
 * nothing, so a 500 looked exactly like a load that had not finished.
 */
type Failure = "offline" | "error";

export function GameReviews({ slug, title }: { slug: string; title: string }) {
  const [data, setData] = useState<ReviewsResponse | null>(null);
  const [sort, setSort] = useState<Sort>("recent");
  const [failure, setFailure] = useState<Failure | null>(null);

  const load = useCallback(
    async (nextSort: Sort) => {
      try {
        const res = await fetch(
          `/api/v1/games/${encodeURIComponent(slug)}/reviews?sort=${nextSort}`,
        );
        if (!res.ok) {
          setFailure("error");
          return;
        }
        setData((await res.json()) as ReviewsResponse);
        setFailure(null);
      } catch {
        setFailure("offline");
      }
    },
    [slug],
  );

  /**
   * Retry after a failure. Clearing `failure` first is what puts the skeleton
   * back while the second attempt is in flight (on a first load, where there is
   * no `data` to keep showing) — otherwise the notice would sit there looking
   * inert until the response landed.
   */
  const retry = useCallback(() => {
    setFailure(null);
    void load(sort);
  }, [load, sort]);

  useEffect(() => {
    // `load` only ever calls setState after `await fetch(...)`, so it cannot
    // cascade a render synchronously — but the rule traces the call statically
    // and cannot see that the awaits are in the way.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(sort);
  }, [load, sort]);

  const ratio =
    data && data.total > 0 ? Math.round((data.recommended / data.total) * 100) : null;

  return (
    <section className="mt-5 rounded-3xl bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-black tracking-tight text-zinc-900">Reviews</h2>
        {data && data.total > 0 && (
          <p className="text-[13px] font-bold text-muted">
            <span className="text-zinc-900">{summaryLabel(ratio)}</span> ·{" "}
            {data.total} review{data.total === 1 ? "" : "s"}
          </p>
        )}
      </div>

      {/* BOTH failures wear the notice this card already used for offline.
          A server error is not a different KIND of news to the reader — the
          reviews are not here and they did nothing wrong — so it gets the same
          amber block rather than a red one, which on a games page would read as
          "you broke something". Only the sentence and the retry differ. */}
      {failure && (
        <FailureNotice onRetry={retry}>
          {failure === "offline"
            ? "Reviews need a connection."
            : "Reviews couldn’t load just now."}
        </FailureNotice>
      )}

      {data && !data.enabled && !failure && (
        <p className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
          Reviews aren&rsquo;t switched on yet.
        </p>
      )}

      {data === null && failure === null && <ReviewsSkeleton />}

      {data?.enabled && (
        <>
          <ReviewComposer
            slug={slug}
            title={title}
            onPosted={() => {
              void load(sort);
            }}
          />

          {data.reviews.length > 1 && (
            <div className="mt-5 flex items-center gap-2 text-[13px] font-bold text-muted">
              <span>Sort by</span>
              <SortButton active={sort === "recent"} onClick={() => setSort("recent")}>
                Most recent
              </SortButton>
              <SortButton active={sort === "helpful"} onClick={() => setSort("helpful")}>
                Most helpful
              </SortButton>
            </div>
          )}

          {data.reviews.length === 0 ? (
            <p className="mt-5 text-[15px] font-semibold text-muted">
              No reviews yet — be the first.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {data.reviews.map((review) => (
                <ReviewRow
                  key={review.id}
                  review={review}
                  onChanged={() => {
                    void load(sort);
                  }}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Steam-style band label.
 *
 * Deliberately NOT rendered as stars or a numeric score, and deliberately not
 * emitted as `AggregateRating` in the page's JSON-LD: Google requires rating
 * markup to be genuinely user-generated AND visible, and synthesising one from a
 * handful of reviews is the pattern that earns a structured-data manual action —
 * which lands on the whole domain, not one URL.
 */
function summaryLabel(ratio: number | null): string {
  if (ratio === null) return "";
  if (ratio >= 90) return "Overwhelmingly positive";
  if (ratio >= 75) return "Mostly positive";
  if (ratio >= 50) return "Mixed";
  if (ratio >= 25) return "Mostly negative";
  return "Negative";
}

/**
 * The amber block for a load that did not produce reviews, with the retry the
 * card used to lack. Offered for the offline case too: "Reviews need a
 * connection" is precisely the message a reader acts on by reconnecting, and
 * without a button their only way to try again is to reload the page — which
 * offline is a far more expensive gamble than re-running one `/api/` call.
 */
function FailureNotice({
  onRetry,
  children,
}: {
  onRetry: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      role="status"
      className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900"
    >
      <p>{children}</p>
      <button
        type="button"
        onClick={onRetry}
        className="shrink-0 rounded-full border border-amber-300 bg-white px-3 py-1 text-[13px] font-extrabold text-amber-900 transition hover:bg-amber-100 focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-200"
      >
        Try again
      </button>
    </div>
  );
}

/**
 * The card's shape while the response is in flight.
 *
 * IT RESERVES HEIGHT, and that is the reason it exists rather than a spinner or
 * a `null`. This card is a fixed slot with "More like this" underneath it, so a
 * zero-height wait means the related-games rail sits directly under the heading
 * and then gets shoved down the moment the fetch lands — under the cursor of
 * anyone who started reading. That is a different situation from the store
 * page's other islands: `FriendsWhoPlay`, `ChallengedHere` and
 * `GameAchievements` render `null` until loaded because they may legitimately
 * never appear, and a placeholder for a section that turns out not to exist is
 * worse than the shift. Reviews always render.
 *
 * The three blocks stand in for the composer and the first two rows, which is
 * the common shape; nobody can know the real height before the response, so
 * this is an honest approximation rather than a promise. Bars are `aria-hidden`
 * with one `role="status"` line behind them — a screen reader wants "loading",
 * not three empty boxes.
 */
function ReviewsSkeleton() {
  return (
    <div className="mt-4">
      <p role="status" className="sr-only">
        Loading reviews…
      </p>
      <div aria-hidden className="animate-pulse">
        <div className="h-28 rounded-2xl bg-surface-2/60" />
        <div className="mt-4 space-y-3">
          <div className="h-24 rounded-2xl bg-surface-2/50" />
          <div className="h-24 rounded-2xl bg-surface-2/50" />
        </div>
      </div>
    </div>
  );
}

function SortButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-[13px] font-extrabold transition ${
        active ? "bg-brand-50 text-brand" : "text-zinc-700 hover:bg-surface-2"
      }`}
    >
      {children}
    </button>
  );
}
