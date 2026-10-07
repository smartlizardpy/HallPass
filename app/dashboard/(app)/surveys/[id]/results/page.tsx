/**
 * HallPass dashboard — what players said.
 *
 * Server-rendered bars, no chart library and no client JavaScript. A survey
 * result is a handful of counts per question, and a labelled bar with the number
 * and percentage printed beside it carries more than a recharts tooltip would:
 * nothing is hidden behind a hover, it prints, and it reads without colour.
 *
 * PERCENTAGES ARE OF THAT QUESTION'S RESPONDERS, not of all responses. An
 * optional question answered by 12 of 200 people reports shares of 12, and says
 * "12 of 200 answered" beside the title, because 6% of 200 would make every
 * optional question look like a failure.
 *
 * MULTIPLE CHOICE SHARES CAN ADD UP TO MORE THAN 100%, which is correct: each
 * bar is "how many people picked this".
 *
 * NO ONE IS NAMED. The store returns a response number and a time, never a
 * player; free-text answers are listed with the number alone. This screen is
 * what the MCP `get_survey_results` tool also reports, and the two should say
 * the same thing.
 *
 * REMOVED AND REPLACED QUESTIONS ARE STILL HERE, marked as such, because their
 * answers are real and the response total would not otherwise add up.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/app/lib/auth";
import { SITE_WRITE_ROLE } from "@/app/lib/permissions";
import { surveys } from "@/app/lib/surveys";
import { QUESTION_KIND_LABEL, SCALE_MAX, SCALE_MIN } from "@/app/lib/surveys/config";
import type { QuestionResult } from "@/app/lib/surveys";
import { Section } from "../../../_ui/Section";
import { SurveyStatusChip } from "../../_ui/Chips";

export const metadata: Metadata = {
  title: "Survey results",
  robots: { index: false, follow: false },
};

function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

function Bar({ label, count, of }: { label: string; count: number; of: number }) {
  const pct = percent(count, of);
  return (
    <div className="grid grid-cols-[minmax(0,12rem)_1fr_auto] items-center gap-3 text-sm">
      <span className="truncate text-foreground" title={label}>
        {label}
      </span>
      <div
        className="h-3 overflow-hidden rounded-full bg-surface-2"
        role="img"
        aria-label={`${label}: ${count} of ${of} (${pct}%)`}
      >
        <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-20 text-right tabular-nums text-muted">
        {count} · {pct}%
      </span>
    </div>
  );
}

function Result({ result, total }: { result: QuestionResult; total: number }) {
  const { question } = result;
  return (
    <Section>
      <div className="mb-3">
        <h2 className="text-sm font-bold text-foreground">{question.prompt}</h2>
        <p className="text-xs text-muted">
          {QUESTION_KIND_LABEL[question.kind]}
          {question.required ? " · required" : " · optional"}
          {" · "}
          {result.answered} of {total} answered
          {question.retired ? " · removed or replaced" : ""}
        </p>
      </div>

      {(question.kind === "single" || question.kind === "multi") && (
        <div className="flex flex-col gap-2">
          {result.choices.map((choice) => (
            <Bar
              key={choice.optionId}
              label={choice.label}
              count={choice.count}
              of={result.answered}
            />
          ))}
        </div>
      )}

      {question.kind === "scale" && result.scale && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-foreground">
            Average{" "}
            <span className="font-bold tabular-nums">
              {result.scale.mean === null ? "—" : result.scale.mean.toFixed(2)}
            </span>{" "}
            out of {SCALE_MAX}
          </p>
          {Array.from({ length: SCALE_MAX - SCALE_MIN + 1 }, (_, i) => SCALE_MAX - i).map(
            (value) => (
              <Bar
                key={value}
                label={String(value)}
                count={result.scale?.counts[value] ?? 0}
                of={result.answered}
              />
            ),
          )}
        </div>
      )}

      {question.kind === "text" &&
        (result.texts.length === 0 ? (
          <p className="text-sm text-muted">No written answers yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {result.texts.map((text) => (
              <li
                key={text.responseId}
                className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-foreground"
              >
                {/* Rendered as text with pre-wrap, never as HTML. */}
                <p className="whitespace-pre-wrap break-words">{text.body}</p>
                <p className="mt-1 text-xs text-muted">
                  Response #{text.responseId} ·{" "}
                  {new Date(text.createdAt).toISOString().slice(0, 10)}
                </p>
              </li>
            ))}
          </ul>
        ))}
    </Section>
  );
}

export default async function SurveyResultsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole(SITE_WRITE_ROLE);

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();

  const results = await surveys.getResults(id);
  if (!results) notFound();

  const { survey, responseCount } = results;
  // Live questions first (the store already orders them), removed ones after.
  const ordered = [
    ...results.questions.filter((r) => !r.question.retired),
    ...results.questions.filter((r) => r.question.retired),
  ];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-xs font-bold">
          <Link
            href={`/dashboard/surveys/${survey.id}`}
            className="text-muted hover:text-foreground"
          >
            ← Back to the survey
          </Link>
        </p>
        <h1 className="mt-1 flex flex-wrap items-center gap-2 text-lg font-bold text-foreground">
          <span className="truncate">{survey.title}</span>
          <SurveyStatusChip status={survey.status} />
        </h1>
        <p className="text-sm text-muted">
          {responseCount} {responseCount === 1 ? "response" : "responses"}
        </p>
      </div>

      {responseCount === 0 ? (
        <Section>
          <p className="text-sm text-muted">
            Nobody has answered yet. Results appear here as responses come in.
          </p>
        </Section>
      ) : (
        ordered.map((result) => (
          <Result key={result.question.id} result={result} total={responseCount} />
        ))
      )}
    </div>
  );
}
