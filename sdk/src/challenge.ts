/**
 * Browser helper for the challenge picker, upholding the SDK's golden rule:
 * every function is fully guarded and NEVER throws. Nothing here runs at import
 * time — each helper is inert until called, so bundling this module cannot have
 * side effects on a host game page.
 *
 * The flow, from the SDK's side:
 *  1. {@link pickerUrl} builds the first-party URL of the picker page.
 *  2. {@link openPicker} shows it — INLINE when the game is same-origin with
 *     HallPass, as a POPUP WINDOW when it is not (see below).
 *  3. {@link subscribeChallengeSignals} listens for the picker announcing what
 *     happened, across the same three cross-context channels `auth-flow.ts` uses.
 *
 * ── WHY THE TRANSPORT DEPENDS ON THE ORIGIN ────────────────────────────────
 * Hosted games are served from `/game-html/<slug>/` on HallPass's OWN origin, so
 * a nested `/embed/challenge` frame there is first-party and its session cookie
 * flows normally. An externally-hosted game is cross-origin, and a HallPass
 * frame nested inside it is a THIRD-PARTY context whose cookie the browser may
 * withhold — the picker would render "sign in" to somebody already signed in.
 * A popup window is top-level and does not have that problem, which is the same
 * conclusion `auth-flow.ts` reached for sign-in. The game never has to know.
 *
 * ── THE PANEL IS SMALL ON PURPOSE ──────────────────────────────────────────
 * The inline frame is a centred card, not a full-viewport overlay, and there is
 * no backdrop dimming the page: the game stays visible behind it. Sizing lives
 * here rather than in the page's CSS because only this side knows how much room
 * the host actually has.
 */

/**
 * The one pinned string shared by all three signal transports: the
 * `BroadcastChannel` name, the `localStorage` key watched via `storage` events,
 * and the `type` field of the `postMessage` payload.
 *
 * MIRRORED BY HAND in `app/embed/challenge/ChallengeEmbed.tsx`. It cannot be
 * imported from there — the SDK must not pull in app code — and it cannot live
 * in `contract.ts`, which is types-only by rule and carries no runtime values.
 */
export const CHALLENGE_SIGNAL_KEY = "hallpass:challenge";

/** Path of the picker page. */
export const CHALLENGE_PATH = "/embed/challenge";

/** How long to keep listening before giving up and tearing down. */
const WATCH_MAX_MS = 5 * 60 * 1000;

/** What the picker sends back. Mirrors the `Signal` type on the page. */
export interface ChallengeSignal {
  sent: boolean;
  reason?: string;
  challenge?: {
    to: string;
    targetScore: number;
    board: string;
    game: string | null;
  };
}

/**
 * Build the picker URL. Pure and exported for testing.
 *
 * Only non-empty parameters are appended, so a game with one board can pass
 * nothing but its slug and let the server resolve the board.
 */
export function pickerUrl(
  api: string,
  opts: { game?: string | null; board?: string | null } = {},
): string {
  const params: string[] = [];
  if (opts.game) params.push(`game=${encodeURIComponent(opts.game)}`);
  if (opts.board) params.push(`board=${encodeURIComponent(opts.board)}`);
  const query = params.length ? `?${params.join("&")}` : "";
  return `${api}${CHALLENGE_PATH}${query}`;
}

/**
 * Is the host page on the same origin as the HallPass API?
 *
 * Decides inline-frame versus popup.
 *
 * RESOLVED AGAINST THE PAGE URL, which is not a detail: `config.ts` allows `api`
 * to be relative (its documented last resort is the page origin), and a relative
 * value genuinely DOES mean "same origin" — so the inline frame is the right
 * answer there, and its cookie really will flow. A value too malformed to
 * resolve even relatively lands on the page origin too, which is harmless for
 * the same reason: whatever it was meant to be, the frame it opens is
 * first-party.
 *
 * With no `window` at all there is nothing to compare, and `false` selects the
 * popup — the option that works in strictly more situations.
 */
