"use client";

/**
 * HallPass — the player-facing survey form.
 *
 * The only client island on `/survey/[slug]`: the page itself is a server
 * component that has already decided the survey is open and this player has not
 * answered. This component collects answers and posts them to
 * `/api/v1/surveys/[slug]/respond`, which is where every real rule lives; what
 * is checked here (a required question left blank) is only so the common mistake
 * is caught without a round trip, and the server repeats it.
 *
 * Question ids come from the server, and so do option ids; nothing in this file
 * knows what a "genre" or a "rating" is. A survey an admin edits needs no change
 * here.
 *
 * ACCESSIBILITY. Each question is a `<fieldset>` with a `<legend>`, the rating is
 * a radio group (not a row of unlabeled buttons), and errors are announced with
 * `role="alert"`. The 1-5 scale names its ends so "5" cannot be read two ways.
 *
 * A STALE FORM IS NOT FATAL. If an admin edits a question while the player has
 * the page open, the server answers 409 "reload the page"; the message is shown
 * as-is and nothing the player typed is thrown away until they choose to reload.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PublicSurvey } from "@/app/lib/surveys/store";

type Answers = Record<number, string | string[] | number>;

const SCALE = [1, 2, 3, 4, 5] as const;

const INPUT =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground";

function isBlank(value: Answers[number] | undefined): boolean {
  if (value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

export function SurveyForm({ survey }: { survey: Pick<PublicSurvey, "slug" | "questions"> }) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Answers>({});
  const [error, setError] = useState<{ message: string; questionId?: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  function set(id: number, value: Answers[number]) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }

  function toggle(id: number, optionId: string) {
    const current = (answers[id] as string[] | undefined) ?? [];
    set(
      id,
      current.includes(optionId) ? current.filter((o) => o !== optionId) : [...current, optionId],
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    const missing = survey.questions.find((q) => q.required && isBlank(answers[q.id]));
    if (missing) {
      setError({ message: `Please answer: ${missing.prompt}`, questionId: missing.id });
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/surveys/${encodeURIComponent(survey.slug)}/respond`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        reason?: string;
        questionId?: number;
      } | null;
      if (res.ok && data?.ok) {
        setDone(true);
        // Re-render the server page so it shows "thanks", and the banner stops.
        router.refresh();
        return;
      }
      if (res.status === 401) {
        setError({ message: "You've been signed out. Sign in again to send your answers." });
        return;
      }
      setError({
        message: data?.reason ?? "Could not send your answers. Try again.",
        questionId: data?.questionId,
      });
    } catch {
      setError({ message: "Could not reach the server. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p role="status" className="rounded-xl bg-emerald-100 px-4 py-3 text-sm font-bold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200">
        Thanks! Your answers are in.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
      {survey.questions.map((question, index) => {
        const flagged = error?.questionId === question.id;
        return (
          <fieldset
            key={question.id}
            className={`flex flex-col gap-2 rounded-xl border p-4 ${
              flagged ? "border-rose-400" : "border-border"
            }`}
          >
            <legend className="px-1 text-sm font-extrabold text-foreground">
              {index + 1}. {question.prompt}
              {!question.required && (
                <span className="ml-2 text-xs font-semibold text-muted">optional</span>
              )}
            </legend>

            {question.kind === "single" &&
              question.options.map((option) => (
                <label key={option.id} className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="radio"
                    name={`q${question.id}`}
                    checked={answers[question.id] === option.id}
                    onChange={() => set(question.id, option.id)}
                  />
                  {option.label}
                </label>
              ))}

            {question.kind === "multi" &&
              question.options.map((option) => (
                <label key={option.id} className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={((answers[question.id] as string[] | undefined) ?? []).includes(
                      option.id,
                    )}
                    onChange={() => toggle(question.id, option.id)}
                  />
                  {option.label}
                </label>
              ))}

            {question.kind === "scale" && (
              <div>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={question.prompt}>
                  {SCALE.map((value) => (
                    <label
                      key={value}
                      className={`grid h-10 w-10 cursor-pointer place-items-center rounded-full border text-sm font-extrabold transition ${
                        answers[question.id] === value
                          ? "border-brand bg-brand text-white"
                          : "border-border text-foreground hover:bg-surface-2"
                      }`}
                    >
                      <input
                        type="radio"
                        name={`q${question.id}`}
                        value={value}
                        checked={answers[question.id] === value}
                        onChange={() => set(question.id, value)}
                        className="sr-only"
                      />
                      {value}
                    </label>
                  ))}
                </div>
                <p className="mt-1 flex justify-between text-xs text-muted">
                  <span>1 = not at all</span>
                  <span>5 = a lot</span>
                </p>
              </div>
            )}

            {question.kind === "text" && (
              <textarea
                rows={3}
                maxLength={500}
                aria-label={question.prompt}
                value={(answers[question.id] as string | undefined) ?? ""}
                onChange={(e) => set(question.id, e.target.value)}
                className={INPUT}
              />
            )}
          </fieldset>
        );
      })}

      {error && (
        <p role="alert" className="rounded-lg bg-rose-100 px-3 py-2 text-sm font-bold text-rose-800 dark:bg-rose-950/60 dark:text-rose-200">
          {error.message}
        </p>
      )}

      <div>
        <button
          type="submit"
          disabled={busy}
          className="rounded-full bg-brand px-6 py-2.5 text-sm font-extrabold text-white transition hover:bg-brand-600 disabled:opacity-60"
        >
          {busy ? "Sending…" : "Send my answers"}
        </button>
      </div>
    </form>
  );
}
