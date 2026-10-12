"use client";

/**
 * Forwards the co-op SDK's session messages to PostHog — see
 * `app/lib/coop-telemetry.ts` for what is accepted and why. Mounted once in the
 * root layout rather than inside the player overlay: the SDK reports a session's
 * end from the game frame's `pagehide`, which fires as the overlay unmounts, so a
 * listener that lived and died with the overlay would miss exactly that message.
 *
 * Same-origin only. PostHog itself drops the event for a device that opted out
 * of analytics (`instrumentation-client.ts`).
 */

import { useEffect } from "react";
import posthog from "posthog-js";
import { parseCoopMessage } from "../lib/coop-telemetry";

export function CoopTelemetry() {
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source === window) return;
      const capture = parseCoopMessage(e.data);
      if (!capture) return;
      try {
        posthog.capture(capture.event, capture.props);
      } catch {
        /* Analytics must never break a play. */
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return null;
}
