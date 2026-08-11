"use client";

/**
 * HallPass — turning push on for THIS DEVICE.
 *
 * The control that did not exist before, and the reason the whole feature was
 * invisible: push could only ever be enabled by a promo modal that appeared
 * after somebody had already been challenged. If you dismissed it, or were never
 * challenged, there was no way to switch notifications on at all.
 *
 * ── IT IS PER DEVICE, AND SAYS SO ──────────────────────────────────────────
 * A Web Push subscription belongs to a browser profile, not to an account
 * (`023_push_subscriptions.sql`: one row per DEVICE, deliberately). Somebody who
 * turns this on at home and then opens the site on a school Chromebook has not
 * turned it on there, and a card that implied otherwise would leave them
 * expecting notifications that cannot arrive. So the copy names the device, and
 * the per-kind switches below it — which ARE account-wide — say that too.
 *
 * ── EVERY STATE IS SHOWN HONESTLY, INCLUDING THE ONE WE CANNOT FIX ─────────
 * `denied` is close to permanent: `Notification.requestPermission()` cannot
 * re-prompt after a refusal, and only the browser's own site settings can undo
 * it. A button there would do nothing when pressed, which is worse than no
 * button, so that state gets an explanation instead.
 *
 * `unavailable` covers a server with no VAPID keys — the feature ships dark by
 * design (`push/config.ts`) — and it, too, is stated rather than hidden behind a
 * button that would fail. The bell keeps working in every one of these states;
 * push is the only thing at stake.
 */

import { useCallback, useEffect, useState } from "react";
import {
  canUsePush,
  enablePush,
  fetchPushConfig,
  notificationPermission,
} from "../../lib/push/client";

/**
 * What this device can currently do.
 *
 * `checking` is the pre-mount value, so the card renders the same on the server
 * and the first client paint — none of the browser APIs below exist during a
 * prerender, and reading them in render would be a hydration mismatch.
 */
type DeviceState =
  | "checking"
  | "unsupported"
  | "unavailable"
  | "denied"
  | "ready"
  | "enabling"
  | "on"
  | "failed";

/**
 * The state, and the VAPID key that goes with it, as ONE value.
 *
 * They are decided together by the same probe and are meaningless apart — a
 * `ready` with no key is a button that cannot work — so pairing them makes that
 * combination unrepresentable rather than merely avoided.
 */
type Device = {
  state: DeviceState;
  /**
   * The VAPID key, fetched while the card is DECIDING rather than on the click.
   *
   * `requestPermission()` needs transient user activation and an `await` ahead of
   * it inside the handler can outlive that — Safari is strict, and some browsers
   * record the refusal as a denial the player can never undo. `push/client.ts`
   * sets this out in full; the card exists to satisfy it, not to rediscover it.
   */
  key: string | null;
};

/**
 * Ask the browser and the server what this device can do.
 *
 * ASYNC EVEN WHERE THE ANSWER IS SYNCHRONOUS — `canUsePush()` and
 * `notificationPermission()` both answer immediately. Returning them through a
 * promise means every `setState` in the effect below happens in a callback
 * rather than during the effect body, which is the cascading-render pattern the
 * lint rule in `eslint.config.mjs` rejects. It also keeps ONE place that decides
 * the state, instead of an early-return ladder in the effect and a promise chain
 * after it.
 */
async function probeDevice(): Promise<Device> {
  if (!canUsePush()) return { state: "unsupported", key: null };

  const permission = notificationPermission();
  if (permission === "denied") return { state: "denied", key: null };

  const key = await fetchPushConfig();
  if (!key) return { state: "unavailable", key: null };

  // `granted` means the browser has already agreed. It does NOT prove a
  // subscription row exists on our side — a cleared database, a pruned dead
  // endpoint, or a permission granted before this feature shipped all land here
  // — so the button stays available and re-subscribing is a cheap idempotent
  // upsert rather than a second permission prompt.
  return { state: permission === "granted" ? "on" : "ready", key };
}

