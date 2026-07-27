"use client";

import { useEffect, useState } from "react";
import type { PlayerAchievement } from "../lib/achievements/store";

/**
 * The achievements shelf on a game's store page.
 *
 * A CLIENT ISLAND, and it has to be — the same constraint `GameReviews`
 * documents. `/game/[slug]` must stay statically prerendered: one `auth()` on
 * that page makes the route dynamic, drops it from `prerender-manifest.json`,
 * and therefore drops all 27 game pages from the service-worker precache,
 * silently breaking offline play with no error anywhere. This shelf is
 * personalised (it shows THIS player's progress), so it cannot be server
 * rendered without doing exactly that. Server rendering it would also bake one
 * child's trophies into a prerender the PWA then serves to everyone.
 *
 * ── IT DECIDES FOR ITSELF WHETHER TO EXIST ──────────────────────────────────
 *
 * The component returns `null` until it has loaded, and returns `null` forever
 * if the game has no achievements. That is deliberate and it is why the parent
 * renders it unconditionally: 26 of the 27 games have nothing provisioned, and
 * an "Achievements" heading over an empty box on every one of them is worse than
 * no section at all. Only the fetch knows, so only the fetch may decide.
 *
 * ── WHY THERE IS NO SPINNER AND NO OFFLINE BANNER ───────────────────────────
 *
 * The service worker never intercepts `/api/`, so offline this fetch simply
 * rejects. A spinner would then spin forever, which is the one outcome the brief
 * rules out. A banner is barely better: offline we do not know whether this game
 * HAS achievements, so "Achievements need a connection" would appear on all 27
 * game pages including the 26 with none — a section that only ever exists when
 * it is broken. So a failed load is indistinguishable from an unprovisioned
 * game and both render nothing.
 *
 * The amber notice is spent where it is actually informative: SIGNED OUT. There
 * we know the shelf exists, we can show the whole locked list, and the notice
 * explains the one thing the player cannot otherwise work out — that playing
 * right now will not record anything.
 *
 * Nothing here is cached client-side, deliberately. A player's progress in
 * `localStorage` would be read by the NEXT child on a shared school computer;
 * this is exactly the data that must not outlive the session on a lab machine.
 */

type Shelf = {
  slug: string;
  /** Whether the progress below belongs to anyone. */
  signedIn: boolean;
  achievements: PlayerAchievement[];
  earnedPoints: number;
  totalPoints: number;
  /** `key -> 0..100`. Only present because we ask for `?rarity=1`. */
  rarity?: Record<string, number>;
};

export function GameAchievements({ slug }: { slug: string }) {
  const [shelf, setShelf] = useState<Shelf | null>(null);

  useEffect(() => {
    // `ignore` rather than an AbortController: the only thing that can change is
    // `slug`, and a resolved-but-stale response writing over a newer one is the
    // single failure this needs to prevent. Aborting would additionally cancel a
    // request that is nearly always already in flight for the page we are on.
    let ignore = false;
    (async () => {
      try {
        // `rarity=1` is opt-in on the API because it costs a second query; the
        // store page is precisely the caller that wants it.
        const res = await fetch(
          `/api/v1/games/${encodeURIComponent(slug)}/achievements?rarity=1`,
        );
        if (!res.ok || ignore) return;
        const body = (await res.json()) as Shelf;
        if (!ignore) setShelf(body);
      } catch {
        // Offline, or the API is down. Stay null — see the module docblock.
      }
    })();
    return () => {
      ignore = true;
    };
    // No `react-hooks/set-state-in-effect` suppression is needed here, unlike
    // `GameReviews`: the setState sits inside an async IIFE behind two awaits,
    // so the rule can already see it cannot cascade a synchronous render. Do not
    // "tidy" this into a bare `void load()` call at the top of the effect — that
    // is the shape the rule flags and the reason the sibling file carries a
    // disable comment.
  }, [slug]);

  // Not loaded, or this game has nothing provisioned. Either way there is no
  // section — never an empty heading, never a spinner.
  if (!shelf || shelf.achievements.length === 0) return null;

  const earned = shelf.achievements.filter((a) => a.unlocked).length;

  return (
    <section className="mt-5 rounded-3xl bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-black tracking-tight text-zinc-900">
          Achievements
        </h2>
        <p className="text-[13px] font-bold text-muted">
          <span className="text-zinc-900">
            {earned} of {shelf.achievements.length}
          </span>
          {shelf.totalPoints > 0 && (
            <>
              {" "}
              · {shelf.earnedPoints}/{shelf.totalPoints} pts
            </>
          )}
        </p>
      </div>

      {!shelf.signedIn && (
        <p className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
          Sign in to earn these — progress isn&rsquo;t saved while you&rsquo;re
          signed out.
        </p>
      )}

      {/* AUTHORED ORDER, never re-sorted by earned-first. The admin's order is
          the game's story order, and re-sorting on unlock would reshuffle the
          list under the player mid-session — the moment they are most likely to
          be looking at it. */}
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {shelf.achievements.map((achievement) => (
          <AchievementCard
            key={achievement.key}
            achievement={achievement}
            rarity={shelf.rarity?.[achievement.key]}
          />
        ))}
      </ul>
    </section>
  );
}

