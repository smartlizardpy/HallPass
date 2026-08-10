import Link from "next/link";
import { Wordmark } from "@/app/components/Wordmark";

/**
 * "No such player" for `/u/<username>`.
 *
 * DELIBERATELY PLAIN AND DELIBERATELY DATA-FREE. It reads no session, resolves no
 * catalogue and touches no database, so it cannot itself fail while trying to
 * tell you that something is missing — and it is not wrapped in `ArcadeShell`,
 * whose sidebar needs the catalogue. A 404 should be the cheapest render on the
 * site, because a guessable URL space gets mostly misses.
 *
 * WHAT IT MUST NOT SAY. `getPublicProfileByUsername` returns "not found" for a
 * name nobody holds, a name nobody could hold, and a schema gap, all
 * indistinguishably — so this page cannot be more specific than it is without
 * inventing a reason. It also must not imply that anyone did anything wrong: a
 * BLOCKED viewer never lands here (they get a quiet minimal profile instead),
 * so the reader of this page is, as far as anyone knows, someone who mistyped a
 * friend's name.
 *
 * The rename line is the useful part. Usernames are changeable, and "they may
 * have changed it" is the actual explanation most of the time — that is the whole
 * point of a rename, and the reason this URL space is kept out of search results.
 *
 * The page's `robots` metadata comes from `generateMetadata` in `page.tsx`, which
 * derives the tab title from the URL alone and never reads the database — so the
 * `noindex` applies here too. That matters more than it looks: Next answers a
 * STREAMED `not-found` with HTTP 200, so this page cannot rely on its status code
 * to keep it out of an index.
 */
export default function ProfileNotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-10">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center">
        <Wordmark size="text-3xl" dotClass="h-2 w-2" />

        <h1 className="mt-4 text-2xl font-black tracking-tight text-zinc-900">
          No player here
        </h1>
        <p className="mt-3 text-[15px] font-semibold leading-relaxed text-muted">
          We couldn&rsquo;t find that profile. Usernames ignore capitals, but the
          spelling has to match exactly — and players can change theirs at any
          time.
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/"
            className="rounded-full bg-brand px-5 py-2.5 text-sm font-extrabold text-white transition hover:bg-brand-600"
          >
            Back to games
          </Link>
          <Link
            href="/play/you/friends"
            className="rounded-full border border-border bg-white px-5 py-2.5 text-sm font-bold text-zinc-700 transition hover:bg-surface-2"
          >
            Find a friend
          </Link>
        </div>
      </div>
    </main>
  );
}
