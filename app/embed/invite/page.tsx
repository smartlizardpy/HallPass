/**
 * The invite picker — the small panel a game opens through `HallPass.invite()`.
 *
 *   /embed/invite?game=<slug>&data=<json>&n=<nonce>&ttl=<minutes>
 *
 * Built like the challenge picker (`app/embed/challenge/page.tsx`, whose header
 * explains why this is a first-party page rather than a widget the SDK draws):
 * the friend list is read HERE, server-side, with the session cookie, and the
 * game never sees it. The SDK sizes a frame and listens.
 *
 * ── WHAT IS CHECKED BEFORE ANYTHING IS SHOWN ───────────────────────────────
 * The game must be one the viewer may invite people to — `resolveInviteGame`,
 * which answers a hidden staged game exactly like an unknown one — and the data
 * must already be a JSON object of at most 1 KB. Either failing renders a short
 * notice with a Close button, never an error page: an inline frame has no window
 * chrome, so a page with no way out would sit over the game until the SDK's
 * timeout. The route re-checks everything (it is the authority); this is so the
 * player is never offered a button that cannot work.
 *
 * ── WHO IS LISTED ──────────────────────────────────────────────────────────
 * Accepted friends with no block either way and — for a staged game — only
 * those who can see staged games. Friends already invited to this game in the
 * last ten minutes are listed as "Invited", not offered again.
 *
 * ── PER-VIEWER, PROTECTED IN TWO PLACES ────────────────────────────────────
 * It calls `auth()`, so it is dynamic and never precached, and `sw.js` lists
 * `/embed/` as private. `robots: noindex`.
 */

import type { Metadata } from "next";
import { auth } from "@/app/lib/auth";
import { getInvitableFriends, resolveInviteGame } from "@/app/lib/invites";
import { clampExpiryMinutes, inviteRefusalText } from "@/app/lib/invites/config";
import { parseInviteDataParam } from "@/app/lib/invites/data";
import { InviteEmbed } from "./InviteEmbed";

export const metadata: Metadata = {
  title: "Invite friends",
  robots: { index: false, follow: false },
};

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** The SDK's nonce is hex; anything else is not ours and is dropped. */
const NONCE_RE = /^[0-9a-z]{1,40}$/;

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function InviteEmbedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const slug = first(params.game);
  const nonce = NONCE_RE.test(first(params.n)) ? first(params.n) : "";
  const ttlRaw = first(params.ttl);
  const minutes = clampExpiryMinutes(ttlRaw === "" ? undefined : Number(ttlRaw)) ?? 30;

  // `auth()` rather than `currentPlayerId()`, as in the challenge picker.
  const session = await auth().catch(() => null);
  const playerId = session?.user?.playerId ?? null;

  const payload = parseInviteDataParam(first(params.data));
  const target = SLUG_RE.test(slug) ? await resolveInviteGame(slug) : null;

  let problem: string | null = null;
  if (!target) problem = inviteRefusalText("unknown-game");
  else if (!payload) problem = inviteRefusalText("bad-request");

  const friends = target && payload && playerId ? await getInvitableFriends(playerId, target) : [];

  return (
    <main className="p-3">
      <InviteEmbed
        nonce={nonce}
        signedIn={Boolean(playerId)}
        problem={problem}
        game={target ? { slug: target.game.slug, title: target.game.title } : null}
        data={payload?.data ?? null}
        minutes={minutes}
        friends={friends}
      />
    </main>
  );
}
