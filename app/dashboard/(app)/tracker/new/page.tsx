/**
 * HallPass dashboard — paste a new tracker item in.
 *
 * A DEDICATED PAGE rather than an inline one-line composer on the board, and
 * that is the whole point of this surface. The input here is a PASTE, not a
 * capture: somebody drops in a spec, a chat log, or a list of bullet points, and
 * that needs a full-width textarea with room to see what was pasted — not a
 * single-line field fighting six board columns for space.
 *
 * The title is the only required field. The brief and the tags are optional
 * because a half-formed thought at the moment somebody has it is worth more than
 * a well-formed one they did not bother to write down; `createItemAction` lands
 * it in `new`, which is exactly the lane for "pasted in, not looked at yet".
 *
 * A plain `<form action={serverAction}>` with no client component anywhere: no
 * JavaScript is required to file an item, and the action re-checks
 * authorization itself rather than trusting that this page is gated (the
 * Next.js forms guide is explicit that a Server Action is its own entry point).
 */

import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/app/lib/auth";
import {
  BRIEF_MAX,
  MAX_TAGS_PER_ITEM,
  TITLE_MAX,
} from "@/app/lib/tracker/config";
import { Section } from "../../_ui/Section";
import { createItemAction } from "../actions";
import { PRIMARY_BUTTON, ResultBanner } from "../_ui/Chips";

export const metadata: Metadata = {
  title: "Add tracker item",
  robots: { index: false, follow: false },
};

export default async function NewTrackerItemPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requireRole("admin");
  const { ok, error } = await searchParams;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-bold text-foreground">Add an item</h1>
        <p className="text-sm text-muted">
          Paste in what you want built. Only the title is required.
        </p>
      </div>

      <ResultBanner ok={ok} error={error} />

      <Section>
        <form action={createItemAction} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-bold text-foreground">Title</span>
            <input
              name="title"
              required
              maxLength={TITLE_MAX}
              autoFocus
              placeholder="Dark mode for the arcade"
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-bold text-foreground">Details</span>
            <span className="text-xs text-muted">
              Anything useful — what it should do, why, links, a pasted
              conversation.
            </span>
            {/* Tall by default: this field exists to be pasted into, and a
                three-row box signals "write one sentence". */}
            <textarea
              name="brief"
              rows={14}
              maxLength={BRIEF_MAX}
              className="rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm text-foreground"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-bold text-foreground">Tags</span>
            <span className="text-xs text-muted">
              Comma separated, up to {MAX_TAGS_PER_ITEM}. Spaces become hyphens,
              so “needs art, mobile” is two tags.
            </span>
            <input
              name="tags"
              placeholder="pwa, mobile, needs-art"
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
            />
          </label>

          <div className="flex items-center gap-3">
            <button type="submit" className={PRIMARY_BUTTON}>
              Add to tracker
            </button>
            <Link
              href="/dashboard/tracker"
              className="text-sm font-bold text-muted hover:text-foreground"
            >
              Cancel
            </Link>
          </div>
        </form>
      </Section>
    </div>
  );
}
