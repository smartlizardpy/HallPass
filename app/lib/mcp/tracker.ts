/**
 * HallPass — what the MCP's tracker tools actually do.
 *
 * The SERVER-ONLY sibling of `bugs.ts`, and built to the same rule: it adds no
 * SQL of its own. Every call below is a `tracker/store.ts` method the dashboard
 * already calls, in the same order and with the same decoding of its answer.
 * That store was written around a constraint — the `neon()` driver is one
 * stateless request per tagged template, so every mutation is a single
 * multi-CTE statement that changes the row AND writes its event — and the way
 * to keep that property is to call it rather than to write it out again.
 *
 * ── WHY A MACHINE MAY MOVE A LANE ──────────────────────────────────────────
 * `tracker/config.ts` restricts status to `super_admin`, and its docblock gives
 * the reason: "the STATUS is a claim about the work itself … and only the
 * person actually building it can make that claim truthfully". Read carefully
 * that is a rule about KNOWLEDGE rather than about roles — a plain admin is
 * refused because they would be guessing, not because they are less trusted.
 *
 * The agent holding `MCP_SECRET` is the party doing the work and the only one
 * that knows at the moment it starts. So this is the first caller that argument
 * fully describes, not an exception to it. `tracker-mcp-design.md` §2 is the
 * long version.
 *
 * `canMoveStatus` is deliberately NOT widened to admit it. That function
 * answers a question about a dashboard role, and this server has no role; the
 * authority here is holding the secret, which `server.ts` checks before any of
 * this is reachable. Putting a machine into a ladder built for people would
 * leave the next reader of that function working out which of two systems it
 * describes.
 *
 * ── THE LIVE STORE, NOT THE FAIL-SOFT WRAPPERS ─────────────────────────────
 * `tracker/index.ts` exports both, and the choice matters here. Its reads
 * degrade a missing schema to `[]` so a dashboard page can render a notice
 * instead of a 500 — and an agent handed an empty board would paste duplicates
 * of everything already on it. So this module uses `tracker` directly and lets
 * the error reach the tool, which is the split that module's own header draws
 * for writes.
 *
 * ── EVERY WRITE REPORTS REFUSAL AS REFUSAL ─────────────────────────────────
 * The store answers `null`/`false` rather than throwing when a guard failed —
 * no such item, or it is archived. `bugs.ts` makes the point that an agent
 * handed "ok" for a write that did nothing will confidently tell you a thing is
 * done when it is not, and the same distinction is drawn here. The one
 * exception is moving an item to the lane it is already in: the store treats
 * that as a no-op ON PURPOSE, so it is reported as success with a message that
 * says nothing changed. An agent told "refused" would retry it.
 */

import "server-only";
import { revalidatePath } from "next/cache";
import { tracker } from "@/app/lib/tracker";
import {
  BRIEF_MAX,
  STATUS_LABEL,
  TITLE_MAX,
  UPDATE_BODY_MAX,
  parseTags,
  type TrackerStatus,
} from "@/app/lib/tracker/config";
import type { WriteResult } from "./bugs";
import { TRACKER_BOARD_PATH, clampTrackerLimit, mcpActor } from "./config";

/**
 * The refusal half of every result here.
 *
 * Typed as the refusal branch alone rather than as `WriteResult`, so it is
 * assignable to {@link CreateResult} too — a helper narrowed to one union
 * cannot be shared by two.
 */
const refuse = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

/**
 * How many comments `get_tracker_item` returns with an item.
 *
 * The thread is append-only and an item worked over several sessions can hold
 * dozens; the newest are the ones that say where the work is. The item's own
 * `commentCount` tells the agent how many it is not seeing, which is the thing
 * a silent truncation would hide.
 */
const COMMENT_DEPTH = 20;

/** A card, as the list tool answers. No `brief` — see {@link listTrackerItems}. */
export type TrackerItemSummary = {
  id: number;
  title: string;
  status: TrackerStatus;
  tags: string[];
  commentCount: number;
  lastCommentAt: string | null;
  createdBy: string;
  updatedAt: string;
};

export type TrackerComment = {
  author: string;
  body: string;
  createdAt: string;
};

