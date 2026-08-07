"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The `beforeinstallprompt` event is not in the standard DOM lib types.
 * https://developer.mozilla.org/docs/Web/API/BeforeInstallPromptEvent
 */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

const DISMISS_KEY = "hp:installDismissedAt";
const VISITS_KEY = "hp:visits";
const SESSION_KEY = "hp:visitCounted";
const DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const DWELL_MS = 45_000; // first-session engagement dwell
const RETURNING_DELAY_MS = 2500; // let a returning visitor land before nudging

type Mode = "install" | "ios";

/** Already installed / launched from the home screen — never nag. */
function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const mm = window.matchMedia?.("(display-mode: standalone)").matches ?? false;
  const iosStandalone =
    (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  return mm || iosStandalone;
}

/** iOS never fires `beforeinstallprompt`; it needs a manual Share-sheet hint. */
function detectIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const iPhone = /iphone|ipad|ipod/i.test(ua);
  // iPadOS 13+ masquerades as desktop Safari.
  const iPadOS = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return iPhone || iPadOS;
}

function recentlyDismissed(): boolean {
  try {
    const ts = Number(localStorage.getItem(DISMISS_KEY) || "0");
    return ts > 0 && Date.now() - ts < DISMISS_TTL_MS;
  } catch {
    return false;
  }
}

function rememberDismissal(): void {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    // storage blocked — nothing to persist
  }
}

/**
 * "Add to Home Screen" nudge. Shown only after the visitor is engaged
 * (returning visitor, or ≥45s + one interaction this session), and only when
 * the install is actually available. Dismissal is remembered for 30 days.
 *
 * `mode` is the sole render-driving state: it is `null` on the server and on
 * the first client render (so no hydration mismatch), and is only ever set
 * from async callbacks (timers, event listeners, clicks) — never synchronously
 * in the effect body — so there are no cascading renders.
 *
 * Kept separate from <PWA/> (which is dev-guarded) so the logic is testable on
 * its own and free of the service-worker lifecycle.
 */
export function InstallPrompt() {
  const [mode, setMode] = useState<Mode | null>(null);
  const deferredRef = useRef<BeforeInstallPromptEvent | null>(null);
  const dismissedRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Already installed, or dismissed recently → stay silent.
    if (isStandalone() || recentlyDismissed()) return;

    const ios = detectIOS();

    // Count this visit once per tab session.
    let visits = 0;
    try {
      if (!sessionStorage.getItem(SESSION_KEY)) {
        visits = Number(localStorage.getItem(VISITS_KEY) || "0") + 1;
        localStorage.setItem(VISITS_KEY, String(visits));
        sessionStorage.setItem(SESSION_KEY, "1");
      } else {
        visits = Number(localStorage.getItem(VISITS_KEY) || "0");
      }
    } catch {
      // storage blocked — treat as a fresh first visit
    }
    const returningVisitor = visits >= 2;

    let interacted = false;
    let dwellReached = false;

    // Decide (from a callback only) whether the banner should appear now.
    const evaluate = () => {
      if (dismissedRef.current) return;
      const engaged = returningVisitor || (interacted && dwellReached);
      if (!engaged) return;
      if (deferredRef.current) setMode("install");
      else if (ios) setMode("ios");
    };

    const onInteract = () => {
      interacted = true;
      evaluate();
    };
    window.addEventListener("pointerdown", onInteract, { once: true });
    window.addEventListener("keydown", onInteract, { once: true });

    const dwellTimer = window.setTimeout(() => {
      dwellReached = true;
      evaluate();
    }, DWELL_MS);
    const returningTimer = returningVisitor
      ? window.setTimeout(evaluate, RETURNING_DELAY_MS)
      : undefined;

    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      deferredRef.current = e as BeforeInstallPromptEvent;
      evaluate();
    };
    const onInstalled = () => {
      deferredRef.current = null;
      dismissedRef.current = true;
      setMode(null);
      rememberDismissal();
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.clearTimeout(dwellTimer);
      if (returningTimer !== undefined) window.clearTimeout(returningTimer);
      window.removeEventListener("pointerdown", onInteract);
      window.removeEventListener("keydown", onInteract);
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismiss = () => {
    dismissedRef.current = true;
    setMode(null);
    rememberDismissal();
  };

  const install = async () => {
    const deferred = deferredRef.current;
    if (!deferred) return;
    try {
      await deferred.prompt();
      await deferred.userChoice;
    } catch {
      // user closed the native prompt — nothing to do
    }
    deferredRef.current = null;
    dismissedRef.current = true;
    setMode(null);
  };

  if (mode === null) return null;

  // z-[110] keeps the nudge above the game overlay / toast (both z-[100]) so it
  // stays visible and clickable on the immersive /game/[slug] landing pages.
  return (
    <div
      role="region"
      aria-label="Install HALLPASS"
      className="pointer-events-none fixed inset-x-0 z-[110] flex justify-center px-3"
      style={{ bottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
    >
      <div className="pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl border border-white/10 bg-black/85 px-4 py-3 text-white shadow-lg backdrop-blur">
        <div className="min-w-0">
          <p className="text-sm font-bold">Install HALLPASS</p>
          <p className="text-xs font-semibold text-white/70">
            {mode === "install"
              ? "Add to your home screen — plays offline, even with the wifi off."
              : "Tap Share, then “Add to Home Screen” — plays offline, wifi or not."}
          </p>
        </div>
        {mode === "install" && (
          <button
            type="button"
            onClick={install}
            className="shrink-0 rounded-full bg-white px-3.5 py-1.5 text-xs font-black text-black transition hover:bg-white/90"
          >
            Install
          </button>
        )}
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded-full p-1 text-white/60 transition hover:bg-white/10 hover:text-white"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
