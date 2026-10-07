/**
 * HallPass dashboard — one survey: its status, details and questions.
 *
 * EVERY MUTATION IS ITS OWN `<form>` posting to a server action, with no client
 * component, matching the tracker's detail page. The consequence for the
 * question builder is that the options box is always shown and labelled "only
 * for choice questions", because swapping it in and out on the kind `<select>`
 * would need JavaScript this screen otherwise has no use for.
 *
 * AN ANSWERED QUESTION SAYS SO. When a question already has answers the editor
 * tells the admin, before they save, that the change will be stored as a new
 * question and the existing answers will stay under the old wording. The store
 * does that (`updateQuestion`); the page's job is that nobody is surprised by it.
 *
 * REMOVED AND REPLACED QUESTIONS ARE LISTED, COLLAPSED, at the bottom. They are
 * not editable, but their answers are real and the results page still reports
 * them, so hiding that they exist would make the response counts look wrong.
 *
 * ARCHIVING IS TWO-STEP in a `<details>` disclosure rather than a native
 * `confirm()`, following the tracker and moderation screens. An archived survey
 * stays reachable by URL with its results and loses its edit controls.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/app/lib/auth";
import { SITE_WRITE_ROLE } from "@/app/lib/permissions";
import { surveys } from "@/app/lib/surveys";
import {
  OPTIONS_MAX,
  OPTIONS_MIN,
  QUESTIONS_MAX,
  QUESTION_KINDS,
  QUESTION_KIND_LABEL,
  QUESTION_PROMPT_MAX,
  SURVEY_INTRO_MAX,
  SURVEY_STATUSES,
  SURVEY_STATUS_HINT,
  SURVEY_STATUS_LABEL,
  SURVEY_TITLE_MAX,
  hasOptions,
  type SurveyStatus,
} from "@/app/lib/surveys/config";
import { Section } from "../../_ui/Section";
import {
  addQuestionAction,
  archiveSurveyAction,
  moveQuestionAction,
  removeQuestionAction,
  setSurveyStatusAction,
  updateQuestionAction,
  updateSurveyAction,
} from "../actions";
import {
  PRIMARY_BUTTON,
  ResultBanner,
  SECONDARY_BUTTON,
  SurveyStatusChip,
} from "../_ui/Chips";

export const metadata: Metadata = {
  title: "Survey",
  robots: { index: false, follow: false },
};

const INPUT =
  "rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground";

/** The button label for moving INTO a status, worded as an action. */
const MOVE_LABEL: Record<SurveyStatus, string> = {
  draft: "Back to draft",
  live: "Publish",
  closed: "Close survey",
};

