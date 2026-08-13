/**
 * HallPass dashboard — the review moderation queue.
 *
 * The screen an admin opens when a pupil has reported something. It is a work
 * LIST, not a table: every reported review is a card carrying enough context to
 * make the decision in one place — what was written, who wrote it, who objected
 * and why, whether the site already auto-hid it — followed by the verbs that
 * resolve it. Nothing here needs a second screen, because a moderation decision
 * deferred is a decision a child is waiting on.
 *
 * *** THE AUTHOR'S EMAIL IS NEVER RENDERED, AND NEVER FETCHED. ***
 *
 * `players.email` is, for this audience, a child's SCHOOL address. It is not
 * needed to judge a review: the author is identified here by their public handle
 * and their `public_id` (a random UUID), which is enough to ban them, enough to
 * find them in the database, and useless to anyone who screenshots this page. If
 * a safeguarding case ever needs a real address, that is a deliberate manual
 * lookup by someone with database access — an act with a witness — NOT a column
 * rendered on a screen that gets shoulder-surfed in a staff room. The store makes
 * this structural rather than a matter of discipline: `queue()` selects no email
 * column at all, and no type it returns has a field one could be assigned to (see
 * the docblock in `app/lib/reviews/moderation.ts`). The `actorEmail` shown in the
 * audit trail at the bottom is a DIFFERENT email — a colleague's
 * `dashboard_users` work account, and naming who acted is the entire point of an
 * audit trail.
 *
 * The review body is rendered as TEXT — `whitespace-pre-wrap break-words`, never
 * `dangerouslySetInnerHTML`. It is attacker-controlled string data from a
 * teenager who has just been told there is a moderation panel; the one place it
 * is displayed in full to a privileged user is the last place to start trusting
 * it.
 *
 * DESTRUCTIVE ACTIONS ARE TWO-STEP, and the second step is a `<details>`
 * disclosure rather than `window.confirm()`. A native dialog blocks the whole
 * browser, cannot be styled, and — worse for this surface — trains admins to
 * dismiss it reflexively. The disclosure keeps the confirmation on the page, next
 * to the thing being destroyed, with room to state what it actually does. No
 * dialog library, in keeping with the rest of the repo.
 *
 * Failure modes stay distinct, following `boards/[id]/page.tsx`: an unconfigured
 * `DATABASE_URL` and a database missing the reviews migration each render their
 * own notice instead of a 500, and any OTHER error is rethrown — a real Neon
 * outage must not be disguised as "nothing to moderate", which is the single most
 * dangerous lie this page could tell.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/app/lib/auth";
import { isMissingColumnError, isUnconfiguredDbError, sql } from "@/app/lib/db";
import { resolveGames } from "@/app/lib/games-store";
import {
  REPORT_REASONS,
  REVIEW_AUTO_HIDE_REPORTS,
} from "@/app/lib/reviews/config";
import {
  createModerationStore,
  type ModerationLogEntry,
  type QueueEntry,
  type QueuedReport,
  type ReviewEntry,
} from "@/app/lib/reviews/moderation";
import { DashHeader } from "../_ui/DashHeader";
import { Section } from "../_ui/Section";
import {
  banAuthorAction,
  deleteReviewAction,
  dismissReportAction,
  dismissReporterAction,
  hideReviewAction,
  purgeReviewAction,
  unbanAuthorAction,
  unhideReviewAction,
} from "./actions";

export const metadata: Metadata = {
  title: "Moderation",
  description: "Reported reviews waiting on a decision.",
  robots: { index: false, follow: false },
};

/**
 * Bound to the shared Neon client here for the same reason `actions.ts` does it:
 * the house pattern is a `server-only` barrel, `reviews/index.ts` is not this
 * surface's to edit, and the factory is a bag of closures over `sql` — a second
 * binding costs a pointer.
 */
const moderation = createModerationStore(sql);

/** One screen of work. The store clamps anything larger; this is the product choice. */
const QUEUE_LIMIT = 50;
/**
 * How far back the "everything else" list reads.
 *
 * Smaller than the queue on purpose: the queue is work that must be finished,
 * this is a feed to keep an eye on. A term's worth of reviews down one page
 * would bury the reported ones the page exists for.
 */
