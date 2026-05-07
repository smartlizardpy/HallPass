"use client";

import { useEffect, useRef, useState } from "react";

let reloaded = false;

export function PWA() {
  const [offline, setOffline] = useState(false);
  const lastPolledAt = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const poll = async () => {
      const now = Date.now();
      if (now - lastPolledAt.current < 30_000) return;
      lastPolledAt.current = now;
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
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed left-1/2 z-50 -translate-x-1/2 rounded-full border border-white/10 bg-black/80 px-3 py-1 text-xs font-semibold text-white shadow-lg backdrop-blur"
      style={{ bottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
    >
      Offline · cached games still playable
    </div>
  );
}
