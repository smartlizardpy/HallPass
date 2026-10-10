/**
 * Browser helper for the invite picker, upholding the SDK's golden rule: every
 * function is fully guarded and NEVER throws, and nothing runs at import time.
 *
 * The picker reuses the challenge picker's transport decision and openers
 * (`challenge.ts`: an inline frame on HallPass's own origin, a popup elsewhere)
 * and its three signal channels. What differs is the conversation:
 *
 *  - A challenge picker says ONE thing — what was sent — and closes. The invite
 *    picker is a place the player can stay: invite two friends, then copy a link
 *    for a third, then close. So it signals MORE THAN ONCE: `open` when it has
 *    loaded, `update` after every invite or link, `closed` when the player is
 *    done. Each carries the running totals, so a popup the player closes by hand
 *    — which sends nothing at the end — has already reported what happened.
 *  - Every signal carries the NONCE this call put in the picker URL, and anything
 *    without it is ignored. Two games in two tabs (or one game calling twice)
 *    share the `BroadcastChannel` and the `storage` key; without the nonce one
 *    picker could settle the other's promise.
 *
 * MIRRORED BY HAND in `app/embed/invite/InviteEmbed.tsx` (the SDK must not import
 * app code, and `contract.ts` carries no runtime values): the signal key, the
 * `phase` vocabulary and the payload fields.
 */

import { MAX_LAUNCH_DATA_BYTES } from "./launch";
import type { PickerChrome } from "./challenge";

/** The BroadcastChannel name, the `localStorage` key, and the `postMessage` `type`. */
export const INVITE_SIGNAL_KEY = "hallpass:invite";

/** Path of the picker page. */
export const INVITE_PATH = "/embed/invite";

/** How the invite picker is labelled and sized. Taller than the challenge card: it lists friends AND offers a link. */
export const INVITE_CHROME: PickerChrome = {
  title: "Invite friends",
  frameHeight: "min(520px,86vh)",
  windowName: "hallpass-invite",
  windowFeatures: "popup=yes,width=400,height=600",
};

/** How long to keep listening before giving up. Matches the challenge picker. */
const WATCH_MAX_MS = 5 * 60 * 1000;

/** What the picker says, one message at a time. Mirrors `InviteEmbed.tsx`. */
export interface InviteSignal {
  phase: "open" | "update" | "closed";
  /** Friends invited so far in this picker (running total). */
  sent: number;
  /** The latest share link made in this picker, absolute, else `null`. */
  link: string | null;
}

/**
 * Serialise a game's invite data, or `null` when it is not a plain JSON object
 * of at most 1 KB. Checked here so a bad payload never opens a picker that the
 * server would refuse anyway; the server re-checks (it is the authority).
 */
export function serializeInviteData(data: unknown): string | null {
  try {
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    const proto = Object.getPrototypeOf(data);
    if (proto !== Object.prototype && proto !== null) return null;
    const json = JSON.stringify(data);
    if (typeof json !== "string") return null;
    const bytes =
      typeof TextEncoder === "function" ? new TextEncoder().encode(json).length : json.length * 3;
    return bytes <= MAX_LAUNCH_DATA_BYTES ? json : null;
  } catch {
    // A cycle or a BigInt.
    return null;
  }
}

/** A short random token for one `invite()` call. Not a secret — a correlation id. */
export function makeNonce(): string {
  try {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
  }
}

/** Build the picker URL. Pure and exported for testing. */
export function invitePickerUrl(
  api: string,
  opts: { game: string; data: string; nonce: string; expiresInMinutes?: number },
): string {
  const params = [
    `game=${encodeURIComponent(opts.game)}`,
    `data=${encodeURIComponent(opts.data)}`,
    `n=${encodeURIComponent(opts.nonce)}`,
  ];
  if (typeof opts.expiresInMinutes === "number" && Number.isFinite(opts.expiresInMinutes)) {
    params.push(`ttl=${encodeURIComponent(String(Math.round(opts.expiresInMinutes)))}`);
  }
  return `${api}${INVITE_PATH}?${params.join("&")}`;
}

/**
 * Listen for this call's picker on all three channels. Unlike the challenge
 * subscriber this fires for EVERY valid signal (deduplicated across channels
 * by the caller keeping running totals), and only for signals carrying `nonce`.
 * Returns an unsubscribe; stops by itself after {@link WATCH_MAX_MS}.
 */
export function subscribeInviteSignals(
  api: string,
  nonce: string,
  onSignal: (signal: InviteSignal) => void,
): () => void {
  let stopped = false;
  let channel: BroadcastChannel | null = null;
  let deadline: ReturnType<typeof setTimeout> | undefined;

  let apiOrigin = "";
  try {
    apiOrigin = new URL(api, typeof window === "undefined" ? undefined : window.location.href).origin;
  } catch {
    apiOrigin = "";
  }

  function read(value: unknown): InviteSignal | null {
    if (!value || typeof value !== "object") return null;
    const data = value as Record<string, unknown>;
    if (data.type !== INVITE_SIGNAL_KEY || data.n !== nonce) return null;
    const phase = data.phase === "open" || data.phase === "update" || data.phase === "closed" ? data.phase : null;
    if (!phase) return null;
    const sent = typeof data.sent === "number" && Number.isFinite(data.sent) && data.sent > 0 ? Math.floor(data.sent) : 0;
    const link = typeof data.link === "string" && /^https?:\/\//.test(data.link) ? data.link : null;
    return { phase, sent, link };
  }

  function deliver(value: unknown): void {
    if (stopped) return;
    const signal = read(value);
    if (!signal) return;
    try {
      onSignal(signal);
    } catch {
      // A throwing caller must not break the listener.
    }
  }

  function onMessage(event: MessageEvent): void {
    // Any frame on the page can postMessage to us; only the picker's origin counts.
    if (apiOrigin && event.origin !== apiOrigin) return;
    deliver(event.data);
  }

  function onStorage(event: StorageEvent): void {
    if (event.key !== INVITE_SIGNAL_KEY || !event.newValue) return;
    try {
      deliver(JSON.parse(event.newValue));
    } catch {
      // Not our JSON.
    }
  }

  function stop(): void {
    stopped = true;
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
      channel = new BroadcastChannel(INVITE_SIGNAL_KEY);
      channel.onmessage = (event: MessageEvent) => deliver(event.data);
    } catch {
      // No BroadcastChannel here; the other two still cover it.
    }
    deadline = setTimeout(stop, WATCH_MAX_MS);
  } catch {
    return () => {};
  }

  return stop;
}
