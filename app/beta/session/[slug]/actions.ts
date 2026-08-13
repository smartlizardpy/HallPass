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

import { revalidatePath, updateTag } from "next/cache";
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
import { findGame } from "@/app/lib/games";
import { bugReportCopy } from "@/app/lib/notifications/copy";
import { notifyAdmins } from "@/app/lib/notifications/deliver";
import {
  extensionForType,
  validateEvidenceUpload,
  validateMediaUpload,
  type EvidenceRejection,
  type ImageType,
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

/**
 * The same, for a picture attached to a report.
 *
 * Separate copy as well as a separate policy, because these reach a different
 * person in a different situation: a gallery rejection is about a capture this
 * app produced, so it apologises for itself, while an evidence rejection is
 * about a file the TESTER picked and has to tell them what to do instead.
 */
const EVIDENCE_REJECTION_COPY: Record<EvidenceRejection, string> = {
  empty: "the file was empty",
  "too-large": "it was over the 4 MB limit",
  "not-an-image": "it wasn't a PNG, JPEG or WebP",
  "too-small": "it was too small to show anything",
};

/**
 * Ceilings on everything the browser reports about a clip or an error log.
 *
 * All of these arrive from client code that the tester's own devtools can edit,
 * so every one is re-clamped server-side even though the capture modules already
 * bound them. The numbers are generous versions of what the client produces.
 */
const MAX_CLIP_BYTES = 25 * 1024 * 1024;
const MAX_CLIP_MS = 120_000;
const MAX_ERROR_ENTRIES = 100;
const MAX_ERROR_LOG_CHARS = 60_000;

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
export async function submitReportAction(
  input: {
    slug: string;
    kind: string;
    severity: string | null;
    title: string;
    body: string;
    device?: string;
    /**
     * A replay clip already uploaded by the browser, straight to Blob storage.
     *
     * The client uploads it (see `api/v1/beta/clip-token`) and reports the
     * result here, because a 30-second clip exceeds the 4.5 MB request-body cap
     * a Server Action is subject to. The player is still re-derived from the
     * SESSION below, so a forged path can only ever attach a clip to the
     * forger's own report.
     */
    clipBlobPath?: string | null;
    clipUrl?: string | null;
    clipBytes?: number;
    clipMs?: number;
    /** The game's own errors, already capped and serialised by the client. */
    errorLog?: string | null;
    errorCount?: number;
  },
  /**
   * An optional screenshot pinned to the report, picked from the session's
   * automatic grabs.
   *
   * Passed as a separate `FormData` rather than folded into `input`: a Server
   * Action can carry a `File` in FormData but not inside a plain serialised
   * object, and keeping the text fields typed is worth the second argument.
   */
  shot?: FormData,
): Promise<ActionResult> {
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

  /**
   * Why the attached picture did not make it, if it did not.
   *
   * The report is still filed without it — but SILENTLY dropping it was the
   * original bug here, not the rejection. The tester chose that file on purpose,
   * and a success message that does not mention its absence teaches them that
   * attaching pictures works when it did not.
   */
  let imageProblem: string | null = null;

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

    // Evidence is stored BEFORE the row, so a failed upload never leaves a
    // report claiming a screenshot that does not exist. A failed upload is not
    // fatal to the report either — the words are the point, the picture is
    // supporting material — so it degrades to a report with no image rather
    // than losing what the tester typed.
    //
    // THE PUT HAS ITS OWN `try`, and that is not decoration. Everything below is
    // inside one catch that answers "could not save that", so a blob outage —
    // or a school wifi dropping a 2 MB upload — used to take the tester's words
    // down with it. The failure that this whole path is designed to survive was
    // the one that was fatal.
    let shotBlobPath: string | null = null;
    let shotUrl: string | null = null;
    const file = shot?.get("file");
    if (file instanceof File && file.size > 0) {
      try {
        const stored = await uploadEvidence(input.slug, file);
        if (stored.ok) {
          shotBlobPath = stored.blobPath;
          shotUrl = stored.blobUrl;
        } else {
          imageProblem = stored.error;
        }
      } catch (error) {
        console.error("beta report screenshot upload failed:", error);
        imageProblem = "the upload didn't go through";
      }
    }

    // A clip path must live under this report's own game. The token route
    // enforced it when minting, and this enforces it again at write time — the
    // two together mean neither a stolen token nor a hand-rolled call can point
    // a report at somebody else's object.
    const clipPath =
      typeof input.clipBlobPath === "string" &&
      input.clipBlobPath.startsWith(`beta-clips/${input.slug}/`)
        ? input.clipBlobPath
        : null;

    // The client already caps this, but it is client input: re-cap so a crafted
    // call cannot write an unbounded blob of text into the row.
    const errors =
      typeof input.errorLog === "string" && input.errorLog.length > 0
        ? input.errorLog.slice(0, MAX_ERROR_LOG_CHARS)
        : null;

    await beta.createReport({
      playerId,
      assignmentId: assignment?.id ?? null,
      slug: input.slug,
      kind,
      severity,
      title,
      body,
      device: String(input.device ?? "").slice(0, 200),
      shotBlobPath,
      shotUrl,
      // Belt and braces on a client-supplied path: the token route already
      // pinned the prefix, but nothing here should trust a string from a
      // browser to name a blob.
      clipBlobPath: clipPath,
      // Only kept when the path validated — a URL without a matching path
      // would let a crafted call point playback at an arbitrary host.
      clipUrl: clipPath ? (input.clipUrl ?? null) : null,
      clipBytes: Math.max(0, Math.min(MAX_CLIP_BYTES, Math.floor(input.clipBytes ?? 0))),
      clipMs: Math.max(0, Math.min(MAX_CLIP_MS, Math.floor(input.clipMs ?? 0))),
      errorLog: errors,
      errorCount: Math.max(0, Math.min(MAX_ERROR_ENTRIES, Math.floor(input.errorCount ?? 0))),
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

  // Tell the admins there is something in the triage queue.
  //
  // OUTSIDE the try above, deliberately. In there it would sit between the
  // report write and the `catch` that reports failure to the tester, so a
  // notification problem would tell somebody their report was not saved when it
  // was — and they would file it again. `notifyAdmins` does not reject, but the
  // placement should not depend on that.
  //
  // NO DEDUPE KEY. Every report is a distinct finding, including several against
  // the same game in one session, and that is what a tester is being paid XP to
  // produce. The bell defaults to bell-only for this kind precisely because the
  // volume is expected.
  //
  // The report's own title is NOT used as the notification body: it is free text
  // a tester typed, and this is the same lock-screen argument the review kinds
  // make. The queue is where the words belong.
  await notifyAdmins({
    kind: "bug_report_filed",
    copy: bugReportCopy({ gameTitle: findGame(input.slug)?.title ?? input.slug }),
    dedupeKey: null,
  });

  revalidatePath("/beta");
  revalidatePath("/dashboard/beta");
  return {
    ok: true,
    message: imageProblem
      ? `Report filed, but your picture didn't attach — ${imageProblem}.`
      : "Report filed — thanks!",
  };
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
/**
 * Validate and store one captured still, returning its blob key and URL.
 *
 * Shared by the gallery submission and the bug-report attachment so both apply
 * the same magic-byte sniffing and the same size/dimension policy. Returns a
 * reason rather than throwing, because both callers turn it into UI copy.
 */
async function uploadShot(
  slug: string,
  file: File,
): Promise<
  | { ok: true; blobPath: string; blobUrl: string; meta: { type: ImageType; width: number; height: number }; bytes: number }
  | { ok: false; error: string }
> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = validateMediaUpload(bytes);
  if (!check.ok) return { ok: false, error: SHOT_REJECTION_COPY[check.reason] };

  const stored = await putImage(slug, file, check.meta.type);
  return { ok: true, ...stored, meta: check.meta, bytes: check.bytes };
}

/**
 * Validate and store one image attached to a REPORT.
 *
 * Deliberately not `uploadShot`. That one applies the gallery's policy — 640px
 * of width, a landscape aspect — which is right for a picture destined for a
 * game's page and wrong for a picture of a bug: a portrait phone screenshot is
 * the normal shape here, and the shared function refused it, which is how a
 * tester on iOS ended up with no way to show anybody anything. See
 * `validateEvidenceUpload` and `mobile-capture.md`.
 */
async function uploadEvidence(
  slug: string,
  file: File,
): Promise<{ ok: true; blobPath: string; blobUrl: string } | { ok: false; error: string }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = validateEvidenceUpload(bytes);
  if (!check.ok) return { ok: false, error: EVIDENCE_REJECTION_COPY[check.reason] };

  const stored = await putImage(slug, file, check.meta.type);
  return { ok: true, ...stored };
}

/**
 * Put an already-validated image in the blob store under `beta-shots/`.
 *
 * NEVER under `games/`: seven separate behaviours sweep that prefix — blob
 * deletes, `sync-games.mjs` mirroring into the repo, the SW precache — and are
 * enumerated in `app/lib/game-media.sql`.
 *
 * The `File` is uploaded, not the `Uint8Array` that was validated — `put` takes a
 * stream-like body and the two are the same bytes. The content type is the
 * SNIFFED one, never `file.type`, so a mislabelled upload is stored under what it
 * actually is. Same reasoning as `media-actions.ts`.
 */
async function putImage(
  slug: string,
  file: File,
  type: ImageType,
): Promise<{ blobPath: string; blobUrl: string }> {
  const blobPath = `beta-shots/${slug}/${newId()}.${extensionForType(type)}`;
  const uploaded = await put(blobPath, file, {
    access: "public",
    contentType: type,
    addRandomSuffix: false,
    allowOverwrite: false,
    cacheControlMaxAge: 31_536_000,
  });
  return { blobPath, blobUrl: uploaded.url };
}

export async function submitShotAction(formData: FormData): Promise<ActionResult> {
  const { playerId } = await requireBetaTester();

  const slug = String(formData.get("slug") ?? "");
  if (!(await isResolvedSlug(slug))) return { ok: false, error: "Unknown game" };

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No image" };

  try {
    const recent = await beta.recentShotCount(playerId, SHOT_RATE_LIMIT.windowSeconds);
    if (recent >= SHOT_RATE_LIMIT.maxPerWindow) {
      return { ok: false, error: "That's plenty of screenshots for now" };
    }

    const stored = await uploadShot(slug, file);
    if (!stored.ok) return stored;

    await beta.createShot({
      id: stored.blobPath.split("/").pop()!.replace(/\.[^.]+$/, ""),
      playerId,
      slug,
      blobPath: stored.blobPath,
      blobUrl: stored.blobUrl,
      contentType: stored.meta.type,
      width: stored.meta.width,
      height: stored.meta.height,
      bytes: stored.bytes,
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
  updateTag(BETA_CREDITS_CACHE_TAG);
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
