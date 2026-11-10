"use client";

import type { Ref } from "react";

/**
 * HallPass — the 10 Kasım remembrance notice.
 *
 * Rendered by `FeaturePromo` inside its own backdrop and dialog shell, so it
 * inherits the focus trap, Esc, scroll lock and the "never over a running game"
 * rule. Only the panel's CONTENTS live here, because they share nothing with the
 * promo variants: no bullet points, no call to action, no "Maybe later".
 *
 * ── TONE ────────────────────────────────────────────────────────────────────
 * 10 November is a day of mourning in Türkiye, not a holiday. So: a portrait
 * of Atatürk in his kalpak fading into black, one red accent, Turkish first
 * with English beneath it, no "happy",
 * and the only button closes the notice. The single quotation is Atatürk's own
 * ("Yurtta sulh, cihanda sulh"); the world-leader tributes that circulate on
 * social media every year are mostly misattributed and are deliberately left out.
 *
 * The panel is dark in BOTH themes on purpose — the black is the message, not a
 * colour scheme.
 */
export function RemembrancePanel({
  closeRef,
  onClose,
}: {
  closeRef: Ref<HTMLButtonElement>;
  onClose: () => void;
}) {
  return (
    <>
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        aria-label="Kapat · Close"
        className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-full bg-black/45 text-zinc-200 backdrop-blur-sm transition hover:bg-black/60 hover:text-white focus:outline-none focus-visible:ring-4 focus-visible:ring-white/30"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          className="pointer-events-none"
        >
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>

      {/*
        A plain <img>, not next/image: it is one small, pre-sized JPEG
        (720px wide, cropped to the kalpak and face), shown one day a year.
        The bottom of the photo fades into the panel's black so the text below
        reads as part of the same picture.
      */}
      <div className="relative h-60 sm:h-72 [@media(max-height:720px)]:h-36">
        {/* eslint-disable-next-line @next/next/no-img-element -- one pre-sized asset; see above */}
        <img
          src="/events/10-kasim/ataturk.jpg"
          alt="Mustafa Kemal Atatürk"
          width={720}
          height={833}
          decoding="async"
          className="h-full w-full object-cover object-[50%_68%]"
        />
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-b from-transparent via-zinc-950/10 to-zinc-950"
        />
      </div>

      <div className="relative -mt-6 px-6 pb-7 text-center sm:px-8">
        <CrescentAndStar />

        <h2
          id="promo-title"
          lang="tr"
          className="mt-5 font-serif text-[34px] font-normal uppercase leading-none tracking-wide text-white sm:text-[40px]"
        >
          {/* 1938 → ∞: the familiar Turkish motif — he died in 1938, and lives on.
              Screen readers get the plain date instead of "193 infinity". */}
          <span aria-hidden>10 Kasım 193∞</span>
          <span className="sr-only">10 Kasım 1938</span>
        </h2>

        <div id="promo-body" className="mt-5 space-y-3">
          <p lang="tr" className="text-[17px] font-bold leading-snug text-zinc-100">
            Mustafa Kemal Atatürk&apos;ü saygı, minnet ve özlemle anıyoruz.
          </p>
          <p className="text-[14px] font-semibold leading-relaxed text-zinc-400">
            Remembering Mustafa Kemal Atatürk with respect and gratitude — from all
            of us at HallPass to our friends in Türkiye.
          </p>
        </div>

        <figure className="mt-6">
          <blockquote lang="tr" className="font-serif text-[18px] italic text-zinc-100">
            &ldquo;Yurtta sulh, cihanda sulh.&rdquo;
          </blockquote>
          <figcaption className="mt-1 text-[12px] font-bold uppercase tracking-[0.18em] text-zinc-500">
            Peace at home, peace in the world
          </figcaption>
        </figure>

        <div aria-hidden className="mx-auto mt-5 h-0.5 w-10 rounded-full bg-[#E30A17]" />

        <button
          type="button"
          onClick={onClose}
          className="mt-6 rounded-full border border-white/25 px-6 py-3 text-sm font-extrabold text-white transition hover:bg-white/10 focus:outline-none focus-visible:ring-4 focus-visible:ring-white/30"
        >
          <span lang="tr">Saygıyla</span> · With respect
        </button>
      </div>
    </>
  );
}

/**
 * The crescent and star in flag red. The crescent is a disc with an offset disc
 * masked out of it, so it reads correctly on any background rather than relying
 * on the panel being black.
 */
function CrescentAndStar() {
  return (
    <svg
      aria-hidden
      width="34"
      height="24"
      viewBox="0 0 34 24"
      className="mx-auto block"
    >
      <defs>
        <mask id="remembrance-crescent">
          <rect width="34" height="24" fill="white" />
          <circle cx="14.4" cy="12" r="8" fill="black" />
        </mask>
      </defs>
      <circle cx="12" cy="12" r="10" fill="#E30A17" mask="url(#remembrance-crescent)" />
      {/* One point faces the crescent, as on the flag. */}
      <polygon
        fill="#E30A17"
        points="20.00,12.00 23.38,10.82 23.45,7.24 25.62,10.10 29.05,9.06 27.00,12.00 29.05,14.94 25.62,13.90 23.45,16.76 23.38,13.18"
      />
    </svg>
  );
}
