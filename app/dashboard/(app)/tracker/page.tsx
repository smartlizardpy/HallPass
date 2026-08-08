/**
 * HallPass dashboard — the project tracker board.
 *
 * The screen that answers "what is being built right now". Admins paste a brief
 * in, tag it, and read the status back; six lanes, ordered so that the reading
 * runs left to right from "not looked at yet" to "done".
 *
 * DYNAMIC BY DESIGN. This page is inside the `(app)` group, whose layout calls
 * `auth()`, so it is non-prerenderable — which is correct HERE and would be a
 * bug on `/` or `/game/[slug]`, where going dynamic silently drops the route
 * from `public/sw-manifest.js` and breaks offline play. The service worker never
 * intercepts `/dashboard` at all, so nothing on this page can reach the arcade's
 * offline behaviour.
 *
 * THE TAG FILTER IS APPLIED IN JS, NOT SQL, and that is a deliberate call
 * documented at length in `tracker/store.ts`: the `neon()` tagged template does
 * not reliably splice fragments, so a dynamic `WHERE` would mean a
 * combinatorial set of hand-written query templates. At this table's realistic
 * size — tens to low hundreds of rows — reading the board once and filtering
 * here is one round trip and no spliced SQL.
 *
 * FAILURE MODES STAY DISTINCT, following `boards/[id]/page.tsx` and the
 * moderation screen. A database with no migration 021 renders a "run the
 * migration" notice rather than a convincingly empty board — the reads in
 * `tracker/index.ts` degrade to `[]`, and an empty board and an absent table are
 * indistinguishable from a return value alone, which is why `isTrackerReady()`
 * is a separate probe. Any OTHER error is rethrown: a real Neon outage must not
 * be disguised as "nobody has pasted anything in yet".
 */

import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/app/lib/auth";
import { getBoard, getTags, isTrackerReady } from "@/app/lib/tracker";
import { TRACKER_STATUSES } from "@/app/lib/tracker/config";
import { Section } from "../_ui/Section";
import { ItemCard } from "./_ui/ItemCard";
import { Lane } from "./_ui/Lane";
import { PRIMARY_BUTTON, ResultBanner, TagChip } from "./_ui/Chips";

export const metadata: Metadata = {
  title: "Tracker",
  robots: { index: false, follow: false },
};

export default async function TrackerBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ tag?: string; ok?: string; error?: string }>;
}) {
  await requireRole("admin");
  const { tag, ok, error } = await searchParams;

  const ready = await isTrackerReady();
  if (!ready) {
    return (
      <div className="flex flex-col gap-4">
        <Header />
        <Section title="Tracker unavailable">
          <p className="text-sm text-muted">
            The tracker tables are not in this database yet. Apply migration{" "}
            <code className="rounded bg-surface-2 px-1">021_tracker.sql</code>:
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-surface-2 p-3 text-xs">
            npm run migrate -- --status{"\n"}npm run migrate
          </pre>
          <p className="mt-3 text-xs text-muted">
            We use Neon branching, so it must be applied to every branch the app
            runs against. The runner prints the target host — check it matches.
          </p>
        </Section>
      </div>
    );
  }

  const [cards, tags] = await Promise.all([getBoard(), getTags()]);
  const visible = tag ? cards.filter((card) => card.tags.includes(tag)) : cards;

  return (
    <div className="flex flex-col gap-4">
      <Header />
      <ResultBanner ok={ok} error={error} />

      {tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wide text-muted">
            Tags
          </span>
          {tags.map((t) => (
            <TagChip
              key={t}
              tag={t}
              href={
                t === tag
                  ? "/dashboard/tracker"
                  : `/dashboard/tracker?tag=${encodeURIComponent(t)}`
              }
            />
          ))}
          {tag && (
            <Link
              href="/dashboard/tracker"
              className="text-xs font-bold text-brand hover:underline"
            >
              Clear filter
            </Link>
          )}
        </div>
      )}

      {cards.length === 0 ? (
        <Section title="Nothing tracked yet">
          <p className="text-sm text-muted">
            Paste in what you want built and it will show up here.{" "}
            <Link
              href="/dashboard/tracker/new"
              className="font-bold text-brand hover:underline"
            >
              Add the first item
            </Link>
            .
          </p>
        </Section>
      ) : (
        // Horizontally scrolling columns on desktop, a vertical stack on a
        // phone. `overflow-x-auto` sits here rather than on the page so the
        // dashboard shell never scrolls sideways as a whole.
        <div className="flex flex-col gap-3 md:flex-row md:overflow-x-auto md:pb-2">
          {TRACKER_STATUSES.map((status) => {
            const inLane = visible.filter((card) => card.status === status);
            return (
              <Lane key={status} status={status} count={inLane.length}>
                {inLane.map((card) => (
                  <ItemCard key={card.id} card={card} />
                ))}
              </Lane>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Header() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-lg font-bold text-foreground">Tracker</h1>
        <p className="text-sm text-muted">
          What we want built, and what is being built right now.
        </p>
      </div>
      <Link href="/dashboard/tracker/new" className={PRIMARY_BUTTON}>
        Add item
      </Link>
    </div>
  );
}
