"use client";

/**
 * Site-header account control. Logged out → a "Sign in" button that kicks off
 * Google sign-in (via the `startSignIn` server action). Logged in → the player's
 * avatar + handle opening a dropdown (Account settings, Dashboard for admins,
 * Sign out).
 *
 * Identity is fetched client-side from `/api/v1/me` so the public arcade pages
 * stay statically rendered — the menu just hydrates with whoever's signed in.
 */

import { useEffect, useRef, useState } from "react";
import { startSignIn, startSignOut } from "../lib/auth-actions";
import type { MeResponse } from "@/sdk/src/contract";

export function AccountMenu() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/v1/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { player: null }))
      .then((d: MeResponse) => active && setMe(d))
      .catch(() => {})
      .finally(() => active && setLoaded(true));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const player = me?.player ?? null;
  const isAdmin = Boolean(me?.isAdmin);
  const roleLabel =
    me?.role === "super_admin" ? "Super admin" : isAdmin ? "Admin" : null;

  // Identity not resolved yet → hold space without flashing the wrong state.
  if (!loaded) {
    return <div className="h-11 w-11" aria-hidden />;
  }

  // Logged out → a sign-in button.
  if (!player) {
    return (
      <form action={startSignIn}>
        <button
          type="submit"
          className="flex h-11 items-center gap-2 rounded-full bg-brand px-4 text-sm font-extrabold text-white shadow-lg shadow-brand/30 transition hover:bg-brand-600 sm:px-5"
        >
          Sign in
        </button>
      </form>
    );
  }

  const initial = player.handle?.[0]?.toUpperCase() ?? "P";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-11 items-center gap-2 rounded-full bg-white pl-1.5 pr-2 text-sm font-bold text-zinc-800 shadow-sm transition hover:text-brand sm:pr-3"
      >
        <Avatar src={player.image} initial={initial} size={32} />
        <span className="hidden max-w-[7.5rem] truncate sm:block">
          {player.handle}
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`hidden text-muted transition-transform sm:block ${open ? "rotate-180" : ""}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[3.25rem] z-50 w-56 overflow-hidden rounded-2xl border border-border bg-white p-1.5 shadow-xl"
        >
          <div className="flex items-center gap-3 px-3 py-2">
            <Avatar src={player.image} initial={initial} size={40} />
            <div className="min-w-0">
              <div className="truncate text-sm font-extrabold text-zinc-900">
                {player.handle}
              </div>
              {roleLabel && (
                <span className="mt-0.5 inline-block rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-bold text-brand">
                  {roleLabel}
                </span>
              )}
            </div>
          </div>

          <div className="my-1 h-px bg-border" />

          <MenuLink href="/play/account">Account settings</MenuLink>
          {isAdmin && <MenuLink href="/dashboard">Dashboard</MenuLink>}

          <form action={startSignOut}>
            <button
              type="submit"
              className="w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-red-600 transition hover:bg-red-50"
            >
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function MenuLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      role="menuitem"
      className="block rounded-lg px-3 py-2 text-sm font-semibold text-zinc-800 transition hover:bg-surface-2"
    >
      {children}
    </a>
  );
}

function Avatar({
  src,
  initial,
  size,
}: {
  src: string | null;
  initial: string;
  size: number;
}) {
  if (src) {
    return (
      // Google avatar is a remote URL; next/image would need domain config, and
      // this is a tiny decorative thumbnail — a plain img is the right call.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="grid place-items-center rounded-full bg-brand-100 font-black text-brand"
      style={{ width: size, height: size, fontSize: size * 0.45 }}
    >
      {initial}
    </span>
  );
}
