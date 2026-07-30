/**
 * HallPass dashboard — register a NEW external (off-site) game.
 *
 * Admin-gated form that posts to `createExternalGameAction`. The action owns all
 * validation (slug derivation, URL check, collision checks) and, on failure,
 * redirects back here with the message in `?error`, which we surface as a banner.
 * The slug is derived from the title by the action, so there is no slug field.
 * Category autocompletes from the resolved catalogue via a `<datalist>`; tags use
 * the shared chip `TagEditor`. Leaving the cover URL blank triggers a best-effort
 * server-side screenshot (see the note below the field).
 */

import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/app/lib/auth";
import { resolveCategories, resolveTags } from "@/app/lib/games-store";
import { DashHeader } from "../../_ui/DashHeader";
import { Section } from "../../_ui/Section";
import { TagEditor } from "../../_ui/TagEditor";
import { createExternalGameAction } from "../actions";

export const metadata: Metadata = {
  title: "New external game",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<{ error?: string | string[] }>;

function asString(value: string | string[] | undefined): string | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] : value;
}

const inputClass =
  "mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/30";

export default async function NewExternalGamePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireRole("admin");
  const error = asString((await searchParams).error);

  // Both reads already fail soft to the static catalogue on a Neon outage.
  const [categories, tagList] = await Promise.all([
    resolveCategories(),
    resolveTags(),
  ]);
  const tagSuggestions = tagList.map((t) => t.tag);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <Link
        href="/dashboard/external-games"
        className="inline-block text-sm font-semibold text-brand hover:text-brand-600"
      >
        ← All external games
      </Link>

      <DashHeader
        title="New external game"
        subtitle="Register an off-site game by URL. It is embedded in an iframe and appears alongside native games."
      />

      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          {error}
        </div>
      )}

      <Section>
        <form action={createExternalGameAction} className="space-y-5">
          <label className="block text-sm font-semibold text-zinc-900">
            Title
            <input
              name="title"
              type="text"
              required
              placeholder="My Off-site Game"
              className={inputClass}
            />
            <span className="mt-1 block text-xs font-normal text-muted">
              The slug is derived from the title automatically.
            </span>
          </label>

          <label className="block text-sm font-semibold text-zinc-900">
            External URL
            <input
              name="externalUrl"
              type="url"
              required
              placeholder="https://…"
              className={inputClass}
            />
          </label>

          <label className="block text-sm font-semibold text-zinc-900">
            Tagline
            <input
              name="tagline"
              type="text"
              placeholder="A short one-liner"
              className={inputClass}
            />
          </label>

          <label className="block text-sm font-semibold text-zinc-900">
            Description
            <textarea
              name="description"
              rows={4}
              placeholder="What is this game?"
              className={inputClass}
            />
          </label>

          <label className="block text-sm font-semibold text-zinc-900 sm:max-w-xs">
            Category
            <input
              name="category"
              type="text"
              list="external-game-categories"
              placeholder="e.g. Arcade"
              className={inputClass}
            />
            <datalist id="external-game-categories">
              {categories.map((category) => (
                <option key={category} value={category} />
              ))}
            </datalist>
          </label>

          <div className="block text-sm font-semibold text-zinc-900">
            Tags
            <div className="mt-2">
              <TagEditor defaultTags={[]} suggestions={tagSuggestions} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            <label className="block text-sm font-semibold text-zinc-900">
              Accent color
              <input
                name="accent"
                type="color"
                defaultValue="#7c5cff"
                className="mt-2 h-10 w-full rounded-lg border border-border px-1 py-1 outline-none focus:ring-2 focus:ring-brand/30"
              />
            </label>

            <label className="block text-sm font-semibold text-zinc-900">
              Gradient from
              <input
                name="gradientFrom"
                type="color"
                defaultValue="#7c5cff"
                className="mt-2 h-10 w-full rounded-lg border border-border px-1 py-1 outline-none focus:ring-2 focus:ring-brand/30"
              />
            </label>

            <label className="block text-sm font-semibold text-zinc-900">
              Gradient to
              <input
                name="gradientTo"
                type="color"
                defaultValue="#00e5ff"
                className="mt-2 h-10 w-full rounded-lg border border-border px-1 py-1 outline-none focus:ring-2 focus:ring-brand/30"
              />
            </label>
          </div>

          <label className="block text-sm font-semibold text-zinc-900">
            Cover URL override
            <input
              name="coverUrl"
              type="url"
              placeholder="https://…"
              className={inputClass}
            />
            <span className="mt-1 block text-xs font-normal text-muted">
              Leave blank to auto-screenshot the site. The screenshot sends the
              URL to a third-party service (image.thum.io). A cover you supply
              here is downloaded and re-hosted on our storage, so devices load it
              from us rather than the original host. On any failure the game is
              still created with a gradient placeholder.
            </span>
          </label>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              className="rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white hover:bg-brand-600"
            >
              Add external game
            </button>
            <Link
              href="/dashboard/external-games"
              className="rounded-full border border-border bg-white px-5 py-2 text-sm font-bold text-zinc-700 hover:bg-surface-2"
            >
              Cancel
            </Link>
          </div>
        </form>
      </Section>
    </div>
  );
}
