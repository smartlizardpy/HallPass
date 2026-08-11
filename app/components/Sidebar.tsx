"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import type { Game } from "../lib/games";
import { StealthMenuButton } from "./stealth/StealthMenuButton";
import { SurpriseButton } from "./SurpriseButton";
import { Wordmark } from "./Wordmark";

/**
 * One glyph per browse row, drawn on the same 24x24 grid {@link CategoryIcon}
 * renders at 20x20.
 *
 * EVERY ENTRY MUST READ AS A DIFFERENT SHAPE AT 20px — that is the whole
 * constraint, and it is stricter than it sounds. Three groups used to fail it:
 * Survivor, Sports and Simulation were three spellings of one eight-pointed
 * asterisk (differing by fractions of a coordinate); Puzzle was All's 2x2 grid
 * inset by a pixel; New and Strategy were both five-pointed stars. At 20px each
 * group collapses to a single silhouette, so the rail was labelling rows it
 * could not tell apart. One member of each group kept its drawing — All, because
 * a 2x2 grid is the natural "everything" mark, and Strategy, because the star
 * had no better claimant — and the other five were redrawn.
 *
 * So: before adding or editing a glyph, render the whole set at 20x20 and look
 * at it. Do not trust the path data — two very different `d` strings collapse
 * to the same silhouette at this size surprisingly often. Check it against
 * `PRIMARY_NAV` below too; those share the grid and sit in the same rail.
 *
 * Keep them stroke-only line art with no per-icon `fill`/`stroke` (the wrapper
 * owns those), no detail finer than ~2 units, no more than ~6 strokes, and
 * roughly inside 2..22 so nothing clips.
 */
const ICONS: Record<string, React.ReactNode> = {
  All: <path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" />,
  // A four-pointed sparkle, not the five-pointed star it was: Strategy already
  // owns that outline and the two were the same glyph at 20px.
  New: <path d="M12 3c0 4.5 4.5 9 9 9-4.5 0-9 4.5-9 9 0-4.5-4.5-9-9-9 4.5 0 9-4.5 9-9z" />,
  Trending: <path d="M3 17 9 11l4 4 8-9M14 6h7v7" />,
  Racing: <path d="M3 12h18M5 12V8a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v4M6 16h2M16 16h2" />,
  // A heart — lives left, last one standing. Deliberately not a cracked shield
  // (Defense is the shield) and not a lone figure (Multiplayer and the primary
  // group's You already carry people).
  Survivor: <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7z" />,
  Adventure: <path d="M3 21V5l9-3 9 3v16M9 21v-9h6v9" />,
  // An actual jigsaw piece: knob out of the top edge, socket into the left one.
  // The asymmetry is what separates it from All's grid of plain squares.
  Puzzle: <path d="M5 6h5a2.5 2.5 0 0 1 5 0h4v14H5v-5a2.5 2.5 0 0 0 0-5z" />,
  // An upright cruciform sword. It was a diagonal blade whose corner arrowhead
  // read as one more up-and-right arrow next to Trending's chart line — fine
  // beside a label, not fine in a collapsed icon-only rail where the label is
  // the thing that goes away. Standing it up is what separates the two.
  RPG: <path d="M12 2v12M8 14h8M12 14v6M10 20h4" />,
  Horror: <path d="M12 2a8 8 0 0 0-8 8v8l3-2 3 2 2-2 2 2 3-2 3 2v-8a8 8 0 0 0-8-8z" />,
  Arcade: <path d="M4 4h16v16H4zM4 9h16M9 14h.01M15 14h.01M9 18h6" />,
  Sandbox: <path d="M3 7l9-4 9 4-9 4-9-4zM3 12l9 4 9-4M3 17l9 4 9-4" />,
  Multiplayer: <path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM17 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2M15 21v-2a4 4 0 0 0-3-3.87" />,
  // A two-handled trophy. The cup's bowl is one semicircular arc, so it stays a
  // solid readable mass at 20px where a ball's seam lines would just be noise.
  Sports: <path d="M6 4h12v4a6 6 0 0 1-12 0zM6 6H3v2a4 4 0 0 0 3.4 4M18 6h3v2a4 4 0 0 1-3.4 4M12 14v6M8 20h8" />,
  Defense: <path d="M12 2 4 5v6c0 5 3.5 9.5 8 11 4.5-1.5 8-6 8-11V5z" />,
  Platformer: <path d="M3 18h6v-4H3zM9 14h6v-4H9zM15 10h6V6h-6z" />,
  Shooter: <path d="M12 2 22 12l-10 10L2 12zM12 8v8M8 12h8" />,
  Strategy: <path d="M12 2l3 6h7l-5 4 2 7-7-4-7 4 2-7-5-4h7z" />,
  // Three slider tracks with their handles offset from one another — a control
  // panel, i.e. the knobs you turn on a simulation. The only glyph in the set
  // built from horizontal rules, which is what makes it unmistakable.
  Simulation: <path d="M4 6h16M4 12h16M4 18h16M9 4v4M15 10v4M7 16v4" />,
};