/** A date input value (`YYYY-MM-DD`, UTC) from a stored instant. */
function dateValue(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

export default async function SurveyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requireRole(SITE_WRITE_ROLE);

  const { id: rawId } = await params;
  const { ok, error } = await searchParams;

  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();

  const survey = await surveys.getSurvey(id);
  if (!survey) notFound();

  const archived = survey.archivedAt !== null;
  const active = survey.questions.filter((q) => !q.retired);
  const retired = survey.questions.filter((q) => q.retired);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold">
            <Link href="/dashboard/surveys" className="text-muted hover:text-foreground">
              ← All surveys
            </Link>
          </p>
          <h1 className="mt-1 flex flex-wrap items-center gap-2 text-lg font-bold text-foreground">
            <span className="truncate">{survey.title}</span>
            <SurveyStatusChip status={survey.status} />
          </h1>
          <p className="text-sm text-muted">
            /survey/{survey.slug} · {survey.responseCount} responses
          </p>
        </div>
        <div className="flex items-center gap-2">
          {survey.status === "live" && (
            <Link href={`/survey/${survey.slug}`} className={SECONDARY_BUTTON}>
              Open as a player
            </Link>
          )}
          <Link href={`/dashboard/surveys/${survey.id}/results`} className={PRIMARY_BUTTON}>
            View results
          </Link>
        </div>
      </div>

      <ResultBanner ok={ok} error={error} />

      {archived && (
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm font-bold text-muted">
          This survey is archived. It is hidden from the list and from players;
          its results are kept.
        </p>
      )}

      {/* ---- Status ------------------------------------------------------ */}
      {!archived && (
        <Section title="Status" subtitle={SURVEY_STATUS_HINT[survey.status]}>
          <div className="flex flex-wrap gap-2">
            {SURVEY_STATUSES.filter((s) => s !== survey.status).map((next) => (
              <form key={next} action={setSurveyStatusAction}>
                <input type="hidden" name="id" value={survey.id} />
                <input type="hidden" name="status" value={next} />
                <button
                  type="submit"
                  className={next === "live" ? PRIMARY_BUTTON : SECONDARY_BUTTON}
                >
                  {MOVE_LABEL[next]}
                </button>
              </form>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">
            {SURVEY_STATUS_LABEL.live} surveys appear on /survey/{survey.slug} and
            in the site banner. Needs at least one question.
          </p>
        </Section>
      )}

      {/* ---- Details ----------------------------------------------------- */}
      {!archived && (
        <Section title="Details">
          <form action={updateSurveyAction} className="flex flex-col gap-4">
            <input type="hidden" name="id" value={survey.id} />
            <label className="flex flex-col gap-1">
              <span className="text-sm font-bold text-foreground">Title</span>
              <input
                name="title"
                required
                maxLength={SURVEY_TITLE_MAX}
                defaultValue={survey.title}
                className={INPUT}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm font-bold text-foreground">Introduction</span>
              <textarea
                name="intro"
                rows={3}
                maxLength={SURVEY_INTRO_MAX}
                defaultValue={survey.intro}
                className={INPUT}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm font-bold text-foreground">Closes on</span>
              <span className="text-xs text-muted">
                Optional. Players can answer until the end of that day (UTC).
              </span>
              <input
                type="date"
                name="closes_at"
                defaultValue={dateValue(survey.closesAt)}
                className={`${INPUT} w-fit`}
              />
            </label>
            <div>
              <button type="submit" className={PRIMARY_BUTTON}>
                Save details
              </button>
            </div>
          </form>
        </Section>
      )}

      {/* ---- Questions --------------------------------------------------- */}
      <Section
        title="Questions"
        subtitle={`${active.length} of ${QUESTIONS_MAX}`}
      >
        {active.length === 0 ? (
          <p className="text-sm text-muted">No questions yet. Add the first one below.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {active.map((question, index) => (
              <li
                key={question.id}
                className="rounded-lg border border-border p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-foreground">
                      {index + 1}. {question.prompt}
                    </p>
                    <p className="text-xs text-muted">
                      {QUESTION_KIND_LABEL[question.kind]}
                      {question.required ? " · required" : " · optional"}
                      {" · "}
                      {question.answerCount} answers
                    </p>
                    {hasOptions(question.kind) && (
                      <ul className="mt-1 list-disc pl-5 text-xs text-muted">
                        {question.options.map((option) => (
                          <li key={option.id}>{option.label}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {!archived && (
                    <div className="flex shrink-0 gap-1">
                      {(["up", "down"] as const).map((direction) => (
                        <form key={direction} action={moveQuestionAction}>
                          <input type="hidden" name="id" value={survey.id} />
                          <input type="hidden" name="question_id" value={question.id} />
                          <input type="hidden" name="direction" value={direction} />
                          <button
                            type="submit"
                            className={SECONDARY_BUTTON}
                            aria-label={`Move question ${index + 1} ${direction}`}
                            disabled={
                              (direction === "up" && index === 0) ||
                              (direction === "down" && index === active.length - 1)
                            }
                          >
                            {direction === "up" ? "↑" : "↓"}
                          </button>
                        </form>
                      ))}
                    </div>
                  )}
                </div>

                {!archived && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm font-bold text-muted hover:text-foreground">
                      Edit or remove
                    </summary>

                    {question.answerCount > 0 && (
                      <p className="mt-3 rounded-lg bg-amber-100 px-3 py-2 text-xs font-bold text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
                        {question.answerCount} people have answered this. Saving a
                        change stores it as a new question; their answers stay under
                        the wording they saw.
                      </p>
                    )}

                    <form action={updateQuestionAction} className="mt-3 flex flex-col gap-3">
                      <input type="hidden" name="id" value={survey.id} />
                      <input type="hidden" name="question_id" value={question.id} />
                      <input type="hidden" name="kind" value={question.kind} />
                      <label className="flex flex-col gap-1">
                        <span className="text-sm font-bold text-foreground">Question</span>
                        <input
                          name="prompt"
                          required
                          maxLength={QUESTION_PROMPT_MAX}
                          defaultValue={question.prompt}
                          className={INPUT}
                        />
                      </label>
                      {hasOptions(question.kind) && (
                        <label className="flex flex-col gap-1">
                          <span className="text-sm font-bold text-foreground">Options</span>
                          <span className="text-xs text-muted">
                            One per line, {OPTIONS_MIN}–{OPTIONS_MAX}. Options whose text
                            you keep stay linked to their earlier answers.
                          </span>
                          <textarea
                            name="options"
                            rows={5}
                            defaultValue={question.options.map((o) => o.label).join("\n")}
                            className={INPUT}
                          />
                        </label>
                      )}
                      <label className="flex items-center gap-2 text-sm text-foreground">
                        <input
                          type="checkbox"
                          name="required"
                          defaultChecked={question.required}
                        />
                        Required
                      </label>
                      <div>
                        <button type="submit" className={SECONDARY_BUTTON}>
                          Save question
                        </button>
                      </div>
                    </form>

                    <form action={removeQuestionAction} className="mt-4 border-t border-border pt-3">
                      <input type="hidden" name="id" value={survey.id} />
                      <input type="hidden" name="question_id" value={question.id} />
                      <p className="mb-2 text-xs text-muted">
                        {question.answerCount > 0
                          ? "It leaves the survey but its answers stay in the results."
                          : "Nobody has answered it, so it is deleted."}
                      </p>
                      <button
                        type="submit"
                        className="rounded-full border border-rose-300 px-4 py-1.5 text-xs font-extrabold text-rose-700 transition hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40"
                      >
                        Remove question
                      </button>
                    </form>
                  </details>
                )}
              </li>
            ))}
          </ol>
        )}
      </Section>

      {/* ---- Add a question --------------------------------------------- */}
      {!archived && active.length < QUESTIONS_MAX && (
        <Section title="Add a question">
          <form action={addQuestionAction} className="flex flex-col gap-4">
            <input type="hidden" name="id" value={survey.id} />
            <label className="flex flex-col gap-1">
              <span className="text-sm font-bold text-foreground">Type</span>
              <select name="kind" defaultValue="single" className={`${INPUT} w-fit`}>
                {QUESTION_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {QUESTION_KIND_LABEL[kind]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm font-bold text-foreground">Question</span>
              <input
                name="prompt"
                required
                maxLength={QUESTION_PROMPT_MAX}
                placeholder="Which kind of game should we make next?"
                className={INPUT}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm font-bold text-foreground">Options</span>
              <span className="text-xs text-muted">
                Only for single and multiple choice. One per line, {OPTIONS_MIN}–
                {OPTIONS_MAX}.
              </span>
              <textarea name="options" rows={4} className={INPUT} />
            </label>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" name="required" defaultChecked />
              Required
            </label>
            <div>
              <button type="submit" className={PRIMARY_BUTTON}>
                Add question
              </button>
            </div>
          </form>
        </Section>
      )}

      {/* ---- Removed / replaced ----------------------------------------- */}
      {retired.length > 0 && (
        <Section title="Removed or replaced questions">
          <details>
            <summary className="cursor-pointer text-sm font-bold text-muted hover:text-foreground">
              {retired.length} kept for their answers
            </summary>
            <ul className="mt-3 flex flex-col gap-2 text-sm">
              {retired.map((question) => (
                <li key={question.id} className="text-muted">
                  <span className="font-bold text-foreground">{question.prompt}</span>
                  {" · "}
                  {QUESTION_KIND_LABEL[question.kind]} · {question.answerCount} answers
                </li>
              ))}
            </ul>
          </details>
        </Section>
      )}

      {/* ---- Archive ----------------------------------------------------- */}
      {!archived && (
        <Section title="Archive">
          <details>
            <summary className="cursor-pointer text-sm font-bold text-muted hover:text-foreground">
              Archive this survey
            </summary>
            <p className="mt-3 text-sm text-muted">
              It leaves the list and stops being shown to players. Nothing is
              deleted: the questions and every answer are kept, and the results
              page still works.
            </p>
            <form action={archiveSurveyAction} className="mt-3">
              <input type="hidden" name="id" value={survey.id} />
              <button type="submit" className={SECONDARY_BUTTON}>
                Yes, archive it
              </button>
            </form>
          </details>
        </Section>
      )}
    </div>
  );
}