const RECENT_LIMIT = 25;
/** Enough audit rows to see today's work without turning the page into a log viewer. */
const LOG_LIMIT = 25;

type SearchParams = Promise<{
  ok?: string | string[];
  error?: string | string[];
}>;

/** Collapse a possibly-repeated querystring value to a single string. */
function asString(value: string | string[] | undefined): string | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] : value;
}

/** Locale-stable date + time, matching the Users table's "last sign-in" column. */
function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Widened to `Map<string, string>` on purpose. `reason` arrives from the database
 * as a plain string, and a map keyed by the literal union would force a cast at
 * every lookup — a cast that would then be a lie the first time the CHECK
 * constraint gains a value `REPORT_REASONS` has not caught up with.
 */
const REASON_LABEL: Map<string, string> = new Map(
  REPORT_REASONS.map((r) => [r.value, r.label]),
);

/**
 * An unknown reason is shown raw rather than dropped. The column has a CHECK
 * constraint, so this can only fire if the constraint and `REPORT_REASONS` have
 * drifted — in which case the moderator should SEE the odd value, not a card that
 * quietly lost a report.
 */
function reasonLabel(reason: string): string {
  return REASON_LABEL.get(reason) ?? reason;
}

/**
 * Severity, used only to colour the reason chips. The four red ones are the
 * reasons that can mean a child is being harmed right now; the amber ones are
 * nuisance. It is a reading aid for a long queue, not a policy.
 */
const REASON_TONE: Record<string, Tone> = {
  personal_info: "red",
  bullying: "red",
  hate: "red",
  sexual: "red",
  spam: "amber",
  impersonation: "amber",
  other: "zinc",
};

