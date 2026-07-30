/**
 * HallPass dashboard — player flair ("custom perks"), admin surface.
 *
 * Grant a short, custom title to a player by `@username`, and revoke ones already
 * granted. Structurally a sibling of the Users page: an invite-style form above a
 * table of existing grants, with results reported through the shared `?ok`/`?error`
 * banner. The one thing to notice is who each surface is ABOUT — Users manages
 * dashboard admins (keyed by email); this manages PLAYERS (addressed by the same
 * public `@username` everyone else uses), and never surfaces a player's id.
 *
 * `admin`, not `super_admin`: granting flair is routine catalogue-adjacent work
 * like editing a game or a board, not an authorization change. The nav link is
 * likewise in the base set.
 *
 * The store read is wrapped: `flair-store.ts` throws when `DATABASE_URL` is unset
 * (the Neon connection is lazy) and when `player_flair` has not been migrated yet,
 * so an unconfigured/mid-deploy database renders a friendly notice instead of a
 * 500 on an admin page.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/app/lib/auth";
import { FLAIR_TONES } from "@/app/lib/flair";
import { flair, type FlairGrant } from "@/app/lib/flair-store";
import { DashHeader } from "../_ui/DashHeader";
import { Section } from "../_ui/Section";
import { FlairPill } from "@/app/components/profile/FlairRow";
import { grantFlairAction, revokeFlairAction } from "./actions";

export const metadata: Metadata = {
  title: "Flair",
  description: "Grant custom flair to HALLPASS players.",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<{
  ok?: string | string[];
  error?: string | string[];
}>;

function asString(value: string | string[] | undefined): string | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] : value;
}

/** Locale-stable date for the "granted" column. */
function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

/** Sentence-case a tone id for the colour `<select>` ("gold" → "Gold"). */
function toneLabel(tone: string): string {
  return tone.charAt(0).toUpperCase() + tone.slice(1);
}

export default async function FlairPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireRole("admin");

  const params = await searchParams;
  const ok = asString(params.ok);
  const error = asString(params.error);

  let grants: FlairGrant[] | null = null;
  let dbError = false;
  try {
    grants = await flair.listRecentFlair();
  } catch {
    dbError = true;
  }

  return (
    <>
      <DashHeader
        title="Flair"
        subtitle="Grant a custom title to a player — it shows as a pill on their profile."
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

      <Section title="Grant flair" className="mb-8">
        <p className="mb-4 text-sm text-muted">
          Enter the player’s <span className="font-semibold">@username</span> and a
          short label. Granting the same label twice does nothing — one pill per
          label. Flair shows only on a profile a viewer is allowed to see in full.
        </p>
        <form action={grantFlairAction} className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-semibold text-foreground">
            Username
            <input
              name="username"
              type="text"
              required
              autoComplete="off"
              placeholder="cool_kid"
              className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/30"
            />
          </label>
          <label className="block text-sm font-semibold text-foreground">
            Label
            <input
              name="label"
              type="text"
              required
              maxLength={24}
              autoComplete="off"
              placeholder="Beta Tester"
              className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/30"
            />
          </label>
          <label className="block text-sm font-semibold text-foreground">
            Icon <span className="font-normal text-muted">(optional emoji)</span>
            <input
              name="icon"
              type="text"
              maxLength={8}
              autoComplete="off"
              placeholder="🧪"
              className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/30"
            />
          </label>
          <label className="block text-sm font-semibold text-foreground">
            Colour
            <select
              name="tone"
              defaultValue="brand"
              className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/30"
            >
              {FLAIR_TONES.map((tone) => (
                <option key={tone} value={tone}>
                  {toneLabel(tone)}
                </option>
              ))}
            </select>
          </label>
          <div className="sm:col-span-2">
            <button
              type="submit"
              className="rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white hover:bg-brand-600"
            >
              Grant flair
            </button>
          </div>
        </form>
      </Section>

      {dbError ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Database not configured, or flair has not been migrated yet. Set{" "}
          <code className="font-mono">DATABASE_URL</code> and run{" "}
          <code className="font-mono">npm run migrate</code>.
        </div>
      ) : grants && grants.length === 0 ? (
        <Section>
          <p className="text-sm font-semibold text-foreground">
            No flair granted yet.
          </p>
          <p className="mt-1 text-sm text-muted">
            Grant one above and it will appear here.
          </p>
        </Section>
      ) : (
        grants && (
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  <th className="px-4 py-3">Flair</th>
                  <th className="px-4 py-3">Player</th>
                  <th className="whitespace-nowrap px-4 py-3">Granted by</th>
                  <th className="px-4 py-3">Granted</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {grants.map((grant) => (
                  <tr
                    key={grant.id}
                    className="border-b border-border align-middle last:border-0 hover:bg-surface-2"
                  >
                    <td className="px-4 py-3">
                      <FlairPill flair={grant} />
                    </td>
                    <td className="px-4 py-3 font-medium text-foreground">
                      {grant.username ? (
                        <Link
                          href={`/u/${grant.username}`}
                          className="text-brand hover:text-brand-600"
                        >
                          {grant.displayName}
                        </Link>
                      ) : (
                        <span className="text-muted">{grant.displayName}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted">{grant.grantedBy}</td>
                    <td className="px-4 py-3 text-muted tabular-nums">
                      {formatDate(grant.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <form action={revokeFlairAction} className="flex justify-end">
                        <input type="hidden" name="id" value={grant.id} />
                        <button
                          type="submit"
                          className="rounded-full border border-red-200 bg-red-50 px-4 py-1.5 text-xs font-bold text-red-700 transition hover:bg-red-100"
                        >
                          Revoke
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </>
  );
}
