/**
 * Browser helper for the popup sign-in flow, upholding the SDK's golden rule:
 * every function is fully guarded and NEVER throws. Nothing here runs at import
 * time — each helper is inert until called, so bundling this module can't have
 * side effects on a host game page.
 *
 * The flow, from the SDK's side:
 *  1. `openAuthPopup(url)` opens the sign-in page in a small popup window.
 *  2. `subscribeAuthSignals(cb)` listens for the auth-complete page announcing
 *     success across all three cross-context channels below.
 *  3. `watchPopup(popup, cb)` notices the popup CLOSING as a weaker fallback hint
 *     (hence `onMaybeDone` — a close is not proof of success, just a nudge to
 *     re-check identity).
 *
 * The three signal transports all key off the SAME pinned string
 * (`SIGNAL_KEY`), but are genuinely independent so a signal lands regardless of
 * which one a given browser/COOP configuration allows:
 *  - `BroadcastChannel("hallpass:auth")` — same-origin, most reliable.
 *  - a `storage` event on `localStorage["hallpass:auth"]` — cross-tab fallback.
 *  - a same-origin `postMessage` of `{ type: "hallpass:auth" }` from the popup.
 *
 * Cross-Origin-Opener-Policy is the recurring hazard: it can make `popup.closed`
 * throw or read `true` prematurely, and it can sever `postMessage`. Every read is
 * therefore wrapped and every failure swallowed.
 */

/** Path of the page the popup lands on once auth succeeds; it emits the signals. */
export const AUTH_COMPLETE_PATH = "/play/auth/complete";

/**
 * The single pinned string shared by all three signal transports: the
 * `BroadcastChannel` name, the `localStorage` key watched via `storage` events,
 * and the `type` field of the `postMessage` payload.
 */
const SIGNAL_KEY = "hallpass:auth";

/** How often `watchPopup` polls `popup.closed`. */
const POLL_MS = 500;

/** Hard ceiling on `watchPopup` polling, after which it stops watching. */
const WATCH_MAX_MS = 5 * 60 * 1000;

/**
 * Open `url` in a named auth popup and return its `Window`, or `null` when the
 * open fails (blocked by a popup blocker, no `window`, sandboxed). Never throws.
 */
export function openAuthPopup(url: string): Window | null {
  try {
    if (typeof window === "undefined" || typeof window.open !== "function") {
      return null;
    }
    return window.open(url, "hallpass-auth", "popup=yes,width=480,height=680");
  } catch {
    // Popup blocked or navigation disallowed — degrade to null.
    return null;
  }
}

/**
 * Poll `popup.closed` every {@link POLL_MS}ms and invoke `onMaybeDone` EXACTLY
 * ONCE the first time it reads closed. Stops polling after {@link WATCH_MAX_MS}
 * even if the popup never closes (or its `.closed` stays unreadable under COOP).
 * Returns a cancel function that clears the timers; safe to call more than once.
 *
 * `null` popup → a no-op cancel. Every `.closed` read is guarded because COOP can
 * make it throw; a throw is treated as "still open" and simply skips that tick.
 */
export function watchPopup(popup: Window | null, onMaybeDone: () => void): () => void {
  if (!popup) return () => {};

  let done = false;
  let poll: ReturnType<typeof setInterval> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;

  function stop(): void {
    try {
      if (poll !== undefined) clearInterval(poll);
    } catch {
      // no-op
    }
    try {
      if (deadline !== undefined) clearTimeout(deadline);
    } catch {
      // no-op
    }
  }

  function finish(): void {
    if (done) return;
    done = true;
    stop();
    try {
      onMaybeDone();
    } catch {
      // A misbehaving callback must never break the SDK.
    }
  }

  try {
    poll = setInterval(() => {
      let closed = false;
      try {
        closed = (popup as Window).closed === true;
      } catch {
        // COOP can make `.closed` throw — treat as still open, skip this tick.
        return;
      }
      if (closed) finish();
    }, POLL_MS);

    // Hard stop: never leave the interval running forever.
    deadline = setTimeout(stop, WATCH_MAX_MS);
  } catch {
    stop();
  }

  return stop;
}

/**
 * Subscribe to all three auth-complete signal transports and call `onSignal`
 * whenever any of them fires. Returns an unsubscribe that removes every listener
 * (and closes the `BroadcastChannel`). Each transport is feature-detected and
 * independently guarded; outside a browser this is a no-op returning a no-op.
 * Never throws.
 */
export function subscribeAuthSignals(onSignal: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  const cleanups: Array<() => void> = [];

  function fire(): void {
    try {
      onSignal();
    } catch {
      // A misbehaving callback must never break the SDK.
    }
  }

  // 1. BroadcastChannel — the auth-complete page posts to the same-origin channel.
  try {
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(SIGNAL_KEY);
      channel.onmessage = () => fire();
      cleanups.push(() => {
        try {
          channel.close();
        } catch {
          // no-op
        }
      });
    }
  } catch {
    // BroadcastChannel construction blocked — skip this transport.
  }

  // 2. storage event — a timestamp written to localStorage[SIGNAL_KEY] fires
  //    `storage` in OTHER tabs/windows sharing the origin.
  try {
    const onStorage = (e: StorageEvent) => {
      if (e.key === SIGNAL_KEY) fire();
    };
    window.addEventListener("storage", onStorage);
    cleanups.push(() => {
      try {
        window.removeEventListener("storage", onStorage);
      } catch {
        // no-op
      }
    });
  } catch {
    // ignore
  }

  // 3. postMessage — the popup posts `{ type: SIGNAL_KEY }` back to its opener,
  //    accepted only from our own origin and only with the expected shape.
  try {
    const onMessage = (e: MessageEvent) => {
      try {
        if (
          e.origin === location.origin &&
          (e.data as { type?: unknown } | null)?.type === SIGNAL_KEY
        ) {
          fire();
        }
      } catch {
        // Reading e.origin / e.data can throw under some COOP setups — swallow.
      }
    };
    window.addEventListener("message", onMessage);
    cleanups.push(() => {
      try {
        window.removeEventListener("message", onMessage);
      } catch {
        // no-op
      }
    });
  } catch {
    // ignore
  }

  return () => {
    for (const cleanup of cleanups.slice()) {
      try {
        cleanup();
      } catch {
        // no-op
      }
    }
  };
}
