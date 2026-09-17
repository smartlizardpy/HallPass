"use client";

import { useEffect, useState } from "react";
import { CREDIT_PLACEHOLDER } from "../lib/credit-visibility";

/**
 * The footer's byline — real names for a visitor `/api/v1/credit-visibility`
 * geolocates to the UK or Turkey, {@link CREDIT_PLACEHOLDER} for everyone
 * else. See that route and `app/lib/credit-visibility.ts` for the rule and
 * the `CREDIT_GEO_GATE` switch that turns it off entirely.
 *
 * A CLIENT ISLAND, same pattern as `AccountMenu`'s identity fetch: the
 * decision needs the visitor's real IP, which only a Route Handler sees, so
 * `SiteFooter` stays static and this is the one piece that hydrates in. It
 * defaults to the placeholder and only SWAPS to the real names once the fetch
 * confirms them — never the other way around, so a slow or failed request
 * never flashes a real name at a visitor the gate meant to hide it from.
 *
 * THE PLACEHOLDER IS ALSO A BUTTON. Clicking "{@link CREDIT_PLACEHOLDER}"
 * reveals the real names on the spot, same local `showReal` state the fetch
 * would have set — a deliberate escape hatch, not a leak: the gate hides the
 * names from a random visitor by default, but never from someone who
 * specifically goes looking.
 */
export function FooterCredits() {
  const [showReal, setShowReal] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/v1/credit-visibility")
      .then((r) => (r.ok ? r.json() : { showRealCredits: false }))
      .then((d: { showRealCredits?: boolean }) => {
        if (active && d.showRealCredits) setShowReal(true);
      })
      // Offline or a transport failure: stay on the placeholder, the safe
      // default this component already renders.
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  if (showReal) {
    return (
      <p>
        Games by <span className="text-foreground">Ateş Demir</span> · Site by{" "}
        <span className="text-foreground">Ozan Kaygusuz</span> · Marketing by{" "}
        <span className="text-foreground">Sohan Kanti Dolai</span>
      </p>
    );
  }

  return (
    <p>
      Made by{" "}
      <button
        type="button"
        onClick={() => setShowReal(true)}
        className="text-foreground underline underline-offset-2 transition hover:text-brand"
      >
        {CREDIT_PLACEHOLDER}
      </button>
    </p>
  );
}
