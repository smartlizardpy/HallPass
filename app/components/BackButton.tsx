"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * A "go back" control for the standalone `/play/*` pages.
 *
 * Those pages render a bare `<main>` with no header and no sidebar — deliberately,
 * because `/play/account` shows the player's email and must stay out of the shared
 * service-worker cache, which the full arcade shell would complicate. The cost is
 * that once you are on one there is no way out except the browser's own back
 * button, which on an installed PWA is not always on screen.
 *
 * RENDERED AS A REAL LINK, NOT A BUTTON. The `href` is the honest destination and
 * works with no JavaScript, from a crawler, and on a middle-click or
 * open-in-new-tab. The click handler is an enhancement on top: when there is a
 * same-origin page to return to, it goes THERE instead, so a player who arrived
 * from a game page lands back on that game rather than being dumped at the home
 * grid.
 *
 * IT NEVER CALLS `history.back()`, AND THAT IS THE WHOLE DESIGN. The obvious
 * implementation — go back when the history stack has depth — is wrong, and
 * wrong in a way that only shows up in a real browser. A tab opened fresh on this
 * page already has a depth of 2 (the blank page it replaced), and a direct
 * arrival carries no referrer, so a depth check plus a "no referrer means we came
 * from inside the app" assumption sends the player to `about:blank`. Verified: it
 * did exactly that.
 *
 * `router.push` cannot do that. The worst case is landing somewhere real inside
 * HallPass, never outside it and never on a blank page. So the enhancement is
 * "push the page we came FROM, if we can prove it was ours", and the proof has to
 * be positive — a non-empty, same-origin referrer — rather than inferred from the
 * absence of one.
 *
 * When there is no such proof the plain `href` navigation stands, which is why
 * this is a `<Link>`: the fallback is not a code path that has to be right, it is
 * simply what the browser was going to do anyway.
 */
export function BackButton({
  href = "/",
  label = "Back to games",
}: {
  /** Where to go when there is no safe in-app history to return to. */
  href?: string;
  label?: string;
}) {
  const router = useRouter();

  return (
    <Link
      href={href}
      onClick={(event) => {
        // Let the browser handle anything that is not a plain left-click, so
        // middle-click and cmd/ctrl-click still open a new tab.
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }

        try {
          const ref = document.referrer;
          if (!ref) return; // No proof it was ours — take the plain link.

          const from = new URL(ref);
          if (from.origin !== window.location.origin) return; // Off-site.
          if (from.pathname === window.location.pathname) return; // A reload.

          event.preventDefault();
          router.push(from.pathname + from.search);
        } catch {
          // Any failure here leaves the plain navigation in place, which is
          // always a correct outcome rather than a broken one.
        }
      }}
      className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-extrabold text-zinc-700 shadow-sm transition hover:bg-surface-2 hover:text-zinc-900 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/30"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className="shrink-0"
      >
        <path d="M15 18l-6-6 6-6" />
      </svg>
      {label}
    </Link>
  );
}
