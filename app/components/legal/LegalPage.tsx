import type { ReactNode } from "react";
import { BackButton } from "../BackButton";
import { Wordmark } from "../Wordmark";

/**
 * Shared frame for the legal pages (`/privacy`, `/terms`).
 *
 * Server components with no data reads, so both pages prerender statically — a
 * policy has no business hitting the database, and a static page keeps working
 * offline like the rest of the arcade. Deliberately a bare `<main>` rather than
 * `ArcadeShell` (same choice as `app/beta/closed/page.tsx`): the shell resolves
 * the whole catalogue, which a text page does not need.
 *
 * THE DRAFT BANNER IS PART OF THE FRAME, NOT AN AFTERTHOUGHT. These texts were
 * drafted from the code by a non-lawyer and carry `Placeholder` markers for
 * facts the code cannot supply (operator identity, contact address). The banner
 * and the markers are removed by whoever finalises the text; until then the
 * page says out loud that it is unfinished rather than looking authoritative.
 */

/** Marks a fact the codebase cannot supply. Rendered conspicuously on purpose. */
export function Placeholder({ children }: { children: ReactNode }) {
  return (
    <mark className="rounded bg-accent-yellow/40 px-1 font-extrabold text-foreground">
      [{children}]
    </mark>
  );
}

export function LegalSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="mt-8 scroll-mt-6">
      <h2 className="text-xl font-black tracking-tight text-foreground">
        {title}
      </h2>
      <div className="mt-2 space-y-3 text-[15px] font-semibold leading-relaxed text-muted [&_a]:text-brand [&_a]:underline [&_li]:mt-1.5 [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}

export function LegalPage({
  title,
  updated,
  shortVersion,
  children,
}: {
  title: string;
  /** Human-readable date of the draft. */
  updated: ReactNode;
  /** Plain-English summary shown first; a list of one-line points. */
  shortVersion: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-background px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <BackButton />
        <header className="mt-6">
          <Wordmark size="text-3xl" dotClass="h-2 w-2" />
          <h1 className="mt-3 text-3xl font-black tracking-tight text-foreground">
            {title}
          </h1>
          <p className="mt-1 text-sm font-bold text-muted">
            Last updated: {updated}
          </p>
        </header>

        <p
          role="note"
          className="mt-4 rounded-xl border border-border bg-surface p-3 text-[13px] font-bold text-muted"
        >
          Draft: this text has not yet been reviewed by a solicitor. Items in{" "}
          <Placeholder>square brackets</Placeholder> are still to be filled in.
        </p>

        <aside
          aria-label="The short version"
          className="mt-6 rounded-2xl border border-border bg-brand-50 p-5"
        >
          <h2 className="text-lg font-black text-brand">The short version</h2>
          <div className="mt-2 text-[15px] font-semibold leading-relaxed text-foreground [&_li]:mt-1.5 [&_ul]:list-disc [&_ul]:pl-5">
            {shortVersion}
          </div>
          <p className="mt-3 text-xs font-bold text-muted">
            This summary is only a guide. The full text below is what counts.
          </p>
        </aside>

        {children}
      </div>
    </main>
  );
}