export function PushDeviceCard() {
  const [device, setDevice] = useState<Device>({ state: "checking", key: null });

  useEffect(() => {
    let active = true;
    probeDevice()
      .then((next) => {
        if (active) setDevice(next);
      })
      .catch(() => {
        if (active) setDevice({ state: "unavailable", key: null });
      });
    return () => {
      active = false;
    };
  }, []);

  /**
   * The key is read from the CLOSURE, not from inside a `setDevice` updater.
   *
   * An updater must be pure: React is free to call it more than once for a
   * single update (it does exactly that in StrictMode), so a `enablePush` call
   * placed inside one would fire the browser's permission prompt twice. Reading
   * the key here and keying the callback on it keeps the side effect in the
   * handler where it belongs.
   */
  const key = device.key;
  const enable = useCallback(() => {
    if (!key) return;
    setDevice((current) => ({ ...current, state: "enabling" }));
    // No `await` before this call — the key is already in hand, which is the
    // whole point of fetching it during the probe.
    void enablePush(key)
      .then((ok) => setDevice((now) => ({ ...now, state: ok ? "on" : "failed" })))
      .catch(() => setDevice((now) => ({ ...now, state: "failed" })));
  }, [key]);

  const state = device.state;

  // Nothing at all while we do not yet know. A card that flashed "not supported"
  // for a frame before correcting itself reads as broken.
  if (state === "checking") return null;

  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <h3 className="text-sm font-black uppercase tracking-wide text-foreground">
        Push on this device
      </h3>

      {state === "on" && (
        <>
          <p className="mt-2 text-sm text-muted">
            This device is set up. Anything you&rsquo;ve set to{" "}
            <span className="font-bold text-foreground">Push</span> below will
            reach you here, even with HallPass closed.
          </p>
          <button
            type="button"
            onClick={enable}
            className="mt-4 rounded-full border border-border bg-white px-5 py-2 text-sm font-bold text-zinc-700 transition hover:bg-surface-2"
          >
            Re-register this device
          </button>
        </>
      )}

      {(state === "ready" || state === "enabling" || state === "failed") && (
        <>
          <p className="mt-2 text-sm text-muted">
            Get notifications on this device even when HallPass is closed.
            You&rsquo;ll be asked for permission once.
          </p>
          {state === "failed" && (
            <p className="mt-2 text-sm font-semibold text-red-900">
              That didn&rsquo;t work. Check notifications aren&rsquo;t blocked
              for this site in your browser settings, then try again.
            </p>
          )}
          <button
            type="button"
            onClick={enable}
            disabled={state === "enabling"}
            className="mt-4 rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white transition hover:bg-brand-600 disabled:opacity-60"
          >
            {state === "enabling" ? "Asking…" : "Turn on for this device"}
          </button>
        </>
      )}

      {state === "denied" && (
        <p className="mt-2 text-sm text-muted">
          Notifications are blocked for HallPass in this browser. We can&rsquo;t
          ask again from here — turn them back on in your browser&rsquo;s site
          settings, then reload this page. Your bell keeps working either way.
        </p>
      )}

      {state === "unsupported" && (
        <p className="mt-2 text-sm text-muted">
          This browser can&rsquo;t do push notifications. Everything below still
          lands in your bell.
        </p>
      )}

      {state === "unavailable" && (
        <p className="mt-2 text-sm text-muted">
          Push isn&rsquo;t switched on for HallPass yet. Everything below still
          lands in your bell.
        </p>
      )}

      {/* The one thing a per-DEVICE control has to say out loud, in every state:
          the switches underneath are not per-device. */}
      <p className="mt-3 border-t border-border pt-3 text-xs font-semibold text-muted">
        This setting is for this device only. What you choose below applies to
        your account everywhere.
      </p>
    </div>
  );
}
