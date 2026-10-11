"use client";

/**
 * Backstop that sends a signed-in player who still owes a sign-up step to
 * `/play/welcome`, on a normal FULL page load.
 *
 * Every sign-in entry point is meant to pass through `/auth/landing`, but not
 * every signed-in player arrives that way: a session cookie that outlived the
 * account row, the mid-game popup (which asks for a handle only, by design) or a
 * sign-in path that predates the router. This catches them on their next visit.
 *
 * Client-side on purpose: the public pages are statically rendered and a
 * server-side `auth()` in the root layout would make all of them dynamic. The
 * root layout does not remount on soft navigations, so this runs once per
 * document load, never mid-game: the game itself lives in an iframe and the popup
 * routes are exempt. The decision is `shouldRedirectToWelcome` (pure, tested).
 *
 * The optional steps (username, avatar) are prompted once per browser via
 * localStorage so skipping them is final; the mandatory handle is not rate
 * limited. Storage failures degrade to "prompt" for the handle and "do not
 * prompt" for the optional steps.
 */

import { useEffect } from "react";
import { shouldRedirectToWelcome, type OnboardingStep } from "@/app/lib/onboarding";

const PROMPTED_KEY = "hp:onboarding-prompted";

export function OnboardingGate() {
  useEffect(() => {
    let active = true;
    const pathname = window.location.pathname;
    // Cheap exemption check first so exempt pages make no request at all.
    if (!shouldRedirectToWelcome({ pathname, step: "handle", alreadyPrompted: false })) {
      return;
    }
    fetch("/api/v1/me/onboarding", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { step?: OnboardingStep } | null) => {
        if (!active || !d?.step) return;
        let prompted = true; // unknown storage -> do not nag for optional steps
        try {
          prompted = window.localStorage.getItem(PROMPTED_KEY) === "1";
        } catch {}
        if (!shouldRedirectToWelcome({ pathname, step: d.step, alreadyPrompted: prompted })) {
          return;
        }
        if (d.step !== "handle") {
          try {
            window.localStorage.setItem(PROMPTED_KEY, "1");
          } catch {}
        }
        const next = pathname + window.location.search + window.location.hash;
        window.location.replace(`/play/welcome?next=${encodeURIComponent(next)}`);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  return null;
}
