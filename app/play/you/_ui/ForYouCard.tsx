"use client";

/**
 * The Settings-tab card for the "for you" order of the game grid.
 *
 * Signing in is what turns the feature on; this is where a signed-in player turns
 * it off, sees how much their device has learned, and wipes it. Everything here
 * acts on `localStorage` through `taste-store.ts` — nothing is sent anywhere, and
 * the card says so, because "we personalise your list" without "and it never
 * leaves this device" would be the wrong half of the sentence to leave out for
 * this audience.
 *
 * A SWITCH, NOT A CHECKBOX. It is a single on/off setting that takes effect the
 * moment it is pressed, which is a switch's contract; `role="switch"` with
 * `aria-checked` is announced as such, and no ARIA has to be invented.
 *
 * TURNING IT OFF ALSO FORGETS. `setForYouEnabled(false)` deletes the record, so
 * the count below drops to zero at once and "off" means gone, not hidden.
 */

import { useState } from "react";
import {
  resetTaste,
  setForYouEnabled,
  useForYouEnabled,
  useTaste,
} from "@/app/lib/taste-store";

export function ForYouCard() {
  const enabled = useForYouEnabled();
  const learned = Object.keys(useTaste()).length;
  const [justReset, setJustReset] = useState(false);

  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3
            id="settings-for-you"
            className="text-sm font-black uppercase tracking-wide text-foreground"
          >
            <span aria-hidden className="mr-1.5">
              ✨
            </span>
            Games picked for you
          </h3>
          <p className="mt-2 text-sm text-muted">
            Because you are signed in, HallPass puts games you are likely to enjoy first,
            based on the games you play and favourite. It is worked out on this device and
            never leaves it — not to our servers and not to your account.
          </p>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-labelledby="settings-for-you"
          onClick={() => {
            setJustReset(false);
            setForYouEnabled(!enabled);
          }}
          style={{ touchAction: "manipulation" }}
          className={`relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/30 ${
            enabled ? "bg-brand" : "bg-border"
          }`}
        >
          {/* Literal white: it sits on the coloured track, which does not follow the theme. */}
          <span
            aria-hidden
            className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${
              enabled ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      <p className="mt-3 text-xs font-semibold text-muted" aria-live="polite">
        {enabled
          ? learned > 0
            ? `This device has learned from ${learned} ${learned === 1 ? "game" : "games"}.`
            : "This device has not learned anything yet."
          : "Off. Nothing is being recorded, and what was learned has been deleted."}
      </p>

      {enabled && learned > 0 && (
        <button
          type="button"
          onClick={() => {
            resetTaste();
            setJustReset(true);
          }}
          className="mt-3 text-[13px] font-bold text-brand underline-offset-2 hover:underline focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/30"
        >
          Forget what this device has learned
        </button>
      )}
      {justReset && learned === 0 && (
        <p className="mt-3 text-xs font-bold text-muted">Done. Your list will start fresh.</p>
      )}
    </div>
  );
}
