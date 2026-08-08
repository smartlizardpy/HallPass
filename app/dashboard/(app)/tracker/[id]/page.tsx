/**
 * HallPass dashboard — one tracker item.
 *
 * Everything about a single item on one screen: the pasted brief, the lane it is
 * in, its tags, the progress notes, and the activity trail. Nothing here needs a
 * second page, because the reason somebody opens this is to find out where a
 * thing actually is.
 *
 * THE BRIEF IS RENDERED AS TEXT — `whitespace-pre-wrap break-words`, never
 * `dangerouslySetInnerHTML`. It is free text pasted by a person, and this is the
 * one place it is shown in full to a privileged user; that is the last place to
 * start trusting it. Same rule the moderation page states for review bodies, and
 * the reason there is no markdown renderer here: a dependency and an XSS surface
 * bought for italics.
 *
 * EVERY MUTATION IS ITS OWN `<form>` posting to a server action — a `<select>`
 * plus a submit for the lane, a textarea plus a submit for an update. No client
 * component and no JavaScript required, matching how the rest of the dashboard
 * mutates.
 *
 * ARCHIVING IS TWO-STEP, and the second step is a `<details>` disclosure rather
 * than `window.confirm()` — following the moderation screen: a native dialog
 * blocks the whole browser, cannot be styled, and trains people to dismiss it
 * reflexively. The disclosure keeps the confirmation next to the thing being
 * archived, with room to say what it actually does. Permanent deletion uses the
 * same shape, worded harder.
 *
 * TWO CONTROLS ARE SUPER-ADMIN-ONLY — moving the lane and deleting for good. A
 * plain admin sees the current status as a READ-ONLY CHIP rather than a
 * `<select>` that would bounce them to `/dashboard` on submit, and sees no
 * delete section at all. Hiding them is a courtesy, not the enforcement: the
 * server actions re-check independently, because a hidden form is still a
 * reachable endpoint. Both halves read `canMoveStatus`/`canDeleteItem` from
 * `tracker/config` so they cannot drift from the guards.
 *
 * A missing item is a `notFound()`, not an empty page. A database with no
 * migration 021 reaches here as a missing item too, which is acceptable on a
 * detail route: the BOARD is the surface that explains the missing migration,
 * and it is the one anybody lands on first.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/app/lib/auth";
import { getEvents, getItem, getUpdates } from "@/app/lib/tracker";
import {
  BRIEF_MAX,
  MAX_TAGS_PER_ITEM,
  STATUS_HINT,
  STATUS_LABEL,
  TITLE_MAX,
  TRACKER_STATUSES,
  UPDATE_BODY_MAX,
  canDeleteItem,
  canMoveStatus,
} from "@/app/lib/tracker/config";
import { Section } from "../../_ui/Section";
import {
  PRIMARY_BUTTON,
  ResultBanner,
  SECONDARY_BUTTON,
  StatusChip,
  TagChip,
} from "../_ui/Chips";
import {
  addUpdateAction,
  archiveItemAction,
  deleteItemAction,
  editItemAction,
  restoreItemAction,
  setStatusAction,
  setTagsAction,
} from "../actions";

export const metadata: Metadata = {
  title: "Tracker item",
  robots: { index: false, follow: false },
};

/** Absolute, unambiguous stamp — this page is a record, not a feed. */
function stamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toISOString().slice(0, 16).replace("T", " ");
}

/** One line of the activity trail, phrased for a reader. */
function describe(action: string, from: string | null, to: string | null): string {
  switch (action) {
    case "create":
      return `created “${to ?? ""}”`;
    case "status":
      return `moved ${from ?? "?"} → ${to ?? "?"}`;
    case "tag":
      return `tags ${from || "none"} → ${to || "none"}`;
    case "edit":
      return "edited the details";
    case "comment":
      return "posted an update";
    case "archive":
      return "archived it";
    case "restore":
      return "restored it";
    case "delete":
      // Written for a reader who can no longer open the thing being described:
      // after a hard delete this line and the title it carries are all that is
      // left, which is why the store records both the title and the lane.
      return `deleted “${from ?? ""}” for good (was ${to ?? "?"})`;
    default:
      return action;
  }
}

