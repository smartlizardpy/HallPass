"use client";

/**
 * Dashboard app-shell chrome (client) — owns the mobile drawer state and lays out
 * the three responsive regions around the page content.
 *
 * Why a client component: the drawer's open/close, Escape-to-close, and body
 * scroll-lock all need browser state/effects the server layout cannot hold. The
 * layout stays a server component (auth guard + the sign-out server action live
 * there) and hands us its server-rendered pieces as SLOTS — `nav`, `whatsNew`,
 * `user`, `signOut`. Passing a server-rendered element (including a
 * `<form action={serverAction}>`) as a prop to a client component is supported by
 * RSC, which is why the server action never has to cross into this file.
 *
 * The desktop aside (md+) reproduces the layout's original rail markup verbatim so
 * the >=768px view is pixel-identical to before. All mobile chrome (top bar +
 * drawer) is `md:hidden`; the desktop aside is `hidden md:flex`.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Wordmark } from "@/app/components/Wordmark";

export function DashShell({
  children,
  nav,
  whatsNew,
  user,
  signOut,
}: {
  children: React.ReactNode;
  nav: React.ReactNode;
  whatsNew: React.ReactNode;
  user: React.ReactNode;
  signOut: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  // Escape-to-close + body scroll-lock while the drawer is open. Mirrors the
  // arcade Sidebar pattern so the two drawers behave identically.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <div className="min-h-screen bg-background md:flex">
      {/* Desktop rail — hidden on mobile, identical to the pre-refactor aside at md+ */}
      <aside className="hidden bg-surface md:sticky md:top-0 md:flex md:h-dvh md:w-64 md:shrink-0 md:flex-col md:overflow-y-auto md:border-r border-border">
        <div className="flex h-full flex-col gap-6 px-5 py-6">
          <Link href="/dashboard" className="block">
            <Wordmark />
            <span className="mt-0.5 block text-[11px] font-bold uppercase tracking-wider text-muted">
              Dashboard
            </span>
          </Link>

          {nav}

          <div className="mt-2 border-t border-border pt-2">{whatsNew}</div>

          <div className="mt-auto space-y-3 border-t border-border pt-4">
            {user}
            {signOut}
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header
        className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-border bg-surface/90 px-4 backdrop-blur md:hidden"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          aria-controls="dash-mobile-nav"
          aria-expanded={open}
          className="inline-flex h-11 w-11 items-center justify-center rounded-full text-zinc-700 transition hover:bg-surface-2"
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
          >
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>

        <Link href="/dashboard" className="inline-flex">
          <Wordmark />
        </Link>

        <div className="ml-auto">{signOut}</div>
      </header>

      {/* Mobile drawer */}
      <div
        id="dash-mobile-nav"
        className={`fixed inset-0 z-[90] transition md:hidden ${
          open ? "pointer-events-auto" : "pointer-events-none"
        }`}
        aria-hidden={!open}
        // `inert` when closed removes the off-screen links + close button from the
        // tab order / a11y tree (aria-hidden alone doesn't drop them from Tab).
        inert={!open ? true : undefined}
      >
        {/* Backdrop */}
        <div
          onClick={() => setOpen(false)}
          className={`absolute inset-0 bg-zinc-900/50 backdrop-blur-sm transition-opacity ${
            open ? "opacity-100" : "opacity-0"
          }`}
        />
        {/* Panel */}
        <aside
          role="dialog"
          aria-label="Dashboard navigation"
          aria-modal="true"
          className={`absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-border bg-surface shadow-2xl transition-transform duration-200 ${
            open ? "translate-x-0" : "-translate-x-full"
          }`}
          style={{
            paddingTop: "env(safe-area-inset-top)",
            paddingBottom: "env(safe-area-inset-bottom)",
          }}
        >
          <div className="flex h-14 items-center justify-between px-5">
            <Wordmark />
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close menu"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full text-zinc-700 transition hover:bg-surface-2"
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
              >
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-3 pb-6">
            {/* Clicking any nav <Link> bubbles up here and closes the drawer.
                Plain <div> (not <nav>) so we don't nest a second nav landmark —
                the `nav` slot is DashNav, which renders its own <nav>. */}
            <div onClick={() => setOpen(false)}>{nav}</div>

            <div className="mt-6 space-y-3 border-t border-border px-2 pt-4">
              {user}
            </div>
          </div>
        </aside>
      </div>

      <div className="min-w-0 flex-1">
        <main className="mx-auto w-full max-w-7xl px-4 sm:px-6 py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
