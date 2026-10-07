/**
 * Answer a survey — `POST /api/v1/surveys/[slug]/respond`.
 *
 * A ROUTE HANDLER, not a server action, for the reason
 * `games/[slug]/reviews/route.ts` gives: a survey answer is a public write by a
 * player with no dashboard role, and every player-scoped write here is a route
 * handler while every server action is admin-only and `requireRole`-gated.
 *
 * Body: `{ "answers": { "<questionId>": value } }`, where value is an option id
 * (single), an array of option ids (multi), an integer 1-5 (scale) or a string
 * (text). Unanswered optional questions are simply absent.
 *
 * THE ORDER OF THE CHECKS IS THE ORDER OF THEIR COST. Signed in and trusted
 * origin first (no I/O), then body size and JSON, then ONE read of the live
 * survey, then validation against its questions, then the single write. A guest or
 * a forged origin never reaches the database.
 *
 * ONE ANSWER PER PLAYER IS THE DATABASE'S RULE, not this route's.
 * `UNIQUE (survey_id, player_id)` decides a double submit, so two tabs racing
 * resolve to one `ok` and one `duplicate` however the requests interleave. The
 * `answered` flag read below only saves a validation pass on the obvious repeat.
 *
 * NO PER-IP RATE LIMIT, deliberately unlike reviews. A review can be rewritten
 * and so can be spammed; a survey answer is written once per account, so the
 * write volume is bounded by the number of signed-in players. Free text still
 * goes through the same contact-info, link and blocked-word checks as a review.
 *
 * Responses never echo what was submitted. A refusal names the QUESTION.
 */

import { isMissingColumnError } from "@/app/lib/db";
import { getPublicSurvey, surveys } from "@/app/lib/surveys";
import { validateAnswers } from "@/app/lib/surveys/validate";
import {
  NO_STORE,
  credentialedOptions,
  currentPlayerId,
  forbidden,
  isTrustedOrigin,
  unauthorized,
} from "@/app/lib/social/request-guard";

/** A full survey of 30 long free-text answers is well under this. */
const MAX_BODY_BYTES = 32 * 1024;

const fail = (reason: string, status: number, extra: Record<string, unknown> = {}) =>
  Response.json({ ok: false, reason, ...extra }, { status, headers: NO_STORE });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const playerId = await currentPlayerId();
  if (!playerId) return unauthorized();
  if (!isTrustedOrigin(req)) return forbidden();

  let raw: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return fail("That's far too long", 413);
    raw = (JSON.parse(text) as { answers?: unknown } | null)?.answers;
  } catch {
    return fail("Bad request", 400);
  }

  try {
    const survey = await getPublicSurvey(slug, playerId);
    // Draft, closed, archived, expired and unknown all answer the same way.
    if (!survey) return fail("This survey isn't open", 404);
    if (survey.answered) return fail("You've already answered this one", 409);

    const checked = validateAnswers(survey.questions, raw);
    if (!checked.ok) {
      return fail(checked.error, 400, checked.questionId ? { questionId: checked.questionId } : {});
    }
    if (checked.answers.length === 0) return fail("Answer at least one question", 400);

    const outcome = await surveys.submitResponse({
      surveyId: survey.id,
      playerId,
      answers: checked.answers,
    });

    switch (outcome) {
      case "ok":
        return Response.json({ ok: true }, { headers: NO_STORE });
      case "duplicate":
        return fail("You've already answered this one", 409);
      case "stale":
        return fail("This survey has changed — please reload the page and try again", 409);
      case "closed":
        return fail("This survey isn't open", 404);
    }
  } catch (error) {
    if (isMissingColumnError(error)) return fail("Surveys aren't switched on yet", 503);
    console.error("survey respond failed:", error);
    return fail("Could not save your answers", 500);
  }
}

export function OPTIONS(): Response {
  return credentialedOptions("POST, OPTIONS");
}