/** One item in full, as the detail tool answers. */
export type TrackerItemDetail = TrackerItemSummary & {
  brief: string;
  createdAt: string;
  startedAt: string | null;
  doneAt: string | null;
  archived: boolean;
  comments: TrackerComment[];
};

export type CreateResult =
  | { ok: true; itemId: number; message: string }
  | { ok: false; reason: string };

/** The board, and the item pages under it. */
function revalidateTracker(itemId?: number): void {
  revalidatePath(TRACKER_BOARD_PATH);
  if (itemId) revalidatePath(`${TRACKER_BOARD_PATH}/${itemId}`);
}

/**
 * The board, newest lanes first, optionally narrowed.
 *
 * THE FILTERS ARE APPLIED IN JS, exactly as the board page applies its tag
 * filter, and for the reason `tracker/store.ts` documents at length: the
 * `neon()` tagged template parameterises values and does not reliably splice
 * fragments, so a dynamic WHERE would mean a combinatorial set of hand-written
 * templates for a table of tens to low hundreds of rows. `listBoard()` is one
 * round trip and returns them all.
 *
 * NO BRIEF. `brief` runs to 20 000 characters and `listBoard()` does not even
 * select it — a list call that carried briefs would spend a hundred thousand
 * tokens answering "what is on the board". `get_tracker_item` is the detail
 * call, the same split the bug tools draw.
 *
 * Archived items are absent, because `listBoard()` filters them out. That is
 * the right default and it is not configurable here: an archived item is one
 * somebody took off the board, and offering an agent a switch to put it back in
 * view is offering it a way to work on something that was cancelled.
 */
export async function listTrackerItems(filters: {
  status?: TrackerStatus;
  tag?: string;
  limit?: number;
}): Promise<{ items: TrackerItemSummary[]; total: number }> {
  const board = await tracker.listBoard();
  const tag = filters.tag?.trim().toLowerCase();

  const matched = board.filter((card) => {
    if (filters.status && card.status !== filters.status) return false;
    if (tag && !card.tags.includes(tag)) return false;
    return true;
  });

  return {
    items: matched.slice(0, clampTrackerLimit(filters.limit)).map((card) => ({
      id: card.id,
      title: card.title,
      status: card.status,
      tags: card.tags,
      commentCount: card.updateCount,
      lastCommentAt: card.lastUpdateAt,
      createdBy: card.createdBy,
      updatedAt: card.updatedAt,
    })),
    // What matched, not what was returned. An agent that asked for five and got
    // five has no way to tell whether there were six without this.
    total: matched.length,
  };
}

/**
 * One item in full, with the newest of its comment thread, or `null`.
 *
 * The BRIEF is the point of this call — it is what somebody pasted in when they
 * asked for the thing, and it is the specification. The comments are the other
 * half: they are where "tried X, it does not work because Y" lives, and an
 * agent that read only the brief would redo whatever the last session
 * abandoned.
 *
 * The activity trail (`tracker_events`) is deliberately NOT returned. It is an
 * audit of who changed what, for a human looking at a screen after something
 * went wrong; returning it would double the tokens to say the same things
 * twice.
 *
 * Two round trips rather than one, which is what the dashboard's own item page
 * does. A joined read would be a new query in a tested store, and this module's
 * first rule is that it adds none.
 */
export async function getTrackerItem(itemId: number): Promise<TrackerItemDetail | null> {
  const item = await tracker.getItem(itemId);
  if (!item) return null;

  const comments = await tracker.listUpdates(itemId);

  return {
    id: item.id,
    title: item.title,
    status: item.status,
    tags: item.tags,
    brief: item.brief,
    commentCount: item.updateCount,
    lastCommentAt: item.lastUpdateAt,
    createdBy: item.createdBy,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    startedAt: item.startedAt,
    doneAt: item.doneAt,
    // A boolean rather than the timestamp: what an agent has to decide is
    // whether to work on this at all, and "archived on the 3rd" invites it to
    // weigh a date it has no way to judge.
    archived: item.archivedAt != null,
    comments: comments.slice(0, COMMENT_DEPTH).map((comment) => ({
      author: comment.authorEmail,
      body: comment.body,
      createdAt: comment.createdAt,
    })),
  };
}

