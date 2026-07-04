"use client";

/**
 * Client half of the post-auth completion page.
 *
 * The Scoreboard SDK opens player sign-in in a popup and waits for a signal.
 * Once the session cookie is set the popup lands here, and on mount we fan out
 * the SAME "hallpass:auth" signal across every channel the opener might be
 * listening on, then try to close ourselves.
 *
 * Every step is independently best-effort: one blocked API (private-mode
 * localStorage, a cross-origin or vanished opener, a browser that refuses
 * `window.close`) must never stop the others, so each lives in its own
 * try/catch and nothing here ever throws.
 */

import { useEffect } from "react";

export default function AuthCompleteClient() {
  useEffect(() => {
    // a) Wake same-browser listeners (other tabs of the app) via a channel.
    try {
      if (typeof BroadcastChannel !== "undefined") {
        new BroadcastChannel("hallpass:auth").postMessage({
          type: "hallpass:auth",
        });
      }
    } catch {
      // Best-effort: BroadcastChannel may be unavailable or blocked.
    }

    // b) A storage event reaches listeners that can't use BroadcastChannel.
    try {
      localStorage.setItem("hallpass:auth", String(Date.now()));
    } catch {
      // Best-effort: storage can throw (private mode, quota, disabled).
    }

    // c) Tell the popup opener directly, pinned to our own origin.
    try {
      if (window.opener) {
        window.opener.postMessage(
          { type: "hallpass:auth" },
          window.location.origin,
        );
      }
    } catch {
      // Best-effort: the opener may be gone or cross-origin.
    }

    // d) Close the popup now the signal is out.
    try {
      window.close();
    } catch {
      // Best-effort: a full tab (not a popup) can refuse to close.
    }
  }, []);

  return (
    <p className="mt-3 text-sm text-muted">
      You&apos;re all set — you can close this window and return to your game.
    </p>
  );
}
