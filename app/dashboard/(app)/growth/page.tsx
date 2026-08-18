/**
 * `/dashboard/growth` — the marketing surface.
 *
 * Four panels and a link builder, answering the question nothing in this repo
 * could answer before: where do our players come from, do they come back, does
 * anybody share us, and which of our own pages are too thin to compete. See
 * `marketing-design.md` for the argument.
 *
 * WHY IT LIVES HERE RATHER THAN IN POSTHOG. Nobody on this project opens the
 * PostHog UI, and half of what is on this page is not in PostHog at all — the
 * share loop is rows in our own database and content health is the catalogue.
 * A dashboard that requires visiting a second dashboard is not a tool.
 *
 * TWO NUMBERS ARE DELIBERATELY NOT HERE. There is no "users" count anywhere,
 * because a class shares a trolley of Chromebooks and `distinct_id` is a browser
 * profile — every count on this page is named for DEVICES and that is a
 * correctness rule, not a wording preference. And sign-ups are not the headline:
 * Google Workspace for Education blocks under-18 accounts from unapproved
 * third-party apps, so a funnel aiming at accounts would read as broken forever
 * through no fault of the funnel. Returning devices is the north star instead.
 *
 * Inherits the admin gate, the `noindex` and the service worker's
 * never-intercept prefix by living under `/dashboard`, and re-checks
 * `requireRole("admin")` in its own body for the same reason the overview does:
 * a layout and a page render concurrently, so the layout's gate is not a
 * guarantee that this body did not fetch.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/app/lib/auth";
import { categoryPath } from "@/app/lib/categories";
import { resolveCategories, resolveGames, resolveTags } from "@/app/lib/games-store";
import { getAllGameMedia, mediaPublicPath } from "@/app/lib/game-media";
import { getAcquisition } from "@/app/lib/growth/acquisition";
import { getContentHealth } from "@/app/lib/growth/content-health";
import { getShareLoop } from "@/app/lib/growth/share-loop";
import { ACQUISITION_WINDOW_DAYS } from "@/app/lib/growth/config";
import { landingTags, tagPath } from "@/app/lib/tags";
import { WHATS_NEW_PATH } from "@/app/lib/whats-new";
import { DashHeader } from "../_ui/DashHeader";
import { Section } from "../_ui/Section";
import { Bars, type Bar } from "./_ui/Bars";
import { LinkBuilder, type Destination } from "./_ui/LinkBuilder";

export const metadata: Metadata = {
  title: "Growth",
  description: "Where HALLPASS players come from, and whether they come back.",
  robots: { index: false, follow: false },
};

const nf = new Intl.NumberFormat("en-US");
const fmt = (n: number) => nf.format(n);

export default async function GrowthPage() {
  await requireRole("admin");

  const [acquisition, shareLoop, health, games, categories, tags, media] =
    await Promise.all([
      getAcquisition(),
      getShareLoop(),
      getContentHealth(),
      resolveGames(),
      resolveCategories(),
      resolveTags(),
      getAllGameMedia(),
    ]);

  const titleBySlug = new Map(games.map((g) => [g.slug, g.title]));

  /**
   * Destinations for the builder, each carrying the social image it actually
   * resolves.
   *
   * A game's card falls back to its cover when it has no screenshot — that is
   * what `generateMetadata` does — so a game always previews as something.
   * EVERYTHING ELSE HERE USED TO PREVIEW AS NOTHING, and the builder said so in
   * amber: the home grid and the category pages had no `opengraph-image`, so the
   * links this page exists to mint arrived in chats as bare grey rectangles.
   * They now generate one, and so do tag pages and `/new`, so each points at its
   * own generated card — the same URL a crawler will fetch, not a stand-in.
   */
  const destinations: Destination[] = [
    { path: "/", label: "Home — the arcade", group: "Site", socialImage: "/opengraph-image" },
    {
      path: WHATS_NEW_PATH,
      label: "What's New — the drops page",
      group: "Site",
      socialImage: `${WHATS_NEW_PATH}/opengraph-image`,
    },
    ...categories.map((c) => ({
      path: categoryPath(c),
      label: `${c} games`,
      group: "Categories",
      socialImage: `${categoryPath(c)}/opengraph-image`,
    })),
    // Only the tags that HAVE a page. `landingTags` applies the same floor the
    // route resolves against, so the builder cannot mint a link to a 404.
    ...landingTags(tags).map(({ tag }) => ({
      path: tagPath(tag),
      label: `${tag} games`,
      group: "Tags",
      socialImage: `${tagPath(tag)}/opengraph-image`,
    })),
    ...games.map((g) => {
      const shot = media.get(g.slug)?.[0];
      return {
        path: `/game/${g.slug}`,
        label: g.title,
        group: "Games",
        socialImage: shot
          ? mediaPublicPath(shot)
          : (g.coverUrl ?? `/games/${g.slug}/cover.png`),
      };
    }),
  ];

  const channelBars: Bar[] = acquisition.channels.map((c) => ({
    key: c.bucket ?? "untagged",
    label: c.label,
    value: c.devices,
    subdued: c.bucket === null || c.bucket === "unknown",
  }));

  const entryBars: Bar[] = acquisition.entryPages.map((p) => ({
    key: p.path,
    label: p.path,
    value: p.devices,
  }));

  const referrerBars: Bar[] = acquisition.referrers.map((r) => ({
    key: r.domain,
    label: r.domain,
    value: r.devices,
  }));

  const shareBars: Bar[] = shareLoop.topGames.map((g) => ({
    key: g.slug,
    label: titleBySlug.get(g.slug) ?? g.slug,
    value: g.links,
    note: `· ${fmt(g.claims)} taken up`,
  }));

  return (
    <>
      <DashHeader
        title="Growth"
        subtitle={`Acquisition, sharing and content health · last ${ACQUISITION_WINDOW_DAYS} days`}
        action={
          <Link href="/dashboard" className="text-sm font-semibold text-brand hover:text-brand-600">
            ← Overview
          </Link>
        }
      />

      {!acquisition.configured && (
        <Notice tone="amber">
          <strong>Analytics panels cannot read.</strong> Set{" "}
          <code className="font-mono">POSTHOG_PERSONAL_API_KEY</code> and{" "}
          <code className="font-mono">POSTHOG_PROJECT_ID</code>. The share-loop and
          content panels below read our own database and are unaffected.
        </Notice>
      )}
      {acquisition.configured && !acquisition.reporting && (
        <Notice tone="rose">
          <strong>No recent events.</strong>{" "}
          {acquisition.lastEventAt
            ? `The newest event PostHog holds is from ${new Date(
                acquisition.lastEventAt,
              ).toLocaleString()}.`
            : "PostHog holds no events at all."}{" "}
          A missing build-time token, a school content filter or an ad blocker all
          look exactly like having no visitors — treat the numbers below as
          unreliable until this clears.
        </Notice>
      )}

      {/* ── Panel 2: acquisition ─────────────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Devices"
          value={fmt(acquisition.devices)}
          hint="Browser profiles, not people — school devices are shared."
        />
        <StatCard
          label="First-time devices"
          value={fmt(acquisition.firstTimeDevices)}
          hint="Played here for the very first time."
        />
        <StatCard
          label="Returning devices"
          value={fmt(acquisition.returningDevices)}
          hint="The north-star metric."
        />
        <StatCard
          label="Return rate"
          value={
            acquisition.firstTimeDevices + acquisition.returningDevices > 0
              ? `${Math.round(
                  (acquisition.returningDevices /
                    (acquisition.firstTimeDevices + acquisition.returningDevices)) *
                    100,
                )}%`
              : "—"
          }
          hint="Of devices that played, the share that had played before."
        />
      </section>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Section
          title="First-touch channel"
          subtitle="devices"
          className="lg:col-span-1"
        >
          <Bars
            rows={channelBars}
            empty="No channel data yet. Tag a link below and share it."
          />
          <p className="mt-4 text-xs text-muted">
            <strong>Untagged</strong> is the normal case — organic search and
            direct. <strong>Unknown ref</strong> means a link is out there
            carrying a label we do not publish, usually a typo.
          </p>
        </Section>

        <Section title="Entry pages" subtitle="where sessions start">
          <Bars rows={entryBars} />
        </Section>

        <Section title="Referrers" subtitle="excluding our own pages">
          <Bars rows={referrerBars} empty="No external referrers recorded." />
        </Section>
      </div>

      {/* ── Panel 3: the share loop ──────────────────────────────────────── */}
      <Section
        title="Share loop"
        subtitle="from our database — exact"
        className="mt-6"
      >
        {!shareLoop.available ? (
          <div className="py-8 text-center text-sm text-muted">
            Challenge-link data is unavailable — the challenges migrations
            (<code className="font-mono">022</code>,{" "}
            <code className="font-mono">025</code>) may not be applied to this
            database.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
              <MiniStat label="Links shared" value={fmt(shareLoop.links)} />
              <MiniStat label="Sharers" value={fmt(shareLoop.sharers)} />
              <MiniStat label="Opens" value={fmt(shareLoop.opens)} />
              <MiniStat label="Taken up" value={fmt(shareLoop.claims)} />
              <MiniStat
                label="Claims / link"
                value={
                  shareLoop.claimsPerLink === null
                    ? "—"
                    : shareLoop.claimsPerLink.toFixed(2)
                }
              />
            </div>

            {shareBars.length > 0 && (
              <div className="mt-6">
                <div className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">
                  Most-shared games
                </div>
                <Bars rows={shareBars} />
              </div>
            )}

            <p className="mt-4 text-xs text-muted">
              These come from challenge-link rows, so nothing can block or sample
              them — when this panel and the analytics panels disagree, this one
              is right. <strong>Opens</strong> counts presses of &ldquo;Beat
              it&rdquo;, not page views. <strong>Claims / link</strong> is not a
              viral coefficient: it counts people who played, not people who went
              on to share a link of their own.
              {shareLoop.revoked > 0 && ` ${fmt(shareLoop.revoked)} link(s) revoked.`}
            </p>
          </>
        )}
      </Section>

      {/* ── Panel 4: content health ──────────────────────────────────────── */}
      <Section
        title="Content health"
        subtitle={`${health.healthy} of ${health.total} games complete`}
        className="mt-6"
      >
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-1">
            <Bars
              rows={health.summary.map((s) => ({
                key: s.issue.id,
                label: s.issue.label,
                value: s.count,
                subdued: s.issue.severity === "low",
              }))}
              empty="Every game page is complete."
            />
            {!health.reviewsAvailable && (
              <p className="mt-4 text-xs text-muted">
                Review counts could not be read, so that check is suppressed
                rather than reported as every game having none.
              </p>
            )}
          </div>

          <div className="lg:col-span-2">
            <div className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">
              Thinnest pages first
            </div>
            <ul className="divide-y divide-border">
              {health.games
                .filter((g) => g.issues.length > 0)
                .slice(0, 12)
                .map((game) => (
                  <li
                    key={game.slug}
                    className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                  >
                    <Link
                      href={`/dashboard/games/${game.slug}`}
                      className="text-sm font-bold text-brand hover:text-brand-600"
                    >
                      {game.title}
                    </Link>
                    <span className="flex flex-wrap gap-1.5">
                      {game.issues.map((id) => (
                        <span
                          key={id}
                          className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-bold text-muted"
                        >
                          {id.replace(/-/g, " ")}
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
            </ul>
            {health.games.every((g) => g.issues.length === 0) && (
              <div className="py-8 text-center text-sm text-muted">
                Nothing to fix.
              </div>
            )}
          </div>
        </div>
      </Section>

      {/* ── Panel 1: the link builder ────────────────────────────────────── */}
      <Section
        title="Link builder"
        subtitle="tag a link before you post it"
        className="mt-6"
      >
        <LinkBuilder destinations={destinations} />
      </Section>
    </>
  );
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-border bg-surface p-5">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">
        {label}
      </div>
      <div className="mt-1 text-3xl font-black tabular-nums">{value}</div>
      {hint && <div className="mt-auto pt-3 text-xs font-medium text-muted">{hint}</div>}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-2 p-3">
      <div className="text-[11px] font-bold uppercase tracking-wide text-muted">
        {label}
      </div>
      <div className="mt-0.5 text-xl font-black tabular-nums">{value}</div>
    </div>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: "amber" | "rose";
  children: React.ReactNode;
}) {
  const cls =
    tone === "amber"
      ? "border-amber-300 bg-amber-50 text-amber-900"
      : "border-rose-300 bg-rose-50 text-rose-900";
  return (
    <div className={`mb-6 rounded-xl border px-4 py-3 text-sm ${cls}`}>{children}</div>
  );
}
