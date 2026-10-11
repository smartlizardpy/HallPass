"use client";

import { useRef, useState } from "react";
import type { GameMedia } from "../lib/game-media-blob";
import { buildGallerySlides, firstImageIndex } from "../lib/gallery-slides";
import { GameTrailer } from "./GameTrailer";

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
  cover = null,
  video = null,
}: {
  media: GameMedia[];
  title: string;
  /** Cover art URL, shown after the video. `null` when the game has none. */
  cover?: string | null;
  /**
   * The game's gameplay/intro video, shown as the FIRST SLIDE, or `null`. It used
   * to be a separate toggle above the hero; see `lib/gallery-slides.ts`.
   *
   * `poster` and `thumb` are passed in rather than derived so this component never
   * learns about `CoverImage` or YouTube thumbnails (`GameTrailer` explains why the
   * poster is our own artwork). `thumb` is the URL for the strip, `null` for a
   * plain dark tile.
   */
  video?: {
    id: string;
    label: string;
    poster: React.ReactNode;
    thumb: string | null;
    onPlay?: () => void;
  } | null;
}) {
  const [index, setIndex] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pointerStart = useRef<number | null>(null);
  const swipedRef = useRef(false);

  // ONE list every render site reads from — the order is a rule, and it lives in
  // `lib/gallery-slides.ts` so the arrows, the counter, the thumb strip and the
  // lightbox cannot disagree about what slide 1 is.
  const slides = buildGallerySlides({
    title,
    cover,
    media,
    video: video ? { id: video.id, label: video.label } : null,
  });

  const count = slides.length;
  const current = slides[index] ?? slides[0];
  const onVideo = current?.kind === "video";

  const step = (delta: number) => {
    setIndex((i) => (i + delta + count) % count);
  };

  /**
   * Arrow/Home/End for the gallery, handled ONCE on the container.
   *
   * There used to be a second, document-level listener for the open lightbox.
   * That was a bug: a `<dialog>` opened with `showModal()` moves to the top layer
   * VISUALLY but stays where it is in the DOM tree, so a keydown inside it still
   * bubbles to this container. Both handlers therefore fired and every arrow press
   * advanced TWO slides — which, with exactly two screenshots, is a full cycle and
   * looked like the arrows were dead. One handler covers both states.
   *
   * Scoped to the container rather than the document so it never fights the page
   * or the player overlay for arrow keys.
   */
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

  return (
    <div
      className="min-w-0"
      role="group"
      aria-roledescription="carousel"
      aria-label={`${title} gallery`}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      {/* THE VIDEO SLIDE. Mounted only while it is the current slide, so leaving it
          stops the video — and nothing from YouTube is requested until Play is
          pressed (see `GameTrailer`). */}
      {onVideo && video && (
        <GameTrailer
          videoId={video.id}
          label={video.label}
          title={title}
          poster={video.poster}
          onPlay={video.onPlay}
          // Only offered when there is somewhere to go back TO.
          onExit={count > 1 ? () => setIndex(firstImageIndex(slides)) : undefined}
        />
      )}

      {/* Main frame. Stays in the page, hidden, while the video slide is showing:
          the pictures must remain in the HTML for crawlers and no-JS readers. */}
      <div
        className={`relative aspect-[16/10] w-full overflow-hidden rounded-2xl bg-zinc-900 ${
          onVideo ? "hidden" : ""
        }`}
      >
        {slides.map((item, i) =>
          item.kind !== "image" ? null : (
          // All frames stay mounted and crossfade via opacity: swapping `src`
          // would flash the empty frame on every step, and it also means the
          // SSR'd HTML contains every screenshot for crawlers and no-JS readers.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={item.key}
            src={item.src}
            alt={item.alt}
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
          ),
        )}

        {/* The artwork itself is the control that opens the lightbox, and it is a
            real <button>, not a div with pointer handlers. As a div there was no
            keyboard or assistive-tech path to the lightbox at all — it could only
            be opened with a mouse or a finger.

            Swipe and activation are separated by WHICH event they listen to:
            pointer events carry the drag distance, and `click` fires for a mouse
            click, a tap AND a keyboard Enter/Space on a button. The `swipedRef`
            latch stops a drag that ends over the image from also counting as a
            click and popping the lightbox open.

            Threshold is ~40px so a vertical page scroll that drifts a few pixels
            horizontally does not change the slide. */}
        <button
          type="button"
          aria-label={`View ${current?.kind === "image" ? current.alt : title} full size`}
          className="absolute inset-0 cursor-zoom-in focus:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-brand"
          onPointerDown={(e) => {
            pointerStart.current = e.clientX;
            swipedRef.current = false;
          }}
          onPointerUp={(e) => {
            const start = pointerStart.current;
            pointerStart.current = null;
            if (start === null) return;
            const dx = e.clientX - start;
            if (Math.abs(dx) >= 40 && count > 1) {
              swipedRef.current = true;
              step(dx < 0 ? 1 : -1);
            }
          }}
          onClick={() => {
            if (swipedRef.current) {
              swipedRef.current = false;
              return;
            }
            // `showModal()` throws if the dialog is already open.
            if (!dialogRef.current?.open) dialogRef.current?.showModal();
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
          {slides.map((item, i) => (
            <li key={item.key} className="snap-start">
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-label={
                  item.kind === "video"
                    ? `Show the ${item.label.toLowerCase()} video`
                    : `Show image ${slides.slice(0, i + 1).filter((x) => x.kind === "image").length}`
                }
                aria-current={i === index}
                className={`relative block aspect-[16/10] w-24 shrink-0 overflow-hidden rounded-lg bg-zinc-900 transition ${
                  i === index
                    ? "ring-2 ring-brand ring-offset-2"
                    : "opacity-70 hover:opacity-100"
                }`}
              >
                {item.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.src}
                    alt=""
                    width={item.width}
                    height={item.height}
                    loading="lazy"
                    decoding="async"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                ) : (
                  <>
                    {/* The game's own artwork (or a plain dark tile), never a
                        YouTube thumbnail — see `GameTrailer`. */}
                    {video?.thumb && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={video.thumb}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    )}
                    {/* Literal white disc and dark triangle: it sits on artwork,
                        which does not change colour with the theme. */}
                    <span className="absolute inset-0 grid place-items-center bg-zinc-900/35">
                      <span className="grid h-7 w-7 place-items-center rounded-full bg-white/95 shadow">
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 14 14"
                          fill="currentColor"
                          className="pointer-events-none ml-0.5 text-zinc-900"
                          aria-hidden
                        >
                          <path d="M3 1.5v11l10-5.5z" />
                        </svg>
                      </span>
                    </span>
                  </>
                )}
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
        {current?.kind === "image" && (
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={current.src}
              alt={current.alt}
              width={current.width}
              height={current.height}
              className="max-h-[90dvh] w-auto rounded-2xl"
            />
            {/* `tap-44` (globals.css): the disc stays 40px so it does not sit on
                the picture any harder than it has to, while the hit area is a
                full 44px. This is the control someone jabs at to get OUT of a
                full-screen image — the one place a near-miss is least
                forgivable. */}
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              aria-label="Close"
              className="tap-44 absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-full bg-white/90 text-zinc-900 shadow-lg transition hover:bg-white"
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
    // `tap-44` (globals.css) lifts the 40px disc to a 44px hit area without
    // repainting it any larger. The arrows sit `left-2`/`right-2` inside an
    // `overflow-hidden` frame, so the +2px of halo per side still clears the
    // clip — do not move them any closer to the edge.
    <button
      type="button"
      onClick={onClick}
      aria-label={isPrev ? "Previous screenshot" : "Next screenshot"}
      className={`tap-44 absolute top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-zinc-900 shadow-lg transition hover:bg-white focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/40 ${
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
