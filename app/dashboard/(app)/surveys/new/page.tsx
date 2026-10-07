/**
 * HallPass dashboard — start a new survey.
 *
 * Only the title is required. The web address is made from it unless one is
 * typed, and once a survey has been created the address is NOT editable: it is
 * a public URL, and changing it would break every link already shared. A plain
 * `<form action={serverAction}>` with no client component, like the tracker's
 * composer; `createSurveyAction` re-checks authorization itself.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/app/lib/auth";
import { SITE_WRITE_ROLE } from "@/app/lib/permissions";
import { SURVEY_INTRO_MAX, SURVEY_TITLE_MAX } from "@/app/lib/surveys/config";
import { Section } from "../../_ui/Section";
import { createSurveyAction } from "../actions";
import { PRIMARY_BUTTON, ResultBanner } from "../_ui/Chips";

export const metadata: Metadata = {
  title: "New survey",
  robots: { index: false, follow: false },
};

export default async function NewSurveyPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requireRole(SITE_WRITE_ROLE);
  const { ok, error } = await searchParams;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-bold text-foreground">New survey</h1>
        <p className="text-sm text-muted">
          It starts as a draft. Players cannot see it until you publish it.
        </p>
      </div>

      <ResultBanner ok={ok} error={error} />

      <Section>
        <form action={createSurveyAction} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-bold text-foreground">Title</span>
            <input
              name="title"
              required
              maxLength={SURVEY_TITLE_MAX}
              autoFocus
              placeholder="Help us plan the winter release"
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-bold text-foreground">Introduction</span>
            <span className="text-xs text-muted">
              Shown above the questions. Optional.
            </span>
            <textarea
              name="intro"
              rows={4}
              maxLength={SURVEY_INTRO_MAX}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-bold text-foreground">Web address</span>
            <span className="text-xs text-muted">
              Optional. Leave blank to use the title. It cannot be changed later.
            </span>
            <input
              name="slug"
              maxLength={48}
              placeholder="winter-release"
              className="rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm text-foreground"
            />
          </label>

          <div className="flex items-center gap-3">
            <button type="submit" className={PRIMARY_BUTTON}>
              Create draft
            </button>
            <Link
              href="/dashboard/surveys"
              className="text-sm font-bold text-muted hover:text-foreground"
            >
              Cancel
            </Link>
          </div>
        </form>
      </Section>
    </div>
  );
}
