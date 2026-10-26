"use client";

/**
 * Opening a pack in the Pack Room (docs/collectibles-pack-room.md): the room
 * dims, the pack lifts off the riser and comes forward, and the opening plays
 * over the room in a full-screen modal layer. Closing it puts you back at the
 * counter where you were.
 *
 * The layer is only the frame. The opening itself is `OpeningFlow`, unchanged
 * in what it promises: the result comes from the server, once, and a refresh
 * resumes where this device left off. It is loaded on demand (and fetched early
 * when a pack is pointed at), so the room costs nothing until someone opens.
 *
 * The flight: a flat copy of the pack's print stands where the pack stood and
 * moves to the stage's pack slot. The real pack (WebGL, or its DOM fallback)
 * appears in its place once it has landed AND the pack has drawn its first
 * frame, so there is never an empty stage or two packs at once.
 *
 * Modal: portalled to <body>, everything else on the page made inert, scroll
 * held by the site's shared overlay lock, focus moved in and given back.
 */

import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getPack, packPrintSrc } from "@/app/lib/collectibles/catalogue";
import { acquireOverlayLock } from "@/app/lib/overlay-lock";
import type { SealedPack } from "../opening/machine";
import type { InRoom } from "../opening/OpeningFlow";

/** The opening's code, fetched once. Call it early (pointing at a pack) so Open is instant. */
export const preloadOpening = () => import("../opening/OpeningFlow");
const OpeningFlow = lazy(() => preloadOpening().then((m) => ({ default: m.OpeningFlow })));

const FLIGHT_MS = 560;
/** If the pack has not drawn by then, stop waiting for it and show the stage anyway. */
const GIVE_UP_MS = 4000;

export interface Flight {
  publicId: string;
  packId: string;
  /** Where the pack stood in the room, in viewport px. */
  from: DOMRect;
}

export function OpeningLayer({
  id,
  sealed,
  flight,
  onClose,
  onNext,
}: {
  id: string;
  sealed: SealedPack[];
  flight: Flight | null;
  onClose(): void;
  onNext(publicId: string): void;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const proxy = useRef<HTMLImageElement>(null);
  const reduced = useRef(false);
  const [leaving, setLeaving] = useState(false);
  // A stand-in flies only when there is somewhere to fly from, and motion is welcome.
  const [arriving, setArriving] = useState(() => !!flight && typeof window !== "undefined" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const landed = useRef(false);
  const drawn = useRef(false);

  const settle = useCallback(() => {
    if (landed.current && drawn.current) setArriving(false);
  }, []);

  // Take the screen: everything else on the page inert, the page held still.
  useLayoutEffect(() => {
    const self = layer.current;
    const made: Element[] = [];
    for (const el of document.body.children) {
      if (el === self || (el as HTMLElement).inert) continue;
      (el as HTMLElement).inert = true;
      made.push(el);
    }
    const release = acquireOverlayLock();
    const back = document.activeElement as HTMLElement | null;
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    return () => {
      for (const el of made) (el as HTMLElement).inert = false;
      release();
      // Back to where the player was, if it is still there.
      if (back?.isConnected) back.focus({ preventScroll: true });
    };
  }, []);

  // The flight: from the riser to the stage's pack slot, once the slot exists.
  useEffect(() => {
    if (!arriving || !flight) return;
    let frame = 0;
    let anim: Animation | null = null;
    const started = performance.now();
    const giveUp = window.setTimeout(() => {
      landed.current = drawn.current = true;
      settle();
    }, GIVE_UP_MS);
    const find = () => {
      const slot = layer.current?.querySelector<HTMLElement>(".ho-pack-slot");
      const to = slot?.getBoundingClientRect();
      const el = proxy.current;
      if (!to || !to.width || !el) {
        if (performance.now() - started < GIVE_UP_MS) frame = requestAnimationFrame(find);
        return;
      }
      const f = flight.from;
      const dx = to.left + to.width / 2 - (f.left + f.width / 2);
      const dy = to.top + to.height / 2 - (f.top + f.height / 2);
      const k = to.width / f.width;
      anim = el.animate(
        [
          { transform: "translate(0, 0) scale(1)", offset: 0 },
          { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 24}px) scale(${1 + (k - 1) * 0.55}) rotate(-2deg)`, offset: 0.55 },
          { transform: `translate(${dx}px, ${dy}px) scale(${k})`, offset: 1 },
        ],
        { duration: FLIGHT_MS, easing: "cubic-bezier(0.3, 0.7, 0.2, 1)", fill: "forwards" },
      );
      anim.onfinish = () => {
        landed.current = true;
        settle();
      };
    };
    frame = requestAnimationFrame(find);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(giveUp);
      anim?.cancel();
    };
  }, [arriving, flight, settle]);

  // Focus goes into the layer once the pack has landed: onto the pack (Enter or Space tears it), or the title.
  useEffect(() => {
    if (arriving) return;
    let frame = 0;
    const t0 = performance.now();
    const go = () => {
      const root = layer.current;
      const el = root?.querySelector<HTMLElement>('.ho-pack-hit[tabindex="0"]') ?? root?.querySelector<HTMLElement>(".ho-stage .ho-title");
      if (el) return el.focus({ preventScroll: true });
      if (performance.now() - t0 < GIVE_UP_MS) frame = requestAnimationFrame(go);
      else layer.current?.focus({ preventScroll: true });
    };
    frame = requestAnimationFrame(go);
    return () => cancelAnimationFrame(frame);
  }, [id, arriving]);

  const close = useCallback(() => {
    if (reduced.current) return onClose();
    setLeaving(true);
  }, [onClose]);

  const room = useMemo<InRoom>(
    () => ({
      close,
      next: onNext,
      sealed,
      onPackReady: () => {
        drawn.current = true;
        settle();
      },
    }),
    [close, onNext, sealed, settle],
  );

  if (typeof document === "undefined") return null;
  const name = getPack(flight?.packId ?? sealed.find((p) => p.publicId === id)?.packId ?? "")?.name;
  const f = flight?.from;

  return createPortal(
    <div
      ref={layer}
      className="pr-layer hc-root"
      role="dialog"
      aria-modal="true"
      aria-label={name ? `Opening ${name}` : "Opening a pack"}
      tabIndex={-1}
      data-arriving={arriving || undefined}
      data-leaving={leaving || undefined}
      onAnimationEnd={(e) => {
        if (leaving && e.target === e.currentTarget) onClose();
      }}
    >
      <div className="pr-layer-dim" aria-hidden="true" />
      {arriving && f && flight && (
        // eslint-disable-next-line @next/next/no-img-element -- the pack's own pixel art, at the size it stood on the counter
        <img
          ref={proxy}
          className="pr-proxy"
          src={packPrintSrc(flight.packId)}
          alt=""
          aria-hidden="true"
          style={{ left: f.left, top: f.top, width: f.width, height: f.height }}
        />
      )}
      <div className="pr-layer-flow">
        <Suspense fallback={null}>
          <OpeningFlow key={id} id={id} room={room} />
        </Suspense>
      </div>
    </div>,
    document.body,
  );
}
