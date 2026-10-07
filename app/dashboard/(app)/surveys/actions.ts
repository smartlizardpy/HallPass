"use server";

/**
 * HallPass dashboard — survey server actions.
 *
 * Control flow mirrors `tracker/actions.ts` (see its header for why each step is
 * there): `requireRole` FIRST because a server action is its own entry point;
 * narrow every `FormData` field because it is editable even on an admin-only
 * page; one fallible store call inside a try/catch with every `redirect()`
 * OUTSIDE it, since `redirect()` reports by throwing; then `revalidatePath` and
 * land on `?ok=` / `?error=`.
 *
 * ONE ROLE, `SITE_WRITE_ROLE`. Writing a survey is "changing something outside
 * the beta programme" and `survey/config.ts` explains why that rung is reused
 * rather than a new one invented. The MCP tools enforce the same rung for
 * writes, so the two doors cannot disagree about who may edit.
 *
 * VALIDATION LIVES IN `parseQuestionFields`, shared by add and edit, so a rule
 * (two options minimum, 300-character prompt) cannot be true for one and not
 * the other. The store re-checks nothing about shape — the database CHECKs are
 * the backstop — so this is where a bad field becomes a banner, not a 500.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/app/lib/auth";
import { SITE_WRITE_ROLE } from "@/app/lib/permissions";
import { surveys } from "@/app/lib/surveys";
import {
  SURVEYS_DASHBOARD_PATH as LIST,
  SURVEY_INTRO_MAX,
  SURVEY_TITLE_MAX,
  checkQuestion,
  closesAtFromDate,
  hasOptions,
  toQuestionKind,
  toSlug,
  toSurveyStatus,
  type QuestionKind,
} from "@/app/lib/surveys/config";

function target(path: string, key: "ok" | "error", message: string): string {
  return `${path}?${key}=${encodeURIComponent(message)}`;
}

function surveyPath(id: number): string {
  return `${LIST}/${id}`;
}

/** Narrow a posted id: a positive safe integer, or `null`. */
function toId(value: unknown): number | null {
  const n = Number(String(value ?? "").trim());
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function revalidateSurveys(id?: number): void {
  revalidatePath(LIST);
  if (id) revalidatePath(surveyPath(id));
  // The public page and the banner (rendered in the root layout) read live data.
  revalidatePath("/survey/[slug]", "page");
}

type QuestionFields =
  | { ok: true; prompt: string; required: boolean; optionLabels: string[] }
  | { ok: false; error: string };

/** Validate the prompt/required/options fields add and edit share. */
function parseQuestionFields(formData: FormData, kind: QuestionKind): QuestionFields {
  const checked = checkQuestion(kind, formData.get("prompt"), String(formData.get("options") ?? ""));
  if (!checked.ok) return checked;
  return { ...checked, required: formData.get("required") === "on" };
}

/** Create a draft survey and land on it. */
export async function createSurveyAction(formData: FormData): Promise<void> {
  const { email } = await requireRole(SITE_WRITE_ROLE);

  const title = String(formData.get("title") ?? "").trim().slice(0, SURVEY_TITLE_MAX);
  const intro = String(formData.get("intro") ?? "").trim().slice(0, SURVEY_INTRO_MAX);
  const typedSlug = String(formData.get("slug") ?? "").trim();
  const slug = toSlug(typedSlug || title);

  const back = `${LIST}/new`;
  if (!title) redirect(target(back, "error", "Give the survey a title."));
  if (!slug) redirect(target(back, "error", "Could not make a web address from that. Use letters or numbers."));

  let id: number | null = null;
  let saveFailed = false;
  try {
    id = await surveys.createSurvey({ slug, title, intro, actor: email });
  } catch (error) {
    console.error("[surveys] createSurvey failed:", error);
    saveFailed = true;
  }
  if (saveFailed) redirect(target(back, "error", "Could not save that. Try again."));
  if (id === null) redirect(target(back, "error", `The address “${slug}” is already used. Pick another.`));

  revalidateSurveys(id);
  redirect(target(surveyPath(id), "ok", "Survey created. Add some questions, then publish it."));
}

/** Change the title, intro and close date. */
export async function updateSurveyAction(formData: FormData): Promise<void> {
  await requireRole(SITE_WRITE_ROLE);

  const id = toId(formData.get("id"));
  const title = String(formData.get("title") ?? "").trim().slice(0, SURVEY_TITLE_MAX);
  const intro = String(formData.get("intro") ?? "").trim().slice(0, SURVEY_INTRO_MAX);
  const closesAt = closesAtFromDate(formData.get("closes_at"));

  if (!id) redirect(target(LIST, "error", "Unknown survey."));
  if (!title) redirect(target(surveyPath(id), "error", "A survey needs a title."));

  let ok = false;
  let saveFailed = false;
  try {
    ok = await surveys.updateSurvey(id, { title, intro, closesAt });
  } catch (error) {
    console.error("[surveys] updateSurvey failed:", error);
    saveFailed = true;
  }
  if (saveFailed) redirect(target(surveyPath(id), "error", "Could not save."));
  if (!ok) redirect(target(LIST, "error", "That survey is gone."));

  revalidateSurveys(id);
  redirect(target(surveyPath(id), "ok", "Saved"));
}

/** Move a survey between draft, live and closed. */
export async function setSurveyStatusAction(formData: FormData): Promise<void> {
  await requireRole(SITE_WRITE_ROLE);

  const id = toId(formData.get("id"));
  const status = toSurveyStatus(formData.get("status"));
  if (!id || !status) redirect(target(LIST, "error", "Unknown survey or status."));

  let result: Awaited<ReturnType<typeof surveys.setStatus>> = null;
  let saveFailed = false;
  try {
    result = await surveys.setStatus(id, status);
  } catch (error) {
    console.error("[surveys] setStatus failed:", error);
    saveFailed = true;
  }
  if (saveFailed) redirect(target(surveyPath(id), "error", "Could not change the status."));
  if (result === null) redirect(target(LIST, "error", "That survey is gone."));
  if (result.blocked) {
    redirect(target(surveyPath(id), "error", "Add at least one question before publishing."));
  }

  revalidateSurveys(id);
  redirect(target(surveyPath(id), "ok", result.changed ? `Now ${status}` : "Already there"));
}

/** Hide a survey from the list and the public site. Its answers are kept. */
export async function archiveSurveyAction(formData: FormData): Promise<void> {
  await requireRole(SITE_WRITE_ROLE);

  const id = toId(formData.get("id"));
  if (!id) redirect(target(LIST, "error", "Unknown survey."));

  let ok = false;
  let saveFailed = false;
  try {
    ok = await surveys.archiveSurvey(id);
  } catch (error) {
    console.error("[surveys] archiveSurvey failed:", error);
    saveFailed = true;
  }
  if (saveFailed) redirect(target(surveyPath(id), "error", "Could not archive."));

  revalidateSurveys(id);
  redirect(target(LIST, ok ? "ok" : "error", ok ? "Archived" : "That survey is gone."));
}

/** Append a question to a survey. */
export async function addQuestionAction(formData: FormData): Promise<void> {
  await requireRole(SITE_WRITE_ROLE);

  const surveyId = toId(formData.get("id"));
  const kind = toQuestionKind(formData.get("kind"));
  if (!surveyId) redirect(target(LIST, "error", "Unknown survey."));
  if (!kind) redirect(target(surveyPath(surveyId), "error", "Pick a question type."));

  const fields = parseQuestionFields(formData, kind);
  if (!fields.ok) redirect(target(surveyPath(surveyId), "error", fields.error));

  let questionId: number | null = null;
  let saveFailed = false;
  try {
    questionId = await surveys.addQuestion({
      surveyId,
      kind,
      prompt: fields.prompt,
      required: fields.required,
      optionLabels: fields.optionLabels,
    });
  } catch (error) {
    console.error("[surveys] addQuestion failed:", error);
    saveFailed = true;
  }
  if (saveFailed) redirect(target(surveyPath(surveyId), "error", "Could not add that question."));
  if (questionId === null) {
    redirect(target(surveyPath(surveyId), "error", "Could not add it. The survey is full or gone."));
  }

  revalidateSurveys(surveyId);
  redirect(target(surveyPath(surveyId), "ok", "Question added"));
}

/**
 * Edit a question's text, required flag or options.
 *
 * The kind is not editable (see `store.updateQuestion`). If the question already
 * has answers the store forks it, and the banner says so: an admin who edits
 * the wording of a question 300 people answered should be told that those 300
 * answers stay under the OLD wording.
 */
export async function updateQuestionAction(formData: FormData): Promise<void> {
  await requireRole(SITE_WRITE_ROLE);

  const surveyId = toId(formData.get("id"));
  const questionId = toId(formData.get("question_id"));
  const kind = toQuestionKind(formData.get("kind"));
  if (!surveyId) redirect(target(LIST, "error", "Unknown survey."));
  if (!questionId || !kind) redirect(target(surveyPath(surveyId), "error", "Unknown question."));

  const fields = parseQuestionFields(formData, kind);
  if (!fields.ok) redirect(target(surveyPath(surveyId), "error", fields.error));

  let result: Awaited<ReturnType<typeof surveys.updateQuestion>> = null;
  let saveFailed = false;
  try {
    result = await surveys.updateQuestion(questionId, {
      prompt: fields.prompt,
      required: fields.required,
      ...(hasOptions(kind) ? { optionLabels: fields.optionLabels } : {}),
    });
  } catch (error) {
    console.error("[surveys] updateQuestion failed:", error);
    saveFailed = true;
  }
  if (saveFailed) redirect(target(surveyPath(surveyId), "error", "Could not save that question."));
  if (result === null) redirect(target(surveyPath(surveyId), "error", "That question is gone."));

  revalidateSurveys(surveyId);
  redirect(
    target(
      surveyPath(surveyId),
      "ok",
      result.forked
        ? "Saved as a new question. People who already answered keep the old wording."
        : "Question saved",
    ),
  );
}

/** Remove a question (deleted if unanswered, retired if answered). */
export async function removeQuestionAction(formData: FormData): Promise<void> {
  await requireRole(SITE_WRITE_ROLE);

  const surveyId = toId(formData.get("id"));
  const questionId = toId(formData.get("question_id"));
  if (!surveyId) redirect(target(LIST, "error", "Unknown survey."));
  if (!questionId) redirect(target(surveyPath(surveyId), "error", "Unknown question."));

  let outcome: Awaited<ReturnType<typeof surveys.removeQuestion>> = null;
  let saveFailed = false;
  try {
    outcome = await surveys.removeQuestion(questionId);
  } catch (error) {
    console.error("[surveys] removeQuestion failed:", error);
    saveFailed = true;
  }
  if (saveFailed) redirect(target(surveyPath(surveyId), "error", "Could not remove it."));
  if (outcome === null) redirect(target(surveyPath(surveyId), "error", "That question is gone."));

  revalidateSurveys(surveyId);
  redirect(
    target(
      surveyPath(surveyId),
      "ok",
      outcome === "retired"
        ? "Removed from the survey. Its answers are kept in the results."
        : "Question deleted",
    ),
  );
}

/** Move a question up or down one place. */
export async function moveQuestionAction(formData: FormData): Promise<void> {
  await requireRole(SITE_WRITE_ROLE);

  const surveyId = toId(formData.get("id"));
  const questionId = toId(formData.get("question_id"));
  const direction = formData.get("direction") === "up" ? "up" : "down";
  if (!surveyId) redirect(target(LIST, "error", "Unknown survey."));
  if (!questionId) redirect(target(surveyPath(surveyId), "error", "Unknown question."));

  let saveFailed = false;
  try {
    await surveys.moveQuestion(questionId, direction);
  } catch (error) {
    console.error("[surveys] moveQuestion failed:", error);
    saveFailed = true;
  }
  if (saveFailed) redirect(target(surveyPath(surveyId), "error", "Could not move it."));

  // Already first/last is not an error: nothing to say, nothing to show.
  revalidateSurveys(surveyId);
  redirect(surveyPath(surveyId));
}
