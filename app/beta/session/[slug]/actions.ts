"use server";

/**
 * HallPass — beta test session write actions.
 *
 * Called imperatively from the session client island rather than through a
 * `<form action>`, so unlike the dashboard actions these RETURN a result object
 * instead of redirecting. That is a deliberate deviation from `users/actions.ts`:
 * the tester is mid-playtest inside a running game, and a redirect would tear
 * down the iframe — losing their progress to tell them a title was too short.
 *
 * Everything else follows the house rules: the actor is derived from the SESSION
 * and never from an argument, input is narrowed from `unknown`, and the store
 * write is the only thing inside a try.
 *
 * RATE LIMITS ARE PER PLAYER, NEVER PER IP. A school NATs its whole network to
 * one address, so an IP limit tight enough to matter would take out a computing
 * lab mid-session. Repeated across `reviews/config.ts` and `achievements/config.ts`
 * as the most common footgun in this codebase.
 */

import { revalidatePath, revalidateTag } from "next/cache";
import { put } from "@vercel/blob";
import {
  beta,
  requireBetaTester,
  BETA_CREDITS_CACHE_TAG,
} from "@/app/lib/beta";
import { reviews } from "@/app/lib/reviews";
import {
  REPORT_BODY_MAX,
  REPORT_BODY_MIN,
  REPORT_RATE_LIMIT,
  REPORT_TITLE_MAX,
  SHOT_RATE_LIMIT,
  toBugSeverity,
  toReportKind,
} from "@/app/lib/beta/config";
import { isResolvedSlug } from "@/app/lib/games-store";
import {
  validateMediaUpload,
  type MediaRejection,
} from "@/app/lib/image-meta";

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

/** Human copy for each rejection, so no reason code reaches a tester. */
const SHOT_REJECTION_COPY: Record<MediaRejection, string> = {
  empty: "That image was empty.",
  "too-large": "That image is too big — 4 MB is the limit.",
  "not-an-image": "That file isn't a PNG, JPEG or WebP.",
  "too-narrow": "Something went wrong capturing that one — try another.",
  "bad-aspect": "Something went wrong capturing that one — try another.",
};