function CategoryIcon({ name }: { name: string }) {
  const icon = ICONS[name] ?? ICONS.All;
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
    >
      {icon}
    </svg>
  );
}

/**
 * The style of one sidebar row, shared by every group in the rail.
 *
 * Hoisted out of the category map so the rail reads as ONE system: whatever the
 * row links to, an active row is `bg-brand-50 text-brand` and an idle one is
 * zinc-on-hover. Anything that adds a group below (or above) the categories gets
 * the highlight for free rather than re-typing a class string that then drifts.
 */
function itemClass(isActive: boolean): string {
  // `px-3`, not `px-4`: the rail is 192px wide (see the <aside> note), and the
  // nav's own `px-3` already spends 24px of it. At `px-4` a row leaves ~104px
  // for the label after the 20px icon and its 12px gap, which "Multiplayer"
  // very nearly fills; `px-3` buys back the margin the truncate would otherwise
  // start eating.
  return `group flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-[15px] font-bold transition lg:py-2.5 ${
    isActive
      ? "bg-brand-50 text-brand"
      : "text-zinc-700 hover:bg-surface-2 hover:text-zinc-900"
  }`;
}

/**
 * The public URL for a sidebar item. "All" is the catalog root; "New" and
 * "Trending" are virtual categories the category route already understands.
 * Encoding matches `app/sitemap.ts` and the JSON-LD breadcrumbs byte for byte —
 * categories are free-form and dashboard-editable, so they can contain spaces.
 */
function hrefForItem(item: string): string {
  return item === "All"
    ? "/"
    : `/category/${encodeURIComponent(item.toLowerCase())}`;
}

/**
 * Trailing slashes are LIVE URLs on this site: `next.config.ts` sets
 * `skipTrailingSlashRedirect: true`, so `/play/you/` is served rather than
 * redirected, and `usePathname()` reports whatever the browser is actually on.
 * Normalise before comparing, or the rail silently loses its highlight on the
 * slashed spelling of the very page it is describing. Same reasoning as the
 * prefix match in `SurpriseButton`.
 */
function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

/** `base` itself or anything nested under it — and never `/categoryX`. */
function isUnder(path: string, base: string): boolean {
  return path === base || path.startsWith(`${base}/`);
}

