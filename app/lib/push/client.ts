"use client";

/**
 * HallPass — turning push notifications on, from the browser.
 *
 * Split out of the promo that calls it so the sequencing — which is fiddly and
 * easy to get subtly wrong — lives in one place with its reasoning attached.
 *
 * ── THE KEY IS FETCHED BEFORE THE CLICK, NOT DURING IT ─────────────────────
 * Two requirements pull against each other, and both are real:
 *
 *   1. Do not spend the permission prompt before knowing the server can
 *      actually subscribe anybody. A denial is close to permanent, so asking and
 *      then failing on a missing VAPID key costs the player the feature outright.
 *   2. `Notification.requestPermission()` needs TRANSIENT USER ACTIVATION. An
 *      `await fetch()` ahead of it inside the click handler can outlive that
 *      activation — Safari is strict about this — and the prompt is then refused,
 *      which some browsers record as a denial.
 *
 * Satisfying one by breaking the other is not necessary: {@link fetchPushConfig}
 * runs while the promo is DECIDING whether to appear, and {@link enablePush}
 * takes the key it found. So the click does no awaiting before it asks, and the
 * ask only happens on a deploy that can honour it.
 *
 * ── NOTHING HERE THROWS ────────────────────────────────────────────────────
 * Every step is guarded and the whole thing resolves a boolean. A browser
 * without push, a service worker that never registered, a rejected permission
 * and a failed round trip are all just `false`.
 */

/** Whether this browser can do Web Push at all. */
export function canUsePush(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window
    );
  } catch {
    return false;
  }
}

/**
 * The current permission, or `null` where the API does not exist.
 *
 * `"default"` is the only state worth prompting in: `"granted"` is already done
 * and `"denied"` cannot be re-asked from script — the player has to change it in
 * browser settings, and pretending otherwise with a button that does nothing is
 * worse than not offering one.
 */
export function notificationPermission(): NotificationPermission | null {
  try {
    return canUsePush() ? Notification.permission : null;
  } catch {
    return null;
  }
}

/**
 * Decode the URL-safe base64 VAPID key into the `Uint8Array`
 * `pushManager.subscribe` requires. There is no built-in for this.
 */
function decodeKey(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  // Built over an explicit ArrayBuffer rather than `new Uint8Array(length)`:
  // the latter is typed `Uint8Array<ArrayBufferLike>`, which could be backed by
  // a SharedArrayBuffer and so is not assignable to `applicationServerKey`.
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * The VAPID public key, or `null` when push is not configured server-side.
 *
 * Called AHEAD of the click — see the header. Never throws.
 */
export async function fetchPushConfig(): Promise<string | null> {
  try {
    const res = await fetch("/api/v1/me/push", { credentials: "include" });
    if (!res.ok) return null;
    const config = (await res.json()) as {
      configured?: boolean;
      publicKey?: string | null;
    };
    return config.configured && config.publicKey ? config.publicKey : null;
  } catch {
    return null;
  }
}

/**
 * Ask for permission and register this device. Resolves whether it worked.
 *
 * MUST be called from a user gesture, and `publicKey` MUST already be in hand —
 * awaiting anything before `requestPermission()` risks losing the activation
 * that makes the prompt legal. Get it from {@link fetchPushConfig} beforehand.
 */
export async function enablePush(publicKey: string): Promise<boolean> {
  try {
    if (!canUsePush() || !publicKey) return false;

    // First statement in the handler: no await stands between the click and the
    // prompt.
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return false;

    // 3. `ready` rather than `getRegistration`: the SW may still be activating
    // on a first visit, and subscribing against a registration that is not yet
    // active fails.
    const registration = await navigator.serviceWorker.ready;

    // Reuse an existing subscription when there is one — re-subscribing would
    // mint a new endpoint and orphan the old row until it 410s.
    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        // Required: a subscription that could be used for silent pushes is
        // rejected by Chrome outright.
        userVisibleOnly: true,
        applicationServerKey: decodeKey(publicKey),
      }));

    const res = await fetch("/api/v1/me/push", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription.toJSON()),
    });
    return res.ok;
  } catch {
    // No service worker (it does not register under `next dev`), a blocked
    // prompt, an offline round trip — all simply "not enabled".
    return false;
  }
}

const SYNC_KEY = "hp:push-synced-at";
/** How often an app that is already enabled re-registers with the server. */
export const PUSH_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Is a re-sync due? A missing or unreadable timestamp means yes. */
export function pushSyncDue(lastSyncedAt: number | null, now: number): boolean {
  if (lastSyncedAt === null || !Number.isFinite(lastSyncedAt)) return true;
  return now - lastSyncedAt >= PUSH_SYNC_INTERVAL_MS;
}

/**
 * Re-register this device's push subscription with the server, if the player
 * already switched notifications on.
 *
 * WHY THIS EXISTS. `enablePush` runs once, from a tap, and never again — so the
 * server's copy of a phone's subscription is exactly as old as that tap. iOS
 * quietly drops or rotates a Home Screen app's subscription (an update, a
 * reinstall, a permission reset), and when it does, the row we hold keeps being
 * sent to for ever while nothing arrives. The Mac, whose subscription never
 * moved, kept working — which is how this looks from outside.
 *
 * It never PROMPTS: it only acts when permission is already `granted`, and
 * `subscribe()` is allowed without a gesture in that state. It reuses a live
 * subscription, mints one only if the browser has none, and POSTs either way —
 * the server's upsert refreshes `last_seen_at`, so a healthy device costs one
 * cheap write a day. Rate-limited by `pushSyncDue`; every failure is silent,
 * and the next foreground tries again.
 */
export async function syncPushSubscription(): Promise<void> {
  try {
    if (!canUsePush() || Notification.permission !== "granted") return;

    let last: number | null = null;
    try {
      const raw = localStorage.getItem(SYNC_KEY);
      last = raw === null ? null : Number(raw);
    } catch {
      /* storage blocked: treat as due */
    }
    if (!pushSyncDue(last, Date.now())) return;

    const publicKey = await fetchPushConfig();
    if (!publicKey) return;

    const registration = await navigator.serviceWorker.ready;
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeKey(publicKey),
      }));

    const res = await fetch("/api/v1/me/push", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription.toJSON()),
    });
    // Only a server that accepted it counts. A signed-out player gets a 401 and
    // is tried again once they are signed in, rather than waiting out the day.
    if (res.ok) {
      try {
        localStorage.setItem(SYNC_KEY, String(Date.now()));
      } catch {
        /* nothing further */
      }
    }
  } catch {
    /* best-effort: the next foreground asks again */
  }
}
