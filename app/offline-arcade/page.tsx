/**
 * `/offline-arcade` — "Build your arcade": choose games, download one ZIP that
 * plays them with no internet.
 *
 * STATIC. The catalog is `public/arcade/catalog.json`, written by
 * `npm run hpg:arcade` in `prebuild` (hpg/src/build/arcade.ts), and is read
 * here at build time, so the page and the files it offers always come from the
 * same deploy. The download itself is composed in the browser from those
 * prebuilt static files (hpg/src/compose.ts): no server work per download, and
 * every file is checked against this page's sha256 before it is zipped.
 *
 * When the arcade did not build (the catalog is missing or `available` is
 * false) the page says so plainly instead of offering a broken download.
 *
 * Linked from the site footer only; it is a utility, not a destination.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import { BackButton } from "../components/BackButton";
import { Wordmark } from "../components/Wordmark";
import { publicGames } from "../lib/games";
import type { ArcadeCatalog } from "@/hpg/src/build/arcade";
import { ArcadeBuilder, type BuilderGame } from "./ArcadeBuilder";

const title = "Offline Arcade";
const description = "Download HallPass games to play with no internet: pick your games and get one file that runs straight from your computer.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/offline-arcade" },
  openGraph: { type: "website", title, description, url: "/offline-arcade" },
};

function loadCatalog(): ArcadeCatalog | null {
  try {
    const c = JSON.parse(readFileSync(path.join(process.cwd(), "public", "arcade", "catalog.json"), "utf8")) as ArcadeCatalog;
    return c.format === "hpg-arcade-catalog" && c.version === 1 ? c : null;
  } catch {
    return null;
  }
}

export default function OfflineArcadePage() {
  const catalog = loadCatalog();
  const bySlug = new Map(publicGames.map((g) => [g.slug, g]));
  const games: BuilderGame[] = (catalog?.games ?? []).map((g) => {
    const site = bySlug.get(g.id);
    return {
      id: g.id,
      name: g.name,
      tagline: site?.tagline ?? g.description,
      category: g.category,
      size: g.size,
      cover: site?.coverUrl ?? `/games/${g.id}/cover.png`,
      gradient: site?.gradient ?? ["#7c2eef", "#1c1c28"],
    };
  });
  const available = !!catalog?.available && games.length > 0;

  return (
    <main className="min-h-screen bg-background px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <BackButton />
        <header className="mt-6 grid gap-3">
          <div className="flex items-center gap-2">
            <Wordmark size="text-3xl" dotClass="h-2 w-2" />
            <span className="rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-black uppercase tracking-wider text-brand">Offline</span>
          </div>
          <h1 className="text-3xl font-black tracking-tight text-foreground sm:text-4xl">Build your offline arcade</h1>
          <p className="max-w-2xl text-[15px] font-semibold leading-relaxed text-muted">
            Pick games, download one file, and play them with the internet off: on a train, on a plane, or anywhere the
            Wi-Fi gives up. Nothing to install and no account. It opens in Chrome, Edge or Firefox on a computer.
          </p>
        </header>

        {available ? (
          <ArcadeBuilder catalog={catalog!} games={games} />
        ) : (
          <section className="mt-10 rounded-3xl bg-surface p-8 text-center">
            <h2 className="text-xl font-black text-foreground">The offline arcade isn&rsquo;t available right now</h2>
            <p className="mt-2 text-[15px] font-semibold text-muted">Please check back soon. Every game still plays online.</p>
          </section>
        )}

        <section className="mt-12 grid gap-4 sm:grid-cols-3">
          {[
            ["Unzip it", "Open the download and extract the HallPass Arcade folder anywhere: your desktop, a USB stick."],
            ["Open index.html", "Double-click it. The first time, drop games.zip onto the page to add your games."],
            ["Play offline", "Your games and progress stay in the browser on that computer. Export saves to move them."],
          ].map(([h, p], i) => (
            <div key={h} className="rounded-3xl bg-surface p-5">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-50 text-sm font-black text-brand">{i + 1}</span>
              <h3 className="mt-3 text-base font-black text-foreground">{h}</h3>
              <p className="mt-1 text-sm font-semibold text-muted">{p}</p>
            </div>
          ))}
        </section>

        <p className="mt-8 text-[13px] font-semibold text-muted">
          Online features (accounts, global leaderboards, multiplayer) are switched off in the offline arcade, and scores
          stay on the computer you play on. It&rsquo;s made for computers: phones and tablets usually can&rsquo;t open
          a downloaded page like this.
        </p>
      </div>
    </main>
  );
}
