"use server";

/**
 * HallPass dashboard — a game's QUALITY rating (super admin only).
 *
 * Quality is the editorial 1-10 judgement, per criterion, that nudges how
 * recommendations and the Featured order rank a game (`app/lib/quality.ts`).
 * It is a judgement about a game rather than a copy edit, so it sits behind
 * `super_admin`, not the `admin` that edits descriptions: `requireRole` is the
 * first line and re-reads the live role, so a demoted super admin loses the
 * ability on their very next request.
 *
 * Like every dashboard action, `redirect()` stays OUTSIDE the try. Every
 * criterion is sent on every save (blank = not rated), so the form always
 * describes the whole rating and a cleared box really clears it.
 */

import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/app/lib/auth";
import { CACHE_TAG, isKnownSlug, setGameQuality } from "@/app/lib/games-store";
import { QUALITY_CRITERIA, emptyScores, toScore, type QualityScores } from "@/app/lib/quality";

function target(slug: string, key: "ok" | "error", message: string): string {
  return `/dashboard/games/${encodeURIComponent(slug)}?${key}=${encodeURIComponent(message)}`;
}

export async function setGameQualityAction(formData: FormData): Promise<void> {
  await requireRole("super_admin");

  const slug = String(formData.get("slug") ?? "").trim();
  if (!slug || !(await isKnownSlug(slug))) {
    redirect("/dashboard/games?error=Unknown+game.");
  }

  // A value that is present but not a whole 1-10 is a mistake worth saying so,
  // not something to quietly read as "unrated".
  const scores: QualityScores = emptyScores();
  for (const { key, label } of QUALITY_CRITERIA) {
    const raw = String(formData.get(key) ?? "").trim();
    const score = toScore(raw);
    if (raw !== "" && score === null) {
      redirect(target(slug, "error", `${label} must be a whole number from 1 to 10, or empty.`));
    }
    scores[key] = score;
  }

  let failed = false;
  try {
    await setGameQuality(slug, scores);
  } catch {
    failed = true;
  }
  if (!failed) {
    updateTag(CACHE_TAG);
    revalidatePath("/");
    revalidatePath(`/game/${slug}`);
  }

  redirect(
    failed
      ? target(slug, "error", "Could not save the rating. Try again.")
      : target(slug, "ok", "Quality rating saved"),
  );
}
