"use client";

import { useEffect, useRef, useState } from "react";
import { youtubeEmbedUrl, youtubeWatchUrl } from "../lib/youtube";

/**
 * A game's gameplay/intro video, as a CLICK-TO-LOAD FACADE.
 *
 * THE IFRAME DOES NOT EXIST UNTIL SOMEBODY PRESSES PLAY, and that is the whole
 * design. A YouTube embed is roughly a megabyte of script and a dozen requests to
 * Google before a frame of video is decoded; mounting one on every store-page
 * render would be the most expensive thing on the page, on a site whose visitors
 * are mostly on school Chromebooks. Deferring it means the store page costs exactly
 * what it costs today.
 *
 * THE POSTER IS OUR OWN ARTWORK, NOT YouTube's THUMBNAIL — the caller passes it in.
 * `i.ytimg.com/vi/<id>/hqdefault.jpg` would have been the obvious poster and it is
 * the wrong choice three times over:
 *   - it is a request to Google on page load, which is the thing this component
 *     exists to avoid;
 *   - it is cross-origin, and `public/sw.js` returns early for cross-origin
 *     requests, so unlike our screenshots it could never be cached for offline;
 *   - it is served by the same infrastructure a school content filter blocks, so on
 *     a blocked network the poster itself would be a broken image.
 * Using the game's first screenshot means zero third-party contact until a
 * deliberate click, and a poster that always renders.
 *
 * BLOCKED NETWORKS ARE THE EXPECTED CASE, not an edge case. The filters that block
 * unblocked-games sites block youtube.com too. Detection is necessarily partial:
 *   - a filter that BLACKHOLES the request (dropped packets, DNS to nowhere) never
 *     fires `load`, which the {@link LOAD_TIMEOUT_MS} timer catches;
 *   - a filter that serves its own block PAGE returns a perfectly good HTTP
 *     response, so `load` fires and we cannot tell — the frame is cross-origin and
 *     its content is unreadable to us by design.
 * Because the second case is undetectable, the escape hatches are rendered
 * PERMANENTLY under a playing video rather than only in the error state. A user
 * staring at their district's "This page is blocked" notice still has a labelled way
 * back to the screenshots and a link that works from a phone on cellular.
 */

/**
 * How long to wait for the frame's `load` before assuming the network ate it.
 *
 * Six seconds is a deliberate compromise: long enough not to accuse a slow school
 * connection of being blocked, short enough that somebody staring at a dead grey
 * rectangle gets an explanation before they give up on the page. The timer only
 * ever ADDS the fallback UI — it never removes the frame, so a video that arrives
 * at eight seconds still plays.
 */
const LOAD_TIMEOUT_MS = 6000;

type Phase = "idle" | "playing" | "slow";

export function GameTrailer({
  videoId,
  label,
  title,
  poster,
  onPlay,
  onExit,
}: {
  /** A validated 11-character id. See `app/lib/youtube.ts`. */
  videoId: string;
  /** Editorial label — "Gameplay", "Intro". Used in the a11y names. */
  label: string;
  /** The game's title, so the accessible names say which game. */
  title: string;
  /**
   * What fills the frame before play is pressed — the game's first screenshot or
   * its cover art. Taken as a node so this component never has to know about
   * `GameMedia` or `CoverImage`, and so it can never be handed a YouTube URL.
   */
  poster: React.ReactNode;
  /** Fired once, on the click that creates the frame. The parent owns analytics. */
  onPlay?: () => void;
  /**
   * Switch back to the screenshot gallery. Omitted when the game has no
   * screenshots to switch to, in which case no "Back to screenshots" control is
   * rendered — an offer that leads nowhere is worse than no offer.
   */
  onExit?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear the timer if the component goes away mid-load — switching to the
  // screenshots tab unmounts this, and a pending setState on a dead component is a
  // leak the linter will not catch.
  useEffect(() => {
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  const start = () => {
    setPhase("playing");
    onPlay?.();
    timer.current = setTimeout(() => setPhase("slow"), LOAD_TIMEOUT_MS);
  };

  /**
   * The frame reported `load`, so cancel the "this looks blocked" timer.
   *
   * Deliberately does NOT move a phase that already reached "slow" back to
   * "playing". Yanking the explanation away the instant a late `load` arrives would
   * be a flicker on exactly the slow connection it was written for, and the frame is
   * visible and playing either way — so this only ever stops the timer.
   */
  const settle = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  return (
    <div className="min-w-0">
      {/* Same `aspect-[16/10]` box as ScreenshotGallery's main frame, NOT the 16/9
          a video actually is. Matching the gallery means toggling between the two
          does not change the height of the hero, so the Play button and the
          metadata rail beside it never jump. YouTube letterboxes inside the frame,
          which costs a few pixels of black and buys a stable layout. */}
      <div className="relative aspect-[16/10] w-full overflow-hidden rounded-2xl bg-zinc-900">
        {phase === "idle" ? (
          <>
            {poster}
            {/* One real <button> over the whole poster, so the video is reachable
                by keyboard and by assistive tech — the same correction
                ScreenshotGallery's lightbox trigger needed. */}
            <button
              type="button"
              onClick={start}
              aria-label={`Play the ${label.toLowerCase()} video for ${title}`}
              style={{ touchAction: "manipulation" }}
              className="group absolute inset-0 grid place-items-center bg-zinc-900/30 transition hover:bg-zinc-900/45 focus:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-brand"
            >
              <span className="grid h-16 w-16 place-items-center rounded-full bg-white/95 shadow-xl transition group-hover:scale-105 group-active:scale-95 sm:h-20 sm:w-20">
                <svg
                  width="26"
                  height="26"
                  viewBox="0 0 14 14"
                  fill="currentColor"
                  className="pointer-events-none ml-1 text-zinc-900"
                >
                  <path d="M3 1.5v11l10-5.5z" />
                </svg>
              </span>
              <span className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-zinc-900/75 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-white">
                {label}
              </span>
            </button>
          </>
        ) : (
          <iframe
            src={youtubeEmbedUrl(videoId)}
            title={`${label} video for ${title}`}
            onLoad={settle}
            // Narrow on purpose. `fullscreen` is what makes the embed's own
            // fullscreen control work; the rest are what a video player legitimately
            // needs. Nothing about geolocation, camera or microphone is granted.
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            className="absolute inset-0 h-full w-full border-0"
          />
        )}
      </div>

      {/* PERMANENT while playing, not conditional on the timeout — see the module
          docblock. A filter that serves its own block page produces a successful
          `load`, so this row is the only thing standing between a user and an
          inexplicable grey rectangle. */}
      {phase !== "idle" && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] font-bold">
          {phase === "slow" && (
            <p className="text-muted">
              Video isn&apos;t loading — this network may block YouTube.
            </p>
          )}
          <a
            href={youtubeWatchUrl(videoId)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand hover:text-brand-600"
          >
            Watch on YouTube
          </a>
          {onExit && (
            <button
              type="button"
              onClick={onExit}
              className="text-muted underline decoration-dotted hover:text-zinc-900"
            >
              Back to screenshots
            </button>
          )}
        </div>
      )}
    </div>
  );
}
