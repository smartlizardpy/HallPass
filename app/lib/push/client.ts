"use client";

/**
 * HallPass — turning push notifications on, from the browser.
 *
 * Split out of the promo that calls it so the sequencing — which is fiddly and
 * easy to get subtly wrong — lives in one place with its reasoning attached.
 *
 * ── THE ORDER MATTERS AND IS NOT OBVIOUS ───────────────────────────────────
 * Ask for the key BEFORE asking for permission. `Notification.requestPermission()`
 * must be called from a user gesture, and a denial is close to permanent — so
 * burning the one prompt a player will ever see, only to then discover the server
 * has no VAPID key configured and cannot subscribe them, would cost them the
 * feature outright. Checking first means a misconfigured deploy declines to ask
 * rather than asking and failing.
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
 * Ask for permission and register this device. Resolves whether it worked.
 *
 * MUST be called from a user gesture — the permission prompt is refused
 * otherwise, and on some browsers that counts as a denial.
 */
export async function enablePush(): Promise<boolean> {
  try {
    if (!canUsePush()) return false;

    // 1. Is push even configured server-side? Ask before spending the prompt.
    const configRes = await fetch("/api/v1/me/push", { credentials: "include" });
    if (!configRes.ok) return false;
    const config = (await configRes.json()) as {
      configured?: boolean;
      publicKey?: string | null;
    };
    if (!config.configured || !config.publicKey) return false;

    // 2. Now spend it.
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
        applicationServerKey: decodeKey(config.publicKey),
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
