"use client";

/**
 * HallPass — who owns the screen right now.
 *
 * THE BUG THIS EXISTS TO STOP. `document.body.style.overflow === "hidden"` was
 * doing two unrelated jobs at once: it was the scroll-lock MECHANISM and, at the
 * same time, the cross-component STATE QUERY every overlay used to ask "is
 * somebody else already up?". One string, two meanings, and no agreement between
 * its owners about the protocol — `Sidebar` and `FeaturePromo` save and restore
 * the previous value, `PlayerOverlay` cleared it unconditionally to `""` (quietly
 * freeing a lock that outlived it), `PanicScreen` keeps its own save/restore, and
 * `StealthSettings` did not lock at all.
 *
 * That last one is what turned a smell into a real defect: with stealth settings
 * open the string read `""`, so `FeaturePromo` concluded nothing owned the screen,
 * mounted at `z-[95]` UNDERNEATH the `z-[120]` settings modal, locked scroll and
 * moved keyboard focus to a Close button nobody could see.
 *
 * THE CONTRACT. Lock by ACQUIRING, unlock by calling what you were handed, and
 * ask {@link isOverlayOpen} rather than reading the string. Acquisitions are
 * REF-COUNTED: the first one records the page's own `overflow` and clamps it, and
 * only the last release puts that recorded value back — so two overlaps (the
 * player under the promo, the promo under stealth settings) cannot free each
 * other's lock, in any interleaving, and a double release is a no-op rather than
 * a page that silently starts scrolling behind a modal.
 *
 * WHY {@link isOverlayOpen} STILL READS THE RAW STRING. Several overlays outside
 * this module's reach still lock the old way — `Sidebar`'s mobile drawer,
 * `PanicScreen`, the beta session tutorial, the dashboard shell. Dropping the
 * string clause would make the query blind to every one of them and turn this fix
 * into a new regression of exactly the same shape. The clause is therefore
 * load-bearing until those files are migrated, not a leftover.
 *
 * KNOWN LIMIT, stated plainly: a raw-string locker that takes the body WHILE a
 * counted lock is held still loses its value when the count reaches zero, because
 * both wrote the same indistinguishable `"hidden"`. Ref-counting can only
 * arbitrate between participants, and the remedy is to migrate the stragglers —
 * not to guess here.
 *
 * ONE ORDERING RULE FOR CALLERS, which follows from that limit. An overlay that
 * can be torn down in the SAME commit that a NON-participant takes the body must
 * release from a LAYOUT effect, not a passive one. `PanicScreen` locks from a
 * layout effect, so a passive release lands after it has already recorded our
 * `hidden` as the page's own value — and dismissing the disguise then hands the
 * page back permanently locked. `StealthSettings` is that case today: its
 * "Preview panic screen" button closes the modal and raises the disguise in one
 * commit. Overlays with no such path (the player, the promo) are fine as they are.
 *
 * DOM-only and free of React on purpose (same posture as `bottom-chrome.ts`), so
 * a component takes the lock from whichever effect actually owns its lifetime.
 */

/** The value a locked page's `body` carries. */
const LOCKED = "hidden";

/** How many overlays are currently holding the lock. */
let count = 0;

/**
 * The page's own `overflow`, captured at the FIRST acquire. Meaningless while
 * `count` is 0, which is why nothing reads it outside a held lock.
 */
let prior = "";

/**
 * Take the body scroll lock; call the returned function to give it back.
 *
 * The release is idempotent — calling it twice releases once — because a React
 * effect cleanup that also runs on an unmount path is easy to double-fire, and a
 * stray decrement would drop somebody else's lock. It is also safe to release out
 * of order: the count, not the ordering, decides when the page is handed back.
 *
 * A no-op returning a no-op on the server, so a component may call it from a
 * layout effect without a `typeof document` dance of its own.
 */
export function acquireOverlayLock(): () => void {
  if (typeof document === "undefined") return () => {};

  if (count === 0) prior = document.body.style.overflow;
  count += 1;
  document.body.style.overflow = LOCKED;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    count -= 1;
    if (count > 0) return;
    count = 0;
    document.body.style.overflow = prior;
  };
}

/**
 * Whether ANY overlay currently owns the screen.
 *
 * The question `FeaturePromo` has to answer before interrupting somebody, and the
 * one `StreakToast` asks before choosing where to land. Both clauses matter: the
 * count covers everything that has migrated to {@link acquireOverlayLock}, and the
 * raw string covers everything that has not (see the header).
 */
export function isOverlayOpen(): boolean {
  if (count > 0) return true;
  if (typeof document === "undefined") return false;
  return document.body.style.overflow === LOCKED;
}

/**
 * How many locks are held. Exported for tests and debugging — components should
 * ask {@link isOverlayOpen}, which also sees the overlays this module does not own.
 */
export function overlayLockCount(): number {
  return count;
}
