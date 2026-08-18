import "server-only";
import { ImageResponse } from "next/og";
import type { Game } from "@/app/lib/games";
import {
  BRAND,
  DIM,
  DOT,
  INK,
  INK_MID,
  OG_SIZE,
  PAPER,
  Wordmark,
  coverDataUri,
  nunito,
} from "@/app/lib/og/brand";

/**
 * ONE renderer for every LISTING card on the site — the home grid, each
 * category, each tag.
 *
 * All three advertise the same kind of thing: a titled shelf of games. They
 * differ only in what the shelf is called and which games are on it, so they are
 * one function with three call sites rather than three near-identical card files
 * that would answer "what colour is the subhead" differently within a month.
 *
 * The GAME PAGE and the CHALLENGE card are deliberately NOT built from this.
 * Each advertises a single specific thing — one game, one score to beat — and
 * flattening them into a shelf would lose the point of both.
 *
 * ── IT WEARS THE SHELF'S OWN COLOURS ───────────────────────────────────────
 * The first listed game's `gradient` and `accent` tint the card, exactly as the
 * challenge card wears the challenged game's. Two consequences worth stating:
 * the shooter shelf and the puzzle shelf do not arrive in a group chat as the
 * same rectangle, and the colour follows the catalogue — reorder the shelf and
 * the card follows, with nothing to keep in sync by hand.
 *
 * THE GRADIENT RUNS INTO DARKNESS UNDER THE WORDS, for the reason the challenge
 * card's header gives at length: accents include `#00e5ff` and `#ffc700`, and
 * white type on those is unreadable.
 *
 * ── EVERY INGREDIENT IS OPTIONAL ───────────────────────────────────────────
 * No games, no cover files on disk, a shelf of nothing but external games: each
 * degrades to a plainer card, never to an error. A chat platform caches a FAILED
 * preview and keeps serving the grey box long after the URL is fixed, so a plain
 * card is always the better failure.
 *
 * Satori's rules — explicit `display: flex`, no Fragments as flex children, no
 * `text-transform` — are documented in `brand.tsx`. Read that first.
 */

/** How many covers fit across the art strip at a legible size. */
const COVER_COUNT = 4;
const COVER_W = 240;
const COVER_H = 180;

export async function listingCard({
  kicker,
  headline,
  subhead,
  games,
}: {
  /** Small, uppercase, above the headline. Uppercased here — Satori has none. */
  kicker: string;
  /** The shelf's name. The one line somebody actually reads in a chat. */
  headline: string;
  /** One quiet line under it: how many games, and what it costs. */
  subhead: string;
  /**
   * The shelf, in the order it renders on the page. The first game tints the
   * card; the first {@link COVER_COUNT} with art on disk fill the strip.
   */
  games: Game[];
}): Promise<ImageResponse> {
  const fonts = await nunito();

  // Blob-hosted covers are skipped by `coverDataUri` (a card must not depend on
  // a second network hop a crawler's timeout can lose), so ask MORE games than
  // there are slots and take the first that answer.
  const candidates = games.filter((g) => !g.externalUrl).slice(0, COVER_COUNT * 3);
  const covers = (
    await Promise.all(candidates.map((g) => coverDataUri(g.slug)))
  )
    .filter((uri): uri is string => uri !== null)
    .slice(0, COVER_COUNT);

  const hot = games[0]?.gradient?.[0] ?? BRAND;
  const accent = games[0]?.accent ?? DOT;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "56px 64px",
          background: `linear-gradient(140deg, ${INK} 0%, ${INK} 42%, ${INK_MID} 78%, ${hot} 150%)`,
        }}
      >
        {/* WORDS ------------------------------------------------------------ */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <Wordmark />

          <div
            style={{
              display: "flex",
              marginTop: 34,
              fontSize: 28,
              fontWeight: 900,
              color: accent,
              letterSpacing: 3,
            }}
          >
            {kicker.toUpperCase()}
          </div>

          {/* One expression, not JSX text, so no leading space can be trimmed
              away — the note in ChallengeLanding applies here too. */}
          <div
            style={{
              display: "flex",
              marginTop: 4,
              fontSize: covers.length > 0 ? 82 : 104,
              fontWeight: 900,
              color: PAPER,
              lineHeight: 1.05,
              letterSpacing: -2,
              maxWidth: 1000,
            }}
          >
            {headline}
          </div>

          <div
            style={{
              display: "flex",
              marginTop: 20,
              fontSize: 26,
              fontWeight: 600,
              color: DIM,
            }}
          >
            {subhead}
          </div>
        </div>

        {/* ART — absent entirely when nothing on the shelf has a cover on disk,
            rather than leaving a reserved gap the words could have used. */}
        {covers.length > 0 ? (
          <div style={{ display: "flex", gap: 24 }}>
            {covers.map((uri, i) => (
              /* Satori renders this, not a browser: `next/image` has nothing to
                 optimise here and would not run. The metadata-route files get
                 this exemption from the lint rule automatically; a shared module
                 that renders INTO one does not. */
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={uri}
                alt=""
                width={COVER_W}
                height={COVER_H}
                style={{
                  borderRadius: 22,
                  objectFit: "cover",
                  border: "5px solid rgba(255,255,255,0.16)",
                }}
              />
            ))}
          </div>
        ) : null}
      </div>
    ),
    { ...OG_SIZE, fonts },
  );
}
