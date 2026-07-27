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
 */

type ReviewsResponse = {
  reviews: Review[];
  total: number;
  recommended: number;
  enabled: boolean;
};

type Sort = "recent" | "helpful";

export function GameReviews({ slug, title }: { slug: string; title: string }) {
  const [data, setData] = useState<ReviewsResponse | null>(null);
  const [sort, setSort] = useState<Sort>("recent");
  const [offline, setOffline] = useState(false);

  const load = useCallback(
    async (nextSort: Sort) => {
      try {
        const res = await fetch(
          `/api/v1/games/${encodeURIComponent(slug)}/reviews?sort=${nextSort}`,
        );
        if (!res.ok) return;
        setData((await res.json()) as ReviewsResponse);
        setOffline(false);
      } catch {
        setOffline(true);
      }
    },
    [slug],
  );

  useEffect(() => {
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

      {offline && (
        <p className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
          Reviews need a connection.
        </p>
      )}

      {data && !data.enabled && !offline && (
        <p className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
          Reviews aren&rsquo;t switched on yet.
        </p>
      )}

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
