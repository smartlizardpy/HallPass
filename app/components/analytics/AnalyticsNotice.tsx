"use client";

/**
 * A one-time, dismissible note explaining the analytics HallPass collects.
 *
 * Shown once per device (`hp:analytics-notice-seen`), a few seconds after the
 * page settles, as a small card in the bottom corner. It is a plain
 * non-modal region: it never traps or steals focus, never dims the page, and
 * can be ignored while playing. "Okay" dismisses it; "Turn off analytics" opts
 * the device out (see `app/lib/analytics-consent.ts`) and dismisses it.
 *
 * WHERE IT DOES NOT APPEAR, and why:
 * - inside any iframe (`/embed/*` panels and game frames are small boxes inside
 *   somebody else's page — a banner there would cover the game);
 * - `/embed`, the dashboard and admin, sign-in and OAuth flows — working or
 *   mid-flow surfaces, the same list `FeaturePromo` suppresses;
 * - `/c/` and `/i/` landing pages, whose whole job is one big Play / Accept
 *   button on a phone-sized screen. The notice appears on the visitor's next
 *   page instead; nothing is lost because it is shown "once per device", not
 *   "once per page".
 * - while another overlay owns the screen (`isOverlayOpen`) — it waits.
 *
 * MOUNTED ONCE in the root layout, like `WelcomeToast`. Everything per-visitor is
 * read in an effect, so the prerendered HTML is identical for everyone and the
 * pages stay static. Motion is a plain opacity fade, which the global
 * reduced-motion rule leaves in place (it only strips movement).
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  hasSeenAnalyticsNotice,
  isAnalyticsOptedOut,
  markAnalyticsNoticeSeen,
  setAnalyticsOptOut,
} from "@/app/lib/analytics-consent";
import { isOverlayOpen } from "@/app/lib/overlay-lock";

const SUPPRESSED_PREFIXES = [
  "/embed",
  "/dashboard",
  "/admin",
  "/oauth",
  "/offline",
  "/play/signin",
  "/play/signout",
  "/play/welcome",
  "/play/auth",
  "/c/",
  "/i/",
  // The privacy page explains all this itself, with the switch on it.
  "/privacy",
];

function isSuppressed(pathname: string): boolean {
  return SUPPRESSED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : `${p}/`),
  );
}

const SHOW_DELAY_MS = 2500;
const RETRY_MS = 2000;

export function AnalyticsNotice() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) return;
    if (isSuppressed(pathname)) return;
    let framed = true;
    try {
      framed = window.self !== window.top;
    } catch {
      // A cross-origin parent throws — that is an iframe by definition.
    }
    if (framed) return;
    if (hasSeenAnalyticsNotice() || isAnalyticsOptedOut()) return;

    let timer: ReturnType<typeof setTimeout>;
    const tryShow = () => {
      if (hasSeenAnalyticsNotice()) return;
      if (isOverlayOpen()) {
        timer = setTimeout(tryShow, RETRY_MS);
        return;
      }
      setOpen(true);
      requestAnimationFrame(() => setVisible(true));
    };
    timer = setTimeout(tryShow, SHOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [pathname, open]);

  // Navigating onto a suppressed route while the card is up (rare: it only
  // appears after a delay) hides it without marking it seen.
  const hidden = !open || isSuppressed(pathname);
  if (hidden) return null;

  const close = (optOut: boolean) => {
    markAnalyticsNoticeSeen();
    if (optOut) setAnalyticsOptOut(true);
    setVisible(false);
    setTimeout(() => setOpen(false), 200);
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[70] flex justify-center px-4 sm:bottom-4 sm:justify-start">
      <section
        aria-labelledby="analytics-notice-title"
        aria-describedby="analytics-notice-body"
        className={`pointer-events-auto w-full max-w-sm rounded-2xl border border-border bg-surface p-4 shadow-xl transition-opacity duration-200 ${
          visible ? "opacity-100" : "opacity-0"
        }`}
      >
        <h2
          id="analytics-notice-title"
          className="text-sm font-black text-foreground"
        >
          A quick note about data
        </h2>
        <p id="analytics-notice-body" className="mt-1 text-xs font-semibold text-muted">
          We count which pages get visited and which games get played, plus
          your device or browser type and rough country. That helps us fix bugs
          and make better games. No ads, and we never sell your data.{" "}
          <Link
            href="/privacy"
            onClick={() => markAnalyticsNoticeSeen()}
            className="underline underline-offset-2 hover:text-brand focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/30"
          >
            Read more
          </Link>
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => close(false)}
            className="rounded-full bg-brand px-4 py-1.5 text-xs font-extrabold text-white hover:bg-brand-600 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/30"
          >
            Okay
          </button>
          <button
            type="button"
            onClick={() => close(true)}
            className="rounded-full border border-border bg-surface px-4 py-1.5 text-xs font-bold text-foreground-2 hover:bg-surface-2 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/30"
          >
            Turn off analytics
          </button>
        </div>
      </section>
    </div>
  );
}
