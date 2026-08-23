"use client";

import { useEffect, useRef, useState } from "react";

import { floatingBottom } from "../lib/bottom-chrome";

let reloaded = false;

export function PWA() {
  const [offline, setOffline] = useState(false);
  const lastPolledAt = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    // WHY AN EXPLICIT `update()` AND NOT JUST `register()` ABOVE.
    //
    // `register()` checks for a new service worker when it runs — and in a
    // browser tab it runs often, because every fresh navigation loads this
    // component again. An INSTALLED app does not work like that: it is resumed
    // far more often than it is launched, so the same document can stay alive
    // for days and that check never happens again. The effect is a phone that
    // keeps serving from a service worker several deploys old — including one
    // that predates `/offline/you` and therefore cannot show the offline card at
    // all, while the same site in the browser can. That is not a hypothetical;
    // it is what "it works in Safari but not in the app" looks like from here.
    //
    // Resuming to the foreground with a connection is exactly the moment to ask.
    // Sharing `poll`'s 30s throttle keeps a fast app-switch from asking twice,
    // and the browser applies its own rate limit on top. Nothing is awaited: a
    // newer worker follows the ordinary `updatefound` → SKIP_WAITING →
    // `controllerchange` path already wired above.
    const checkForNewWorker = async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        await reg?.update();
      } catch {
        // Offline, or the browser declined. The next resume asks again.
      }
    };

    const poll = async () => {
      const now = Date.now();
      if (now - lastPolledAt.current < 30_000) return;
      lastPolledAt.current = now;
      // Same trigger, same throttle: whenever we are awake, online and asking
      // whether the GAMES have changed, also ask whether the service worker has.
      // See the note on `checkForNewWorker`.
      void checkForNewWorker();
      try {
        const res = await fetch("/games-version", { cache: "no-store" });
        if (!res.ok) return;
        const { version } = (await res.json()) as { version?: string };
        if (!version) return;
        const reg = await navigator.serviceWorker.ready;
        reg.active?.postMessage({ type: "CHECK_GAMES_VERSION", version });
      } catch {
        // ignore
      }
    };

    (async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
        });
        registration.addEventListener("updatefound", () => {
          const newSW = registration.installing;
          if (!newSW) return;
          newSW.addEventListener("statechange", () => {
            if (
              newSW.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              newSW.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });
        await navigator.serviceWorker.ready;
        poll();
      } catch {
        // ignore
      }
    })();

    const onControllerChange = () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      onControllerChange,
    );

    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);

    const onVisible = () => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        poll();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      document.removeEventListener("visibilitychange", onVisible);
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange,
      );
    };
  }, []);

  if (!offline) return null;
  return (
    // The pill floats above whatever chrome owns the bottom edge, which on a phone
    // is the four-tab `MobileTabBar`. Offsetting by the raw safe-area inset (what
    // this did before) put it ON the bar at `z-50` over the bar's `z-40`, hiding
    // the middle two tabs for as long as the device stayed offline — and a phone
    // that just lost signal is exactly when someone reaches for those tabs.
    // `floatingBottom` clears the published height instead, and falls back to the
    // bare inset on desktop and on the routes with no bar.
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed left-1/2 z-50 -translate-x-1/2 rounded-full border border-white/10 bg-black/80 px-3 py-1 text-xs font-semibold text-white shadow-lg backdrop-blur"
      style={{ bottom: floatingBottom("0.75rem") }}
    >
      Offline · cached games still playable
    </div>
  );
}
