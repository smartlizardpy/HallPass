/**
 * The Quality panel of a game's control center — SUPER ADMIN ONLY.
 *
 * One 1-10 box per criterion; blank means "not rated on this". Every box is sent
 * on every save, so what the form shows is the whole rating. The page decides who
 * sees this (it is not rendered for any other role), and `setGameQualityAction`
 * re-checks the role on the server — hiding the form is a courtesy, not the gate.
 */

import { Section } from "../../../_ui/Section";
import { setGameQualityAction } from "../quality-actions";
import { MAX_SCORE, MIN_SCORE, QUALITY_CRITERIA, overallQuality, type QualityScores } from "@/app/lib/quality";

export function QualityPanel({ slug, scores }: { slug: string; scores: QualityScores }) {
  const overall = overallQuality(scores);
  return (
    <Section
      title="Quality"
      subtitle="Better-rated games are recommended a little more. Never hides a game."
    >
      <form action={setGameQualityAction} className="space-y-4">
        <input type="hidden" name="slug" value={slug} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {QUALITY_CRITERIA.map(({ key, label }) => (
            <label key={key} className="block text-sm font-semibold text-foreground">
              {label}
              <input
                type="number"
                name={key}
                min={MIN_SCORE}
                max={MAX_SCORE}
                step={1}
                inputMode="numeric"
                defaultValue={scores[key] ?? ""}
                placeholder="–"
                className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/30"
              />
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="submit"
            className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white hover:opacity-90"
          >
            Save rating
          </button>
          <p className="text-sm text-muted">
            {overall === null
              ? "Not rated — counts as neutral (5.5)."
              : `Overall ${overall} / 10 (average of the criteria rated).`}
          </p>
        </div>
      </form>
    </Section>
  );
}
