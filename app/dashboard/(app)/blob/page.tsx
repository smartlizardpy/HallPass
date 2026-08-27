/**
 * HallPass dashboard — blob operations control (super-admin only).
 *
 * THE SCREEN THIS SITE NEEDED THE MONTH IT RAN OUT. Vercel meters Blob usage in
 * two classes: SIMPLE operations (`head`, `del` — 10,000/month on Hobby) and
 * ADVANCED ones (`put`, `copy`, `list` — only 2,000). When the advanced
 * allowance is spent, every one of them starts failing, which means no game can
 * be published, no screenshot accepted and no cover cached until the month
 * rolls over — and the only way to see it coming was Vercel's own usage page.
 *
 * This page answers the three questions an operator has in that moment:
 *
 *   1. WHAT IS STILL SPENDING? The table lists every feature that costs an
 *      advanced operation, what it does, and how its spend scales — one per
 *      file, one per image, one per sweep. It is rendered straight from
 *      `ADVANCED_BLOB_OPS`, so a feature that is not in the registry is not on
 *      this page and cannot be turned off; that is the reason the registry's
 *      docblock says adding one is part of adding the feature.
 *
 *   2. HOW DO I STOP IT, NOW, WITHOUT A DEPLOY? Each row toggles, and one
 *      button turns everything off (or back on) in a single write.
 *
 *   3. IS THE MIRROR STILL RIGHT? The index card shows how many blobs Neon
 *      thinks exist and offers the one deliberate `list()` sweep that rebuilds
 *      it from the store. That is the recovery path for anything written
 *      out-of-band, and the count is the cheapest sanity check available: a
 *      corpus of forty games showing zero indexed blobs means migration 026 was
 *      applied and never backfilled.
 *
 * WHAT IS DELIBERATELY NOT HERE. The recurring cost is gone rather than
 * switchable: serving a game, polling for a version, and rendering the
 * dashboard all read Neon now, so no amount of traffic spends an operation and
 * there is nothing to ration. The "Where the cost went" panel says so on the
 * page, because an operator looking at this list should not be left wondering
 * whether playing a game is billed.
 *
 * `requireRole("super_admin")` fails closed (a plain admin is redirected to
 * `/dashboard`) and the shell hides the nav link for everyone else, so the guard
 * is defence in depth rather than the only gate.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/app/lib/auth";
import { ADVANCED_BLOB_OPS, readBlobOpSwitches } from "@/app/lib/blob-ops";
import { readGameBlobIndex } from "@/app/lib/game-blob-index";
import { DashHeader } from "../_ui/DashHeader";
import {
  reindexBlobsAction,
  setAllBlobOpsAction,
  toggleBlobOpAction,
} from "./actions";

export const metadata: Metadata = {
  title: "Blob ops",
  description:
    "Switch off the HALLPASS features that spend advanced Vercel Blob operations.",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<{ ok?: string | string[]; error?: string | string[] }>;

/** Collapse a possibly-repeated querystring value to a single string. */
function asString(value: string | string[] | undefined): string | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] : value;
}

/** The Vercel primitive a feature spends, as a small monospace chip. */
function OpChip({ operation }: { operation: string }) {
  return (
    <span className="inline-block rounded-full bg-surface-2 px-2 py-0.5 font-mono text-xs font-bold text-muted">
      {operation}()
    </span>
  );
}

