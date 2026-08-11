"use client";

/**
 * Site-header account control. Logged out → a "Sign in" button that kicks off
 * Google sign-in (via the `startSignIn` server action). Logged in → the player's
 * avatar + handle opening a dropdown (Friends, Your profile, Beta testing for
 * testers, Dashboard for admins, Stealth mode, Sign out).
 *
 * The player-facing entries point INTO the profile at `/play/you`: the profile
 * itself, and `/play/you/friends` for the tab the badge counts.
 *
 * EVERY DESTINATION IN HERE IS A `next/link`. They used to be plain `<a>`s,
 * justified as "nothing to gain from prefetching them behind a closed menu" —
 * but `Sidebar` renders two of the SAME hrefs as `<Link>`s, so one link was a
 * soft transition from the rail and a cold document reload from the avatar. The
 * prefetch half of that reasoning was answering a question nobody asked: the
 * whole dropdown sits behind `{open && …}`, so a CLOSED menu has no links in the
 * document to prefetch, and an OPEN one is a player a single click from one of
 * four routes — exactly when a warm route pays. Hence the default `prefetch`
 * here; `MobileTabBar`'s docblock records what `prefetch={false}` cost the phone.
 *
 * SIGN OUT IS NOT ONE OF THEM, and must not become one. It is a `<form>` posting
 * the `startSignOut` server action rather than a link: clearing the session is a
 * server round trip, and `signOut({ redirectTo: "/" })` owns where the player
 * lands. There is nothing here to convert, and converting it would be a
 * regression rather than a speed-up.
 *
 * CLOSING ON NAVIGATION IS NOW THIS COMPONENT'S JOB. A full reload unmounted the
 * header and took the open menu with it; a client transition keeps `SiteHeader`
 * — and this dropdown — mounted across the route change, so an open menu would
 * otherwise hang over the page it just navigated to. See `MenuLink` for which
 * Link callback does it and why that choice is not arbitrary.
 *
 * Identity is fetched client-side from `/api/v1/me` so the public arcade pages
 * stay statically rendered — the menu just hydrates with whoever's signed in.
 *
 * The pending-friend-request badge comes from a SECOND endpoint,
 * `/api/v1/me/friends/count`, fired in parallel with the identity call. Two
 * requests rather than one field on `MeResponse` because that type is the
 * append-only public SDK contract embedded games consume — the count route's own
 * docblock spells out why social data must not be bolted onto it.
 *
 * The two are deliberately NOT awaited together: `loaded` is gated on identity
 * alone, so the avatar appears the moment we know who is signed in and the badge
 * follows whenever the count lands. A failed or slow count leaves the badge at
 * zero and is never allowed to hold up — or throw inside — the menu.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { startSignIn, startSignOut } from "../lib/auth-actions";
import { openStealthSettings } from "../lib/stealth/store";
import type { MeResponse } from "@/sdk/src/contract";

/**
 * The slice of `/api/v1/me/friends/count` this menu reads. The route also
 * returns `signedIn`, `friends` and `hasUsername` — declared here only as far as
 * the badge needs, so an unrelated change to the rest of that payload cannot
 * break this component.
 */
type FriendCounts = { incoming?: number };

