"use client";

/**
 * HallPass — apply a tab cloak's FAVICON to the live document (browser-only).
 *
 * The title half of a cloak is handled by the controller (it must survive
 * Next.js overwriting `document.title` on every navigation, which needs a
 * MutationObserver — see `StealthController`). The favicon has no such churn, so
 * it lives here as a small idempotent mutator the controller and the before-paint
 * boot script both drive to the same end state.
 *
 * The one subtle rule: we mutate the SINGLE primary icon link the browser
 * actually uses, and stash its original `href` in a data attribute the first time
 * we touch it, so turning the cloak off restores the real HALLPASS icon exactly —
 * rather than appending competing links and hoping the browser picks the last one.
 */

/** Data attribute holding the icon link's pre-cloak href, for restore. */
const ORIG_HREF = "data-hp-orig-href";

/**
 * The icon link the browser renders in the tab: the first `rel="icon"` that is
 * NOT an apple-touch icon. Created (empty) if the document has none. Records its
 * original href once so {@link applyFavicon}`(null)` can put it back.
 */
function primaryIconLink(): HTMLLinkElement | null {
  if (typeof document === "undefined") return null;
  let link = document.head.querySelector<HTMLLinkElement>(
    'link[rel~="icon"]:not([rel~="apple-touch-icon"])',
  );
  if (!link) {
    link = document.createElement("link");
    link.setAttribute("rel", "icon");
    document.head.appendChild(link);
  }
  if (!link.hasAttribute(ORIG_HREF)) {
    link.setAttribute(ORIG_HREF, link.getAttribute("href") ?? "");
  }
  return link;
}

/**
 * Point the tab favicon at `dataUri`, or restore the original icon when passed
 * `null` (the "off" cloak). Idempotent and fail-soft: safe to call on every
 * prefs change and a no-op outside the browser.
 */
export function applyFavicon(dataUri: string | null): void {
  const link = primaryIconLink();
  if (!link) return;
  if (dataUri) {
    link.setAttribute("type", "image/svg+xml");
    link.setAttribute("href", dataUri);
    return;
  }
  const orig = link.getAttribute(ORIG_HREF) ?? "";
  if (orig) {
    link.removeAttribute("type");
    link.setAttribute("href", orig);
  } else {
    // The document never had an icon link before we made one — remove ours so the
    // browser falls back to its default rather than to an empty href.
    link.remove();
  }
}
