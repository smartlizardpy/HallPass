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
 * No `window` in this file — it is imported by client components but stays a
 * pure core, matching `shake.ts`'s split.
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
