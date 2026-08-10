"use client";

import Link from "next/link";
import { useEffect } from "react";
import type { Game } from "../lib/games";
import { StealthMenuButton } from "./stealth/StealthMenuButton";
import { SurpriseButton } from "./SurpriseButton";
import { Wordmark } from "./Wordmark";

const ICONS: Record<string, React.ReactNode> = {
  All: <path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" />,
  New: <path d="M12 2 15 9l7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" />,
  Trending: <path d="M3 17 9 11l4 4 8-9M14 6h7v7" />,
  Racing: <path d="M3 12h18M5 12V8a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v4M6 16h2M16 16h2" />,
  Survivor: <path d="M12 2v20M2 12h20M5 5l14 14M19 5 5 19" />,
  Adventure: <path d="M3 21V5l9-3 9 3v16M9 21v-9h6v9" />,
  Puzzle: <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />,
  RPG: <path d="m4 20 8-8M14 8l6-6M14 2h6v6M9 11l4 4" />,
  Horror: <path d="M12 2a8 8 0 0 0-8 8v8l3-2 3 2 2-2 2 2 3-2 3 2v-8a8 8 0 0 0-8-8z" />,
  Arcade: <path d="M4 4h16v16H4zM4 9h16M9 14h.01M15 14h.01M9 18h6" />,
  Sandbox: <path d="M3 7l9-4 9 4-9 4-9-4zM3 12l9 4 9-4M3 17l9 4 9-4" />,
  Multiplayer: <path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM17 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2M15 21v-2a4 4 0 0 0-3-3.87" />,
  Sports: <path d="M12 2v20M2 12h20M4.93 4.93l14.14 14.14M19.07 4.93 4.93 19.07" />,
  Defense: <path d="M12 2 4 5v6c0 5 3.5 9.5 8 11 4.5-1.5 8-6 8-11V5z" />,
  Platformer: <path d="M3 18h6v-4H3zM9 14h6v-4H9zM15 10h6V6h-6z" />,
  Shooter: <path d="M12 2 22 12l-10 10L2 12zM12 8v8M8 12h8" />,
  Strategy: <path d="M12 2l3 6h7l-5 4 2 7-7-4-7 4 2-7-5-4h7z" />,
  Simulation: <path d="M12 3v18M3 12h18M7 7l10 10M17 7 7 17" />,
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
  games,
  active,
  onSelect,
  mobileOpen = false,
  onMobileClose,
}: {
  categories: string[];
  /** The catalogue, used only to pick a random game for "Surprise me". */
  games: Game[];
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
      {/* Above the categories, not among them: it is an action, not a filter,
          and grouping it with the nav items would make it look like a
          destination that could be "active". Rendered here rather than in each
          <aside> so the desktop rail and the mobile drawer share one copy. */}
      <SurpriseButton games={games} onNavigate={onMobileClose} />

      <ul className="flex flex-col gap-1">
        {items.map((item) => {
          const isActive = item === active;
          const itemClass = `group flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-[15px] font-bold transition lg:py-2.5 ${
            isActive
              ? "bg-brand-50 text-brand"
              : "text-zinc-700 hover:bg-surface-2 hover:text-zinc-900"
          }`;
          const inner = (
            <>
              <CategoryIcon name={item} />
              <span className="flex-1 text-left">{item}</span>
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
                  className={itemClass}
                >
                  {inner}
                </button>
              ) : (
                <Link
                  href={hrefForItem(item)}
                  onClick={onMobileClose}
                  className={itemClass}
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
      <aside className="hidden w-60 shrink-0 border-r border-border bg-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
        <div className="flex h-20 items-center px-6">
          <Link href="/">
            <Wordmark size="text-3xl" dotClass="h-2 w-2" />
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-4">{navList}</nav>

        <div className="border-t border-border px-3 py-2">
          <StealthMenuButton />
        </div>

        <div className="px-6 pb-6">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted">
            © {new Date().getFullYear()} hallpass
          </p>
          <p className="mt-1 text-[11px] text-muted">all games unblocked.</p>
        </div>
      </aside>

      {/* Mobile drawer */}
      <div
        id="mobile-nav"
        className={`lg:hidden fixed inset-0 z-[90] transition ${
          mobileOpen ? "pointer-events-auto" : "pointer-events-none"
        }`}
        aria-hidden={!mobileOpen}
      >
        {/* Backdrop */}
        <div
          onClick={onMobileClose}
          className={`absolute inset-0 bg-zinc-900/50 backdrop-blur-sm transition-opacity ${
            mobileOpen ? "opacity-100" : "opacity-0"
          }`}
        />
        {/* Panel */}
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
