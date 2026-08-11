"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { StealthMenuButton } from "./stealth/StealthMenuButton";
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
 * to the same silhouette at this size surprisingly often. `PRIMARY_NAV`'s icons
 * in `./primary-nav` are drawn on the same 24-unit grid and were once stacked
 * directly above these; they no longer share a surface (that group lives in
 * `SiteHeader`, label-only), so they are no longer part of the silhouette test —
 * but they remain the reference for what the grid is.
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
  // (Defense is the shield) and not a lone figure (Multiplayer already carries
  // people, as does the header's You tab).
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

/* -------------------------------------------------------------------------- *
 * "Keep the rail expanded" — the pin preference.
 * -------------------------------------------------------------------------- */

/**
 * Whether the visitor has pinned the desktop rail open, persisted so the choice
 * survives a reload.
 *
 * A DELIBERATE COPY of `useForceDesktop` in `app/lib/use-device-platform.ts`,
 * down to the shape: one localStorage key holding `"1"` or nothing, a module
 * `Set` of listeners, a `storage` listener so a second tab agrees, and
 * `useSyncExternalStore` on top. Read that file's header for the rationale; the
 * same rules apply here. It is NOT a `useState` + `useEffect` pair, because the
 * rail is rendered once per page but the preference is a piece of site state, and
 * an external store is what lets a future second reader (a settings row, say)
 * observe the same value without lifting anything.
 *
 * Small enough to live in this file rather than `app/lib/`: it is four functions
 * and a string key, it has exactly one consumer (the rail below), and every
 * behaviour worth asserting on is DOM behaviour of that rail rather than of the
 * store. `app/lib/` modules in this repo carry unit tests; a lib file with none
 * would be the odd one out.
 *
 * THE SERVER SNAPSHOT IS ALWAYS `false` — i.e. collapsed — and that is the
 * hydration contract, not a default nobody thought about. The public pages are
 * prerendered and precached by the service worker, so the HTML cannot depend on
 * one visitor's storage; the first client render must match it byte for byte.
 * `useSyncExternalStore` renders `getServerSnapshot` for the server pass AND for
 * the hydrating pass, then re-renders with the real value immediately after — the
 * same "second paint" rule `useRawDevice` follows with its `null`. A pinned rail
 * therefore paints collapsed for one frame and then expands, which is the correct
 * trade: the alternative is a hydration mismatch on every prerendered page.
 */
const RAIL_PINNED_KEY = "hp-rail-pinned";
const railListeners = new Set<() => void>();

