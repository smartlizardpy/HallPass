"use client";

/**
 * Slide-down banner telling a player they have been made a beta tester.
 *
 * Visually the same pill as {@link WelcomeToast} — the site has exactly one
 * banner shape and this is it. The DIFFERENCE is what triggers it. `WelcomeToast`
 * fires on a `?welcome=` flag that `/auth/landing` puts in the URL, i.e. the
 * site already knows the moment has arrived. Nobody can put a flag in the URL
 * here: the player is invited from the dashboard, possibly while they are
 * offline, and the next thing they do is open the site normally. So the trigger
 * is a STATE CHANGE the client notices for itself — "the API says I am a tester
 * and I have never been told" — and the acknowledgement is remembered in
 * localStorage, exactly as `FeaturePromo` remembers its dismissals.
 *
 * IT DOES NOT AUTO-DISMISS, unlike `WelcomeToast`. A welcome-back greeting is
 * pleasant and disposable; this one carries a link to somewhere the player has
 * never been, and a banner that slides away after four seconds is a banner that
 * gets missed. It stays until acknowledged, and acknowledging is what marks it
 * seen — so a player who reloads mid-read gets it again rather than losing it.
 *
 * THE DISMISSAL KEY IS PER PLAYER. A single global key would mean the first
 * tester to use a shared school computer suppresses the banner for every other
 * account on that machine — the exact environment this site is built for.
 *
 * STAYS OUT OF THE WAY. It reads `/api/v1/me` (never intercepted by the service
 * worker) so the pages it mounts on stay statically prerendered, and it refuses
 * to appear while another modal has locked body scroll or while a game is being
 * played — the same courtesy `FeaturePromo` extends.
 */

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { MeResponse } from "@/sdk/src/contract";

const STORAGE_PREFIX = "hp:beta-welcomed:";

/** Let the page paint and settle before sliding anything over it. */
const DELAY_MS = 1200;

/**
 * Routes where this would interrupt rather than inform: the beta pages
 * themselves (they already say it), the dashboard (someone working), and the
 * mid-flow auth screens.
 */
const SUPPRESSED_PREFIXES = [
  "/beta",
  "/dashboard",
  "/admin",
  "/play/signin",
  "/play/signout",
  "/play/welcome",
  "/play/auth",
  "/offline",
];

function storageKey(playerId: string): string {
  return `${STORAGE_PREFIX}${playerId}`;
}

function wasWelcomed(playerId: string): boolean {
  try {
    return window.localStorage.getItem(storageKey(playerId)) === "1";
  } catch {
    // Storage can be unavailable (private mode, blocked cookies). Treat that as
    // "already welcomed" rather than throwing OR nagging: a banner that cannot
    // remember being dismissed would reappear on every single navigation, which
    // is far worse than never showing. Same fail-soft posture as
    // `FeaturePromo`, opposite default for the opposite reason.
    return true;
  }
}

function rememberWelcomed(playerId: string): void {
  try {
    window.localStorage.setItem(storageKey(playerId), "1");
  } catch {
    /* best effort */
  }
}

export function BetaWelcome() {
  const pathname = usePathname();
  const [player, setPlayer] = useState<{ id: string; handle: string } | null>(
    null,
  );
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (SUPPRESSED_PREFIXES.some((p) => pathname.startsWith(p))) return;

    let active = true;
    const timer = setTimeout(() => {
      // Something else owns the screen (the player overlay, the mobile drawer).
      if (document.body.style.overflow === "hidden") return;

      fetch("/api/v1/me", { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .then((data: MeResponse | null) => {
          if (!active || !data?.player || !data.isBetaTester) return;
          if (wasWelcomed(data.player.id)) return;
          setPlayer({ id: data.player.id, handle: data.player.handle });
          // Next frame → trigger the slide-in transition.
          requestAnimationFrame(() => active && setShown(true));
        })
        .catch(() => {
          /* offline or a blip — try again on the next navigation */
        });
    }, DELAY_MS);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [pathname]);

  if (!player) return null;

  const acknowledge = () => {
    rememberWelcomed(player.id);
    setShown(false);
    // Let the slide-out finish before unmounting.
    setTimeout(() => setPlayer(null), 400);
  };

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-0 z-[96] flex justify-center px-4"
    >
      <div
        className={`pointer-events-auto mt-3 flex max-w-[min(28rem,calc(100vw-2rem))] items-center gap-3 rounded-2xl border border-brand/30 bg-white/95 py-2 pl-3 pr-2 shadow-xl backdrop-blur transition-all duration-500 ease-out motion-reduce:transition-none ${
          shown ? "translate-y-0 opacity-100" : "-translate-y-20 opacity-0"
        }`}
      >
        <span
          aria-hidden
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-100 text-lg"
        >
          🎉
        </span>

        <span className="min-w-0 flex-1">
          <span className="block text-sm font-extrabold text-zinc-900">
            You&rsquo;re a beta tester!
          </span>
          <span className="block text-xs font-semibold text-muted">
            Games get assigned to you early. Find bugs, earn XP.
          </span>
        </span>

        <a
          href="/beta"
          onClick={acknowledge}
          className="shrink-0 rounded-full bg-brand px-3.5 py-2 text-xs font-extrabold text-white transition hover:bg-brand-600"
        >
          Open
        </a>
        <button
          type="button"
          onClick={acknowledge}
          aria-label="Dismiss"
          className="shrink-0 rounded-full px-2 py-2 text-sm font-black text-muted transition hover:bg-surface-2 hover:text-zinc-900"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
