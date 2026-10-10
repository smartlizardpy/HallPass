/**
 * `/i/<code>` — a game invite: "Ozan invited you to play LAST BELL."
 *
 * Where a `game_invite` notification and a shared invite link land. One card,
 * one Play button, and the game opens ON THIS PAGE with the invite's data handed
 * to it — the friend joins the room they were invited to rather than a lobby.
 * `docs/invites-design.md` has the whole design.
 *
 * ── HOW THE DATA REACHES THE GAME ──────────────────────────────────────────
 * Not through the URL: `/game-html/<slug>/` 307s to `/games/<slug>/index.html`
 * and drops any query. {@link InviteLanding} writes it to `sessionStorage`
 * (`sdk/src/launch.ts`) immediately before mounting `<PlayerOverlay>`, and the
 * SDK inside the same-origin game frame reads it once as it loads. A game hosted
 * on another origin cannot read it and gets `getLaunch() === null`; it still
 * opens and plays.
 *
 * ── WHAT A STRANGER LEARNS FROM A CODE ─────────────────────────────────────
 * The inviter's PUBLIC display name (handle, else `@username` — never the
 * Google name) and the game. No avatar, no profile link: an invite link gets
 * pasted into group chats, and sign-in is Google-only, so an avatar here would
 * often be a child's real photograph (`challenge-sharing-design.md` §7). The
 * metadata names nobody, and there is no preview image.
 *
 * ── ONE ANSWER FOR EVERY DEAD END ──────────────────────────────────────────
 * An unknown code, a collected one, a malformed one, and an invite to a STAGED
 * game this viewer cannot see all render the same "This invite has run out"
 * card linking home — the last must be indistinguishable from the others, or a
 * code would confirm a hidden game exists. Only a recently expired invite to a
 * public game also links to that game's page.
 *
 * ── DYNAMIC, NOINDEX, NEVER CACHED ─────────────────────────────────────────
 * It reads a per-code row (and, for a staged game only, the session), so it is
 * `force-dynamic`. `next.config.ts` sends `X-Robots-Tag` for `/i/`, the metadata
 * says `noindex`, `sw.js` treats `/i/` as private and the precache manifest
 * excludes it — the same layering `/c/` uses.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { getInvite, resolveInviteGame } from "@/app/lib/invites";
import { isValidInviteCode, normalizeInviteCode } from "@/app/lib/invites/code";
import { Wordmark } from "@/app/components/Wordmark";
import { InviteLanding } from "./InviteLanding";

export const metadata: Metadata = {
  title: "You're invited · HallPass",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/** The dead end. `game` is offered only for an expired invite to a public game. */
function RunOut({ game }: { game: { slug: string; title: string } | null }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-10">
      <div className="w-full max-w-md rounded-2xl bg-surface p-8 text-center">
        <Wordmark size="text-3xl" dotClass="h-2 w-2" />
        <h1 className="mt-4 text-2xl font-black tracking-tight text-foreground">
          This invite has run out
        </h1>
        <p className="mt-2 text-sm font-semibold text-muted">
          Invites only last a little while. Ask for a new one, or jump into a game on your own.
        </p>
        <div className="mt-6 flex flex-col items-center gap-3">
          {game ? (
            <Link
              href={`/game/${encodeURIComponent(game.slug)}`}
              className="inline-block rounded-full bg-brand px-6 py-2.5 text-sm font-extrabold text-white transition hover:bg-brand-600"
            >
              Play {game.title}
            </Link>
          ) : null}
          <Link
            href="/"
            className={
              game
                ? "text-sm font-bold text-muted underline-offset-4 hover:underline"
                : "inline-block rounded-full bg-brand px-6 py-2.5 text-sm font-extrabold text-white transition hover:bg-brand-600"
            }
          >
            Find a game
          </Link>
        </div>
      </div>
    </main>
  );
}

export default async function InvitePage({ params }: { params: Promise<{ code: string }> }) {
  const code = normalizeInviteCode((await params).code);
  const invite = isValidInviteCode(code) ? await getInvite(code) : null;
  if (!invite) return <RunOut game={null} />;

  // `null` for an unknown game AND for a staged one this viewer may not see.
  const target = await resolveInviteGame(invite.slug);
  if (!target) return <RunOut game={null} />;

  const expiresAt = Date.parse(invite.expiresAt);
  if (invite.expired || invite.secondsLeft <= 0 || !Number.isFinite(expiresAt)) {
    return <RunOut game={target.staged ? null : { slug: target.game.slug, title: target.game.title }} />;
  }

  // Whole minutes left by the DATABASE clock, rounded UP so a live invite never
  // reads "runs out in 0 minutes". Passed down so server and client render the
  // same text.
  const minutesLeft = Math.max(1, Math.ceil(invite.secondsLeft / 60));

  return (
    <InviteLanding
      game={target.game}
      from={invite.from}
      data={invite.data}
      expiresAt={expiresAt}
      minutesLeft={minutesLeft}
    />
  );
}