export default async function TrackerItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { role } = await requireRole("admin");
  const mayMove = canMoveStatus(role);
  const mayDelete = canDeleteItem(role);

  const { id: rawId } = await params;
  const { ok, error } = await searchParams;

  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();

  const item = await getItem(id);
  if (!item) notFound();

  const [updates, events] = await Promise.all([getUpdates(id), getEvents(id)]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/dashboard/tracker"
          className="text-sm font-bold text-muted hover:text-foreground"
        >
          ← Tracker
        </Link>
        <StatusChip status={item.status} />
      </div>

      <ResultBanner ok={ok} error={error} />

      {item.archivedAt && (
        <Section title="Archived">
          <p className="text-sm text-muted">
            Archived {stamp(item.archivedAt)}. It is hidden from the board but
            nothing was deleted.
          </p>
          <form action={restoreItemAction} className="mt-3">
            <input type="hidden" name="id" value={item.id} />
            <button type="submit" className={SECONDARY_BUTTON}>
              Restore to the board
            </button>
          </form>
        </Section>
      )}

      {/* ---- The ask ---------------------------------------------------- */}
      <Section title="The ask">
        <form action={editItemAction} className="flex flex-col gap-3">
          <input type="hidden" name="id" value={item.id} />
          <label className="flex flex-col gap-1">
            <span className="text-xs font-bold uppercase tracking-wide text-muted">
              Title
            </span>
            <input
              name="title"
              defaultValue={item.title}
              required
              maxLength={TITLE_MAX}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-bold text-foreground"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-bold uppercase tracking-wide text-muted">
              Details
            </span>
            {/* Editable in place rather than behind an "edit" toggle: with two
                people there is nobody to lock against, and a toggle is one more
                click between reading a stale brief and fixing it. */}
            <textarea
              name="brief"
              defaultValue={item.brief}
              rows={12}
              maxLength={BRIEF_MAX}
              className="whitespace-pre-wrap break-words rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm text-foreground"
            />
          </label>
          <div>
            <button type="submit" className={SECONDARY_BUTTON}>
              Save details
            </button>
          </div>
        </form>

        <p className="mt-4 text-xs text-muted">
          Added by {item.createdBy} on {stamp(item.createdAt)}
          {item.startedAt && <> · started {stamp(item.startedAt)}</>}
          {item.doneAt && <> · finished {stamp(item.doneAt)}</>}
        </p>
      </Section>

      {/* ---- Status + tags ---------------------------------------------- */}
      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Status">
          {mayMove ? (
            <form action={setStatusAction} className="flex flex-col gap-3">
              <input type="hidden" name="id" value={item.id} />
              <select
                name="status"
                defaultValue={item.status}
                className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
              >
                {TRACKER_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABEL[status]} — {STATUS_HINT[status]}
                  </option>
                ))}
              </select>
              <div>
                <button type="submit" className={SECONDARY_BUTTON}>
                  Move
                </button>
              </div>
            </form>
          ) : (
            /* Read-only, and it SAYS SO. A disabled <select> would look like a
               control that is temporarily unavailable; the point is that this
               field belongs to whoever is building the thing, and the way to
               change it is to ask — or to post an update saying where it
               actually is, which anybody here can do. */
            <div className="flex flex-col gap-2">
              <div>
                <StatusChip status={item.status} />
              </div>
              <p className="text-sm text-muted">
                {STATUS_HINT[item.status]}.
              </p>
              <p className="text-xs text-muted">
                Only the dev moves items between lanes, so the board&rsquo;s
                status always means what it says. Post an update below if this
                one looks wrong.
              </p>
            </div>
          )}
        </Section>

        <Section title="Tags">
          <form action={setTagsAction} className="flex flex-col gap-3">
            <input type="hidden" name="id" value={item.id} />
            {item.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {item.tags.map((tag) => (
                  <TagChip
                    key={tag}
                    tag={tag}
                    href={`/dashboard/tracker?tag=${encodeURIComponent(tag)}`}
                  />
                ))}
              </div>
            )}
            {/* The field carries the FULL set: submitting replaces the tags
                with exactly what is typed, which is why the store converges
                rather than appending. */}
            <input
              name="tags"
              defaultValue={item.tags.join(", ")}
              placeholder="pwa, mobile"
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
            />
            <span className="text-xs text-muted">
              Comma separated, up to {MAX_TAGS_PER_ITEM}. Replaces the current
              tags.
            </span>
            <div>
              <button type="submit" className={SECONDARY_BUTTON}>
                Save tags
              </button>
            </div>
          </form>
        </Section>
      </div>

      {/* ---- Updates ---------------------------------------------------- */}
      <Section
        title="Updates"
        subtitle={updates.length ? `${updates.length}` : undefined}
      >
        {!item.archivedAt && (
          <form action={addUpdateAction} className="mb-4 flex flex-col gap-2">
            <input type="hidden" name="id" value={item.id} />
            <textarea
              name="body"
              rows={3}
              maxLength={UPDATE_BODY_MAX}
              placeholder="Where this actually is…"
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
            />
            <div>
              <button type="submit" className={PRIMARY_BUTTON}>
                Post update
              </button>
            </div>
          </form>
        )}

        {updates.length === 0 ? (
          <p className="text-sm text-muted">
            No updates yet. This is what turns a status chip into something
            somebody can act on.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {updates.map((update) => (
              <li
                key={update.id}
                className="rounded-lg border border-border bg-surface-2/40 p-3"
              >
                <p className="whitespace-pre-wrap break-words text-sm text-foreground">
                  {update.body}
                </p>
                <p className="mt-2 text-xs text-muted">
                  {update.authorEmail} · {stamp(update.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ---- Activity --------------------------------------------------- */}
      <Section title="Activity">
        {events.length === 0 ? (
          <p className="text-sm text-muted">Nothing recorded yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {events.map((event) => (
              <li key={event.id} className="text-xs text-muted">
                <span className="text-foreground">{event.actorEmail}</span>{" "}
                {describe(event.action, event.fromValue, event.toValue)} ·{" "}
                {stamp(event.createdAt)}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ---- Archive ---------------------------------------------------- */}
      {!item.archivedAt && (
        <Section title="Archive">
          <details>
            <summary className="cursor-pointer text-sm font-bold text-muted hover:text-foreground">
              Archive this item
            </summary>
            <p className="mt-3 text-sm text-muted">
              It comes off the board. Nothing is deleted — the brief, the
              updates and the activity trail all stay, and you can restore it
              from this page.
            </p>
            <form action={archiveItemAction} className="mt-3">
              <input type="hidden" name="id" value={item.id} />
              <button type="submit" className={SECONDARY_BUTTON}>
                Yes, archive it
              </button>
            </form>
          </details>
        </Section>
      )}

      {/* ---- Delete for good -------------------------------------------- */}
      {mayDelete && (
        <Section title="Delete permanently">
          <details>
            <summary className="cursor-pointer text-sm font-bold text-rose-700 hover:text-rose-800">
              Delete this item for good
            </summary>
            {/* Says exactly what is lost, in the order it will be missed.
                "Are you sure?" is not a warning — naming the updates is, because
                they are the part that cannot be reconstructed from memory. */}
            <p className="mt-3 text-sm text-muted">
              This cannot be undone. The brief, the tags and all{" "}
              {updates.length === 1 ? "1 update" : `${updates.length} updates`}{" "}
              go with it. Only the activity trail survives, recording that you
              deleted it.
            </p>
            <p className="mt-2 text-sm text-muted">
              Archiving does almost the same thing and can be undone — prefer it
              unless this was pasted in by mistake.
            </p>
            <form action={deleteItemAction} className="mt-3">
              <input type="hidden" name="id" value={item.id} />
              <button
                type="submit"
                className="rounded-full border border-rose-300 bg-rose-50 px-4 py-1.5 text-xs font-extrabold text-rose-800 transition hover:bg-rose-100"
              >
                Yes, delete “{item.title}” for good
              </button>
            </form>
          </details>
        </Section>
      )}
    </div>
  );
}