export default async function BlobOpsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireRole("super_admin");

  const params = await searchParams;
  const ok = asString(params.ok);
  const error = asString(params.error);

  // Both fail soft — the switches to all-enabled (see `blob-ops.ts` for why
  // that direction), the index to an empty array — so this page renders during
  // a Neon outage rather than 500ing on the one screen somebody opens when
  // things are already going wrong. An operator reading "ON" during an outage is
  // reading the truth: nothing is gating those actions right now either.
  const [switches, indexed] = await Promise.all([
    readBlobOpSwitches(),
    readGameBlobIndex(),
  ]);
  const offCount = ADVANCED_BLOB_OPS.filter((op) => !switches[op.id]).length;
  const allOff = offCount === ADVANCED_BLOB_OPS.length;

  const indexedSlugs = new Set(indexed.map((row) => row.slug));
  const newestIndexed = indexed.reduce(
    (newest, row) => Math.max(newest, row.uploadedAt),
    0,
  );

  return (
    <>
      <DashHeader
        title="Blob ops"
        subtitle="Everything that still spends an advanced Vercel Blob operation, and the switch for each."
        action={
          <Link
            href="/dashboard"
            className="text-sm font-semibold text-brand hover:text-brand-600"
          >
            ← Back to overview
          </Link>
        }
      />

      {ok && (
        <div className="mb-6 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {ok}
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          {error}
        </div>
      )}

      <section className="mb-8 rounded-xl border border-border bg-surface p-5">
        <h2 className="text-lg font-black tracking-tight">
          Where the cost went
        </h2>
        <div className="mt-2 space-y-3 text-sm text-muted">
          <p>
            Vercel bills{" "}
            <code className="font-mono text-foreground">put</code>,{" "}
            <code className="font-mono text-foreground">copy</code> and{" "}
            <code className="font-mono text-foreground">list</code> as{" "}
            <strong className="text-foreground">advanced operations</strong> —
            2,000 a month on Hobby, a twentieth of the{" "}
            <code className="font-mono text-foreground">head</code>/
            <code className="font-mono text-foreground">del</code> budget. When
            they run out, <code className="font-mono text-foreground">put</code>{" "}
            fails too, so nobody can publish anything until the month rolls over.
          </p>
          <p>
            <strong className="text-foreground">
              Playing games costs nothing.
            </strong>{" "}
            Serving a game, polling for a version and rendering this dashboard
            all read the{" "}
            <code className="font-mono text-foreground">game_blobs</code> table
            in Neon instead of asking the blob store — the{" "}
            <code className="font-mono text-foreground">list()</code> that used
            to do that was 98% of everything we spent. No amount of traffic
            spends an operation now.
          </p>
          <p>
            What is left is one write per file a person deliberately publishes.
            The switches below are for the month that is not affordable either.
          </p>
        </div>
      </section>

      <section className="mb-8 rounded-xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-black tracking-tight">
              {allOff
                ? "Everything is switched off"
                : offCount === 0
                  ? "Everything is switched on"
                  : `${offCount} of ${ADVANCED_BLOB_OPS.length} switched off`}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {allOff
                ? "Nothing in the app will spend an advanced operation. Publishing, media, beta evidence and the reindex sweep are all refusing."
                : "Turn everything off in one write when the allowance is spent, and back on when it resets."}
            </p>
          </div>
          <form action={setAllBlobOpsAction} className="shrink-0">
            <input type="hidden" name="enabled" value={allOff ? "1" : "0"} />
            <button
              type="submit"
              className={
                allOff
                  ? "rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white hover:bg-brand-600"
                  : "rounded-full bg-red-600 px-5 py-2 text-sm font-extrabold text-white hover:bg-red-700"
              }
            >
              {allOff ? "Enable everything" : "Disable everything"}
            </button>
          </form>
        </div>
      </section>

      <section className="mb-8 rounded-xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-black tracking-tight">Blob index</h2>
            <p className="mt-1 text-sm text-muted">
              What Neon believes is published under{" "}
              <code className="font-mono text-foreground">games/</code>. Rebuild
              it after publishing from a script, editing a blob in the Vercel
              dashboard, or applying migration 026 for the first time — an
              unindexed blob is not broken, it just serves the copy baked into
              the last deploy.
            </p>
            <p className="mt-3 text-sm tabular-nums text-foreground">
              <strong>{indexed.length}</strong> blob
              {indexed.length === 1 ? "" : "s"} across{" "}
              <strong>{indexedSlugs.size}</strong> game
              {indexedSlugs.size === 1 ? "" : "s"}
              {newestIndexed > 0 && (
                <span className="text-muted">
                  {" "}
                  · newest{" "}
                  {new Intl.DateTimeFormat("en-US", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  }).format(new Date(newestIndexed))}
                </span>
              )}
            </p>
          </div>
          <form action={reindexBlobsAction} className="shrink-0">
            <button
              type="submit"
              disabled={!switches.blob_reindex}
              className="rounded-full border border-border bg-white px-5 py-2 text-sm font-bold text-zinc-700 hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Rebuild index
            </button>
          </form>
        </div>
      </section>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <ul>
          {ADVANCED_BLOB_OPS.map((op) => {
            const enabled = switches[op.id];
            return (
              <li
                key={op.id}
                className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-5 last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-bold text-foreground">
                      {op.label}
                    </h3>
                    <OpChip operation={op.operation} />
                    {!enabled && (
                      <span className="inline-block rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-800">
                        off
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-muted">{op.effect}</p>
                  <p className="mt-1 text-xs text-muted">{op.cost}</p>
                </div>
                <form action={toggleBlobOpAction} className="shrink-0">
                  <input type="hidden" name="id" value={op.id} />
                  <input
                    type="hidden"
                    name="enabled"
                    value={enabled ? "1" : "0"}
                  />
                  <button
                    type="submit"
                    aria-label={`${enabled ? "Disable" : "Enable"} ${op.label}`}
                    className={
                      enabled
                        ? "rounded-full border border-border bg-white px-4 py-1.5 text-sm font-bold text-zinc-700 hover:bg-surface-2"
                        : "rounded-full bg-brand px-4 py-1.5 text-sm font-extrabold text-white hover:bg-brand-600"
                    }
                  >
                    {enabled ? "Disable" : "Enable"}
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
