/**
 * HallPass — checking a player's answers against the survey they were shown.
 *
 * Pure, so the public route, the tests and any future import share one rule.
 *
 * ── THE QUESTION SET IS THE SOURCE OF TRUTH ────────────────────────────────
 * A submission is `{ [questionId]: value }`, and every key and every value is
 * checked against the survey's CURRENT (non-retired) questions rather than
 * trusted. An id that is not one of them is refused, not ignored: a client
 * holding a stale copy of the form (the admin edited an answered question while
 * the player had the page open) would otherwise have its answers silently
 * dropped and be told it succeeded.
 *
 * ── FREE TEXT GOES THROUGH THE REVIEW VALIDATOR ────────────────────────────
 * Players here are often children, and "what would you change?" is exactly where
 * a phone number or a link gets typed. `validateReviewBody` already refuses
 * contact info, links, keyboard-mashing and blocked words, and a second copy of
 * those rules would drift from the first. It also supplies the 500-character cap.
 *
 * ── REFUSALS NEVER ECHO THE INPUT ───────────────────────────────────────────
 * The message names the QUESTION, not what was typed, so a rejected phone number
 * is not reflected into a response.
 */

import {
  MAX_REVIEW_LENGTH,
  validateReviewBody,
  type ReviewRejection,
} from "@/app/lib/reviews/validate";
import { SCALE_MAX, SCALE_MIN, type QuestionKind, type SurveyOption } from "./config";

/** The slice of a question validation needs. */
export type AnswerableQuestion = {
  id: number;
  kind: QuestionKind;
  prompt: string;
  required: boolean;
  options: SurveyOption[];
};

/** One validated answer, in the shape the store writes. */
export type ValidAnswer = {
  questionId: number;
  choiceIds: string[] | null;
  scale: number | null;
  body: string | null;
};

export type AnswerValidation =
  | { ok: true; answers: ValidAnswer[] }
  | { ok: false; error: string; questionId?: number };

/** Reject an absurdly large submission before decoding any of it. */
export const MAX_ANSWER_KEYS = 64;

const refuse = (error: string, questionId?: number): AnswerValidation => ({
  ok: false,
  error,
  ...(questionId === undefined ? {} : { questionId }),
});

/** Survey wording for each text rejection; the review copy says "reviews". */
const TEXT_REJECTION_MESSAGES: Record<ReviewRejection, string> = {
  empty: "Write something first",
  "too-short": "That's a bit short — say a little more",
  "too-long": `Answers can be at most ${MAX_REVIEW_LENGTH} characters`,
  oversized: "That's far too long",
  links: "Links aren't allowed here",
  "contact-info": "Don't share phone numbers, emails or social handles",
  flooding: "That looks like keyboard mashing",
  "blocked-word": "Keep it friendly — that wording isn't allowed",
};

/** Has the player left this question blank? */
function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * Validate `raw` (untrusted JSON) against the live `questions`.
 *
 * Answers come back in question order, not submission order, so the store's
 * insert is deterministic.
 */
export function validateAnswers(
  questions: readonly AnswerableQuestion[],
  raw: unknown,
): AnswerValidation {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return refuse("Answers must be an object keyed by question id");
  }
  const submitted = raw as Record<string, unknown>;
  const keys = Object.keys(submitted);
  if (keys.length > MAX_ANSWER_KEYS) return refuse("Too many answers");

  const known = new Set(questions.map((q) => String(q.id)));
  const stray = keys.find((key) => !known.has(key));
  if (stray !== undefined) {
    return refuse("This survey has changed — please reload the page and try again");
  }

  const answers: ValidAnswer[] = [];
  for (const question of questions) {
    const value = submitted[String(question.id)];

    if (isBlank(value)) {
      if (question.required) return refuse(`Please answer: ${question.prompt}`, question.id);
      continue;
    }

    switch (question.kind) {
      case "single": {
        if (typeof value !== "string" || !question.options.some((o) => o.id === value)) {
          return refuse(`Pick one of the options for: ${question.prompt}`, question.id);
        }
        answers.push({ questionId: question.id, choiceIds: [value], scale: null, body: null });
        break;
      }
      case "multi": {
        if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
          return refuse(`Pick from the options for: ${question.prompt}`, question.id);
        }
        const ids = [...new Set(value as string[])];
        if (!ids.every((id) => question.options.some((o) => o.id === id))) {
          return refuse(`Pick from the options for: ${question.prompt}`, question.id);
        }
        answers.push({ questionId: question.id, choiceIds: ids, scale: null, body: null });
        break;
      }
      case "scale": {
        if (
          typeof value !== "number" ||
          !Number.isInteger(value) ||
          value < SCALE_MIN ||
          value > SCALE_MAX
        ) {
          return refuse(
            `Choose ${SCALE_MIN} to ${SCALE_MAX} for: ${question.prompt}`,
            question.id,
          );
        }
        answers.push({ questionId: question.id, choiceIds: null, scale: value, body: null });
        break;
      }
      case "text": {
        const checked = validateReviewBody(value);
        if (!checked.ok) {
          return refuse(
            `${TEXT_REJECTION_MESSAGES[checked.reason]} (${question.prompt})`,
            question.id,
          );
        }
        answers.push({ questionId: question.id, choiceIds: null, scale: null, body: checked.body });
        break;
      }
    }
  }

  return { ok: true, answers };
}
