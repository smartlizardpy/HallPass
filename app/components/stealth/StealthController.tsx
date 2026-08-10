"use client";

/**
 * HallPass — the stealth-mode CONTROLLER, mounted once in the root layout.
 *
 * Owns the two live behaviours behind the prefs held in `lib/stealth/store`:
 *
 *  1. THE PANIC KEY. A window-level keydown listener watches for the configured
 *     panic key and toggles a full-viewport {@link PanicScreen} disguise. Escape
 *     always dismisses — which is also why Escape cannot BE the panic key, and
 *     why the hotkey stands down entirely while the settings modal is capturing a
 *     replacement one (see `rebinding`). Caveat: while a game IFRAME holds focus
 *     the browser routes keystrokes to it, so the panic key fires reliably on the
 *     catalogue and store pages (where a passer-by actually sees the arcade), not
 *     mid-game — the honest limitation of any iframe host.
 *
 *     Raising the disguise is more than a render: the arcade behind it also has to
 *     go quiet ({@link hushArcade}), because a disguise a teacher can HEAR through
 *     is no disguise. Every such side effect is owned here, as an effect keyed on
 *     `panicking`, so each one is undone by the same code path that applied it.
 *
 *  2. THE TAB. One effect owns the title and the favicon for BOTH disguises: the
 *     standing cloak, and the panic screen that outranks it while raised. It
 *     re-asserts through a MutationObserver because Next rewrites
 *     `document.title` on every navigation, and it keeps a record of the REAL
 *     title (seeded from the boot script's `__hpRealTitle`, refreshed whenever the
 *     tab shows something we could not have written) so dropping a disguise
 *     restores the genuine page title rather than a guess. The rule that keeps
 *     one disguise's title from being mistaken for the real one lives in
 *     {@link reconcileTitle}, where it can be tested.
 *
 * Renders nothing to the server and reads no session — it stays a pure client
 * island so the pages that mount it remain statically prerenderable (and thus in
 * the service-worker precache). Same contract as `WelcomeToast`/`PWA`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { cloakById } from "../../lib/stealth/cloaks";
import { applyFavicon } from "../../lib/stealth/apply";
import { panicScreenById } from "../../lib/stealth/config";
import { hushArcade } from "../../lib/stealth/hush";
import { isDisguiseTitle, reconcileTitle } from "../../lib/stealth/panic";
import { useShakeToPanic } from "../../lib/stealth/shake";
import { OPEN_STEALTH_EVENT, PANIC_EVENT, useStealth } from "../../lib/stealth/store";
import { PanicScreen } from "./PanicScreen";
import { StealthSettings } from "./StealthSettings";

/** Site default, used only as the last-resort restore title. */
const FALLBACK_TITLE = "HALLPASS — Unblocked Games";

/** True when a keystroke landed in an editable field (so a printable panic key
 *  doesn't fire while the player is typing in search or the settings modal). */
function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable === true
  );
}

