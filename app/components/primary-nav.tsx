/**
 * HallPass — the site's primary destinations, as data.
 *
 * WHY THIS IS ITS OWN MODULE. Games / Friends / You used to be private to
 * `Sidebar`, which was fine while the rail was the only surface that drew them.
 * It is not any more: the top bar shows the same three destinations, and two
 * hand-copied lists would drift. The `match` predicates are the dangerous half —
 * their asymmetry (see `PRIMARY_NAV` below) is subtle enough that a second copy
 * would eventually be "corrected" into a bug where two rows light up at once.
 * One definition, imported by every surface that shows them.
 *
 * NO `"use client"` HERE, DELIBERATELY. Nothing in this file touches state,
 * effects or browser APIs — it is a table, two pure string helpers and an SVG
 * wrapper — so it has no reason to be a client ENTRY POINT. A file with no
 * directive takes the boundary of whoever imports it: pulled into `Sidebar`
 * (which is `"use client"`) it is bundled for the client like any other module
 * in that graph, while a Server Component could read `href`/`label` off it
 * without forcing the file across the network boundary. Adding the directive
 * would buy nothing and throw that second option away.
 *
 * The `match` FUNCTIONS are safe for the same reason. Serializability only
 * constrains PROPS handed from a Server Component to a Client Component; these
 * cross no boundary at all, because consumers `import` them and call them in
 * their own environment. The one shape that would break is passing a
 * `PRIMARY_NAV` entry from a server component into a client one as a prop —
 * don't; import it on the client side instead.
 */

/**
 * Trailing slashes are LIVE URLs on this site: `next.config.ts` sets
 * `skipTrailingSlashRedirect: true`, so `/play/you/` is served rather than
 * redirected, and `usePathname()` reports whatever the browser is actually on.
 * Normalise before comparing, or a nav surface silently loses its highlight on
 * the slashed spelling of the very page it is describing. Same reasoning as the
 * prefix match in `SurpriseButton`.
 *
 * Every consumer of `PRIMARY_NAV` owes it this call: `match` compares bare
 * paths and does not normalise on your behalf.
 */
export function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

/** `base` itself or anything nested under it — and never `/categoryX`. */
export function isUnder(path: string, base: string): boolean {
  return path === base || path.startsWith(`${base}/`);
}

/**
 * The wrapper that gives a `PRIMARY_NAV` icon its coordinate system.
 *
 * It travels with the icons rather than staying behind in the rail because the
 * fragments below are drawn for exactly these metrics — a 24-unit viewBox,
 * stroke-only, no per-icon `fill`/`stroke` — and are meaningless without a host
 * that supplies them. Every surface that renders one therefore gets the same
 * grid without restating it.
 *
 * 20x20 drawn on a 24x24 grid is also `CategoryIcon`'s geometry over in
 * `Sidebar`: the two groups stack in one rail, so they have to sit on one icon
 * grid. Changing the metrics here means changing them there.
 */
export function NavIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden
    >
      {children}
    </svg>
  );
}

/**
 * The site's top-level destinations.
 *
 * WHY IT EXISTS. Friends and the player's own profile were reachable on desktop
 * ONLY from the avatar dropdown in the header, while the phone's bottom tab bar
 * gives both a first-class slot — so the mobile information architecture was the
 * better of the two on a site whose recent feature work is all social. This is
 * the desktop answer to that bar. `Sidebar` renders it above the genre list, and
 * because it does so from `navList`, the mobile drawer gets it from that same
 * single insertion.
 *
 * REAL LINKS, ALWAYS — never the `<button>` a category falls back to in callback
 * mode (see `Sidebar`'s `onSelect`). A category in callback mode filters the grid
 * in place, so there is nothing for a new tab to open; these are destinations,
 * and middle-click, ⌘-click and "open in new tab" have to work on them.
 *
 * MATCHING IS PER-ITEM and asymmetric on purpose:
 *   * Games owns the catalogue, so it stays lit across `/category/<name>`.
 *   * Friends matches its own subtree.
 *   * You matches everything under `/play/you` EXCEPT that Friends subtree
 *     nested inside it — `/play/you/settings` lights You, `/play/you/friends`
 *     lights Friends, and never both at once.
 *
 * Hand `match` a path that has already been through `normalizePath`.
 *
 * The icons are deliberately none of the genre glyphs in `Sidebar`'s `ICONS`: a
 * glyph that already means a genre would read as one more filter.
 */
export const PRIMARY_NAV: {
  href: string;
  label: string;
  match: (path: string) => boolean;
  icon: React.ReactNode;
}[] = [
  {
    href: "/",
    label: "Games",
    match: (path) => path === "/" || isUnder(path, "/category"),
    // A gamepad — d-pad left, two buttons right. Not the Arcade genre's upright
    // cabinet, and not Puzzle's four squares.
    icon: (
      <>
        <rect x="2" y="7" width="20" height="10" rx="5" />
        <path d="M7 10v4M5 12h4M15.5 11.5h.01M18 14h.01" />
      </>
    ),
  },
  {
    href: "/play/you/friends",
    label: "Friends",
    match: (path) => isUnder(path, "/play/you/friends"),
    // Two equal heads over one shared base, matching the phone tab bar's mark
    // rather than the Multiplayer genre's lopsided big-person/little-person.
    icon: (
      <>
        <circle cx="8" cy="8" r="3" />
        <circle cx="16" cy="8" r="3" />
        <path d="M3 20v-1a5 5 0 0 1 5-5h8a5 5 0 0 1 5 5v1" />
      </>
    ),
  },
  {
    href: "/play/you",
    label: "You",
    match: (path) =>
      isUnder(path, "/play/you") && !isUnder(path, "/play/you/friends"),
    // The single-person mark the phone's Account tab uses.
    icon: (
      <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 21v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1" />
    ),
  },
];