/** Reasons on one review, most-cited first. */
function tallyReasons(reports: QueuedReport[]): { reason: string; n: number }[] {
  const counts = new Map<string, number>();
  for (const report of reports) {
    counts.set(report.reason, (counts.get(report.reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, n]) => ({ reason, n }))
    .sort((a, b) => b.n - a.n || a.reason.localeCompare(b.reason));
}

/**
 * How many DISTINCT people objected — the number that actually matters, because
 * one report is an opinion and five are a signal.
 *
 * A report whose reporter deleted their account arrives with a null id
 * (`reporter_id` is ON DELETE SET NULL, so the queue cannot be emptied by
 * deleting an account). Two nulls are not provably the same person, so each
 * orphan counts as one. The number therefore errs HIGH rather than merging two
 * strangers into one — the safe direction when the count is a proxy for "how
 * many people found this bad enough to act".
 */
function distinctReporters(reports: QueuedReport[]): number {
  const known = new Set<string>();
  let orphans = 0;
  for (const report of reports) {
    if (report.reporter.id) known.add(report.reporter.id);
    else orphans += 1;
  }
  return known.size + orphans;
}

export default async function ModerationPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireRole("admin");

  const params = await searchParams;
  const ok = asString(params.ok);
  const error = asString(params.error);

  // One try for all four reads: they hit the same tables, so they fail together
  // or not at all, and a partial render ("no queue, but here is the audit log")
  // would be more confusing than a single honest notice.
  let queue: QueueEntry[] = [];
  let recent: ReviewEntry[] = [];
  let log: ModerationLogEntry[] = [];
  let openReports = 0;
  let unavailable: "unconfigured" | "schema" | null = null;

  try {
    [queue, recent, openReports, log] = await Promise.all([
      moderation.queue({ limit: QUEUE_LIMIT }),
      moderation.recentReviews({ limit: RECENT_LIMIT }),
      moderation.openReportCount(),
      moderation.recentActions(LOG_LIMIT),
    ]);
  } catch (err) {
    if (isUnconfiguredDbError(err)) unavailable = "unconfigured";
    else if (isMissingColumnError(err)) unavailable = "schema";
    // Anything else is a real outage and must stay loud. Swallowing it here would
    // render an empty queue, which reads as "nothing to do".
    else throw err;
  }

  // Slug → title for the "which game" link. Membership in this map IS
  // `isResolvedSlug()` — same resolved catalogue (static + external), read once
  // instead of once per card — so a slug that has since been removed renders as
  // plain text and never becomes a link to a 404. `resolveGames()` never throws.
  const titleBySlug = new Map((await resolveGames()).map((g) => [g.slug, g.title]));

  return (
    <>
      <DashHeader
        title="Moderation"
        subtitle={
          unavailable
            ? "Reported reviews"
            : openReports === 0
              ? "Nothing reported — the queue is clear."
              : `${plural(openReports, "open report", "open reports")} across ${plural(queue.length, "review", "reviews")}`
        }
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

      {unavailable === "unconfigured" && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Database not configured. Set{" "}
          <code className="font-mono">DATABASE_URL</code> to work the report
          queue.
        </div>
      )}

      {unavailable === "schema" && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          The reviews schema is not on this database yet. Apply{" "}
          <code className="font-mono">
            app/lib/scoreboard/migrations/008_game_reviews.sql
          </code>{" "}
          and reload.
        </div>
      )}

      {/* A plain heading rather than a `Section`: the cards below are already
          bordered `bg-surface` panels, and nesting them inside another one puts
          two borders around every review. */}
      {!unavailable && (
        <ListHeading
          title="Reported"
          subtitle={
            queue.length === 0
              ? "nothing outstanding"
              : `${plural(queue.length, "review", "reviews")} · newest report first`
          }
        />
      )}

      {!unavailable && queue.length === 0 && (
        <div className="rounded-xl border border-border bg-surface p-12 text-center">
          <div aria-hidden className="text-3xl">
            ✻
          </div>
          <p className="mt-3 text-sm font-extrabold text-foreground">
            Nothing is waiting on you.
          </p>
          <p className="mt-1 text-sm text-muted">
            Reviews land here the moment somebody reports them. At{" "}
            {REVIEW_AUTO_HIDE_REPORTS} distinct reporters a review hides itself
            and still queues for a human.
          </p>
        </div>
      )}

      {queue.length > 0 && (
        <div className="space-y-5">
          {queue.map((entry) => (
            <QueueCard
              key={entry.review.id}
              entry={entry}
              gameTitle={titleBySlug.get(entry.review.slug) ?? null}
            />
          ))}
        </div>
      )}

      {queue.length === QUEUE_LIMIT && (
        <p className="mt-4 text-center text-xs text-muted">
          Showing the {QUEUE_LIMIT} reviews with the newest reports. Clear some to
          see the rest.
        </p>
      )}

      {/*
        EVERYTHING THAT HAS BEEN WRITTEN, reported or not, and the reason this
        page has two lists rather than one.

        The queue above is fed by `review_reports`, so a review nobody has
        reported cannot appear in it. That left two things silently broken. The
        `review_posted` notification says "Open moderation to read it" and links
        here — and a brand-new review has no reports, so the page it linked to
        truthfully answered "Nothing is waiting on you". And a review whose text
        trips a FLAGGED wordlist term is saved HIDDEN, pending review: off the
        public page, therefore unreadable, therefore unreportable, therefore
        never queued. Flagging a review made it invisible to the very people it
        was flagged for.

        So this list is not a nice-to-have feed. It is the only surface on which
        a held review can be read, and it carries the full set of verbs for that
        reason.
      */}
      {!unavailable && (
        <>
          <ListHeading
            title="Every review"
            subtitle={`newest first · up to ${RECENT_LIMIT} · reported or not`}
          />
          {recent.length === 0 ? (
            <div className="rounded-xl border border-border bg-surface p-12 text-center text-sm text-muted">
              Nobody has written a review yet.
            </div>
          ) : (
            <div className="space-y-5">
              {recent.map((entry) => (
                <ReviewCard
                  key={entry.review.id}
                  entry={entry}
                  gameTitle={titleBySlug.get(entry.review.slug) ?? null}
                />
              ))}
            </div>
          )}
        </>
      )}

      {!unavailable && (
        <div className="mt-8">
          <Section
            title="Recent moderation actions"
            subtitle={`newest first · up to ${LOG_LIMIT}`}
          >
            <RecentActions log={log} />
          </Section>
        </div>
      )}
    </>
  );
}

/**
 * The label above a list of review cards.
 *
 * Deliberately not `Section`, which is a bordered card: these lists are made of
 * bordered cards already, and nesting the two draws a second frame around every
 * review. Matches the audit trail's heading style so the page still reads as
 * one page.
 */
function ListHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-4 mt-8 flex items-baseline justify-between gap-3">
      <h2 className="text-sm font-bold uppercase tracking-wide text-muted">
        {title}
      </h2>
      <span className="text-xs text-muted">{subtitle}</span>
    </div>
  );
}

/* ---------------------------------------------------------------- one review */

function QueueCard({
  entry,
  gameTitle,
}: {
  entry: QueueEntry;
  gameTitle: string | null;
}) {
  const { review, author, reports } = entry;
  const people = distinctReporters(reports);
  const tally = tallyReasons(reports);

  return (
    <article className="rounded-xl border border-border bg-surface p-5">
      <ReviewHeader entry={entry} gameTitle={gameTitle} />

      {/* The open-report count is spelled out in the heading below, so the chip
          version of it would be the same fact twice on one card. */}
      <StateChips entry={entry} showOpenReports={false} />

      <ReviewBody body={review.body} />

      {/* Who objected, and why ---------------------------------------------- */}
      <div className="mt-5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h3 className="text-xs font-bold uppercase tracking-wide text-muted">
            {plural(entry.openReports, "open report", "open reports")} from{" "}
            {plural(people, "person", "people")}
          </h3>
          <span className="text-xs text-muted">
            latest {formatDateTime(entry.latestReportAt)}
          </span>
        </div>

        {/*
          The tally is a SUMMARY, so it only earns its space when there is
          something to summarise. With a single report it printed the reason as
          a chip and then again in the row directly beneath it — the same string
          twice, which reads as a rendering bug rather than as a heading. With
          several it does real work ("Bullying ×4, Spam ×1" is the shape of the
          complaint at a glance, before you read anyone's individual reason).
        */}
        {reports.length > 1 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {tally.map(({ reason, n }) => (
              <Chip key={reason} tone={REASON_TONE[reason] ?? "zinc"}>
                {reasonLabel(reason)}
                {n > 1 && <span className="tabular-nums"> ×{n}</span>}
              </Chip>
            ))}
          </div>
        )}

        <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
          {reports.map((report) => (
            <li
              key={report.id}
              className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-xs"
            >
              <div className="min-w-0">
                <span className="font-semibold text-foreground">
                  {report.reporter.displayName}
                </span>
                <span className="text-muted">
                  {" "}
                  · {reasonLabel(report.reason)} ·{" "}
                  {formatDateTime(report.createdAt)}
                </span>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <form action={dismissReportAction}>
                  <input type="hidden" name="reportId" value={report.id} />
                  <button
                    type="submit"
                    title="This report was wrong — resolve it without touching the review."
                    className="rounded-full border border-border bg-white px-3 py-1 text-xs font-bold text-zinc-700 transition hover:bg-surface-2"
                  >
                    Dismiss
                  </button>
                </form>
                {/* Offered only when the reporter still has an account: the bulk
                    dismissal is keyed on the reporter, and an orphaned report has
                    nobody left to key on. This is the answer to a pupil who has
                    discovered the report button and flagged half the site. */}
                {report.reporter.id && (
                  <form action={dismissReporterAction}>
                    <input
                      type="hidden"
                      name="playerPublicId"
                      value={report.reporter.id}
                    />
                    <button
                      type="submit"
                      title="Dismiss every open report this person has filed, anywhere on the site."
                      className="rounded-full border border-border bg-white px-3 py-1 text-xs font-bold text-muted transition hover:bg-surface-2 hover:text-zinc-700"
                    >
                      Dismiss all theirs
                    </button>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <ReviewVerbs review={review} author={author} />
    </article>
  );
}

/**
 * A review nobody has reported — the same card, minus the part about who
 * objected, because nobody has.
 *
 * It carries the full set of verbs rather than a read-only view. The reviews
 * that most need this list are the ones the wordlist FLAGGED: they are already
 * hidden, they are here because a human has to decide, and a screen that showed
 * them without letting anyone act would just be a longer route to the same dead
 * end.
 */
function ReviewCard({
  entry,
  gameTitle,
}: {
  entry: ReviewEntry;
  gameTitle: string | null;
}) {
  return (
    <article className="rounded-xl border border-border bg-surface p-5">
      <ReviewHeader entry={entry} gameTitle={gameTitle} />
      <StateChips entry={entry} showOpenReports />
      <ReviewBody body={entry.review.body} />
      <ReviewVerbs review={entry.review} author={entry.author} />
    </article>
  );
}

/* ------------------------------------------------- the parts a card is made of */

/**
 * Who wrote it, and where. Shared by both lists, so an author is described
 * identically whether or not anybody has complained about them.
 */
function ReviewHeader({
  entry,
  gameTitle,
}: {
  entry: ReviewEntry;
  gameTitle: string | null;
}) {
  const { review, author } = entry;

  return (
    <>
      {/* Who wrote it ------------------------------------------------------- */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {author.image ? (
            /* eslint-disable-next-line @next/next/no-img-element -- a Google
               avatar is a remote URL on a domain we do not control; next/image
               would proxy every one of them through the optimizer for a 36px
               square on an admin page. `referrerPolicy="no-referrer"` matches the
               leaderboard: it stops the avatar request telling Google which
               dashboard page an admin is on. */
            <img
              src={author.image}
              alt=""
              width={36}
              height={36}
              referrerPolicy="no-referrer"
              className="h-9 w-9 shrink-0 rounded-full border border-border object-cover"
            />
          ) : (
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-100 text-sm font-black text-brand">
              {author.displayName[0]?.toUpperCase() ?? "?"}
            </span>
          )}

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {/* `displayName` is the handle, else "@username", else "Player" —
                  the Google `name` field is never selected and must never be
                  rendered: for a school account it is a child's real name. */}
              <span className="truncate text-sm font-extrabold text-foreground">
                {author.displayName}
              </span>
              {author.banned && <Chip tone="red">Banned from reviews</Chip>}
            </div>
            <div className="mt-0.5 truncate text-xs text-muted">
              {author.username ? `@${author.username}` : "no username"} ·{" "}
              <span className="font-mono" title={author.id}>
                {author.id.slice(0, 8)}
              </span>
            </div>
          </div>
        </div>

        <div className="text-right text-xs text-muted">
          <div className="font-semibold text-foreground">
            {gameTitle ? (
              <Link
                href={`/game/${review.slug}`}
                className="text-brand hover:text-brand-600"
              >
                {gameTitle}
              </Link>
            ) : (
              /* The slug no longer resolves — the game was removed. Rendered
                 flat rather than as a link that would land on a 404. */
              <span title="This game is no longer in the catalogue">
                {review.slug}
              </span>
            )}
          </div>
          <div className="mt-0.5">Review #{review.id}</div>
          <div className="mt-0.5">Written {formatDateTime(review.createdAt)}</div>
        </div>
      </div>
    </>
  );
}

/**
 * Where the review stands, at a glance.
 *
 * `showOpenReports` is off on a queue card, where the count is already the
 * heading of the reports list beneath it, and on for a review in the latest
 * list, where it is the only thing saying "this one is also in the queue above".
 */
function StateChips({
  entry,
  showOpenReports,
}: {
  entry: ReviewEntry;
  showOpenReports: boolean;
}) {
  const { review } = entry;

  /**
   * "Did the site hide this by itself?" cannot be answered exactly from one row:
   * a moderator's own hide of a review that already had three reports looks
   * identical. What IS certain is that a hidden review still carrying
   * `report_count >= REVIEW_AUTO_HIDE_REPORTS` crossed the threshold — `unhide()`
   * resets that counter to zero precisely so a cleared review cannot be re-hidden
   * by a single later report. So the note claims the threshold was reached, not
   * who acted; the audit trail below is the authority on that.
   */
  const hitThreshold =
    review.status === "hidden" && review.reportCount >= REVIEW_AUTO_HIDE_REPORTS;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <StatusChip status={review.status} />
      <Chip tone={review.recommended ? "emerald" : "zinc"}>
        {review.recommended ? "Recommended" : "Not recommended"}
      </Chip>
      {review.helpfulCount > 0 && (
        <Chip tone="zinc">
          {plural(review.helpfulCount, "helpful vote", "helpful votes")}
        </Chip>
      )}
      {showOpenReports && entry.openReports > 0 && (
        <Chip tone="red" title="This review is in the report queue at the top of this page.">
          {plural(entry.openReports, "open report", "open reports")}
        </Chip>
      )}
      {hitThreshold && (
        <Chip
          tone="amber"
          title={`Auto-hide fires at ${REVIEW_AUTO_HIDE_REPORTS} distinct reporters and never resolves the reports — a human still decides.`}
        >
          Hit the {REVIEW_AUTO_HIDE_REPORTS}-report auto-hide
        </Chip>
      )}
    </div>
  );
}

/**
 * What it says.
 *
 * TEXT, never markup — see the module docblock. One component so that rule has
 * one place to be broken rather than one per list.
 */
function ReviewBody({ body }: { body: string }) {
  return (
    <p className="mt-4 whitespace-pre-wrap break-words rounded-lg border border-border bg-surface-2 p-4 text-sm text-foreground">
      {body}
    </p>
  );
}

/** The verbs, identical on both lists — the same review deserves the same powers. */
function ReviewVerbs({
  review,
  author,
}: {
  review: ReviewEntry["review"];
  author: ReviewEntry["author"];
}) {
  return (
    <>
      {/* Verbs --------------------------------------------------------------- */}
      {/*
        Only the verbs that can actually move this review are rendered. Hide is
        gone once it is hidden, Unhide only exists for a hidden one, and Delete
        disappears on a tombstone the author already removed — for that last case
        the correct verb IS Dismiss, because `dismissed` means "the report needed
        no action" and the review is already off the public site. A button that
        provably cannot change anything teaches admins to distrust the panel.

        Hide/Unhide/Delete take no note. A mandatory justification on every
        routine hide is a tax that gets paid with "." within a week; the reason
        field lives on the two acts worth explaining — Purge and Ban.
      */}
      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        {review.status === "visible" && (
          <form action={hideReviewAction}>
            <input type="hidden" name="reviewId" value={review.id} />
            <button
              type="submit"
              title="Take it off the public page. Reversible, and closes the open reports."
              className="rounded-full bg-brand px-4 py-1.5 text-xs font-extrabold text-white transition hover:bg-brand-600"
            >
              Hide
            </button>
          </form>
        )}

        {review.status === "hidden" && (
          <form action={unhideReviewAction}>
            <input type="hidden" name="reviewId" value={review.id} />
            <button
              type="submit"
              title="Put it back and clear the auto-hide counter, so one more report cannot instantly re-hide it."
              className="rounded-full border border-border bg-white px-4 py-1.5 text-xs font-bold text-zinc-700 transition hover:bg-surface-2"
            >
              Unhide
            </button>
          </form>
        )}

        {review.status !== "deleted" && (
          <form action={deleteReviewAction}>
            <input type="hidden" name="reviewId" value={review.id} />
            <button
              type="submit"
              title="Tombstone it: off the site for good, but the row and its text stay as evidence."
              className="rounded-full border border-red-200 bg-red-50 px-4 py-1.5 text-xs font-extrabold text-red-700 transition hover:bg-red-100"
            >
              Delete
            </button>
          </form>
        )}

        {author.banned && (
          <form action={unbanAuthorAction} className="ml-auto">
            <input type="hidden" name="playerPublicId" value={author.id} />
            <button
              type="submit"
              title="Let them write reviews again. Reviews hidden when the ban was applied stay hidden."
              className="rounded-full border border-border bg-white px-4 py-1.5 text-xs font-bold text-zinc-700 transition hover:bg-surface-2"
            >
              Lift ban
            </button>
          </form>
        )}
      </div>

      {/* Two-step destructive verbs ------------------------------------------ */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <PurgePanel reviewId={review.id} />
        {!author.banned && (
          <BanPanel publicId={author.id} displayName={author.displayName} />
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------- confirm steps */

/**
 * Purge, behind a disclosure. Step one opens the panel; step two submits.
 *
 * The hidden `confirm` field is written only by this second step — `actions.ts`
 * rejects a purge without it. Not a security control (an admin is already
 * authorised to purge and can POST whatever they like) but a wiring check: if
 * this ever collapses into a single button by accident, the request bounces
 * instead of destroying a row.
 */
function PurgePanel({ reviewId }: { reviewId: number }) {
  return (
    <details className="group rounded-lg border border-red-200 bg-red-50/50">
      <summary className="cursor-pointer list-none px-4 py-2 text-xs font-extrabold text-red-700 [&::-webkit-details-marker]:hidden">
        Purge… <span aria-hidden className="inline-block transition-transform group-open:rotate-90">▸</span>
      </summary>
      <form
        action={purgeReviewAction}
        className="border-t border-red-200 px-4 py-3"
      >
        <input type="hidden" name="reviewId" value={reviewId} />
        <input type="hidden" name="confirm" value="purge" />
        <p className="text-xs leading-relaxed text-red-900/80">
          Erases the row, its votes and its reports. There is no undo and no
          tombstone. Use it only when the text itself must not persist — a phone
          number, an address, another pupil&rsquo;s real name. For everything
          else, Delete keeps the evidence.
        </p>
        <input
          name="reason"
          type="text"
          maxLength={300}
          autoComplete="off"
          placeholder="Why (goes in the audit log)"
          aria-label="Reason for purging"
          className="mt-3 w-full rounded-lg border border-red-200 bg-white px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-red-300"
        />
        <button
          type="submit"
          className="mt-2 w-full rounded-full bg-red-600 px-4 py-2 text-xs font-extrabold text-white transition hover:bg-red-700"
        >
          Really purge #{reviewId}
        </button>
      </form>
    </details>
  );
}

/**
 * Ban, behind the same disclosure pattern.
 *
 * Expiry is a DATE and blank means permanent; `actions.ts` reads it as the end of
 * that day in UTC and explains why a `datetime-local` would silently shift the
 * ban by the server's offset.
 */
function BanPanel({
  publicId,
  displayName,
}: {
  publicId: string;
  displayName: string;
}) {
  return (
    <details className="group rounded-lg border border-red-200 bg-red-50/50">
      <summary className="cursor-pointer list-none px-4 py-2 text-xs font-extrabold text-red-700 [&::-webkit-details-marker]:hidden">
        Ban from reviews… <span aria-hidden className="inline-block transition-transform group-open:rotate-90">▸</span>
      </summary>
      <form
        action={banAuthorAction}
        className="space-y-3 border-t border-red-200 px-4 py-3"
      >
        <input type="hidden" name="playerPublicId" value={publicId} />
        <input type="hidden" name="confirm" value="ban" />

        <p className="text-xs leading-relaxed text-red-900/80">
          Stops <span className="font-bold">{displayName}</span> writing or
          editing reviews anywhere on the site. Their scores, saves and games are
          untouched. The ban survives account deletion, so signing up again with
          the same Google account will not shake it off.
        </p>

        <label className="block text-xs font-bold text-red-900">
          Reason (optional)
          <input
            name="reason"
            type="text"
            maxLength={300}
            autoComplete="off"
            placeholder="What happened"
            className="mt-1 w-full rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-normal outline-none focus:ring-2 focus:ring-red-300"
          />
        </label>

        <label className="block text-xs font-bold text-red-900">
          Until (leave blank for permanent)
          <input
            name="expiresAt"
            type="date"
            className="mt-1 w-full rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-normal outline-none focus:ring-2 focus:ring-red-300"
          />
          <span className="mt-1 block font-normal text-red-900/70">
            Ends at the close of that day (UTC).
          </span>
        </label>

        {/*
          UNCHECKED BY DEFAULT, and that default is the policy decision rather
          than a UI preference. A ban almost always follows ONE bad review.
          Sweeping a term's worth of a child's harmless reviews off the site is
          disproportionate to that, and it destroys the context the NEXT
          moderator needs to judge whether the ban was fair or should be lifted.
          Least destructive default; the admin who has actually read the case is
          the one who opts in. (When it is on, the store deliberately leaves
          those reviews' reports OPEN — a bulk hide judged nothing anyone read.)
        */}
        <label className="flex items-start gap-2 text-xs font-semibold text-red-900">
          <input
            name="hideBacklog"
            type="checkbox"
            value="1"
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-red-300 accent-red-600"
          />
          <span>
            Also hide their existing reviews
            <span className="block font-normal text-red-900/70">
              Hides every review of theirs that is still visible. Lifting the ban
              does not bring them back.
            </span>
          </span>
        </label>

        <button
          type="submit"
          className="w-full rounded-full bg-red-600 px-4 py-2 text-xs font-extrabold text-white transition hover:bg-red-700"
        >
          Really ban {displayName}
        </button>
      </form>
    </details>
  );
}

/* ------------------------------------------------------------- audit trail */

const ACTION_LABEL: Record<ModerationLogEntry["action"], string> = {
  hide: "Hid",
  unhide: "Unhid",
  delete: "Deleted",
  purge: "Purged",
  dismiss: "Dismissed",
  ban: "Banned",
  unban: "Unbanned",
  hide_backlog: "Hid backlog",
};

const ACTION_TONE: Record<ModerationLogEntry["action"], Tone> = {
  hide: "amber",
  unhide: "emerald",
  delete: "red",
  purge: "red",
  dismiss: "zinc",
  ban: "red",
  unban: "emerald",
  hide_backlog: "amber",
};

/**
 * The audit trail, in the product rather than only in the database.
 *
 * It is here because a log nobody reads is a log that does not work: the point of
 * `review_moderation_log` is that a colleague can see what was done to a pupil
 * and by whom, and that only happens if it is on the same screen as the queue.
 * `actorEmail` is rendered deliberately — see the module docblock on the two
 * different emails.
 */
function RecentActions({ log }: { log: ModerationLogEntry[] }) {
  if (log.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted">
        No moderation actions recorded yet.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-muted">
            <th className="whitespace-nowrap py-2 pr-3">When</th>
            <th className="py-2 pr-3">Action</th>
            <th className="py-2 pr-3">Review</th>
            <th className="py-2 pr-3">Player</th>
            <th className="py-2 pr-3">Note</th>
            <th className="py-2">By</th>
          </tr>
        </thead>
        <tbody>
          {log.map((row) => (
            <tr key={row.id} className="border-b border-border last:border-0">
              <td className="whitespace-nowrap py-2 pr-3 text-xs text-muted tabular-nums">
                {formatDateTime(row.createdAt)}
              </td>
              <td className="py-2 pr-3">
                <Chip tone={ACTION_TONE[row.action] ?? "zinc"}>
                  {ACTION_LABEL[row.action] ?? row.action}
                </Chip>
              </td>
              <td className="py-2 pr-3 text-xs">
                {row.reviewId ? (
                  <span className="font-mono text-foreground">
                    #{row.reviewId}
                  </span>
                ) : (
                  <span className="text-muted">—</span>
                )}
                {row.slug && (
                  <span className="ml-1.5 text-muted">{row.slug}</span>
                )}
              </td>
              <td className="py-2 pr-3 text-xs">
                {/* `target.id` null with a target present is the meaningful case:
                    the account is gone but the ban (which has no FK, on purpose)
                    outlived it. Never an email, never the internal player id. */}
                {row.target ? (
                  <span
                    className={row.target.id ? "text-foreground" : "text-muted"}
                    title={row.target.id ?? undefined}
                  >
                    {row.target.displayName}
                  </span>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </td>
              <td className="py-2 pr-3 text-xs text-muted">
                {row.reason ? (
                  <span className="break-words">{row.reason}</span>
                ) : (
                  "—"
                )}
              </td>
              <td className="py-2 text-xs text-muted">{row.actorEmail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------- atoms */

type Tone = "red" | "amber" | "emerald" | "brand" | "zinc";

const TONE_CLASS: Record<Tone, string> = {
  red: "border-red-200 bg-red-50 text-red-700",
  amber: "border-amber-300 bg-amber-50 text-amber-900",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  brand: "border-brand-100 bg-brand-50 text-brand",
  zinc: "border-border bg-surface-2 text-muted",
};

function Chip({
  tone,
  title,
  children,
}: {
  tone: Tone;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * The three review states, spelled out rather than shown as a bare word.
 * "deleted" in particular is ambiguous on its own — it means the AUTHOR removed
 * it, and the row survives so a report still points at real text.
 */
function StatusChip({ status }: { status: QueueEntry["review"]["status"] }) {
  if (status === "hidden") return <Chip tone="amber">Hidden</Chip>;
  if (status === "deleted") {
    return (
      <Chip tone="zinc" title="A tombstone: the row survives so the report still points at real text.">
        Deleted by its author
      </Chip>
    );
  }
  return <Chip tone="emerald">Live on the site</Chip>;
}