export function isSameOrigin(api: string): boolean {
  try {
    if (typeof window === "undefined" || !window.location) return false;
    return new URL(api, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

/** A picker that has been opened, and the one way to take it away again. */
export interface OpenPicker {
  close(): void;
  /** The popup window, when that is the transport — so the caller can watch it. */
  window: Window | null;
}

/**
 * Show the picker inline, in a small centred frame over the game.
 *
 * Returns `null` when the DOM will not take it (no `document`, a sandbox that
 * blocks frames), so the caller can fall back to a popup.
 */
export function openInlinePicker(url: string): OpenPicker | null {
  try {
    if (typeof document === "undefined" || !document.body) return null;

    const frame = document.createElement("iframe");
    frame.src = url;
    frame.title = "Challenge a friend";
    // `min()` keeps it inside a small game canvas without a media query, and the
    // fixed centring is deliberately NOT a full-screen flex container: nothing
    // here covers the page or intercepts a click outside the card.
    frame.setAttribute(
      "style",
      [
        "position:fixed",
        "top:50%",
        "left:50%",
        "transform:translate(-50%,-50%)",
        "width:min(360px,92vw)",
        "height:min(440px,80vh)",
        "border:0",
        "border-radius:16px",
        "box-shadow:0 10px 40px rgba(0,0,0,.25)",
        "background:transparent",
        "z-index:2147483000",
      ].join(";"),
    );
    document.body.appendChild(frame);

    return {
      window: null,
      close(): void {
        try {
          frame.remove();
        } catch {
          // Already gone, or the document was torn down under us.
        }
      },
    };
  } catch {
    return null;
  }
}

/**
 * Show the picker as a popup window — the cross-origin path.
 *
 * Returns `null` when the browser refuses (a popup blocker, or no `window`),
 * which the caller reports as `"popup-blocked"`: there is no inline fallback
 * from here, because inline is exactly what did not work for this origin.
 */
export function openPopupPicker(url: string): OpenPicker | null {
  try {
    if (typeof window === "undefined" || typeof window.open !== "function") {
      return null;
    }
    const popup = window.open(url, "hallpass-challenge", "popup=yes,width=400,height=520");
    if (!popup) return null;
    return {
      window: popup,
      close(): void {
        try {
          popup.close();
        } catch {
          // COOP can make this throw; the popup closes itself on the signal.
        }
      },
    };
  } catch {
    return null;
  }
}

/**
 * Listen for the picker's verdict on all three channels; returns an unsubscribe.
 *
 * `onSignal` fires AT MOST ONCE — whichever transport lands first wins and the
 * rest are torn down, so a browser that delivers two of them cannot resolve the
 * caller's promise twice.
 *
 * The `postMessage` branch checks `event.origin` against the API origin, because
 * that listener is attached to the GAME's window and any frame on the page can
 * post to it.
 */
export function subscribeChallengeSignals(
  api: string,
  onSignal: (signal: ChallengeSignal) => void,
): () => void {
  let done = false;
  let channel: BroadcastChannel | null = null;
  let deadline: ReturnType<typeof setTimeout> | undefined;

  let apiOrigin = "";
  try {
    apiOrigin = new URL(api, typeof window === "undefined" ? undefined : window.location.href).origin;
  } catch {
    apiOrigin = "";
  }

  function fire(signal: ChallengeSignal): void {
    if (done) return;
    done = true;
    stop();
    try {
      onSignal(signal);
    } catch {
      // A throwing caller must not take the teardown with it.
    }
  }

  /** Accept only objects that actually look like our payload. */
  function read(value: unknown): ChallengeSignal | null {
    if (!value || typeof value !== "object") return null;
    const data = value as Record<string, unknown>;
    if (data.type !== CHALLENGE_SIGNAL_KEY) return null;
    return {
      sent: data.sent === true,
      reason: typeof data.reason === "string" ? data.reason : undefined,
      challenge:
        data.challenge && typeof data.challenge === "object"
          ? (data.challenge as ChallengeSignal["challenge"])
          : undefined,
    };
  }

  function onMessage(event: MessageEvent): void {
    // Any frame on the page can postMessage to us; only the picker's origin counts.
    if (apiOrigin && event.origin !== apiOrigin) return;
    const signal = read(event.data);
    if (signal) fire(signal);
  }

  function onStorage(event: StorageEvent): void {
    if (event.key !== CHALLENGE_SIGNAL_KEY || !event.newValue) return;
    try {
      const signal = read(JSON.parse(event.newValue));
      if (signal) fire(signal);
    } catch {
      // Not our JSON.
    }
  }

  function stop(): void {
    try {
      window.removeEventListener("message", onMessage);
    } catch {
      /* nothing to remove */
    }
    try {
      window.removeEventListener("storage", onStorage);
    } catch {
      /* nothing to remove */
    }
    try {
      channel?.close();
    } catch {
      /* already closed */
    }
    channel = null;
    if (deadline !== undefined) clearTimeout(deadline);
  }

  try {
    if (typeof window === "undefined") return () => {};
    window.addEventListener("message", onMessage);
    window.addEventListener("storage", onStorage);
    try {
      channel = new BroadcastChannel(CHALLENGE_SIGNAL_KEY);
      channel.onmessage = (event: MessageEvent) => {
        const signal = read(event.data);
        if (signal) fire(signal);
      };
    } catch {
      // No BroadcastChannel here; the other two still cover it.
    }
    // Never listen forever: a player who navigates away from the game must not
    // leave handlers and a channel behind on the page.
    deadline = setTimeout(stop, WATCH_MAX_MS);
  } catch {
    return () => {};
  }

  return stop;
}