export function StealthController() {
  const { prefs } = useStealth();
  const [panicking, setPanicking] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /**
   * True while the settings modal is capturing a replacement panic key.
   *
   * The hotkey below and that capture are bound on the SAME target in the SAME
   * phase, and this one is registered first (it mounts with the root layout), so
   * pressing the current panic key mid-rebind used to raise the disguise over the
   * modal the player was standing in. Standing down for the duration is the fix
   * that does not depend on listener ordering; re-registering when this flips —
   * which putting it in the effect's deps does — is what additionally lets the
   * modal's `stopImmediatePropagation` work, since a listener added later runs
   * later.
   */
  const [rebinding, setRebinding] = useState(false);
  const realTitleRef = useRef<string | null>(null);

  // Open the settings modal when any launcher dispatches the window event.
  useEffect(() => {
    const open = () => setSettingsOpen(true);
    window.addEventListener(OPEN_STEALTH_EVENT, open);
    return () => window.removeEventListener(OPEN_STEALTH_EVENT, open);
  }, []);

  // Raise the panic screen on demand (the settings "Preview" button), closing
  // the settings modal first so the disguise covers the whole viewport.
  useEffect(() => {
    const preview = () => {
      setSettingsOpen(false);
      setPanicking(true);
    };
    window.addEventListener(PANIC_EVENT, preview);
    return () => window.removeEventListener(PANIC_EVENT, preview);
  }, []);

  /* -------------------------- panic hotkey -------------------------- */
  const panicKey = prefs.panicKey;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // The player is choosing a new panic key: every keystroke belongs to that
      // control, including the key this listener currently answers to.
      if (rebinding) return;

      // Never let a browser/OS shortcut (Cmd+`, Ctrl+`) double as the panic key.
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === "Escape") {
        // Escape only ever dismisses; it never opens (that would fight modals).
        setPanicking((on) => (on ? false : on));
        return;
      }

      if (e.key !== panicKey) return;
      // A printable panic key typed into a field is the user writing, not hiding.
      if (panicKey.length === 1 && isEditableTarget(e.target)) return;

      e.preventDefault();
      setPanicking((on) => !on);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [panicKey, rebinding]);

  /* ---------------------- shake to panic (touch) ---------------------- */
  // The counterpart to the panic key for phones and tablets with no keyboard.
  // Deliberately RAISES only (never toggles): a shake reveals homework, and only
  // a deliberate dismiss — the corner tap, Escape, or the key — brings the arcade
  // back, so a jostled phone can't expose it. Opt-in via `prefs.shake`; the hook
  // no-ops when it is off or the device has no motion sensor.
  const raisePanic = useCallback(() => setPanicking(true), []);
  useShakeToPanic(prefs.shake, raisePanic);

  const dismissPanic = useCallback(() => setPanicking(false), []);
  // Stable, not an inline arrow: the settings modal binds its Escape handler to
  // this, and this component re-renders on every stealth preference the player
  // touches — which would otherwise churn that listener on every click.
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  /* ------------------------- silence the arcade ------------------------- */
  // Sound betrays the disguise faster than anything on screen, so it is silenced
  // for exactly as long as the overlay is up and handed back untouched after —
  // see `lib/stealth/hush` for what the host page can and cannot reach.
  useEffect(() => {
    if (!panicking) return;
    return hushArcade();
  }, [panicking]);

  /* ----------------------- the tab (cloak + panic) ----------------------- */
  // ONE owner for `document.title` and the favicon, because two would fight.
  // The panic screen outranks the cloak while it is up — a Google Doc filling the
  // viewport under a tab reading "HALLPASS" is worse than no disguise at all —
  // and dropping back to the cloak (or to the real title) is just this same effect
  // re-running with a different answer for `disguise`.
  const cloakId = prefs.cloak;
  const panicScreenId = prefs.panicScreen;
  useEffect(() => {
    if (typeof document === "undefined") return;
    const cloak = cloakById(cloakId);
    const disguise = panicking
      ? panicScreenById(panicScreenId)
      : cloak.id === "off"
        ? null
        : cloak;

    // Seed the real-title memory: from the boot script's stash if it cloaked before
    // first paint, otherwise from the tab itself — unless the tab is already
    // showing one of ours, which tells us nothing about the real title.
    if (realTitleRef.current == null) {
      const stashed = (window as unknown as { __hpRealTitle?: string }).__hpRealTitle;
      realTitleRef.current =
        stashed ?? (isDisguiseTitle(document.title) ? FALLBACK_TITLE : document.title);
    }

    const enforce = () => {
      const { real, title } = reconcileTitle(
        document.title,
        disguise?.title ?? null,
        realTitleRef.current ?? FALLBACK_TITLE,
      );
      realTitleRef.current = real;
      if (document.title !== title) document.title = title;
      // The favicon needs re-asserting for the same reason the title does: a
      // navigation re-renders the head and puts the real icon link back, which
      // would leave a "Google Docs" tab wearing the arcade's icon.
      applyFavicon(disguise?.favicon ?? null);
    };
    enforce();

    // Watch the whole head, not the `<title>` node: a client-side navigation can
    // REPLACE that element outright, which would leave an observer bound to it
    // watching a node no longer in the document — the disguise silently losing the
    // tab exactly when the player navigates behind it. `enforce` is a string
    // compare, so the extra head churn it sees costs nothing.
    const observer = new MutationObserver(enforce);
    observer.observe(document.head, { childList: true, characterData: true, subtree: true });
    return () => observer.disconnect();
  }, [cloakId, panicking, panicScreenId]);

  return (
    <>
      {panicking && <PanicScreen screen={prefs.panicScreen} onDismiss={dismissPanic} />}
      <StealthSettings
        open={settingsOpen}
        onClose={closeSettings}
        onRebindingChange={setRebinding}
      />
    </>
  );
}
