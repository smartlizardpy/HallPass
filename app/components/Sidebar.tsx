"use client";

import { useEffect } from "react";
import { categories } from "../lib/games";

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

export function Sidebar({
  active,
  onSelect,
  mobileOpen = false,
  onMobileClose,
}: {
  active: string;
  onSelect: (cat: string) => void;
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
    onSelect(item);
    onMobileClose?.();
  };

  const navList = (
    <>
      <ul className="flex flex-col gap-1">
        {items.map((item) => {
          const isActive = item === active;
          return (
            <li key={item}>
              <button
                type="button"
                onClick={() => handleSelect(item)}
                className={`group flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-[15px] font-bold transition lg:py-2.5 ${
                  isActive
                    ? "bg-brand-50 text-brand"
                    : "text-zinc-700 hover:bg-surface-2 hover:text-zinc-900"
                }`}
              >
                <CategoryIcon name={item} />
                <span className="flex-1 text-left">{item}</span>
                {item === "New" && !isActive && (
                  <span className="h-2 w-2 rounded-full bg-accent-pink" />
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mx-4 my-4 h-px bg-border" />

      <ul className="flex flex-col gap-1">
        {[
          { label: "Library", icon: <path d="M4 4h6v16H4zM14 4h6v16h-6z" /> },
          { label: "Recent", icon: <path d="M12 8v4l3 2M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20z" /> },
          { label: "Settings", icon: <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /> },
        ].map((it) => (
          <li key={it.label}>
            <button className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-[15px] font-bold text-zinc-700 transition hover:bg-surface-2 hover:text-zinc-900 lg:py-2.5">
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
                {it.icon}
              </svg>
              {it.label}
            </button>
          </li>
        ))}
      </ul>
    </>
  );

  return (
    <>
      {/* Desktop sidebar — unchanged */}
      <aside className="hidden w-60 shrink-0 border-r border-border bg-white lg:flex lg:flex-col">
        <div className="flex h-20 items-center px-6">
          <a href="#" className="flex items-baseline gap-0.5">
            <span className="text-3xl font-black tracking-tight text-brand">
              hallpass
            </span>
            <span className="h-2 w-2 translate-y-[-2px] rounded-full bg-accent-yellow" />
          </a>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-4">{navList}</nav>

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
            <a href="#" className="flex items-baseline gap-0.5" onClick={onMobileClose}>
              <span className="text-2xl font-black tracking-tight text-brand">
                hallpass
              </span>
              <span className="h-1.5 w-1.5 rounded-full bg-accent-yellow" />
            </a>
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
        </aside>
      </div>
    </>
  );
}