function railSubscribe(onChange: () => void): () => void {
  railListeners.add(onChange);
  window.addEventListener("storage", onChange); // keep tabs in sync
  return () => {
    railListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function getRailSnapshot(): boolean {
  try {
    return localStorage.getItem(RAIL_PINNED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Constant, and constant on purpose — see the docblock above. */
function getRailServerSnapshot(): boolean {
  return false;
}

/** Pin or unpin the rail, then notify every subscriber. */
function setRailPinned(on: boolean): void {
  try {
    if (on) localStorage.setItem(RAIL_PINNED_KEY, "1");
    else localStorage.removeItem(RAIL_PINNED_KEY);
  } catch {
    // Private mode / storage disabled: the toggle simply won't persist.
  }
  railListeners.forEach((l) => l());
}

/** Whether the visitor has asked for the rail to stay expanded. */
function useRailPinned(): boolean {
  return useSyncExternalStore(
    railSubscribe,
    getRailSnapshot,
    getRailServerSnapshot,
  );
}

/**
 * The style of one sidebar row.
 *
 * Hoisted out of the category map because a row renders as a `<button>` in
 * callback mode and a `<Link>` in link mode (see `onSelect`), and those two must
 * be visually identical — an active row is `bg-brand-50 text-brand`, an idle one
 * zinc-on-hover — rather than two class strings that drift apart.
 *
 * It stays a function, not a constant, for the same reason: the categories are
 * the only group left in the rail (the primary destinations moved to
 * `SiteHeader`), so anything added above or below them inherits one highlight
 * treatment instead of inventing a second. `SiteHeader`'s tabs deliberately use
 * the SAME active fill, so the two surfaces cannot disagree about what "current"
 * looks like.
 */
function itemClass(isActive: boolean, collapsed: boolean): string {
  // EXPANDED: `px-3`, not `px-4`. The rail is 192px wide (see the <aside> note),
  // and the nav's own `px-3` already spends 24px of it. At `px-4` a row leaves
  // ~104px for the label after the 20px icon and its 12px gap, which
  // "Multiplayer" very nearly fills; `px-3` buys back the margin the truncate
  // would otherwise start eating.
  //
  // COLLAPSED: no horizontal padding at all and `justify-center`, so the 20px
  // glyph sits on the centre line of the 40px row the 64px strip leaves after
  // the nav's `px-3`. Padding plus `gap-3` would push it off-centre by the width
  // of a label that is not being drawn. `relative` is here for the New dot,
  // which becomes a corner badge at this width (see `renderNavList`).
  //
  // The ACTIVE fill is identical either way — that is the point of hoisting this
  // out, and `SiteHeader`'s tabs share it too, so no surface can disagree about
  // what "current" looks like.
  const shape = collapsed ? "relative justify-center px-0" : "gap-3 px-3";
  return `group flex w-full items-center rounded-2xl py-3 text-[15px] font-bold transition lg:py-2.5 ${shape} ${
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

export function Sidebar({
  categories,
  active,
  onSelect,
  mobileOpen = false,
  onMobileClose,
}: {
  categories: string[];
  /**
   * The highlighted GENRE, by name — and now the only kind of "current" this rail
   * has an opinion about. The primary destinations (Games / Friends / You) used to
   * sit above the genres and take their highlight from the live pathname; they
   * live in `SiteHeader` alone now, which is why nothing in here reads
   * `usePathname` any more.
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

  /* ---------------------------------------------------------------------- *
   * Rail width state. DESKTOP ONLY — the drawer below never reads any of it.
   * ---------------------------------------------------------------------- */

  // The persisted choice. `false` on the server and on the hydrating render.
  const pinned = useRailPinned();
  // Transient reveals. Hover is the mouse affordance; `focusInside` is the
  // keyboard one, and without it a tabbing user would land on a row that is a
  // bare glyph. Both are React state rather than the `hover:` / `focus-within:`
  // variants they look like, because the collapsed and expanded rows differ in
  // WHICH ELEMENTS RENDER (`sr-only` label, badge-or-inline dot, tooltip), not
  // just in a property or two — expressing that in CSS would mean pairing every
  // utility with a `group-hover:`/`group-focus-within:` twin and then losing the
  // specificity fight between `not-sr-only` and `truncate`.
  const [hovering, setHovering] = useState(false);
  const [focusInside, setFocusInside] = useState(false);
  const railExpanded = pinned || hovering || focusInside;

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

  // ONE GROUP, ONE PROMISE: everything this returns filters the catalogue.
  // The primary destinations (Games / Friends / You) and the "Surprise me" button
  // used to sit above the categories, separated by a rule because a destination
  // that stays lit and a filter that swaps the grid underneath you are different
  // promises. `SiteHeader` owns both now — it is the only copy of either — so the
  // rule has nothing left to separate and went with them.
  //
  // Still rendered by BOTH the desktop rail and the mobile drawer from this one
  // insertion, which is why nothing in here may carry an `id`: it would exist
  // twice in the DOM.
  //
  // A FUNCTION, not the constant it was, because the two surfaces now want two
  // widths of the same list and only the rail collapses. The drawer always calls
  // it with both flags off and so renders exactly what it rendered before — it
  // is a full-width overlay you opened deliberately, and there is nothing to
  // save by shrinking it.
  const renderNavList = ({
    /** Icon-only: labels go `sr-only`, rows centre, the New dot becomes a badge. */
    collapsed,
    /** Add a `title` tooltip — see the note where the rail calls this. */
    tooltips,
  }: {
    collapsed: boolean;
    tooltips: boolean;
  }) => (
    <>
      {/* Visual only: the <ul> below carries the same label for assistive tech,
          so announcing this line too would just say "Browse" twice. An `id` +
          `aria-labelledby` pair is not an option — this list is rendered in both
          the rail and the drawer, so any id in here exists twice in the DOM.

          `invisible` rather than unmounted when collapsed: the word does not fit
          in a 64px strip, but its 19px of box does still have a job, which is to
          stop the whole list jumping up by that much the instant the rail is
          hovered. `truncate` keeps it to the one line that height assumes. */}
      <p
        aria-hidden
        className={`truncate px-4 pb-1 text-[11px] font-bold uppercase tracking-wider text-muted ${
          collapsed ? "invisible" : ""
        }`}
      >
        Browse
      </p>

      <ul aria-label="Browse" className="flex flex-col gap-1">
        {items.map((item) => {
          const isActive = item === active;
          const inner = (
            <>
              <CategoryIcon name={item} />
              {/* THE LABEL IS ALWAYS RENDERED, and that is what gives a collapsed
                  row its accessible name: `sr-only` hides it from the eye and
                  from nobody else, so the row is still "Horror, button" to a
                  screen reader with no `aria-label` to keep in sync with the
                  visible text. An icon-only row whose only name were the `title`
                  below would be the thing to avoid — `title` is unreliable as a
                  name and unreachable by keyboard.

                  Expanded, `truncate` earns its place because categories are
                  dashboard-editable free text: a long one would wrap to two lines
                  and break the row rhythm rather than being clipped. */}
              <span className={collapsed ? "sr-only" : "flex-1 truncate text-left"}>
                {item}
              </span>
              {item === "New" && !isActive && (
                <span
                  className={
                    collapsed
                      ? "absolute right-1 top-1.5 h-1.5 w-1.5 rounded-full bg-accent-pink"
                      : "h-2 w-2 rounded-full bg-accent-pink"
                  }
                />
              )}
            </>
          );
          return (
            <li key={item}>
              {onSelect ? (
                <button
                  type="button"
                  onClick={() => handleSelect(item)}
                  title={tooltips ? item : undefined}
                  className={itemClass(isActive, collapsed)}
                >
                  {inner}
                </button>
              ) : (
                <Link
                  href={hrefForItem(item)}
                  onClick={onMobileClose}
                  title={tooltips ? item : undefined}
                  className={itemClass(isActive, collapsed)}
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
      {/* DESKTOP SIDEBAR.
          `w-48`, down from `w-60`, and now only when PINNED. 240px of permanent
          rail was a lot of a small laptop's width to spend on a genre filter;
          192px is still 14% of a 1366px school laptop, which is the width this
          whole redesign is for. So the rail defaults to a 64px icon strip and the
          full 192px is opt-in. 192px is what the expanded state needs and no
          more: "Multiplayer" at 15px bold is ~90px, plus a 20px icon, a 12px gap
          and 32px of padding.

          THE <aside> IS NOW ONLY THE LAYOUT SLOT — a spacer of the pinned width,
          keeping every note below about being PINNED TO THE VIEWPORT (`lg:sticky
          lg:top-0 lg:h-screen`) true. Recap, because it is easy to undo: the
          parent is a `flex min-h-screen` row, so default `align-items: stretch`
          grew this rail to the height of the whole DOCUMENT. Two things broke as
          a result — the `flex-1 overflow-y-auto` nav could never overflow, making
          its scrolling dead code, and the blocks after it sat at the bottom of
          the document (below every game on the home page) instead of the bottom
          of the screen. A definite `100vh` height also stops `stretch` applying,
          so the rail measures exactly one viewport, the nav scrolls internally,
          and the stealth button sits on the visible rail. This is the behaviour
          the mobile drawer already had via `absolute inset-y-0` inside a `fixed
          inset-0`. Scoped to `lg:` because the rail is `hidden` below that.

          `sticky` also makes this a positioned ancestor, which is what the panel
          inside it resolves `absolute inset-y-0` against. The width transition is
          on the SLOT as well as the panel so that pinning and unpinning move the
          catalogue and the rail together; a hover never touches it.

          THE `z-50` HAS TO BE HERE, ON THE SLOT, AND NOT ON THE PANEL. `sticky`
          creates a stacking context unconditionally — z-index `auto` and all —
          so every z-index inside this element is resolved AGAINST THIS BOX, and
          from the outside the whole rail paints at the slot's own level. With the
          z-index on the panel instead, the expanded overlay was painted UNDER
          `SiteHeader` (`sticky z-40`, so also its own context, at level 40 next
          to this one's level 0): the header's wordmark swallowed the clicks meant
          for the pin button, which is how this was caught. Harmless while
          collapsed — a 64px strip overlaps nothing — and 50 stays below the
          mobile drawer's `z-[90]`, `FeaturePromo`'s `z-[95]` and
          `PlayerOverlay`'s `z-[100]`, none of which may ever go under the rail. */}
      <aside
        className={`z-50 hidden shrink-0 transition-[width] duration-200 motion-reduce:transition-none lg:sticky lg:top-0 lg:block lg:h-screen ${
          pinned ? "w-48" : "w-16"
        }`}
      >
        {/* THE PANEL — the rail you actually see, and an OVERLAY when it is not
            pinned. It is absolutely positioned inside the slot above, so growing
            it from 64px to 192px on hover paints over `main` instead of resizing
            it. That is the whole reason for the two-element split: reflowing the
            entire catalogue every time the pointer crosses the rail would be a
            worse bug than the 128px this feature exists to reclaim. When PINNED
            the panel and the slot are the same width, so nothing overlaps and the
            layout is exactly the pre-collapse one.

            It carries NO z-index of its own — the slot above owns that, and the
            comment there explains why putting one here does nothing. What it does
            carry is a shadow, and only while floating: that is what says "this is
            over the page", and a pinned rail is not over anything.

            WHAT THE FLOATING STATE COVERS, measured rather than guessed: at 192px
            it reaches the header's own wordmark (96..181px at `lg`, 96..196px at
            `xl` where it grows back to `text-2xl`) and stops short of the first
            primary tab, which starts at 197px / 212px respectively. So no header
            CONTROL is ever swallowed — the one artefact is a ~4px sliver of the
            wordmark's trailing dot peeking past the edge at `xl` and up, for as
            long as the pointer is on the rail.

            `overflow-hidden` clips the labels while the width animates, so they
            are revealed by the growing edge rather than spilling across the grid
            for 200ms. Focus rings survive it — rows sit 24px in from this edge.

            Hover and focus are tracked HERE, on the one element that contains
            every control in the rail. The `onBlur` containment check is what stops
            the rail flickering shut as focus moves from one row to the next:
            `relatedTarget` is the element receiving focus, and if it is still
            inside the panel, focus never actually left. */}
        <div
          onMouseEnter={() => setHovering(true)}
          onMouseLeave={() => setHovering(false)}
          onFocus={() => setFocusInside(true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) setFocusInside(false);
          }}
          className={`absolute inset-y-0 left-0 flex flex-col overflow-hidden border-r border-border bg-white transition-[width] duration-200 motion-reduce:transition-none ${
            railExpanded ? "w-48" : "w-16"
          } ${railExpanded && !pinned ? "shadow-xl" : ""}`}
        >
          {/* The rail's own wordmark is EXPANDED-ONLY. It does not fit in 64px,
              and nothing is lost when it goes: `SiteHeader` carries the mark at
              every desktop width (it dropped its `lg:hidden` for exactly this
              reason), so the top-left of the screen is never without a way home.
              The slot keeps its `h-20` in both states so the nav below starts on
              the same line as the header's bottom border either way. */}
          <div
            className={`flex h-20 shrink-0 items-center ${
              railExpanded ? "gap-1 px-4" : "justify-center px-2"
            }`}
          >
            {railExpanded && (
              <Link href="/" className="min-w-0 flex-1">
                <Wordmark size="text-2xl" dotClass="h-1.5 w-1.5" />
              </Link>
            )}

            {/* THE PIN. A toggle button, so it is `aria-pressed` plus ONE
                unchanging name — not a label that flips between "Expand" and
                "Collapse", which reads as a different control appearing each
                time and leaves a screen reader announcing the action while the
                pressed state announces the opposite. `title` is the same string,
                so the tooltip and the accessible name cannot drift.

                Pressed wears `bg-brand-50 text-brand`, the same "current" fill
                every other lit thing on the site uses (see `itemClass`).

                First in the rail's tab order, which is the sane place for it:
                tabbing into the rail reveals the labels (`focusInside`) and lands
                on the control that makes that permanent, before the 12+ rows. */}
            <button
              type="button"
              aria-pressed={pinned}
              aria-label="Keep sidebar expanded"
              title="Keep sidebar expanded"
              onClick={() => setRailPinned(!pinned)}
              className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition ${
                pinned
                  ? "bg-brand-50 text-brand"
                  : "text-zinc-500 hover:bg-surface-2 hover:text-zinc-900"
              }`}
            >
              {/* A double chevron pointing the way the rail will move: « to put
                  it away, » to bring it out. */}
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`transition-transform duration-200 motion-reduce:transition-none ${
                  pinned ? "" : "rotate-180"
                }`}
              >
                <path d="M13 6l-6 6 6 6M19 6l-6 6 6 6" />
              </svg>
            </button>
          </div>

          {/* `tooltips` follows PINNED, not the live collapsed state, and that is
              deliberate: a `title` that only existed while the rail is collapsed
              would be removed by the very hover that was about to show it. So an
              unpinned rail keeps its tooltips through the reveal — belt and
              braces for the mouse, next to the `sr-only` labels that serve the
              keyboard. A pinned rail has its labels on screen and needs neither. */}
          <nav className="flex-1 overflow-y-auto px-3 pb-4">
            {renderNavList({ collapsed: !railExpanded, tooltips: !pinned })}
          </nav>

          {/* The last block in the rail — there is deliberately NO copyright line
              under it any more. A `© year hallpass / all games unblocked.` pair was
              pinned here, which meant a full-height rail spent its most valuable
              real estate (the one region that never scrolls away) on boilerplate
              nobody navigates by. `SiteFooter` already carries the same statement —
              the mark, the year and "all games unblocked, forever." — at the bottom
              of every page inside this shell, which is where a colophon belongs, so
              nothing was lost by deleting it.

              THE STEALTH HATCH MUST SURVIVE THE COLLAPSE. It is the only
              auth-independent door to stealth mode on the whole site —
              `AccountMenu` renders nothing for a signed-out visitor and never on a
              phone — so "hide it below 192px" was never an option.
              `StealthMenuButton` is shared with the drawer and takes no variant
              prop, so the collapse is done from OUT HERE with child selectors, the
              same technique (and the same reasoning) as `SiteHeader`'s treatment
              of `WhatsNewLink`: the pressure is this rail's, not the button's.

              `text-[0px]` on the button, NOT `sr-only` on its label and not
              `hidden`: the label is a bare text node inside the shared component,
              so there is no element here to hide, and zeroing the font is the one
              thing that reaches it from the outside. The emoji sets its own
              `text-base` and so keeps its size, the text node keeps its place in
              the accessibility tree (the button is still "Stealth mode" to a
              screen reader — verified in the browser, not assumed), and `gap-0`
              removes the 8px that would otherwise sit between the glyph and a
              label of no width and push it off-centre. All three selectors
              out-specify the component's own single-class utilities on the
              descendant combinator, so source order is not load-bearing.

              The tooltip follows the same pinned-not-collapsed rule as the rows
              above, and for the same reason. */}
          <div
            title={pinned ? undefined : "Stealth mode"}
            className={`shrink-0 border-t border-border py-2 ${
              railExpanded
                ? "px-3"
                : "px-2 [&_button]:justify-center [&_button]:gap-0 [&_button]:px-0 [&_button]:text-[0px]"
            }`}
          >
            <StealthMenuButton />
          </div>
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
        {/* Labelled "Categories", not "Menu". "Menu" was a compromise from the
            phase where this drawer carried the primary destinations (Games /
            Friends / You) as well as the genre filter: a dialog named for
            categories would then have misdescribed half of what was in it. Those
            destinations are gone from `navList` — `SiteHeader` owns them — so the
            vague name now buys nothing and costs the one thing a dialog name is
            for, telling a screen-reader user what they just opened.

            The stealth escape hatch in the panel footer is not a counter-example:
            it is chrome pinned below the nav, exactly as it is in the desktop
            rail, not one of the things the drawer is FOR.

            The trigger matches — `SiteHeader`'s button is "Open categories" and
            the close button below is "Close categories". Its
            `aria-controls="mobile-nav"` still points at this container's id: the
            id names the drawer, not its contents, and `DashShell` already uses the
            parallel `dash-mobile-nav`, so renaming it would only break the
            symmetry. */}
        <aside
          role="dialog"
          aria-label="Categories"
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
              aria-label="Close categories"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full text-zinc-700 transition hover:bg-surface-2"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
          {/* Never collapsed, never tooltipped: the drawer is a full-width
              overlay you opened on purpose, and it has the room. */}
          <nav className="flex-1 overflow-y-auto px-3 pb-6">
            {renderNavList({ collapsed: false, tooltips: false })}
          </nav>
          <div className="border-t border-border px-3 py-3">
            <StealthMenuButton onNavigate={onMobileClose} />
          </div>
        </aside>
      </div>
    </>
  );
}
