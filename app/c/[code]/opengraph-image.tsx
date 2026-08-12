import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { getLink } from "@/app/lib/challenges";
import { normalizeLinkCode } from "@/app/lib/challenges/link";
import { resolveGame } from "@/app/lib/games-store";

/**
 * The preview card a challenge link shows in a chat.
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
 * ── SATORI, NOT A BROWSER ──────────────────────────────────────────────────
 * `ImageResponse` renders through Satori, which is not a browser engine:
 *   - Every element with more than one child needs an explicit `display: flex`.
 *   - A React Fragment is NOT laid out as a flex child. Its children get
 *     hoisted and inherit the parent's axis, which silently turned an earlier
 *     version of this card into one row running off both edges. Use wrapper
 *     divs, never fragments.
 *   - Font WEIGHT does not vary without real font data. Nunito — the face the
 *     rest of the site uses via `next/font` — is therefore loaded from
 *     `public/fonts/` in two weights. `next/font` caches WOFF2, which Satori
 *     cannot read, so these are separate TTFs rather than a shared asset.
 *     Loading them is FAIL-SOFT: a missing file costs the card its typeface,
 *     never its existence.
 */

export const alt = "A HallPass challenge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Palette, inlined — this renders outside the app's CSS entirely, so it cannot
 * read the custom properties in `globals.css` and these must be kept in step
 * with them BY HAND.
 */
const INK = "#0b0616";
const INK_MID = "#1b1033";
const BRAND = "#7c2eef"; // --brand
const DOT = "#ffc700"; // --accent-yellow, the wordmark's full stop
const PAPER = "#ffffff";

/** Readable on `INK` at small sizes; plain grey goes muddy over a gradient. */
const DIM = "rgba(255,255,255,0.62)";

/**
 * Nunito in the two weights this card uses, or `[]` to fall back to Satori's
 * built-in face. Read once per render; Next caches the route's output anyway,
 * and a preview is fetched by crawlers rather than in a hot path.
 */
async function nunito() {
  try {
    const [semibold, black] = await Promise.all([
      readFile(join(process.cwd(), "public", "fonts", "nunito-600.ttf")),
      readFile(join(process.cwd(), "public", "fonts", "nunito-900.ttf")),
    ]);
    return [
      { name: "Nunito", data: semibold, weight: 600 as const, style: "normal" as const },
      { name: "Nunito", data: black, weight: 900 as const, style: "normal" as const },
    ];
  } catch {
    return [];
  }
}

/**
 * The game's cover as a data URI, or `null`.
 *
 * Inlined rather than passed as a URL because Satori would have to fetch it,
 * and a preview card must not depend on a second network hop that a crawler's
 * timeout can lose. `coverUrl` games (blob-hosted) are skipped for the same
 * reason — the card is good without art.
 */
async function coverDataUri(slug: string): Promise<string | null> {
  try {
    const bytes = await readFile(
      join(process.cwd(), "public", "games", slug, "cover.png"),
    );
    return `data:image/png;base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

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
          <div
            style={{
              display: "flex",
              alignItems: "center",
              fontSize: 26,
              fontWeight: 900,
              color: PAPER,
              letterSpacing: 1,
            }}
          >
            hallpass
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: 99,
                background: DOT,
                marginLeft: 6,
              }}
            />
          </div>

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
