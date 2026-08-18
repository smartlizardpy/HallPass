import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * HallPass — the shared ingredients every generated social card is built from.
 *
 * Extracted from `app/c/[code]/opengraph-image.tsx`, which was the first and for
 * a long time the only card on the site. It is no longer the only one: the home
 * grid, every category and every tag page now mint their own, and four hand-
 * copied palettes are four chances for the brand to drift apart one card at a
 * time. The challenge card keeps its own layout — it says something none of the
 * others do — and imports the ingredients from here.
 *
 * ── SATORI, NOT A BROWSER ──────────────────────────────────────────────────
 * Everything rendered with these values goes through Satori, whose rules bit us
 * once already and are repeated here so the next card does not learn them again:
 *   - Every element with more than one child needs an explicit `display: flex`.
 *   - A React Fragment is NOT laid out as a flex child. Its children get hoisted
 *     and inherit the parent's axis. Use wrapper divs, never fragments.
 *   - Font WEIGHT does not vary without real font data — hence {@link nunito}.
 *   - There is no `text-transform`. Uppercase in code.
 *
 * ── THE PALETTE IS HAND-SYNCED ─────────────────────────────────────────────
 * A card renders outside the app's CSS entirely, so it cannot read the custom
 * properties in `globals.css` and these must be kept in step with them BY HAND.
 */

/** The size every card on the site is minted at. */
export const OG_SIZE = { width: 1200, height: 630 } as const;

export const INK = "#0b0616";
export const INK_MID = "#1b1033";
export const BRAND = "#7c2eef"; // --brand
export const DOT = "#ffc700"; // --accent-yellow, the wordmark's full stop
export const PAPER = "#ffffff";

/** Readable on `INK` at small sizes; plain grey goes muddy over a gradient. */
export const DIM = "rgba(255,255,255,0.62)";

/**
 * Nunito in the two weights the cards use, or `[]` to fall back to Satori's
 * built-in face.
 *
 * `next/font` caches WOFF2, which Satori cannot read, so these are separate TTFs
 * under `public/fonts/` rather than a shared asset. Loading them is FAIL-SOFT: a
 * missing file costs a card its typeface, never its existence.
 */
export async function nunito() {
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
 * A game's cover as a data URI, or `null`.
 *
 * Inlined rather than passed as a URL because Satori would have to fetch it, and
 * a preview card must not depend on a second network hop that a crawler's
 * timeout can lose. Blob-hosted (`coverUrl`) games are skipped for the same
 * reason — every card here is good without art.
 */
export async function coverDataUri(slug: string): Promise<string | null> {
  try {
    const bytes = await readFile(
      join(process.cwd(), "public", "games", slug, "cover.png"),
    );
    return `data:image/png;base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * The wordmark, as it appears on every card: `hallpass` with the yellow full
 * stop. A component rather than a copied pair of divs, because the dot's size
 * and offset are the kind of detail that drifts silently. Rounded rather than
 * fractional so the default (26) reproduces the challenge card's original
 * hand-written 10px dot at a 6px offset exactly.
 */
export function Wordmark({ size = 26 }: { size?: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        fontSize: size,
        fontWeight: 900,
        color: PAPER,
        letterSpacing: 1,
      }}
    >
      hallpass
      <div
        style={{
          width: size * 0.38,
          height: size * 0.38,
          borderRadius: 99,
          background: DOT,
          marginLeft: size * 0.23,
        }}
      />
    </div>
  );
}
