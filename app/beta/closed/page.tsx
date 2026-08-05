/**
 * Where `requireBetaTester()` sends a signed-in player who is not a member.
 *
 * A REAL PAGE RATHER THAN A 404, deliberately. Someone reaching here followed a
 * link that exists — from the account menu of a since-revoked tester, a shared
 * URL, or their own bookmark. A 404 tells them the page is broken; this tells
 * them the programme is invite-only and they are not currently in it, which is
 * the true and useful statement.
 *
 * It does NOT distinguish "never invited" from "revoked". The store can tell
 * them apart and the guard could pass it through, but "your access was removed"
 * is a message that invites a conversation this page cannot have, and the action
 * a player takes is identical either way.
 *
 * `noindex` in metadata AND via the `X-Robots-Tag` on `/beta/:path*` in
 * `next.config.ts` — the metadata tag alone is not enough, because a streamed
 * `not-found.js` is answered with HTTP 200 and a header applies to responses no
 * HTML parser reaches the `<head>` of. Same two-part signal as `/u/:path*`.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { BackButton } from "@/app/components/BackButton";
import { Wordmark } from "@/app/components/Wordmark";

export const metadata: Metadata = {
  title: "Beta testers · HallPass",
  robots: { index: false, follow: false },
};

export default function BetaClosedPage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center bg-background px-6 py-10">
      <div className="absolute left-6 top-6">
        <BackButton />
      </div>

      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-8 text-center">
        <Wordmark size="text-3xl" dotClass="h-2 w-2" tag="beta" />
        <h1 className="mt-3 text-2xl font-black tracking-tight text-zinc-900">
          Invite only
        </h1>
        <p className="mt-3 text-sm font-semibold text-muted">
          The beta programme is a small group who get games assigned to them
          before everyone else, hunt for bugs, and earn XP for what they find.
        </p>
        <p className="mt-3 text-sm font-semibold text-muted">
          You are not in it right now. There is no waiting list — testers are
          picked by hand.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white transition hover:bg-brand-600"
        >
          Back to games
        </Link>
      </div>
    </main>
  );
}
