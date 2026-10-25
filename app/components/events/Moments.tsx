"use client";

/**
 * HallPass — the ambient moments runtime for the haunted skin, mounted once in
 * the root layout. Renders nothing except, briefly, the "boo" search reply.
 *
 * It only ever flips `data-playing` on decorations that already exist (they are
 * rendered, hidden and inert, by the region components); the CSS next to each
 * one does the movement with `steps()` timing. So:
 *
 *  - NOTHING RUNS unless the skin is painted, the player has not asked for less
 *    motion (OS setting or the event's Still mode), the tab is visible, and the
 *    page is not a game page (the player is about to play).
 *  - NOTHING MOVES in the first six seconds, and each moment is over in about
 *    three. Two per page view, taken in turn (`lib/events/moments.ts`), each
 *    capped per device per UTC day. Nothing loops, nothing makes a sound.
 *  - A moment only plays if its decoration is actually on screen, so there is no
 *    off-screen work.
 *  - Decorations are `aria-hidden` and never take pointer or focus except the
 *    side ghost while it is out; this file adds no listeners to them.
 *
 * "boo": typing exactly `boo` in the header search shows a short reply under it.
 * It listens to `input` only and never cancels anything, so search runs exactly
 * as before. It also works under Still mode (it is not motion).
 *
 * Knows nothing about the championship.
 */

import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { FRIGHT_FEST_THEME as T } from "../../lib/events/fright-fest";
import { SKIN_ATTR } from "../../lib/events/config";
import { chooseMoments, parseLedger, recordPlay } from "../../lib/events/moments";

const LEDGER_KEY = "hp:event-moments:fright-fest-2026";
const FIRST_AT = 6500;
const EXTRA_AT = 11000;
const PLAY_MS = 3200;

function readLedger() {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(LEDGER_KEY);
  } catch {}
  return parseLedger(raw, Date.now());
}

function writeLedger(l: ReturnType<typeof parseLedger>) {
  try {
    localStorage.setItem(LEDGER_KEY, JSON.stringify(l));
  } catch {}
}

/** The first decoration with this name that is laid out and fully inside the viewport. */
function onScreen(name: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-ha-moment="${name}"]`)) {
    if (!el.getClientRects().length) continue;
    const r = el.getBoundingClientRect();
    if (r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth) return el;
  }
  return null;
}

export function Moments() {
  const pathname = usePathname();
  const ready = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [boo, setBoo] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (!ready) return;
    const html = document.documentElement;
    if (!html.hasAttribute(SKIN_ATTR) || html.hasAttribute("data-hp-still")) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (pathname.startsWith("/game/")) return;

    const timers: number[] = [];
    let ledger = readLedger();
    const turn = ledger.n;
    ledger = { ...ledger, n: turn + 1 };
    writeLedger(ledger);

    const play = (name: string | null) => {
      if (!name || document.hidden) return;
      const el = onScreen(name);
      if (!el) return;
      el.setAttribute("data-playing", "");
      timers.push(window.setTimeout(() => el.removeAttribute("data-playing"), PLAY_MS));
      ledger = recordPlay(ledger, name);
      writeLedger(ledger);
    };

    const present = () => {
      const s = new Set<string>();
      for (const el of document.querySelectorAll<HTMLElement>("[data-ha-moment]")) {
        if (el.getClientRects().length) s.add(el.dataset.haMoment!);
      }
      return s;
    };

    // Decide at fire time, not at load: the page may have scrolled or streamed in.
    timers.push(
      window.setTimeout(() => play(chooseMoments(present(), ledger, turn).primary), FIRST_AT),
      window.setTimeout(() => play(chooseMoments(present(), ledger, turn).extra), EXTRA_AT),
    );
    return () => {
      timers.forEach(clearTimeout);
      document.querySelectorAll("[data-ha-moment][data-playing]").forEach((el) => el.removeAttribute("data-playing"));
    };
  }, [ready, pathname]);

  useEffect(() => {
    if (!ready) return;
    const onInput = (e: Event) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement) || !t.matches('input[type="search"][name="q"]')) return;
      if (
        t.value.trim().toLowerCase() === "boo" &&
        document.documentElement.hasAttribute(SKIN_ATTR) &&
        document.documentElement.getAttribute("data-hp-event") === T.event
      ) {
        const r = t.getBoundingClientRect();
        setBoo({ left: r.left, top: r.bottom + 6 });
      } else setBoo(null);
    };
    document.addEventListener("input", onInput);
    return () => document.removeEventListener("input", onInput);
  }, [ready]);

  if (!boo) return null;
  return createPortal(
    <div role="status" className="ha-boo" style={{ left: boo.left, top: boo.top }}>
      <span aria-hidden="true" className="ha-boo-ghost ha-spr" />
      <span>Something answered. Room 000 is open.</span>
    </div>,
    document.body,
  );
}
