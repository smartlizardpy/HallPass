/**
 * HallPass — where the changelog lives, and where it is READ.
 *
 * Two URLs that must not drift apart:
 *   - {@link WHATS_NEW_URL} — the hosted ShipNote page, the source of truth. It
 *     is what `/new` frames, and what every "open it directly" escape hatch
 *     points at.
 *   - {@link WHATS_NEW_PATH} — our own page. This is what the site's "What's
 *     New" controls link to now; they used to open the hosted URL in a new tab,
 *     which sent a visitor off the site they had just been reading.
 *
 * The pair lives here rather than in `WhatsNewLink` (which owned the URL before
 * `/new` existed) because there are now four places that need one or the other:
 * the header pill, the dashboard rail, the page itself, and its escape hatch.
 * A changed ShipNote slug should be a one-line edit, not a hunt.
 *
 * PURE and dependency-free, so it can be imported from a server page, a client
 * component and the sitemap alike.
 */

/** The hosted ShipNote changelog. The source of truth, on somebody else's origin. */
export const WHATS_NEW_URL = "https://useshipnote.vercel.app/c/hallpass";

/** Our page that frames it. */
export const WHATS_NEW_PATH = "/new";

/** The origin the frame loads from — for a `preconnect`, so the handshake to it
 * is already done when the page paints. `app/game/[slug]/page.tsx` does the same
 * for an external game's origin, and for the same reason.
 *
 * Derived rather than typed out: two spellings of one origin is exactly the kind
 * of drift this module exists to prevent, and a preconnect to the wrong host is
 * silent — it costs a connection and buys nothing. */
export function whatsNewOrigin(): string {
  return new URL(WHATS_NEW_URL).origin;
}
