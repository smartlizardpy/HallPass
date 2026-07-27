"use client";

import { useEffect, useRef, useState } from "react";
import { type GameMedia, mediaPublicPath } from "../lib/game-media-blob";

/**
 * The store-page screenshot gallery: one large frame plus a scroll-snap thumb
 * strip, with a lightbox.
 *
 * NO CAROUSEL LIBRARY. This repo has no motion or carousel dependency and adding
 * one for a five-image strip would be the largest thing in the bundle. Snapping
 * is native CSS (`snap-x snap-mandatory`), the crossfade is a CSS transition, and
 * swipe is ~15 lines of pointer events.
 *
 * THE LIGHTBOX IS A NATIVE `<dialog>`, not a `:target` CSS lightbox. `:target`
 * lightboxes rely on the URL fragment, which the App Router owns — a client-side
 * navigation leaves the fragment set and the dialog stuck open, and the back
 * button becomes a lightbox-history stepper. `<dialog>` gives focus trapping, Esc
 * handling and the top layer for free, all of which would otherwise be hand-rolled.
 *
 * Every image carries explicit `width`/`height` from `game_media` so the browser
 * reserves the right box before the bytes arrive — no layout shift.
 */
export function ScreenshotGallery({
  media,
  title,
}: {
  media: GameMedia[];
  title: string;
}) {
  const [index, setIndex] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pointerStart = useRef<number | null>(null);

  const count = media.length;
  const current = media[index] ?? media[0];

  const step = (delta: number) => {
    setIndex((i) => (i + delta + count) % count);
  };

  // Arrow/Home/End on the gallery itself. Scoped to the container rather than the
  // document so it cannot fight the page or the player overlay for arrow keys.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (count < 2) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      step(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      step(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      setIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setIndex(count - 1);
    }
  };

  // Arrow keys inside the open lightbox, where the dialog owns focus.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (!dialog.open || count < 2) return;
      if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);

  return (
    <div
      className="min-w-0"
      role="group"
      aria-roledescription="carousel"
      aria-label={`${title} screenshots`}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      {/* Main frame */}
      <div className="relative aspect-[16/10] w-full overflow-hidden rounded-2xl bg-zinc-900">
        {media.map((item, i) => (
          // All frames stay mounted and crossfade via opacity: swapping `src`
          // would flash the empty frame on every step, and it also means the
          // SSR'd HTML contains every screenshot for crawlers and no-JS readers.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={item.id}
            src={mediaPublicPath(item)}
            alt={item.alt || `${title} screenshot ${i + 1}`}
            width={item.width}
            height={item.height}
            loading={i === 0 ? "eager" : "lazy"}
            fetchPriority={i === 0 ? "high" : "auto"}
            decoding="async"
            aria-hidden={i !== index}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${
              i === index ? "opacity-100" : "opacity-0"
            }`}
          />
        ))}

        {/* Swipe. Threshold is ~40px so a vertical page scroll that drifts a few
            pixels horizontally does not change the slide. */}
        <div
          className="absolute inset-0"
          onPointerDown={(e) => {
            pointerStart.current = e.clientX;
          }}
          onPointerUp={(e) => {
            const start = pointerStart.current;
            pointerStart.current = null;
            if (start === null) return;
            const dx = e.clientX - start;
            if (Math.abs(dx) < 40) {
              dialogRef.current?.showModal();
              return;
            }
            if (count > 1) step(dx < 0 ? 1 : -1);
          }}
        />

        {count > 1 && (
          <>
            <GalleryArrow direction="prev" onClick={() => step(-1)} />
            <GalleryArrow direction="next" onClick={() => step(1)} />
            <p className="pointer-events-none absolute bottom-2 right-2 rounded-full bg-zinc-900/70 px-2.5 py-1 text-[11px] font-black text-white">
              {index + 1} / {count}
            </p>
          </>
        )}
      </div>

      {/* Thumb strip — native scroll-snap, no JS. */}
      {count > 1 && (
        <ul className="mt-2 flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1">
          {media.map((item, i) => (
            <li key={item.id} className="snap-start">
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Show screenshot ${i + 1}`}
                aria-current={i === index}
                className={`relative block aspect-[16/10] w-24 shrink-0 overflow-hidden rounded-lg bg-zinc-900 transition ${
                  i === index
                    ? "ring-2 ring-brand ring-offset-2"
                    : "opacity-70 hover:opacity-100"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={mediaPublicPath(item)}
                  alt=""
                  width={item.width}
                  height={item.height}
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 h-full w-full object-cover"
                />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Lightbox. `onClick` on the dialog itself closes on backdrop click —
          clicks on the backdrop target the dialog element, clicks on the image do
          not (it stops propagation). */}
      <dialog
        ref={dialogRef}
        onClick={(e) => {
          if (e.target === dialogRef.current) dialogRef.current?.close();
        }}
        className="max-h-[90dvh] max-w-[95vw] rounded-2xl bg-transparent p-0 backdrop:bg-zinc-900/80 backdrop:backdrop-blur-sm"
      >
        {current && (
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={mediaPublicPath(current)}
              alt={current.alt || `${title} screenshot ${index + 1}`}
              width={current.width}
              height={current.height}
              className="max-h-[90dvh] w-auto rounded-2xl"
            />
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              aria-label="Close"
              className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-full bg-white/90 text-zinc-900 shadow-lg transition hover:bg-white"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              >
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
        )}
      </dialog>
    </div>
  );
}

function GalleryArrow({
  direction,
  onClick,
}: {
  direction: "prev" | "next";
  onClick: () => void;
}) {
  const isPrev = direction === "prev";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={isPrev ? "Previous screenshot" : "Next screenshot"}
      className={`absolute top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-zinc-900 shadow-lg transition hover:bg-white focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/40 ${
        isPrev ? "left-2" : "right-2"
      }`}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none"
      >
        <path d={isPrev ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6"} />
      </svg>
    </button>
  );
}
