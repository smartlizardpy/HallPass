import { ImageResponse } from "next/og";
import { getLink } from "@/app/lib/challenges";
import { normalizeLinkCode } from "@/app/lib/challenges/link";
import { resolveGame } from "@/app/lib/games-store";
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
 * A HallPass CHALLENGE card.
 *
 * This is the first thing almost everybody sees of HallPass — before the
 * landing page, before the game. In a Snapchat or WhatsApp thread the card IS
 * the pitch, and it is competing for a thumb against everything else in the
 * conversation.
 *
 * ── IT WEARS THE GAME'S OWN COLOURS ────────────────────────────────────────
 * Every game in `lib/games.ts` carries a `gradient` and an `accent` — the
 * identity it already uses on its card in the arcade — and the cover art sits
 * at `public/games/<slug>/cover.png`. Using them means a challenge to Neon
 * Velocity looks like Neon Velocity rather than like a form, and thirty links
 * in a group chat do not all look like the same grey rectangle.
 *
 * THE GRADIENT RUNS INTO DARKNESS ON THE TEXT SIDE, deliberately. Game accents
 * include `#00e5ff` and `#ffc700`; white type on those is unreadable. Anchoring
 * the dark end under the words means the card cannot be made illegible by a
 * game whose colours happen to be pale, while the colourful end still reads as
 * that game behind the art.
 *
 * ── IT CARRIES A HANDLE AND A NUMBER. NO AVATAR. ───────────────────────────
 * The store does not select one (see `LinkOwner`), and this is the surface that
 * decision was made for. A preview is fetched by the CHAT PLATFORM and cached
 * on ITS servers and on the devices of everybody in the thread — so it travels
 * further than the page it advertises and is the hardest thing to un-publish.
 * Sign-in is Google-only, so an avatar here would frequently be a real
 * photograph of a child.
 *
 * ── EVERY INGREDIENT IS OPTIONAL ───────────────────────────────────────────
 * No game, no cover file, a revoked code, a mistyped one: each degrades to a
 * simpler card rather than an error. Some platforms cache a failed preview and
 * keep showing a grey box long after the link works again, so a plain card is
 * always the better failure — and the generic one names nobody.
 *
 * ── THE PALETTE, THE FONTS AND THE SATORI RULES LIVE IN `lib/og/brand` ─────
 * They are shared with the listing cards the home grid, the categories and the
 * tag pages mint. Read that header before editing anything below: Satori is not
 * a browser, and its constraints (explicit `display: flex`, no Fragments as
 * flex children, no `text-transform`, no font weights without real font data)
 * are documented there rather than repeated here.
 */

export const alt = "A HallPass challenge";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const fonts = await nunito();
  const code = normalizeLinkCode((await params).code);
  const link = code ? await getLink(code) : null;
  const live = link && link.revokedAt === null ? link : null;

  const game = live?.gameSlug
    ? ((await resolveGame(live.gameSlug).catch(() => undefined)) ?? null)
    : null;
  const cover = game && !game.externalUrl ? await coverDataUri(game.slug) : null;

  // The game's own colours, with brand purple as the fallback for a board that
  // belongs to no game.
  const hot = game?.gradient?.[0] ?? BRAND;
  const accent = game?.accent ?? DOT;

  if (!live) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: `linear-gradient(120deg, ${INK} 0%, ${INK_MID} 100%)`,
          }}
        >
          <div style={{ display: "flex", fontSize: 30, fontWeight: 900, color: DIM, letterSpacing: 6 }}>
            HALLPASS
          </div>
          <div
            style={{ display: "flex", marginTop: 24, fontSize: 64, fontWeight: 900, color: PAPER }}
          >
            Beat somebody&apos;s high score
          </div>
        </div>
      ),
      { ...size, fonts },
    );
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          // Dark under the words, the game's colour out to the right where the
          // art sits — see the header.
          background: `linear-gradient(110deg, ${INK} 0%, ${INK} 38%, ${INK_MID} 62%, ${hot} 130%)`,
        }}
      >
        {/* WORDS ------------------------------------------------------------ */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: "64px 56px",
            width: cover ? 700 : 1200,
          }}
        >
          <Wordmark />

          {/* The dare. One expression, so there is no JSX text whose leading
              space can be trimmed away — see the note in ChallengeLanding. */}
          <div
            style={{
              display: "flex",
              marginTop: 30,
              fontSize: 30,
              fontWeight: 900,
              color: accent,
              letterSpacing: 3,
              // Uppercased in code: Satori has no `text-transform`.
            }}
          >
            {`${live.owner.displayName.toUpperCase()} DARES YOU TO BEAT`}
          </div>

          <div
            style={{
              display: "flex",
              fontSize: 176,
              fontWeight: 900,
              color: PAPER,
              lineHeight: 1,
              marginTop: 2,
              letterSpacing: -4,
            }}
          >
            {live.targetScore.toLocaleString("en-US")}
          </div>

          {/*
            THE GAME GETS ITS OWN LINE. Folded into the sentence above as
            "points to beat on Neon Velocity: Hyperdrive" it wrapped to an
            orphaned "Hyperdrive", and any longer title would be worse. As a
            separate element a long name simply takes two tidy lines.
          */}
          <div
            style={{
              display: "flex",
              marginTop: 8,
              fontSize: 40,
              fontWeight: 900,
              color: PAPER,
              maxWidth: 560,
              lineHeight: 1.15,
            }}
          >
            {game?.title ?? live.boardTitle}
          </div>

          <div
            style={{
              display: "flex",
              marginTop: 26,
              fontSize: 24,
              fontWeight: 600,
              color: DIM,
            }}
          >
            Tap to play · no account needed
          </div>
        </div>

        {/* ART -------------------------------------------------------------- */}
        {cover ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 500,
              height: "100%",
            }}
          >
            <img
              src={cover}
              alt=""
              width={380}
              height={380}
              style={{
                borderRadius: 36,
                objectFit: "cover",
                border: `6px solid rgba(255,255,255,0.16)`,
              }}
            />
          </div>
        ) : null}
      </div>
    ),
    { ...size, fonts },
  );
}
