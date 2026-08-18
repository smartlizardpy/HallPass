"use client";

import { useEffect, useRef, useState } from "react";
import { WHATS_NEW_URL } from "../lib/whats-new";

/**
 * The changelog itself, framed from ShipNote.
 *
 * ── WHY A FRAME AND NOT A FETCH ────────────────────────────────────────────
 * ShipNote stays the source of truth: an entry published there is live here the
 * moment it is published, with no API, no key, no cached read and no scheduler
 * to keep in step — and there is no cron in this project by design. What we give
 * up is that the changelog's text belongs to the framed origin and is not ours
 * to index, which is why `/new` carries its own heading and copy around this.
 *
 * ── THE ESCAPE HATCH IS PERMANENT, NOT CONDITIONAL ─────────────────────────
 * A cross-origin frame can be refused by `X-Frame-Options` / `frame-ancestors`,
 * and the browser gives the embedder NO reliable signal when that happens —
 * `PlayerOverlay` documents the same problem for external games and answers it
 * with a ~4s timer, which this reuses rather than inventing a second heuristic.
 *
 * But the timer is a GUESS, and this page has something the game overlay does
 * not: room to show the way out without covering anything. The hosted changelog
 * is therefore linked ALWAYS, not only when the guess fires. The host could not
 * be reached from the build container at all (its network policy denies it), so
 * "it embeds fine" was never something we could verify — and a page whose only
 * fallback depends on detecting a failure we cannot detect is a page that can
 * simply be blank.
 *
 * ── NO `sandbox`, DELIBERATELY ─────────────────────────────────────────────
 * Matching `PlayerOverlay`, which frames arbitrary third-party games without
 * one. A sandbox that is too tight breaks the framed app in ways only running it
 * would reveal — and running it is exactly what this environment cannot do. The
 * frame is cross-origin either way, so it can no more reach this page's DOM with
 * the attribute than without it.
 */
export function WhatsNewFrame() {
  // The frame did not report a load in time, so it may be refusing to embed.
  const [maybeBlocked, setMaybeBlocked] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timerRef.current = setTimeout(() => setMaybeBlocked(true), 4000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, []);

  // onLoad fired => it embedded fine; cancel the pending guess.
  const handleLoad = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setMaybeBlocked(false);
  };

  return (
    <div>
      <div className="relative h-[70svh] min-h-[420px] overflow-hidden rounded-3xl bg-white">
        <iframe
          src={WHATS_NEW_URL}
          title="HALLPASS changelog"
          onLoad={handleLoad}
          className="absolute inset-0 h-full w-full border-0"
        />

        {maybeBlocked && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/80 p-6 backdrop-blur-sm">
            <div className="max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl">
              <p className="text-sm font-bold text-zinc-900">
                The changelog is taking a while, or will not open here.
              </p>
              <p className="mt-1 text-[13px] font-semibold text-zinc-600">
                It lives on another site, so it needs a connection — and some
                networks block it.
              </p>
              <a
                href={WHATS_NEW_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center justify-center rounded-full bg-brand px-5 py-2.5 text-sm font-extrabold text-white transition hover:bg-brand-600"
              >
                Open it directly ↗
              </a>
            </div>
          </div>
        )}
      </div>

      {/* Always here, never conditional — see the header. */}
      <p className="mt-3 text-[13px] font-semibold text-muted">
        The changelog is hosted elsewhere, so this part needs a connection even
        though the rest of HALLPASS does not.{" "}
        <a
          href={WHATS_NEW_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="font-bold text-brand hover:text-brand-600"
        >
          Open the full changelog ↗
        </a>
      </p>
    </div>
  );
}
