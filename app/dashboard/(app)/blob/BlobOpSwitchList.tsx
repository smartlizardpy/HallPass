"use client";

/**
 * The switch panel on `/dashboard/blob`, staged in the browser and saved once.
 *
 * WHAT THIS REPLACED. Every row used to be its own `<form>` with a Disable /
 * Enable button that submitted immediately. Turning off four features was four
 * writes, four redirects and four banners — on the screen somebody opens
 * precisely when things are already going wrong, and each round trip is a
 * chance to be interrupted holding a half-applied panel. Now a click only marks
 * the row; one Save writes every switch that moved in a single statement.
 *
 * WHY A CLIENT COMPONENT AT ALL. Only for the staging: the pending count, the
 * live "N will be off" summary, and Revert. Nothing about the decision moves to
 * the browser — `saveBlobOpsAction` re-reads the stored state, re-diffs it and
 * re-checks the role and the env lock, so what this component sends is a request,
 * never a verdict.
 *
 * IT STILL WORKS WITHOUT JAVASCRIPT. The checkboxes are plain checkboxes inside
 * a plain form posting to a server action, so an unhydrated page still toggles
 * and still saves; only the counters and Revert go quiet. That is why Save is
 * disabled by `hydrated && nothing changed` rather than by `nothing changed`
 * alone — the server renders it live, and only a browser that can actually track
 * the staged state is allowed to grey it out.
 *
 * ABSENT MEANS OFF. Unchecked checkboxes submit nothing, so a row that is off
 * sends no field at all; `switchesFromEnabledIds()` on the server closes over
 * the registry to turn that absence back into an explicit `false`. This is the
 * reason there is no hidden input paired with each box.
 */

import { useMemo, useState, useSyncExternalStore } from "react";
import type { AdvancedBlobOp, BlobOpId } from "@/app/lib/blob-ops";
import { saveBlobOpsAction } from "./actions";

/** Nothing to subscribe to; hoisted so the store identity is stable per render. */
const NEVER_CHANGES = () => () => {};

/** The Vercel primitive a feature spends, as a small monospace chip. */
function OpChip({ operation }: { operation: string }) {
  return (
    <span className="inline-block rounded-full bg-surface-2 px-2 py-0.5 font-mono text-xs font-bold text-muted">
      {operation}()
    </span>
  );
}