/** Random, URL-safe, and matching the `^[a-z0-9][a-z0-9-]*$` CHECK on ids. */
function newId(): string {
  return `s${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

/**
 * File a bug or feature request against a game.
 *
 * The tester's own severity is recorded as their assessment; triage may
 * override it, and only triage decides what it pays. A feature carries no
 * severity at all — the database CHECK enforces that, so it is normalised here
 * rather than passed through and allowed to 500.
 */
export async function submitReportAction(input: {
  slug: string;
  kind: string;
  severity: string | null;
  title: string;
  body: string;
  device?: string;
}): Promise<ActionResult> {
  const { playerId } = await requireBetaTester();

  if (!(await isResolvedSlug(input.slug))) {
    return { ok: false, error: "Unknown game" };
  }

  const kind = toReportKind(input.kind);
  if (!kind) return { ok: false, error: "Pick bug or idea" };

  const title = String(input.title ?? "").trim().slice(0, REPORT_TITLE_MAX);
  if (!title) return { ok: false, error: "Give it a short title" };

  const body = String(input.body ?? "").trim().slice(0, REPORT_BODY_MAX);
  if (body.length < REPORT_BODY_MIN) {
    return {
      ok: false,
      error: `Describe it in at least ${REPORT_BODY_MIN} characters`,
    };
  }

  // A bug must carry a severity and a feature must not.
  const severity = kind === "bug" ? (toBugSeverity(input.severity) ?? "minor") : null;

  try {
    const recent = await beta.recentReportCount(
      playerId,
      REPORT_RATE_LIMIT.windowSeconds,
    );
    if (recent >= REPORT_RATE_LIMIT.maxPerWindow) {
      return { ok: false, error: "Slow down a moment — try again shortly" };
    }

    // Attach to the tester's assignment for this game when they have one, so the
    // report shows up against the work it came from.
    const assignment = (await beta.assignmentsFor(playerId)).find(
      (a) => a.slug === input.slug,
    );

    await beta.createReport({
      playerId,
      assignmentId: assignment?.id ?? null,
      slug: input.slug,
      kind,
      severity,
      title,
      body,
      device: String(input.device ?? "").slice(0, 200),
    });

    // Opening a report means they are actively testing; reflect that in the
    // queue rather than leaving it reading "To do" forever.
    if (assignment && assignment.status === "assigned") {
      await beta.setAssignmentStatus(assignment.id, "in_progress");
    }
  } catch (error) {
    console.error("beta submitReport failed:", error);
    return { ok: false, error: "Could not save that — try again" };
  }

  revalidatePath("/beta");
  revalidatePath("/dashboard/beta");
  return { ok: true, message: "Report filed — thanks!" };
}

/**
 * Submit a captured gameplay still for review.
 *
 * The bytes are validated by the SAME `validateMediaUpload` the dashboard's own
 * gallery upload uses — magic-byte sniffed, never trusting `file.type`, with the
 * identical size, dimension and aspect policy. An accepted shot is later copied
 * into `game_media`, so anything that would be rejected there has to be rejected
 * here or acceptance would fail at the last step.
 *
 * Stored under `beta-shots/`. NEVER under `games/`: seven separate behaviours
 * sweep that prefix — blob deletes, `sync-games.mjs` mirroring into the repo,
 * the SW precache — and are enumerated in `app/lib/game-media.sql`.
 */
export async function submitShotAction(formData: FormData): Promise<ActionResult> {
  const { playerId } = await requireBetaTester();

  const slug = String(formData.get("slug") ?? "");
  if (!(await isResolvedSlug(slug))) return { ok: false, error: "Unknown game" };

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No image" };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = validateMediaUpload(bytes);
  if (!check.ok) {
    // Never surface the raw reason code. Auto-captured stills are pinned to
    // 16:9 at a fixed width precisely so `bad-aspect` and `too-narrow` cannot
    // happen — if one of those appears here it is a bug in the grabber, not
    // something the tester did or can fix, and the copy should not imply
    // otherwise.
    return { ok: false, error: SHOT_REJECTION_COPY[check.reason] };
  }

  try {
    const recent = await beta.recentShotCount(playerId, SHOT_RATE_LIMIT.windowSeconds);
    if (recent >= SHOT_RATE_LIMIT.maxPerWindow) {
      return { ok: false, error: "That's plenty of screenshots for now" };
    }

    const id = newId();
    const ext = check.meta.type === "image/png" ? "png" : check.meta.type === "image/jpeg" ? "jpg" : "webp";
    const blobPath = `beta-shots/${slug}/${id}.${ext}`;

    // The `File` is uploaded, not the `Uint8Array` we validated — `put` takes a
    // stream-like body and the two are the same bytes. The content type is the
    // SNIFFED one, never `file.type`, so a mislabelled upload is stored under
    // what it actually is. Same reasoning as `media-actions.ts`.
    const uploaded = await put(blobPath, file, {
      access: "public",
      contentType: check.meta.type,
      addRandomSuffix: false,
      allowOverwrite: false,
      cacheControlMaxAge: 31_536_000,
    });

    await beta.createShot({
      id,
      playerId,
      slug,
      blobPath,
      blobUrl: uploaded.url,
      contentType: check.meta.type,
      width: check.meta.width,
      height: check.meta.height,
      bytes: check.bytes,
      kind: "screenshot",
    });
  } catch (error) {
    console.error("beta submitShot failed:", error);
    return { ok: false, error: "Upload failed — try again" };
  }

  revalidatePath("/dashboard/beta");
  return { ok: true, message: "Sent for review" };
}

/**
 * Mark an assignment finished.
 *
 * A REVIEW IS REQUIRED, not encouraged. The whole point of assigning a game is
 * to get a verdict on it, and a playtest that produced no bugs currently
 * produces no output at all — the tester plays for twenty minutes, finds nothing
 * wrong, and the programme learns nothing. Requiring the review means "it works
 * fine" is a recorded result rather than silence.
 *
 * It is also what the credit on the game page rests on: `completedTesters()`
 * publishes the names of everyone who finished, so finishing has to mean
 * something more than pressing a button.
 *
 * The check is against the reviews store rather than a flag of our own, so a
 * review written earlier from the game page counts — a tester who already
 * reviewed a game they are later assigned should not have to write a second one.
 */
export async function finishAssignmentAction(slug: string): Promise<ActionResult> {
  const { playerId } = await requireBetaTester();

  try {
    const assignment = (await beta.assignmentsFor(playerId)).find(
      (a) => a.slug === slug,
    );
    if (!assignment) return { ok: false, error: "No assignment for this game" };

    const review = await reviews.ownReview(slug, playerId);
    if (!review) {
      return {
        ok: false,
        error: "Write your review of this game first — that's the point of the playtest",
      };
    }

    await beta.setAssignmentStatus(assignment.id, "submitted");
  } catch (error) {
    console.error("beta finishAssignment failed:", error);
    return { ok: false, error: "Could not update that" };
  }

  revalidatePath("/beta");
  revalidatePath("/dashboard/beta");
  // The game page credits everyone who has finished; this is the moment that
  // list changes.
  revalidateTag(BETA_CREDITS_CACHE_TAG, { expire: 0 });
  revalidatePath(`/game/${slug}`);
  return { ok: true, message: "Marked as done — thanks!" };
}

/**
 * Whether the tester has already reviewed this game.
 *
 * Read by the session screen so the "Done" button can explain itself BEFORE it
 * is pressed, rather than refusing after. Fail-soft to `false`: the worst case
 * is showing the review prompt to someone who has already written one, and
 * `finishAssignmentAction` re-checks authoritatively anyway.
 */
export async function hasReviewedAction(slug: string): Promise<boolean> {
  const { playerId } = await requireBetaTester();
  try {
    return (await reviews.ownReview(slug, playerId)) != null;
  } catch {
    return false;
  }
}
