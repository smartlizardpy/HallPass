/**
 * `/new` — the drops page.
 *
 * The site's "What's New" controls used to open the hosted ShipNote changelog in
 * a new tab: off-site, unindexable, and it sent a visitor away from the page
 * they had just been reading. This is the on-site version. ShipNote is still
 * where entries are written — `WhatsNewFrame` embeds it, and that component's
 * header carries the argument for framing rather than fetching.
 *
 * THE COPY AROUND THE FRAME IS THE POINT, not decoration. Frame content belongs
 * to the framed origin, so the changelog's own text is not ours to index; a page
 * that was nothing but an iframe would be a thin page with a title on it. The
 * heading and the paragraph below are what this URL actually says to a crawler,
 * and they are true whether or not the frame ever loads.
 *
 * It stays statically prerenderable — no session reads anywhere — so it is in
 * the service-worker precache like any other page. Only the frame needs the
 * network, which the page says out loud rather than showing a blank rectangle.
 */

import type { Metadata } from "next";
import { ArcadeShell } from "../components/ArcadeShell";
import { WhatsNewFrame } from "../components/WhatsNewFrame";
import { resolveCategories, resolveGames } from "../lib/games-store";
import { WHATS_NEW_PATH, whatsNewOrigin } from "../lib/whats-new";

const title = "What's New";
const description =
  "Every update to HALLPASS: new unblocked games, fixes and features, newest first.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: WHATS_NEW_PATH },
  openGraph: { type: "website", title, description, url: WHATS_NEW_PATH },
  twitter: { card: "summary_large_image", title, description },
};

export default async function WhatsNewPage() {
  const [games, categories] = await Promise.all([
    resolveGames(),
    resolveCategories(),
  ]);

  return (
    <>
      {/* The handshake to the changelog's origin, started before the frame asks
          for it — the same trick `app/game/[slug]/page.tsx` uses for an external
          game's origin, and for the same reason. */}
      <link rel="preconnect" href={whatsNewOrigin()} />
      <ArcadeShell games={games} categories={categories}>
        <div className="px-3 pb-10 pt-2 sm:px-8">
          <header className="mb-5 max-w-3xl">
            <h1 className="text-2xl font-black tracking-tight text-zinc-900 sm:text-3xl">
              What&apos;s New in HALLPASS
            </h1>
            <p className="mt-2 text-[15px] font-semibold leading-relaxed text-zinc-600">
              Every drop and every fix, newest first — new games as they land,
              plus the features around them. Nothing here needs an account, and
              the arcade itself keeps working offline once you have opened it.
            </p>
          </header>
          <WhatsNewFrame />
        </div>
      </ArcadeShell>
    </>
  );
}