export function BlobOpSwitchList({
  ops,
  saved,
  locked,
}: {
  /** The registry, passed down so the server stays the single source of order. */
  ops: readonly AdvancedBlobOp[];
  /** What is actually stored right now — the baseline every count is against. */
  saved: Record<BlobOpId, boolean>;
  /** `BLOB_READ_ONLY` holds every switch shut; nothing here may move. */
  locked: boolean;
}) {
  const [staged, setStaged] = useState(saved);

  // Save starts enabled and is only allowed to grey itself out once a browser is
  // running to keep `staged` honest — see the no-JS note in the docblock.
  // `useSyncExternalStore` is how you ask "am I hydrated" without a setState in
  // an effect: the server snapshot is `false`, the client snapshot is `true`.
  const hydrated = useSyncExternalStore(
    NEVER_CHANGES,
    () => true,
    () => false,
  );

  // When a save lands the page re-renders with the new stored state, and the
  // staged panel has become the baseline — adopt it, or every just-saved row
  // stays marked "unsaved" until a reload.
  //
  // Keyed on the VALUES, not on the `saved` object's identity, and adjusted
  // during render rather than in an effect (the pattern React documents for
  // exactly this). Identity is new on every RSC re-render, so an effect keyed on
  // it would throw away staged edits whenever the page re-rendered for an
  // unrelated reason — including after a save that FAILED and changed nothing.
  const savedKey = ops.map((op) => (saved[op.id] ? "1" : "0")).join("");
  const [baseline, setBaseline] = useState(savedKey);
  if (baseline !== savedKey) {
    setBaseline(savedKey);
    setStaged(saved);
  }

  const { dirty, offCount } = useMemo(
    () => ({
      dirty: ops.filter((op) => staged[op.id] !== saved[op.id]),
      offCount: ops.filter((op) => !staged[op.id]).length,
    }),
    [ops, staged, saved],
  );

  const stagedAllOff = offCount === ops.length;

  return (
    <form action={saveBlobOpsAction}>
      <section className="mb-8 rounded-xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-black tracking-tight">
              {stagedAllOff
                ? "Everything is switched off"
                : offCount === 0
                  ? "Everything is switched on"
                  : `${offCount} of ${ops.length} switched off`}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {locked
                ? "Forced by BLOB_READ_ONLY, not by these switches — no database needed, and nothing here can override it."
                : dirty.length > 0
                  ? "Counting what you have staged below, not what is saved. Save to apply it."
                  : stagedAllOff
                    ? "Nothing in the app will spend an advanced operation. Publishing, media, beta evidence and the reindex sweep are all refusing."
                    : "Flip whatever you need below and save once — every change goes in a single write."}
            </p>
          </div>
          {/*
            The panic button, and the reason it is a submit inside THIS form
            rather than a form of its own: it has to keep costing one click on
            the day the allowance reads 100%. `all` wins over the checkboxes
            server-side, so it applies regardless of what is staged.
          */}
          <button
            type="submit"
            name="all"
            value={stagedAllOff ? "1" : "0"}
            disabled={locked}
            className={
              stagedAllOff
                ? "shrink-0 rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
                : "shrink-0 rounded-full bg-red-600 px-5 py-2 text-sm font-extrabold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            }
          >
            {stagedAllOff ? "Enable everything" : "Disable everything"}
          </button>
        </div>
      </section>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <ul>
          {ops.map((op) => {
            const on = staged[op.id];
            const changed = on !== saved[op.id];
            return (
              <li
                key={op.id}
                className={
                  changed
                    ? "border-b border-border bg-brand-50/40 last:border-0"
                    : "border-b border-border last:border-0"
                }
              >
                {/*
                  The whole row is the label, so the hit target is the row and
                  not a 16px box — this panel is used in a hurry.
                */}
                <label className="flex cursor-pointer flex-wrap items-start justify-between gap-4 p-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-bold text-foreground">
                        {op.label}
                      </h3>
                      <OpChip operation={op.operation} />
                      {!on && (
                        <span className="inline-block rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-800">
                          off
                        </span>
                      )}
                      {changed && (
                        <span className="inline-block rounded-full bg-brand-50 px-2 py-0.5 text-xs font-bold text-brand">
                          unsaved
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-muted">{op.effect}</p>
                    <p className="mt-1 text-xs text-muted">{op.cost}</p>
                  </div>
                  <input
                    type="checkbox"
                    name="on"
                    value={op.id}
                    checked={on}
                    disabled={locked}
                    onChange={(e) =>
                      setStaged((prev) => ({ ...prev, [op.id]: e.target.checked }))
                    }
                    aria-label={`${op.label} enabled`}
                    className="mt-0.5 h-5 w-5 shrink-0 rounded border-border text-brand focus:ring-2 focus:ring-brand/30 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </label>
              </li>
            );
          })}
        </ul>

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border bg-surface-2 p-5">
          <p className="text-sm text-muted" aria-live="polite">
            {locked
              ? "Locked by the environment — these switches cannot be changed from here."
              : dirty.length === 0
                ? "No unsaved changes."
                : `${dirty.length} unsaved change${dirty.length === 1 ? "" : "s"}: ${dirty
                    .map((op) => op.label)
                    .join(", ")}.`}
          </p>
          <div className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setStaged(saved)}
              disabled={locked || dirty.length === 0}
              className="rounded-full border border-border bg-white px-4 py-2 text-sm font-bold text-zinc-700 hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Revert
            </button>
            <button
              type="submit"
              disabled={locked || (hydrated && dirty.length === 0)}
              className="rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Save changes
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