export function AccountMenu() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [incoming, setIncoming] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  /**
   * The avatar trigger, so the stealth row can hand focus back to it before the
   * dropdown it lives in disappears — see that button for the whole sequence.
   * Separate from `ref` above, which wraps trigger AND dropdown because that is
   * the region the outside-click test asks about.
   */
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/v1/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { player: null }))
      .then((d: MeResponse) => active && setMe(d))
      .catch(() => {})
      .finally(() => active && setLoaded(true));

    // Started in the same tick as the identity call, with its own chain rather
    // than a `Promise.all` — sharing one would make `loaded` wait on the slower
    // of the two and hold the avatar back for a badge.
    fetch("/api/v1/me/friends/count", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: FriendCounts | null) => {
        if (!active || typeof d?.incoming !== "number") return;
        setIncoming(d.incoming);
      })
      // Signed out, offline, or the schema is behind the deploy: no badge. The
      // route already answers 200-with-zeroes for its own failures, so anything
      // reaching here is transport, and a badge is never worth an error.
      .catch(() => {});

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
  const isBetaTester = Boolean(me?.isBetaTester);
  const roleLabel =
    me?.role === "super_admin" ? "Super admin" : isAdmin ? "Admin" : null;

  // A plain closure, not a `useCallback`: nothing below is memoised, so a stable
  // identity would buy exactly nothing and only imply a guarantee that is not
  // being relied on.
  const closeMenu = () => setOpen(false);

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
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        // `bg-surface-2`, not `bg-white`: this trigger sits ON `SiteHeader`'s
        // white bar (see its docblock), where white would erase it. The signed-
        // out `bg-brand` button above needs no such treatment, and the dropdown
        // below stays white — it floats over the page, not on the bar.
        className="flex h-11 items-center gap-2 rounded-full bg-surface-2 pl-1.5 pr-2 text-sm font-bold text-zinc-800 transition hover:text-brand sm:pr-3"
      >
        <span className="relative">
          <Avatar src={player.image} initial={initial} size={32} />
          {incoming > 0 && (
            <span
              aria-label={`${incoming} pending friend request${incoming === 1 ? "" : "s"}`}
              // The ring is a cut-out of whatever the pip sits on, so it tracks
              // the trigger's fill: `ring-surface-2`, not `ring-white`.
              className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent-pink-ink px-1 text-[10px] font-black text-white ring-2 ring-surface-2"
            >
              {incoming > 9 ? "9+" : incoming}
            </span>
          )}
        </span>
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

          <MenuLink href="/play/you/friends" onNavigate={closeMenu}>
            Friends
            {incoming > 0 && (
              <span className="ml-2 rounded-full bg-accent-pink-ink px-1.5 py-0.5 text-[10px] font-black text-white">
                {incoming}
              </span>
            )}
          </MenuLink>
          {/* "Your profile", not "Account settings": `/play/you` is the player's
              own profile with settings as one tab among several, so the old
              label promised a narrower page than the link now opens. */}
          <MenuLink href="/play/you" onNavigate={closeMenu}>
            Your profile
          </MenuLink>
          {/* Sits in the same slot as Dashboard: the one entry that is only
              there because of who you are. A tester who is also an admin sees
              both — they are different jobs, not two names for one. */}
          {isBetaTester && (
            <MenuLink href="/beta" onNavigate={closeMenu}>
              Beta testing
              <span className="ml-2 rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-brand">
                beta
              </span>
            </MenuLink>
          )}
          {isAdmin && (
            <MenuLink href="/dashboard" onNavigate={closeMenu}>
              Dashboard
            </MenuLink>
          )}

          {/* The rule below the destinations, for the same reason `Sidebar`
              draws one above `SurpriseButton`: what follows is an ACTION, and
              stacking it into the same unbroken column would promise a route
              that could be current. */}
          <div className="my-1 h-px bg-border" />

          {/*
            STEALTH MODE — a launcher, not a destination.

            WHY IT IS IN THE ACCOUNT MENU. The rail's `StealthMenuButton` goes
            away as navigation moves into the top bar, and stealth is the one
            feature on this site whose entire value is being set up BEFORE
            somebody walks over — so it must not spend a single release
            unreachable. `NotSignedInCard` carries the same argument for the
            phone, and traces every other door; read it before moving this.

            A LOCAL BUTTON, NOT `StealthMenuButton`. That component is shaped for
            the rail — `rounded-xl`, `font-extrabold`, brand-tinted hover — and it
            fires `openStealthSettings()` BEFORE its `onNavigate` callback, which
            is precisely the order this row must not use. `StealthSettingsRow` on
            the settings tab reached the same conclusion for the same reason: the
            behaviour is a one-line dispatch, the shape is the part that differs.
            The 🕶️ is the one thing all three launchers do share.

            A `<button>` with no `href` and no `aria-current`, because an action
            cannot be "active" — and it wears the `MenuLink` row styling so the
            column still reads as one list.

            CLOSE FIRST, THEN OPEN, and the focus move in between. All three land
            in ONE React commit, so:
              * `StealthSettings`' opening layout effect records the avatar
                trigger as the element to restore focus to — that button outlives
                the dropdown, whereas this row (and `document.activeElement`
                after it is torn down) does not, and a modal that hands focus
                back to a detached node hands it to nowhere;
              * the dialog never paints underneath a menu still on screen.
            The dropdown's outside-click handler cannot swallow the dialog
            either: it listens for `mousedown` on `document` and only while
            `open`, so it has already seen THIS press — on a node inside `ref`,
            hence no close — and is unbound by this same commit. There is no
            second press for it to misread as "outside".
          */}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              triggerRef.current?.focus();
              openStealthSettings();
            }}
            className="block w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-zinc-800 transition hover:bg-surface-2"
          >
            <span aria-hidden className="mr-1.5">
              🕶️
            </span>
            Stealth mode
          </button>

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

/**
 * One dropdown row that goes somewhere.
 *
 * `onNavigate` rather than `onClick` closes the menu, and the difference is not
 * cosmetic. Both fire on an ordinary click, but `onNavigate` runs ONLY once Next
 * has taken the navigation over — which is exactly the distinction ⌘/Ctrl-click
 * needs: that opens the route in a background tab and leaves the player looking
 * at THIS page, still inside the menu they opened, so closing it would be
 * closing a menu they are using. Next skips `onNavigate` for modified clicks
 * (and for anything non-local) for that reason; `onClick` would not.
 */
function MenuLink({
  href,
  onNavigate,
  children,
}: {
  href: string;
  /** Called when the click becomes a real client-side navigation. */
  onNavigate: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onNavigate={onNavigate}
      role="menuitem"
      className="block rounded-lg px-3 py-2 text-sm font-semibold text-zinc-800 transition hover:bg-surface-2"
    >
      {children}
    </Link>
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