/**
 * Move an item to another lane.
 *
 * The store stamps `started_at` the first time an item reaches `building` and
 * never re-stamps it, and sets or CLEARS `done_at` on every move in and out of
 * a terminal lane, because `tracker_items_done_at_matches_status` makes that
 * mandatory rather than optional. None of that is repeated here — it is in the
 * one statement `setStatus` sends.
 *
 * `null` means there was no live item to move: it does not exist, or it is
 * archived. Those two are reported as one refusal because they are one answer
 * to the agent — there is nothing there to move — and distinguishing them would
 * mean a second read to say so.
 */
export async function moveTrackerItem(input: {
  itemId: number;
  status: TrackerStatus;
}): Promise<WriteResult> {
  const result = await tracker.setStatus(input.itemId, input.status, mcpActor());
  if (result === null) {
    return refuse(
      `Tracker item ${input.itemId} does not exist, or it has been archived off the board.`,
    );
  }

  revalidateTracker(input.itemId);

  const to = STATUS_LABEL[input.status];
  return {
    ok: true,
    message: result.changed
      ? `Moved tracker item ${input.itemId} from ${STATUS_LABEL[result.from as TrackerStatus] ?? result.from} to ${to}.`
      : `Tracker item ${input.itemId} was already in ${to}; nothing changed.`,
  };
}

/**
 * Post a comment to an item's thread.
 *
 * THIS IS NOT A LOG LINE, and the distinction is the whole reason this tool
 * exists separately from `log_agent_activity`. A log line is for whoever is
 * watching right now and is deleted when the run ends; a comment is for
 * whoever opens the item next week and is kept forever, beside the comments
 * humans wrote. `tracker-mcp-design.md` opens with the table.
 *
 * The author is `mcpActor()`, the same string a machine's decision writes to
 * the XP ledger, so the thread can say which notes came from an agent — which
 * `/dashboard/tracker/[id]` does, by matching on this same function.
 *
 * The body is trimmed and capped to the column's CHECK rather than left to fail
 * at the database: a model that wrote one character too many should be told
 * what was recorded, not handed a constraint violation.
 */
export async function commentOnTrackerItem(input: {
  itemId: number;
  body: string;
}): Promise<WriteResult> {
  const body = input.body.trim().slice(0, UPDATE_BODY_MAX);
  if (!body) return refuse("A comment cannot be empty.");

  const commentId = await tracker.addUpdate(input.itemId, body, mcpActor());
  if (commentId === null) {
    return refuse(
      `Tracker item ${input.itemId} does not exist, or it has been archived off the board.`,
    );
  }

  revalidateTracker(input.itemId);
  return {
    ok: true,
    message: `Posted a comment on tracker item ${input.itemId}. It is on the item page for good, not in the activity feed.`,
  };
}

/**
 * Paste a new item onto the board.
 *
 * It lands in `new`, the column default, which is the lane a human triages —
 * an agent filing follow-up work should be proposing it, not scheduling it.
 *
 * Tags go through `parseTags`, the same normaliser the composer uses, so
 * "Needs Art" becomes `needs-art` and an unusable fragment is DROPPED rather
 * than failing the write. Losing a stray tag must never cost the brief it came
 * with — the composer's reasoning, and it applies harder to a caller that
 * cannot see the form.
 *
 * A title is required because the CHECK requires one and because a board of
 * untitled cards is not a board.
 */
export async function createTrackerItem(input: {
  title: string;
  brief?: string;
  tags?: string[];
}): Promise<CreateResult> {
  const title = input.title.trim().slice(0, TITLE_MAX);
  if (!title) return refuse("An item needs a title.");

  const brief = (input.brief ?? "").slice(0, BRIEF_MAX);
  const tags = parseTags((input.tags ?? []).join(","));

  const itemId = await tracker.createItem({ title, brief, tags, actor: mcpActor() });
  // `createItem` returns the new id from its own INSERT, so a null here is not
  // "somebody got there first" — it is a write that did not happen, and saying
  // so plainly beats inventing a reason.
  if (itemId === null) return refuse("The item could not be created.");

  revalidateTracker(itemId);
  return {
    ok: true,
    itemId,
    message: `Added tracker item ${itemId} — “${title}” — to the New lane for review.`,
  };
}