/** Same metrics as {@link CategoryIcon}, so both groups sit on one icon grid. */
function NavIcon({ children }: { children: React.ReactNode }) {
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
 * The site's top-level destinations, sitting above the genre list.
 *
 * WHY IT EXISTS. Friends and the player's own profile were reachable on desktop
 * ONLY from the avatar dropdown in the header, while the phone's bottom tab bar
 * gives both a first-class slot — so the mobile information architecture was the
 * better of the two on a site whose recent feature work is all social. This is
 * the desktop answer to that bar, and because it lives in `navList` the mobile
 * drawer gets it from the same insertion.
 *
 * REAL LINKS, ALWAYS — never the `<button>` a category falls back to in callback
 * mode (see `onSelect`). A category in callback mode filters the grid in place,
 * so there is nothing for a new tab to open; these are destinations, and
 * middle-click, ⌘-click and "open in new tab" have to work on them.
 *
 * MATCHING IS PER-ITEM and asymmetric on purpose:
 *   * Games owns the catalogue, so it stays lit across `/category/<name>`.
 *   * Friends matches its own subtree.
 *   * You matches everything under `/play/you` EXCEPT that Friends subtree
 *     nested inside it — `/play/you/settings` lights You, `/play/you/friends`
 *     lights Friends, and never both at once.
 *
 * The icons are deliberately none of `ICONS` above: a glyph that already means a
 * genre would read as one more filter.
 */
const PRIMARY_NAV: {
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

export function Sidebar({
  categories,
  games,
  active,
  onSelect,
  mobileOpen = false,
  onMobileClose,
}: {
  categories: string[];
  /** The catalogue, used only to pick a random game for "Surprise me". */
  games: Game[];
  /**
   * The highlighted GENRE, by name. It says nothing about the primary group
   * above the genres, which is a set of routes and takes its highlight from the
   * live pathname instead — see `PRIMARY_NAV`.
   */
  active: string;
  /**
   * Callback mode (the catalog pages): clicking a category filters in place.
   *
   * OMIT IT for link mode, used by pages with no local grid to filter. Each item
   * then renders a real `<Link>`, which is also why link mode is worth having at
   * all: the category nav was previously `<button>`s only, so the only crawlable
   * paths to `/category/...` were the sitemap and the JSON-LD breadcrumb.
   */
  onSelect?: (cat: string) => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}) {
  const items = ["All", "New", "Trending", ...categories];

  // `usePathname` is the only source for the primary group's active state: the
  // `active` prop names a genre, not a route. It is a client hook, which this
  // component already is, and it re-renders on every navigation — so the
  // highlight follows a client-side route change with no other wiring.
  const path = normalizePath(usePathname() ?? "/");

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onMobileClose?.();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [mobileOpen, onMobileClose]);

  const handleSelect = (item: string) => {
    onSelect?.(item);
    onMobileClose?.();
  };

  const navList = (
    <>
      {/* THE SPINE OF THE SITE, and the first thing in the rail. Everything
          below the rule is a way of browsing the catalogue; these three are
          where a player goes. See `PRIMARY_NAV` for why they are links and how
          each one decides it is current. */}
      <ul className="flex flex-col gap-1">
        {PRIMARY_NAV.map((entry) => {
          const isActive = entry.match(path);
          return (
            <li key={entry.href}>
              <Link
                href={entry.href}
                onClick={onMobileClose}
                aria-current={isActive ? "page" : undefined}
                className={itemClass(isActive)}
              >
                <NavIcon>{entry.icon}</NavIcon>
                <span className="flex-1 text-left">{entry.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      {/* The two groups must not read as one list — a destination that stays lit
          and a filter that swaps the grid underneath you are different promises,
          and stacking them in one unbroken column said they were the same. */}
      <hr className="my-3 border-t border-border" />

      {/* Above the categories, not among them: it is an action, not a filter,
          and grouping it with the nav items would make it look like a
          destination that could be "active" — which is also why it sits on the
          browse side of the rule rather than under the primary group, whose rows
          do light up. Rendered here rather than in each <aside> so the desktop
          rail and the mobile drawer share one copy. */}
      <SurpriseButton games={games} onNavigate={onMobileClose} />

      {/* Visual only: the <ul> below carries the same label for assistive tech,
          so announcing this line too would just say "Browse" twice. An `id` +
          `aria-labelledby` pair is not an option — `navList` is rendered in both
          the rail and the drawer, so any id in here exists twice in the DOM. */}
      <p
        aria-hidden
        className="px-4 pb-1 text-[11px] font-bold uppercase tracking-wider text-muted"
      >
        Browse
      </p>

      <ul aria-label="Browse" className="flex flex-col gap-1">
        {items.map((item) => {
          const isActive = item === active;
          const inner = (
            <>
              <CategoryIcon name={item} />
              {/* `truncate` because categories are dashboard-editable free text:
                  in the narrower rail a long one would wrap to two lines and
                  break the row rhythm rather than being clipped. */}
              <span className="flex-1 truncate text-left">{item}</span>
              {item === "New" && !isActive && (
                <span className="h-2 w-2 rounded-full bg-accent-pink" />
              )}
            </>
          );
          return (
            <li key={item}>
              {onSelect ? (
                <button
                  type="button"
                  onClick={() => handleSelect(item)}
                  className={itemClass(isActive)}
                >
                  {inner}
                </button>
              ) : (
                <Link
                  href={hrefForItem(item)}
                  onClick={onMobileClose}
                  className={itemClass(isActive)}
                >
                  {inner}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );

  return (
    <>
      {/* Desktop sidebar. PINNED TO THE VIEWPORT (`lg:sticky lg:top-0
          lg:h-screen`), which it was not: the parent is a `flex min-h-screen`
          row, so default `align-items: stretch` grew this rail to the height of
          the whole DOCUMENT. Two things broke as a result — the `flex-1
          overflow-y-auto` nav below could never overflow, making its scrolling
          dead code, and the stealth button and copyright that follow it sat at
          the bottom of the document (below every game on the home page) instead
          of the bottom of the screen. A definite `100vh` height also stops
          `stretch` applying, so the rail now measures exactly one viewport, the
          nav scrolls internally, and the footer blocks sit on the visible rail.
          This is the behaviour the mobile drawer already had via `absolute
          inset-y-0` inside a `fixed inset-0`. Scoped to `lg:` because the rail
          is `hidden` below that breakpoint. */}
      {/* `w-48`, down from `w-60`. 240px of permanent rail is a lot of a small
          laptop's width to spend on a genre filter, and pinning it full-height
          made that cost visible on every screen rather than only above the fold.
          192px still clears the longest label comfortably — "Multiplayer" at
          15px bold is ~90px, plus a 20px icon, a 12px gap and 32px of padding. */}
      <aside className="hidden w-48 shrink-0 border-r border-border bg-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
        <div className="flex h-20 items-center px-4">
          <Link href="/">
            <Wordmark size="text-2xl" dotClass="h-1.5 w-1.5" />
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-4">{navList}</nav>

        <div className="border-t border-border px-3 py-2">
          <StealthMenuButton />
        </div>

        <div className="px-4 pb-5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted">
            © {new Date().getFullYear()} hallpass
          </p>
          <p className="mt-1 text-[11px] text-muted">all games unblocked.</p>
        </div>
      </aside>

      {/* Mobile drawer. The container is always rendered so the panel can
          animate in and out, which means the CLOSED drawer is still in the
          document. Neither `-translate-x-full` nor `pointer-events-none`
          removes anything from the tab order, so every control in here used to
          stay keyboard-focusable off screen and was reached BEFORE the header —
          and focusable content inside `aria-hidden="true"` is an ARIA
          violation besides.

          `inert` is the fix: it drops the whole subtree from the tab order,
          from hit-testing and from the accessibility tree. It also implies
          `aria-hidden`, so the explicit attribute is gone rather than
          duplicated. React 19 (19.2.4 here) takes it as a real boolean prop —
          `inert={false}` removes the attribute — so no `"" | undefined`
          dance is needed. The `pointer-events` toggle stays as a cheap
          belt-and-braces for the animation. */}
      <div
        id="mobile-nav"
        className={`lg:hidden fixed inset-0 z-[90] transition ${
          mobileOpen ? "pointer-events-auto" : "pointer-events-none"
        }`}
        inert={!mobileOpen}
      >
        {/* Backdrop */}
        <div
          onClick={onMobileClose}
          className={`absolute inset-0 bg-zinc-900/50 backdrop-blur-sm transition-opacity ${
            mobileOpen ? "opacity-100" : "opacity-0"
          }`}
        />
        {/* Panel */}
        {/* Labelled "Menu", not "Categories": the drawer now opens onto the
            primary destinations as well as the genre filter, and it is the
            header's "Open menu" button (`aria-controls="mobile-nav"`) that
            announces it. A dialog whose name promises only categories would
            misdescribe half of what is in it. */}
        <aside
          role="dialog"
          aria-label="Menu"
          aria-modal="true"
          className={`absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-border bg-white shadow-2xl transition-transform duration-200 ${
            mobileOpen ? "translate-x-0" : "-translate-x-full"
          }`}
          style={{
            paddingTop: "env(safe-area-inset-top)",
            paddingBottom: "env(safe-area-inset-bottom)",
          }}
        >
          <div className="flex h-16 items-center justify-between px-5">
            <Link href="/" onClick={onMobileClose}>
              <Wordmark />
            </Link>
            <button
              type="button"
              onClick={onMobileClose}
              aria-label="Close menu"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full text-zinc-700 transition hover:bg-surface-2"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
          <nav className="flex-1 overflow-y-auto px-3 pb-6">{navList}</nav>
          <div className="border-t border-border px-3 py-3">
            <StealthMenuButton onNavigate={onMobileClose} />
          </div>
        </aside>
      </div>
    </>
  );
}
