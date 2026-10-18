"use client";

/**
 * One polling loop for the dashboard's live widgets, built to cost as little as
 * a poll can while still feeling live to somebody who is looking.
 *
 *  - VISIBLE TABS ONLY. A hidden tab schedules nothing and reads once when it
 *    comes back.
 *  - BACKS OFF WHEN NOTHING CHANGES. Each answer identical to the last doubles
 *    the wait, up to `maxMs`; a different answer, or any click/key/scroll,
 *    snaps back to `baseMs`.
 *  - STOPS WHEN NOBODY IS THERE. After `idleStopMs` with no input the loop
 *    stops outright, so a tab left open overnight costs nothing. The next input
 *    reads once and restarts it.
 *
 * `baseMs` may change between renders (a feed with nothing live asks for a slow
 * base, one with a live run for a fast one); the loop picks it up on its next
 * wait without restarting. `resetKey` restarts it, e.g. on navigation.
 */

import { startTransition, useEffect, useRef } from "react";

export function usePolling<T>({
  read,
  onData,
  baseMs,
  maxMs,
  idleStopMs,
  resetKey,
}: {
  read: () => Promise<T>;
  onData: (value: T) => void;
  baseMs: number;
  maxMs: number;
  idleStopMs: number;
  resetKey?: unknown;
}) {
  const latest = useRef({ read, onData, baseMs });
  useEffect(() => {
    latest.current = { read, onData, baseMs };
  });

  useEffect(() => {
    let cancelled = false;
    let stopped = false;
    let timer: number | undefined;
    let delay = latest.current.baseMs;
    let lastKey: string | undefined;
    let lastInput = Date.now();

    // `cancelled` rather than an AbortController: a Server Function call is not
    // an abortable fetch we own, so a stale read is simply not written.
    const run = () =>
      new Promise<void>((resolve) => {
        startTransition(async () => {
          try {
            const value = await latest.current.read();
            if (cancelled) return;
            const key = JSON.stringify(value);
            delay = key === lastKey ? Math.min(delay * 2, maxMs) : latest.current.baseMs;
            lastKey = key;
            latest.current.onData(value);
          } catch {
            // Silent: the last known state staying on screen is the honest
            // degradation; the server logs its own failures.
          } finally {
            resolve();
          }
        });
      });

    const schedule = () => {
      window.clearTimeout(timer);
      if (cancelled || stopped || document.visibilityState !== "visible") return;
      timer = window.setTimeout(async () => {
        if (Date.now() - lastInput > idleStopMs) {
          stopped = true;
          return;
        }
        await run();
        schedule();
      }, Math.min(delay, maxMs));
    };

    const wake = async () => {
      window.clearTimeout(timer);
      stopped = false;
      delay = latest.current.baseMs;
      await run();
      schedule();
    };

    const onInput = () => {
      lastInput = Date.now();
      if (stopped) void wake();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void wake();
      else window.clearTimeout(timer);
    };

    void wake();
    const events = ["pointerdown", "keydown", "scroll"] as const;
    for (const e of events) window.addEventListener(e, onInput, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, onInput);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // `maxMs`/`idleStopMs` are constants at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);
}