/** One tile: earned tiles are brand-tinted, locked ones recede. */
function AchievementCard({
  achievement,
  rarity,
}: {
  achievement: PlayerAchievement;
  rarity: number | undefined;
}) {
  const { unlocked, secret, target, progress, points } = achievement;
  const hidden = secret && !unlocked;
  // A counter, not a plain unlock. Shown while locked; once earned the number is
  // noise (the tile already says "Unlocked").
  const showBar = target > 1 && !unlocked;
  const pct = target > 1 ? Math.round((progress / target) * 100) : 0;

  return (
    <li
      className={`flex gap-3 rounded-2xl border p-4 transition ${
        unlocked
          ? "border-brand-100 bg-brand-50"
          : "border-border bg-surface-2/50"
      }`}
    >
      <span
        aria-hidden
        className={`text-2xl leading-none ${unlocked ? "" : "opacity-40 grayscale"}`}
      >
        {/* A placeholder glyph for an unearned secret. This is PRESENTATION, not
            a privacy control — the real control is server-side, where
            `mapPlayerAchievement` redacts the name and description before they
            reach the wire. The icon deliberately is not redacted there (it is a
            weak hint, and hiding it would be theatre), but rendering a themed
            emoji next to "Secret achievement" reads as a spoiler where a
            question mark reads as an invitation. */}
        {hidden ? "❓" : achievement.icon}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p
            className={`truncate text-[15px] font-extrabold ${
              unlocked ? "text-zinc-900" : "text-zinc-600"
            }`}
          >
            {achievement.name}
          </p>
          {points > 0 && (
            <span
              className={`shrink-0 text-[11px] font-black uppercase tracking-wider ${
                unlocked ? "text-brand" : "text-muted"
              }`}
            >
              {points} pt{points === 1 ? "" : "s"}
            </span>
          )}
        </div>

        <p className="mt-1 text-[13px] font-semibold leading-snug text-zinc-600">
          {hidden ? "Hidden until you find it." : achievement.description}
        </p>

        {showBar && (
          <div className="mt-2">
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={target}
              aria-valuenow={progress}
              aria-label={`${achievement.name} progress`}
              className="h-1.5 w-full overflow-hidden rounded-full bg-white"
            >
              {/* Inline width is the one thing Tailwind cannot express: the
                  value is per-player and continuous, so a utility class would
                  need 101 of them. */}
              <div
                className="h-full rounded-full bg-brand transition-[width]"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="mt-1 text-[11px] font-bold text-muted">
              {progress.toLocaleString()} / {target.toLocaleString()}
            </p>
          </div>
        )}

        <p className="mt-2 flex flex-wrap items-center gap-x-2 text-[11px] font-bold text-muted">
          {unlocked && <span className="text-brand">Unlocked</span>}
          {/* Rarity is rendered even at 0% — "0% of players" on a brand-new game
              is a true and interesting statement, and dropping the row would
              make the tile jump height the moment the first player earns it. */}
          {rarity !== undefined && <span>{rarity}% of players have this</span>}
        </p>
      </div>
    </li>
  );
}
