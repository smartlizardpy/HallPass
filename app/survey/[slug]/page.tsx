/**
 * `/survey/[slug]` — a survey, as a player sees it.
 *
 * DYNAMIC, unlike most pages here, because what it shows depends on who is
 * looking (signed out, not yet answered, already answered). That costs nothing
 * for the rest of the site: the banner that links here is a client island that
 * fetches `/api/v1/surveys/active`, so no OTHER page reads the session.
 *
 * ONE 404 FOR EVERY WAY A SURVEY CAN BE UNAVAILABLE. A draft, a closed survey,
 * an archived one, one past its close date and a slug that never existed are
 * indistinguishable from outside. A draft's existence is the admins' business,
 * and a "this survey ended" page would be a pointless dead end for a link that
 * was shared in a chat.
 *
 * NOT INDEXED. A survey is a request to the people who already play, not
 * content for a search result, and it vanishes on close.
 *
 * THE FORM IS THE ONLY CLIENT CODE. The three states — signed out, already
 * answered, open — are decided on the server so a signed-out visitor never
 * downloads a form they cannot submit.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArcadeShell } from "@/app/components/ArcadeShell";
import { resolveCategories, resolveGames } from "@/app/lib/games-store";
import { currentPlayerId } from "@/app/lib/social/request-guard";
import { getPublicSurvey } from "@/app/lib/surveys";
import { SurveyForm } from "./SurveyForm";

export const metadata: Metadata = {
  title: "Survey",
  robots: { index: false, follow: false },
};

export default async function SurveyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const playerId = await currentPlayerId();

  const [survey, games, categories] = await Promise.all([
    getPublicSurvey(slug, playerId),
    resolveGames(),
    resolveCategories(),
  ]);
  if (!survey) notFound();

  return (
    <ArcadeShell games={games} categories={categories}>
      <div className="px-3 pb-10 pt-2 sm:px-8">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-black tracking-tight text-foreground sm:text-3xl">
            {survey.title}
          </h1>
          {survey.intro && (
            <p className="mt-2 whitespace-pre-wrap text-[15px] font-semibold leading-relaxed text-zinc-600 dark:text-zinc-300">
              {survey.intro}
            </p>
          )}

          <div className="mt-6">
            {!playerId ? (
              <div className="rounded-xl border border-border bg-surface p-5">
                <p className="text-sm font-bold text-foreground">
                  Sign in to answer. It takes a minute, and your answers help decide
                  what we build next.
                </p>
                {/* A plain anchor, not a Link: signing in leaves the app and the
                    service worker must not try to serve it from the precache. */}
                <a
                  href={`/play/signin?callbackUrl=${encodeURIComponent(`/survey/${survey.slug}`)}`}
                  className="mt-3 inline-block rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white transition hover:bg-brand-600"
                >
                  Sign in
                </a>
              </div>
            ) : survey.answered ? (
              <p
                role="status"
                className="rounded-xl bg-emerald-100 px-4 py-3 text-sm font-bold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
              >
                You&apos;ve already answered this survey. Thank you!
              </p>
            ) : (
              <SurveyForm survey={survey} />
            )}
          </div>
        </div>
      </div>
    </ArcadeShell>
  );
}
