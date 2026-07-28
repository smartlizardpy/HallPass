"use client";

/**
 * Search analytics capture, debounced.
 *
 * WHY THIS EXISTS AT ALL. Capture used to sit inside the header's `onChange`, so
 * every keystroke past three characters became an event: typing "duskfall"
 * emitted `dus`, `dusk`, `duskf`, `duskfa`, `duskfal`, `duskfall`. The dashboard's
 * "top searches" panel was therefore a ranking of PREFIXES rather than of
 * intentions — a real reading was `ter 2 / terr 1 / dus 1 / dusk 1`, which is two
 * people typing two words. It also multiplied PostHog event volume by the average
 * length of a word, in exchange for data strictly worse than one event.
 *
 * THE TRAILING EDGE IS THE POINT. The value reported is the one the player
 * stopped on. A leading-edge debounce would capture `dus` and discard `duskfall`,
 * which is the same bug wearing a hat.
 *
 * WHY THE REPORTER IS SPLIT FROM THE HOOK. The repo has no React testing library
 * and tests hooks by testing what sits underneath them — see
 * `personalization.store.test.ts`. {@link createSearchReporter} holds every
 * decision worth asserting (debouncing, de-duplication, the unmount flush) and is
 * testable with fake timers; {@link useSearchCapture} is the thin React wrapper
 * that owns nothing but lifecycle.
 *
 * WHY THE CALLER IS `ArcadeRows` AND NOT THE HEADER. The header knows what was
 * typed but NOT how many games matched — the catalog rows own the filtering.
 * Reporting the match count is what makes the zero-result dashboard panel
 * possible, and that is the only search metric that is directly actionable:
 * "eleven people searched for a game you do not have" names the next game to add.
 */

import { useEffect, useRef } from "react";
import posthog from "posthog-js";

/** Ignore anything shorter; two characters match half the catalogue. */
export const MIN_SEARCH_LENGTH = 3;

/** How long the player must pause before we believe they meant it. */
export const SEARCH_DEBOUNCE_MS = 600;

/** What a reported search carries. `results` is absent when unknowable. */
export type SearchEvent = { query: string; results?: number };

export type SearchReporter = {
  /** Note the current query and match count; schedules a report. */
  report(query: string, results?: number): void;
  /** Send anything pending immediately (used on unmount). */
  flush(): void;
  /** Drop anything pending without sending. */
  cancel(): void;
};

/**
 * The debouncing/de-duplicating core, with the emit side injected so tests can
 * observe it and the hook can wire it to PostHog.
 *
 * De-duplication is keyed on the QUERY only. A re-render that changes just the
 * match count — switching category while a search is active, say — must not
 * re-report: the player did not search again. Without that guard the zero-result
 * panel would over-count every term a browsing player left in the box.
 */
export function createSearchReporter(
  emit: (event: SearchEvent) => void,
  debounceMs: number = SEARCH_DEBOUNCE_MS,
): SearchReporter {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: SearchEvent | null = null;
  let lastSent: string | null = null;

  const send = (): void => {
    timer = undefined;
    const event = pending;
    pending = null;
    if (!event) return;
    if (event.query.length < MIN_SEARCH_LENGTH) return;
    if (event.query === lastSent) return;
    lastSent = event.query;
    emit(event);
  };

  return {
    report(query, results) {
      const trimmed = query.trim();
      if (trimmed.length < MIN_SEARCH_LENGTH) {
        // Clearing the box is not a search. Drop anything pending so a half-typed
        // word is not reported after the player has already given up on it.
        pending = null;
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        return;
      }
      pending =
        typeof results === "number"
          ? { query: trimmed, results }
          : { query: trimmed };
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(send, debounceMs);
    },
    flush() {
      if (timer !== undefined) clearTimeout(timer);
      send();
    },
    cancel() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      pending = null;
    },
  };
}

function emitToPostHog(event: SearchEvent): void {
  posthog.capture("game_searched", {
    query: event.query,
    // Omitted entirely when the caller cannot know the count (the store page's
    // navigate-on-submit search). The dashboard's zero-result panel EXCLUDES
    // events without this property rather than reading a missing one as zero —
    // treating absence as zero would invent a content gap for every search made
    // before this shipped.
    ...(typeof event.results === "number" ? { results: event.results } : {}),
  });
}

/** Report a search immediately — for submit-style search with no live filtering. */
export function captureSearchNow(query: string): void {
  const trimmed = query.trim();
  if (trimmed.length < MIN_SEARCH_LENGTH) return;
  emitToPostHog({ query: trimmed });
}

/**
 * Report `query` once it stops changing, together with how many games it matched.
 *
 * Flushes on unmount, so navigating away mid-word still records what was actually
 * typed. That matters more than it sounds: an abandoned search is often a search
 * that found nothing, which is exactly the signal worth having.
 */
export function useSearchCapture(query: string, results: number): void {
  const reporter = useRef<SearchReporter | null>(null);
  if (reporter.current === null) {
    // Lazy init in render is safe — it touches no ref that a discarded render
    // could leave stale, and `createSearchReporter` has no side effects until
    // `report` is called from the effect below.
    reporter.current = createSearchReporter(emitToPostHog);
  }

  useEffect(() => {
    reporter.current?.report(query, results);
  }, [query, results]);

  useEffect(() => {
    const current = reporter.current;
    return () => current?.flush();
  }, []);
}
