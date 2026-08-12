/**
 * `/c/<code>` — somebody's "beat my score" link.
 *
 * The one page in HallPass written for a person who has never been here. It
 * shows who is daring them, the number, the game, and ONE button — and the
 * button starts the game on this very page rather than sending them anywhere.
 *
 * ── WHY THE GAME OPENS HERE AND THE PAGE NEVER NAVIGATES ───────────────────
 * `sdk/src/client.ts:111` keeps anonymous claim tokens IN MEMORY and never in
 * storage, deliberately, so the next child on a shared school computer cannot
 * inherit the last one's scores. They die with the document that holds them —
 * which is the game frame. Navigating this page away tears that frame down and
 * throws away the score the visitor just earned, at the exact moment we intend
 * to ask them to sign in and keep it.
 *
 * So {@link ChallengeLanding} mounts the ordinary `<PlayerOverlay>` in place,
 * and sign-in is a POPUP, never a same-tab redirect. The SDK hears the auth
 * signal through `BroadcastChannel`/`localStorage` — both same-origin and both
 * cross frames — and flushes the claim itself from inside the still-live game.
 * See `challenge-sharing-design.md` §6.
 *
 * ── THE HTML IS THE SAME FOR EVERY VIEWER ──────────────────────────────────
 * No `auth()` here, and that is a decision rather than an omission. It keeps
 * the page out of the per-viewer category that `sw.js`'s `isPrivatePath` list
 * exists for, keeps the preview card honest, and means a link shared into a
 * group chat renders identically for all thirty people who open it. Whatever
 * depends on the viewer — whether they have already taken this link up, whether
 * they beat it — is fetched by the island from `/api/`.
 *
 * ── NO AVATAR ──────────────────────────────────────────────────────────────
 * The store does not even select one; see `LinkOwner` in `challenges/store.ts`.
 * Sign-in is Google-only, so an avatar here is frequently a real photograph of
 * a child, and this is a page built to be pasted into a public chat and cached
 * as a preview card on strangers' devices. A handle and a number carry "beat
 * me" perfectly well.
 *
 * ── CRAWLABLE AND `noindex`, NOT `Disallow` ────────────────────────────────
 * Exactly the `/u/<username>` argument (`app/u/[username]/page.tsx:12`): links
 * get pasted where crawlers find them, and a `robots.txt` block would stop the
 * crawler FETCHING the page and therefore ever seeing the `noindex`, leaving a
 * bare URL listed that can then never be removed. Crawlable plus `noindex` is
 * the only combination that removes anything. The header half is in
 * `next.config.ts`.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { getLink } from "@/app/lib/challenges";
import { normalizeLinkCode } from "@/app/lib/challenges/link";
import { resolveGame } from "@/app/lib/games-store";
import { Wordmark } from "@/app/components/Wordmark";
import { ChallengeLanding } from "./ChallengeLanding";

export const metadata: Metadata = {
  title: "Beat this score · HallPass",
  robots: { index: false, follow: false },
};

// Reads a per-code row, so it is inherently per-request. This also keeps it out
// of `prerender-manifest.json` and therefore out of the service-worker
// precache; `scripts/build-sw-manifest.mjs` excludes the prefix as well, on the
// same "both are needed, neither substitutes" principle the `/play/` exclusion
// is written under.
export const dynamic = "force-dynamic";

/** The dead end, shared by a missing code and a revoked one. */
function NotAvailable({ reason }: { reason: "missing" | "revoked" }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-10">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center">
        <Wordmark size="text-3xl" dotClass="h-2 w-2" />
        <h1 className="mt-4 text-2xl font-black tracking-tight text-zinc-900">
          {reason === "revoked" ? "This challenge is closed" : "We can't find that challenge"}
        </h1>
        <p className="mt-2 text-sm font-semibold text-muted">
          {reason === "revoked"
            ? "Whoever set it has taken it down. The games are still here though."
            : "The link might be mistyped, or it was taken down. The games are still here though."}
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-full bg-brand px-6 py-2.5 text-sm font-extrabold text-white transition hover:bg-brand-600"
        >
          Find a game
        </Link>
      </div>
    </main>
  );
}

export default async function ChallengeLinkPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const code = normalizeLinkCode((await params).code);
  // `getLink` is fail-soft and folds "no such code" into `null` — see its
  // docblock for why that collapse is safe on this surface alone.
  const link = code ? await getLink(code) : null;

  if (!link) return <NotAvailable reason="missing" />;
  if (link.revokedAt !== null) return <NotAvailable reason="revoked" />;

  // A board need not belong to a game (`001_decouple_boards.sql`), and an
  // external game cannot be linked to at all (the mint route refuses one), so
  // anything we fail to resolve here simply has no game to play — the card
  // still renders and says so.
  const game = link.gameSlug
    ? ((await resolveGame(link.gameSlug).catch(() => undefined)) ?? null)
    : null;

  return <ChallengeLanding link={link} game={game} />;
}
