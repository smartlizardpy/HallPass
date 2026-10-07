/**
 * HallPass dashboard — the survey list.
 *
 * Live surveys first, then drafts, then closed (the store's own ordering), so
 * the one players can see right now is always at the top.
 *
 * A database without migration 037 renders a "run the migration" notice rather
 * than a convincingly empty list: the admin reads are deliberately NOT
 * fail-soft (see `surveys/index.ts`), so the probe is what tells "no surveys
 * yet" from "no table". Any other error is rethrown — a real Neon outage must
 * not be disguised as an empty list.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/app/lib/auth";
import { SITE_WRITE_ROLE } from "@/app/lib/permissions";
import { isSurveysReady, surveys } from "@/app/lib/surveys";
import { Section } from "../_ui/Section";
import { PRIMARY_BUTTON, ResultBanner, SurveyStatusChip } from "./_ui/Chips";

export const metadata: Metadata = {
  title: "Surveys",
  robots: { index: false, follow: false },
};

function Header() {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-lg font-bold text-foreground">Surveys</h1>
        <p className="text-sm text-muted">
          Ask players what to build next. Questions can be edited any time.
        </p>
      </div>
      <Link href="/dashboard/surveys/new" className={PRIMARY_BUTTON}>
        New survey
      </Link>
    </div>
  );
}

export default async function SurveysPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requireRole(SITE_WRITE_ROLE);
  const { ok, error } = await searchParams;

  if (!(await isSurveysReady())) {
    return (
      <div className="flex flex-col gap-4">
        <Header />
        <Section title="Surveys unavailable">
          <p className="text-sm text-muted">
            The survey tables are not in this database yet. Apply migration{" "}
            <code className="rounded bg-surface-2 px-1">037_surveys.sql</code>:
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-surface-2 p-3 text-xs">
            npm run migrate -- --status{"\n"}npm run migrate
          </pre>
          <p className="mt-3 text-xs text-muted">
            It must be applied to every Neon branch the app runs against. The
            runner prints the target host — check it matches.
          </p>
        </Section>
      </div>
    );
  }

  const list = await surveys.listSurveys();

  return (
    <div className="flex flex-col gap-4">
      <Header />
      <ResultBanner ok={ok} error={error} />

      {list.length === 0 ? (
        <Section>
          <p className="text-sm text-muted">
            No surveys yet. Make one, add a few questions, and publish it.
          </p>
        </Section>
      ) : (
        <Section>
          <ul className="divide-y divide-border">
            {list.map((survey) => (
              <li key={survey.id}>
                <Link
                  href={`/dashboard/surveys/${survey.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 hover:bg-surface-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-foreground">
                      {survey.title}
                    </p>
                    <p className="text-xs text-muted">
                      /survey/{survey.slug}
                      {survey.closesAt
                        ? ` · closes ${new Date(survey.closesAt).toLocaleDateString("en-GB", { timeZone: "UTC" })}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-xs text-muted">
                    <span>{survey.questionCount} questions</span>
                    <span>{survey.responseCount} responses</span>
                    <SurveyStatusChip status={survey.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
