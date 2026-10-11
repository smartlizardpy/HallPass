"use client";

/**
 * The analytics on/off switch, in two shapes:
 *
 * - {@link AnalyticsSwitch} — the bare switch + one-line explanation, for
 *   embedding in prose (the privacy page, the first-visit notice).
 * - {@link AnalyticsSettingsCard} — the same inside a settings-style card, for
 *   `/play/you/settings` and the signed-out card.
 *
 * Both read and write the per-device choice in `app/lib/analytics-consent.ts`.
 * Nothing here needs an account, so it works signed in or out. Changing the
 * switch fires `ANALYTICS_CHOICE_EVENT`, which `instrumentation-client.ts`
 * turns into `posthog.opt_out_capturing()` / `opt_in_capturing()` immediately.
 *
 * The state is read with `useSyncExternalStore` so server HTML (always "on")
 * and the first client render agree, then the real stored value is applied
 * without a hydration mismatch. Other tabs are followed via the `storage` event.
 */

import { useSyncExternalStore } from "react";
import {
  ANALYTICS_CHOICE_EVENT,
  ANALYTICS_OPTOUT_KEY,
  isAnalyticsOptedOut,
  setAnalyticsOptOut,
} from "@/app/lib/analytics-consent";

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === ANALYTICS_OPTOUT_KEY || e.key === null) onChange();
  };
  window.addEventListener(ANALYTICS_CHOICE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(ANALYTICS_CHOICE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** Live opt-out state for this device. Server snapshot is "not opted out". */
export function useAnalyticsOptOut(): boolean {
  return useSyncExternalStore(subscribe, () => isAnalyticsOptedOut(), () => false);
}

export function AnalyticsSwitch({ idPrefix = "analytics" }: { idPrefix?: string }) {
  const optedOut = useAnalyticsOptOut();
  const on = !optedOut;
  const labelId = `${idPrefix}-label`;
  const hintId = `${idPrefix}-hint`;

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div id={labelId} className="text-sm font-black text-foreground">
          Help improve HallPass
        </div>
        <p id={hintId} className="mt-1 text-xs font-semibold text-muted">
          We count visits and which games get played so we can fix bugs and make
          better games. We never sell your data. Saved on this device.
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby={labelId}
        aria-describedby={hintId}
        onClick={() => setAnalyticsOptOut(on)}
        className={`relative mt-0.5 inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/30 ${
          on ? "border-brand bg-brand" : "border-border bg-surface-2"
        }`}
      >
        <span
          aria-hidden
          className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform motion-reduce:transition-none ${
            on ? "translate-x-6" : "translate-x-1"
          }`}
        />
        <span className="sr-only">{on ? "On" : "Off"}</span>
      </button>
    </div>
  );
}

export function AnalyticsSettingsCard() {
  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <h3 className="text-sm font-black uppercase tracking-wide text-foreground">
        <span aria-hidden className="mr-1.5">
          📊
        </span>
        Analytics
      </h3>
      <div className="mt-3">
        <AnalyticsSwitch idPrefix="settings-analytics" />
      </div>
    </div>
  );
}
