/**
 * HallPass — the page-state side of raising a disguise.
 *
 * `PanicScreen` paints the fake screen; this module owns everything the fake
 * screen cannot see — starting with the browser TAB, which is the one part of the
 * disguise the player is not looking at and a passer-by is.
 *
 * ── WHY THE TITLE NEEDS A REDUCER RATHER THAN A SETTER ──────────────────────
 * Three things write `document.title` and only one of them is us: Next rewrites
 * it on every client-side navigation, the before-paint boot script may already
 * have cloaked it, and the controller re-asserts a cloak over both. The
 * controller therefore has to keep a memory of the REAL title so turning a
 * disguise off restores the genuine page name — and that memory is easy to
 * poison, because the title it observes at the moment a disguise goes up is very
 * often another disguise's title (raise the panic screen while the Docs cloak is
 * on and the observed title is "Untitled document - Google Docs"; record that as
 * "real" and the tab never comes back).
 *
 * {@link reconcileTitle} makes the rule explicit and testable: a title we could
 * have written is never mistaken for a real one. It is deliberately a pure
 * function of (what the tab currently says, what we want it to say, what we
 * believe is real) so the controller's initial pass and its MutationObserver can
 * both run the SAME decision instead of two hand-rolled branches that disagree.
 *
 * ── AND THE PAGE UNDERNEATH ────────────────────────────────────────────────
 * The rest of the module is the same idea applied to the document: an overlay
 * that covers the arcade visually while the arcade still scrolls behind it is a
 * disguise that moves when nobody is touching it. Each helper is a LOCK — it
 * captures what it changed and returns the undo — so no state about "what things
 * were like before" ever has to be kept in a component.
 *
 * No `window` in this file — it is imported by client components but stays a
 * pure core, matching `shake.ts`'s split. The two exported browser helpers at the
 * bottom are the thin layer that finds the real document and hands it over.
 */

import { CLOAK_LIST } from "./cloaks";
import { PANIC_SCREENS } from "./config";

/**
 * Every title the stealth feature is capable of putting in the tab. The `off`
 * cloak is excluded on purpose: its title is the site's genuine one, and treating
 * it as a disguise would make the real title unrememberable.
 */
const DISGUISE_TITLES: ReadonlySet<string> = new Set<string>([
  ...CLOAK_LIST.filter((c) => c.id !== "off").map((c) => c.title),
  ...PANIC_SCREENS.map((s) => s.title),
]);

/**
 * Whether a title is one WE could have written.
 *
 * The check is by value, not by provenance, which costs one edge case: a real
 * page genuinely titled "Google" would be treated as a disguise and forgotten.
 * No page on this site can be — every route title runs through the
 * `"%s · HALLPASS"` template — and the alternative (trusting a flag we set
 * ourselves) breaks the instant a navigation lands between two of our writes.
 */
export function isDisguiseTitle(title: string): boolean {
  return DISGUISE_TITLES.has(title);
}

export type TitleDecision = {
  /** What the real-title memory should now hold. */
  real: string;
  /** What `document.title` should now read. */
  title: string;
};

/**
 * Decide the tab's title and the real-title memory in one step.
 *
 * @param observed  what the tab says right now.
 * @param disguise  the title the active disguise wants, or `null` for none.
 * @param remembered the last title believed to be genuine.
 */
export function reconcileTitle(
  observed: string,
  disguise: string | null,
  remembered: string,
): TitleDecision {
  const real = isDisguiseTitle(observed) ? remembered : observed;
  return { real, title: disguise ?? real };
}

/* -------------------------------------------------------------------------- *
 * Background scroll — pure core.
 * -------------------------------------------------------------------------- */

/** Anything with an inline `overflow` we can set and put back (an element). */
export type OverflowTarget = { style: { overflow: string } };

/** Everything needed to undo a lock, and nothing else. */
export type ScrollLock = {
  targets: readonly { target: OverflowTarget; prior: string }[];
  x: number;
  y: number;
};

/**
 * Clamp the given elements' overflow, recording each one's PRIOR INLINE VALUE
 * rather than assuming it was unset. Locks nest in this app — the promo modal
 * takes the same lock — and a lock that restores `""` unconditionally would hand
 * scrolling back to a page whose other modal is still open.
 *
 * The scroll offsets ride along because clipping overflow collapses the
 * document's scrollable height, and the browser clamps the offset to 0 as a
 * side effect. Left alone, dismissing the disguise would drop the player at the
 * top of a page they were halfway down.
 */
export function lockOverflow(
  targets: readonly OverflowTarget[],
  x: number,
  y: number,
): ScrollLock {
  const recorded = targets.map((target) => {
    const prior = target.style.overflow;
    target.style.overflow = "hidden";
    return { target, prior };
  });
  return { targets: recorded, x, y };
}

/**
 * Undo {@link lockOverflow}, then put the scroll offset back through the caller's
 * `scrollTo` — injected so the whole lock/release pair stays testable without a
 * document.
 */
export function releaseOverflow(
  lock: ScrollLock,
  scrollTo: (x: number, y: number) => void,
): void {
  for (const { target, prior } of lock.targets) {
    target.style.overflow = prior;
  }
  scrollTo(lock.x, lock.y);
}

/* -------------------------------------------------------------------------- *
 * Browser layer.
 * -------------------------------------------------------------------------- */

/**
 * Freeze the page behind the disguise and return the undo. Both the root element
 * and the body are clamped: which of the two actually scrolls depends on the
 * layout (`html.h-full` + `body.min-h-full` here), and locking the wrong one
 * alone is the difference between a frozen page and one that still drifts.
 */
export function lockBackgroundScroll(): () => void {
  if (typeof document === "undefined") return () => {};
  const lock = lockOverflow(
    [document.documentElement, document.body],
    window.scrollX,
    window.scrollY,
  );
  return () => releaseOverflow(lock, (x, y) => window.scrollTo(x, y));
}
