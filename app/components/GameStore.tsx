"use client";

import Link from "next/link";
import posthog from "posthog-js";
import { useState } from "react";
import type { Game } from "../lib/games";
import { type GameMedia, mediaPublicPath } from "../lib/game-media-blob";
import { useFavorites } from "../lib/personalization";
import { useOpenGame } from "./ArcadeShell";
import { PlatformConfirmSheet, usePlayGuard } from "./PlatformGate";
import { CoverImage, coverImageSrc } from "./CoverImage";
import { GameCard } from "./GameCard";
import { GameAchievements } from "./GameAchievements";
import { GameReviews } from "./reviews/GameReviews";
import { GameTrailer } from "./GameTrailer";
import { ChallengedHere } from "./ChallengedHere";
import { FriendsWhoPlay } from "./friends/FriendsWhoPlay";
import { ScreenshotGallery } from "./ScreenshotGallery";

/**
 * A game's store page body.
 *
 * LAYOUT is lifted from a Steam-style listing: a title tab above a hero card
 * that splits media (left) from a metadata rail and the Play button (right),
 * then About, then reviews. The SKIN is entirely ours.
 *
 * That distinction is the design brief and worth stating, because the temptation
 * is to copy the chrome too. The reference is dark, boxy and dense; this site is
 * light, rounded and chunky, with no dark variant anywhere in the stylesheet. So
 * what is borrowed is the information architecture — what sits where, and what
 * the eye reaches in what order — while every surface stays white on `#f4f4f7`,
 * corners stay `rounded-3xl`, and the primary action stays brand purple rather
 * than the reference's green.
 *
 * The game's own colour enters only as a ≤18% wash behind the hero and as the
 * title tab's rule (`.game-hero` / `.game-title-tab` in globals.css).
 * `game.accent` is never used for text: 8 of the 28 catalogue values fall below
 * 3:1 contrast on white, and an admin can type any hex for an external game.
 */
export function GameStore({
  game,
  media,
  related,
  plays,
  credit = null,
  testers = [],
  video = null,
}: {
  game: Game;
  media: GameMedia[];
  related: Game[];
  plays: number;
  /**
   * Who made this game, or `null` when nobody has been credited — which renders
   * no row at all rather than a placeholder, because inventing attribution is
   * worse than having none.
   *
   * OPTIONAL AND NULLABLE ON PURPOSE. Most games have no credit, and a byline is
   * decoration: a caller that forgets to pass one must not take a whole store
   * page down over it.
   */
  credit?: string | null;
  /**
   * Display names of the beta testers who finished a playtest of this game.
   *
   * Already reduced to strings by `getGameTesters()` on the server — this
   * component is a client component, so handing it player rows would ship
   * identifiers to the browser for a decorative credit line. Defaults to `[]`
   * so every existing call site is unchanged.
   */
  testers?: string[];
  /**
   * A gameplay/intro video, or `null` when the game has none — which renders no
   * switch at all, leaving the media column exactly as it was before the feature.
   *
   * STRUCTURALLY TYPED, not `GameVideo`. `app/lib/game-videos.ts` is `server-only`
   * and must never enter a browser bundle's import graph, so the shape is spelled
   * out here and the page maps its row into it — the same reason `credit` arrives
   * as a plain string rather than as a `GameCredit`.
   */
  video?: { id: string; label: string } | null;
}) {
  const openGame = useOpenGame();
  // This page's ▶ buttons are the game itself plus the related rail, so the guard
  // needs both — a related card is as likely to be device-mismatched as the
  // headline game, and it opens the same fullscreen player.
  const { requestPlay, pending, confirmPlay, cancelPlay } = usePlayGuard(
    [game, ...related],
    openGame,
  );
  const { isFavorite, toggleFavorite } = useFavorites();

  /**
   * Which side of the media switch is showing. Defaults to the video when there is
   * one, because it answers "what is this like to play" and a still cannot.
   *
   * Every read is guarded by `video &&` rather than trusting this flag alone: the
   * page keys this component on the slug so the state cannot survive a navigation,
   * but a `true` here with a `null` video must be inert regardless of that.
   */
  const [showVideo, setShowVideo] = useState(video !== null);

  const favorited = isFavorite(game.slug);
  const categoryHref = `/category/${encodeURIComponent(game.category.toLowerCase())}`;
  const hasShots = media.length > 0;
  const firstShot = media[0];
  // The cover is a picture of the game like any other, so it leads the gallery
  // instead of sitting in the rail. On a phone the rail stacks UNDER the media
  // column, which turned one image region into two stacked ones with no
  // explanation of why the second was there.
  const coverSrc = coverImageSrc(game);
  const hasGallery = hasShots || coverSrc !== null;

  const handleToggleFavorite = (slug: string) => {
    const target = slug === game.slug ? game : related.find((g) => g.slug === slug);
    posthog.capture(isFavorite(slug) ? "game_unfavorited" : "game_favorited", {
      game_slug: slug,
      game_title: target?.title,
      game_category: target?.category,
    });
    toggleFavorite(slug);
  };

  const accentVars = {
    "--g-from": game.gradient[0],
    "--g-to": game.gradient[1],
    "--g-accent": game.accent,
  } as React.CSSProperties;

  return (
    <div className="px-3 pb-10 pt-2 sm:px-8" style={accentVars}>
      {/* Renders nothing until a device-mismatched ▶ is pressed. */}
      <PlatformConfirmSheet
        game={pending}
        onConfirm={confirmPlay}
        onCancel={cancelPlay}
      />

      {/* Breadcrumb — mirrors the JSON-LD BreadcrumbList exactly, encoding
          included, so the two can never disagree. */}
      <nav aria-label="Breadcrumb" className="mb-3 text-[13px] font-bold text-muted">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/" className="hover:text-brand">
              HALLPASS
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li>
            <Link href={categoryHref} className="hover:text-brand">
              {game.category}
            </Link>
          </li>
        </ol>
      </nav>

      {/* TITLE BAR — the reference's folder-tab header.
          It originally overlapped the hero by 8px as a deliberate "tuck", but
          that read as the title COLLIDING with the card rather than sitting on
          it, so it now stands clear with its own margin. The per-game accent
          appears as a thick left rule (see `.game-title-tab`), which is a use
          `--g-accent` is safe for — unlike text, where 8 of 28 catalogue values
          fall below 3:1 on white. */}
      <div className="game-title-tab mb-3 inline-block max-w-full rounded-2xl bg-white py-3 pl-4 pr-5 shadow-sm">
        <h1 className="truncate text-xl font-black leading-tight tracking-tight text-zinc-900 sm:text-2xl">
          {game.title}
        </h1>
      </div>

      {/* HERO — media left, metadata rail + Play right. */}
      <section className="game-hero grid gap-5 rounded-3xl p-4 sm:gap-6 sm:p-6 lg:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          {/* MEDIA SWITCH — rendered only when there is a genuine choice, i.e. a
              video AND screenshots. A game with a video and no stills just shows
              the video; a game with no video is untouched by this feature.

              `aria-pressed` toggle buttons rather than a `role="tablist"`. Tabs
              come with an arrow-key contract, and ScreenshotGallery already binds
              ArrowLeft/ArrowRight on its own container to step slides — a tablist
              directly above it would fight that handler for the same keys. Toggle
              buttons carry no such contract and stay unambiguous. */}
          {video && hasShots && (
            <div
              role="group"
              aria-label={`${game.title} media`}
              className="mb-2 inline-flex gap-1 rounded-full bg-white/70 p-1"
            >
              <MediaSwitch pressed={showVideo} onClick={() => setShowVideo(true)}>
                {video.label}
              </MediaSwitch>
              <MediaSwitch pressed={!showVideo} onClick={() => setShowVideo(false)}>
                Screenshots
              </MediaSwitch>
            </div>
          )}

          {video && showVideo ? (
            <GameTrailer
              videoId={video.id}
              label={video.label}
              title={game.title}
              onPlay={() =>
                posthog.capture("game_video_played", {
                  game_slug: game.slug,
                  game_title: game.title,
                  game_category: game.category,
                  video_label: video.label,
                })
              }
              // Only offered when there is somewhere to go back TO.
              onExit={hasShots ? () => setShowVideo(false) : undefined}
              poster={
                firstShot ? (
                  // Decorative: it sits behind a play button whose accessible name
                  // already says which game and which video this is.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={mediaPublicPath(firstShot)}
                    alt=""
                    width={firstShot.width}
                    height={firstShot.height}
                    loading="eager"
                    fetchPriority="high"
                    decoding="async"
                    aria-hidden
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                ) : (
                  <CoverImage
                    game={game}
                    initialClass="text-7xl sm:text-8xl"
                    loading="eager"
                    fetchPriority="high"
                  />
                )
              }
            />
          ) : hasGallery ? (
            <ScreenshotGallery media={media} title={game.title} cover={coverSrc} />
          ) : (
            <div className="relative aspect-[16/10] w-full overflow-hidden rounded-2xl bg-zinc-900">
              <CoverImage
                game={game}
                initialClass="text-7xl sm:text-8xl"
                loading="eager"
                fetchPriority="high"
              />
            </div>
          )}
        </div>

        {/* RAIL */}
        <aside className="flex min-w-0 flex-col gap-4">
          <p className="text-[15px] font-bold leading-snug text-zinc-700">
            {game.tagline}
          </p>

          {/* SPEC SHEET — every row here says something about THIS game.
              A row whose value is the same for the whole catalogue is filler
              dressed as data and costs the rows around it their weight, which
              is why there is no "Plays in — Your browser" row: every game in
              the catalogue plays in the browser, so it never distinguished one
              from another. Nullable facts (`credit`, `testers`, `platform`)
              omit their row rather than render a placeholder. */}
          <dl className="divide-y divide-border rounded-2xl bg-white/70 px-4 text-[13px]">
            <MetaRow label="Plays">{plays.toLocaleString()}</MetaRow>
            <MetaRow label="Genre">
              <Link href={categoryHref} className="font-bold text-brand hover:text-brand-600">
                {game.category}
              </Link>
            </MetaRow>
            {game.tags.length > 0 && (
              <MetaRow label="Tags">
                {/* Plain text, not links: there is no /tag/[tag] route, and
                    /category/<tag> would 404 for any tag that is not also a
                    category. Kept anyway, unlike the constant row this rail
                    used to carry: tags are per-game, they are the only place
                    on the site a player can READ them, and they are not the
                    dead end the missing route makes them look — the arcade's
                    search matches `game.tags` (see `Arcade`), so a tag scanned
                    here is a term that works in the box at the top of the
                    site. Do not turn them into links without a route to
                    land on. */}
                {game.tags.join(", ")}
              </MetaRow>
            )}
            {credit && (
              <MetaRow label="By">
                <span className="font-bold text-zinc-900">{credit}</span>
              </MetaRow>
            )}
            {/* Who playtested this before it shipped. A fact about the game, the
                same for every visitor and for the crawler, so it belongs in the
                spec sheet beside the byline rather than in a client island.
                Display names only — `getGameTesters` reduces rows to
                `publicDisplayName()` on the server, so no identifier reaches the
                browser. */}
            {testers.length > 0 && (
              <MetaRow label="Tested by">
                <span className="font-bold text-zinc-900">
                  {testers.join(", ")}
                </span>
              </MetaRow>
            )}
            {/* Rendered from the tag ALONE, with no reference to the visitor's
                device — a fact about the game, the same for everyone and for the
                crawler. The device-aware treatment is the badge and the sort;
                this row is just the spec sheet. Untagged games omit it rather
                than claiming anything. */}
            {game.platform && (
              <MetaRow label="Best on">
                {game.platform === "both"
                  ? "Desktop or mobile"
                  : game.platform === "mobile"
                    ? "Mobile — touch controls"
                    : "Desktop — keyboard controls"}
              </MetaRow>
            )}
          </dl>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => requestPlay(game.slug)}
              style={{ touchAction: "manipulation" }}
              className="flex flex-1 items-center justify-center gap-2 rounded-full bg-brand px-6 py-4 text-base font-extrabold text-white shadow-lg shadow-brand/25 transition hover:bg-brand-600 active:scale-[0.98] focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/30"
            >
              <svg width="16" height="16" viewBox="0 0 14 14" fill="currentColor">
                <path d="M3 1.5v11l10-5.5z" />
              </svg>
              Play now
            </button>
            <button
              type="button"
              aria-pressed={favorited}
              aria-label={favorited ? "Remove from favorites" : "Add to favorites"}
              onClick={() => handleToggleFavorite(game.slug)}
              style={{ touchAction: "manipulation" }}
              className={`grid h-14 w-14 shrink-0 place-items-center rounded-full border border-border bg-white transition hover:bg-surface-2 active:scale-90 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/30 ${
                favorited ? "text-accent-pink" : "text-zinc-400"
              }`}
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill={favorited ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth={favorited ? 0 : 2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="pointer-events-none"
              >
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
              </svg>
            </button>
          </div>

          {/* Above "friends play this": an open challenge is something to act
              on, while who plays it is context. Both render null when they have
              nothing, so neither leaves a gap. */}
          <ChallengedHere slug={game.slug} />
          <FriendsWhoPlay slug={game.slug} />
        </aside>
      </section>

      {/* ABOUT — its own card, narrower than the hero, as in the reference.
          `whitespace-pre-line` because the copy is plain text with real line
          breaks; there is no markdown dependency in this repo. */}
      <section className="mt-5 max-w-3xl rounded-3xl bg-white p-5 sm:p-6">
        <h2 className="text-[11px] font-black uppercase tracking-wider text-muted">
          About this game
        </h2>
        <p className="mt-3 whitespace-pre-line text-[15px] font-semibold leading-relaxed text-zinc-700">
          {game.description}
        </p>
      </section>

      {/* Renders nothing at all unless this game has achievements provisioned —
          the island decides that itself after fetching, because only the fetch
          knows and 26 of 27 games have none. */}
      <GameAchievements slug={game.slug} />

      <GameReviews slug={game.slug} title={game.title} />

      {related.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-5 text-lg font-black tracking-tight text-zinc-900">
            More like this
          </h2>
          <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {related.map((g) => (
              <GameCard
                key={g.slug}
                game={g}
                onPlay={requestPlay}
                isFavorite={isFavorite(g.slug)}
                onToggleFavorite={handleToggleFavorite}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** One side of the video/screenshots switch above the hero media. */
function MediaSwitch({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      style={{ touchAction: "manipulation" }}
      className={`rounded-full px-3.5 py-1.5 text-[12px] font-black uppercase tracking-wider transition focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/30 ${
        pressed
          ? "bg-brand text-white shadow-sm"
          : "text-muted hover:bg-white hover:text-zinc-900"
      }`}
    >
      {children}
    </button>
  );
}

/** One label/value row in the hero rail's metadata table. */
function MetaRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2.5">
      <dt className="shrink-0 text-[11px] font-black uppercase tracking-wider text-muted">
        {label}
      </dt>
      <dd className="min-w-0 truncate text-right font-bold text-zinc-900">
        {children}
      </dd>
    </div>
  );
}
