"use client";

/**
 * HallPass — the stealth-mode SETTINGS modal.
 *
 * Lets a player choose their tab disguise, rebind the panic key, and pick which
 * fake screen the panic key raises. Every control writes straight through
 * {@link useStealth} to localStorage, so changes take effect live — the cloak
 * re-applies and the controller re-binds the moment a value changes, with no save
 * button. Pure client UI; it renders only when `open`.
 *
 * ── WHAT `role="dialog" aria-modal="true"` PROMISES ─────────────────────────
 * Those two attributes are a claim about behaviour, and this panel used to make
 * the claim without keeping any of it: no Escape, no scroll lock, no initial
 * focus, no trap. The screen-reader half of the lie is the obvious cost, but the
 * scroll lock had a second victim — `FeaturePromo` used to read
 * `document.body.style.overflow` as its "is anything on screen?" test, so a modal
 * that never locked was a modal it could not see, and the promo would open at
 * `z-[95]` UNDERNEATH this panel at `z-[120]` and move focus to a Close button
 * behind it. The query moved to `lib/overlay-lock.ts`, and this panel now takes
 * the lock like every other overlay, which fixes both halves.
 *
 * Escape does NOT fight `StealthController`'s global handler. That one is bound on
 * `window` in the capture phase and only ever DISMISSES a raised panic screen
 * (`on ? false : on`, never a raise), and nothing is raised while these settings
 * are up — so closing this modal with Escape cannot disturb the disguise, in
 * either direction.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { acquireOverlayLock } from "../../lib/overlay-lock";
import { CLOAK_LIST } from "../../lib/stealth/cloaks";
import { PANIC_SCREENS } from "../../lib/stealth/config";
import { deviceHasMotion, requestMotionPermission } from "../../lib/stealth/shake";
import { triggerPanic, useStealth } from "../../lib/stealth/store";

/** Turn a raw `KeyboardEvent.key` into something readable in the UI. */
function keyLabel(key: string): string {
  if (key === " ") return "Space";
  if (key === "`") return "Backtick ( ` )";
  if (key.length === 1) return key.toUpperCase();
  return key; // Escape, F2, ArrowUp, …
}

export function StealthSettings({
  open,
  onClose,
  onRebindingChange,
}: {
  open: boolean;
  onClose: () => void;
  /**
   * Told whenever this modal starts and stops capturing a new panic key.
   *
   * A prop rather than another window event in `lib/stealth/store`, because the
   * only listener is the parent that renders this component — and the ordering
   * that makes the capture safe (see the listening effect) depends on the
   * controller re-registering its hotkey in response, which a fire-and-forget
   * event could not guarantee.
   */
  onRebindingChange: (rebinding: boolean) => void;
}) {
  const {
    prefs,
    setCloak,
    setPanicKey,
    setPanicScreen,
    setShake,
    setQuietNotifications,
  } = useStealth();
  const [listening, setListening] = useState(false);
  /** Why the last captured key was refused, shown under the panic-key control. */
  const [keyError, setKeyError] = useState<string | null>(null);
  // Only offer shake-to-panic where it can actually work — a touch device with a
  // motion sensor. Resolved after mount, deliberately: `deviceHasMotion` reads
  // `window`/`navigator`, so the post-hydration set is what keeps it off the
  // server render. Same pattern (and same lint exemption) as the device checks in
  // `Arcade`/`InstallPrompt`.
  const [canShake, setCanShake] = useState(false);
  const [shakeError, setShakeError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCanShake(deviceHasMotion());
  }, []);

  // Toggling ON must ask for motion permission from inside this click (iOS only
  // grants it during a user gesture); enable only if the grant lands. Toggling
  // OFF is unconditional.
  const toggleShake = useCallback(async () => {
    setShakeError(null);
    if (prefs.shake) {
      setShake(false);
      return;
    }
    const granted = await requestMotionPermission();
    if (granted) setShake(true);
    else
      setShakeError(
        "Motion access is blocked. Allow it in your browser or system settings, then try again.",
      );
  }, [prefs.shake, setShake]);

  /**
   * While "listening", the very next keypress becomes the panic key.
   *
   * TWO COLLISIONS WITH THE LIVE HOTKEY, both fixed here.
   *
   * 1. `StealthController` binds its panic hotkey on `window` with `capture:
   *    true` — the same target and the same phase as this listener. Pressing the
   *    CURRENT panic key while rebinding therefore ALSO fired the real thing, and
   *    the full-screen disguise went up over the settings modal the player was
   *    standing in. `stopImmediatePropagation` stops the press dead: nothing else
   *    on `window`, and nothing further down the tree, sees a keystroke that was
   *    only ever meant for this control. That only works because the controller
   *    re-registers its listener AFTER this one whenever `onRebindingChange`
   *    flips — listeners on one target run in registration order — and the
   *    controller ALSO stands down outright while rebinding, so the fix does not
   *    rest on that ordering alone.
   *
   * 2. Escape is refused. The controller reads Escape as "dismiss the disguise"
   *    before it reads it as a panic key, so a player who bound Escape got a key
   *    that could put the arcade back but could never hide it — a panic key that
   *    does not panic, and no way to tell from the UI. It is refused out loud
   *    rather than silently ignored, because a "press any key" prompt that
   *    swallows a key is indistinguishable from a broken one. The capture stops
   *    on the refusal, so a second Escape closes the modal as usual.
   */
  useEffect(() => {
    if (!open || !listening) return;
    onRebindingChange(true);
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      // Ignore modifier-only presses — wait for a real key to bind.
      if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
      if (e.key === "Escape") {
        setKeyError(
          "Escape can’t be the panic key — it always brings the arcade back. Pick another key.",
        );
        setListening(false);
        return;
      }
      setKeyError(null);
      setPanicKey(e.key);
      setListening(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      onRebindingChange(false);
    };
  }, [open, listening, setPanicKey, onRebindingChange]);

  // Reset any in-progress key capture — and the refusal it may have left on
  // screen — when the modal is dismissed. The listening effect is additionally
  // guarded on `open`, so a close that does NOT come through here (the parent
  // closing us to raise a panic-screen preview) still cannot leave a window-level
  // capture listener behind.
  const handleClose = useCallback(() => {
    setListening(false);
    setKeyError(null);
    onClose();
  }, [onClose]);

  /**
   * The scroll lock and the focus move — the two halves of the modal contract that
   * are about OPENING, and so are keyed on `open` and NOTHING else.
   *
   * That is deliberate and load-bearing. Every control in this panel writes
   * through to the store, which re-renders the controller above us, which is
   * enough to give any callback prop a fresh identity — and an effect that
   * re-ran on those would re-take the lock and yank focus back to the ✕ every
   * time the player picked a cloak. Escape lives in its own effect below, where
   * re-registering a listener costs nothing, precisely so this one can stay still.
   */
  useEffect(() => {
    if (!open) return;
    const releaseLock = acquireOverlayLock();

    // The ✕ rather than the first cloak swatch: it is the way out, and starting
    // there means a keyboard player can leave without walking the whole panel.
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    return () => {
      releaseLock();
      // Back to whatever opened this — the tab-bar button, the header menu item,
      // the promo's CTA — unless that element has since gone away with the promo
      // that owned it.
      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [open]);

  // Escape closes. Bound on `document` in the BUBBLE phase, which is what keeps it
  // out of the way of the two window-level capture listeners: the controller's
  // hotkey, and this component's own key capture, which swallows the press
  // entirely while it is listening — so the first Escape cancels a capture in
  // progress and only the next one closes the modal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, handleClose]);

  /**
   * Keep Tab inside the panel while it is open.
   *
   * The same hand-rolled trap as `FeaturePromo`, and the same reason for it: this
   * is not a native `<dialog>`, so nothing traps focus for free. Without it, Tab
   * walks straight out of an `aria-modal` panel into the arcade behind it — which
   * on this particular modal means tabbing onto game cards that a passer-by is not
   * supposed to be seeing.
   *
   * The disabled-button clause matters here in a way it does not in the promo: the
   * shake toggle can be absent and sections come and go with the device, so the
   * first and last focusable are computed per keystroke rather than cached.
   */
  const onKeyDownTrap = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !panelRef.current) return;
    const focusable = panelRef.current.querySelectorAll<HTMLElement>(
      "a[href], button:not([disabled])",
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Stealth settings"
    >
      <div className="absolute inset-0 bg-zinc-900/50 backdrop-blur-sm" onClick={handleClose} />

      <div
        ref={panelRef}
        onKeyDown={onKeyDownTrap}
        className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-6 shadow-2xl sm:rounded-3xl"
      >
        <div className="mb-1 flex items-center gap-2">
          <span className="text-xl">🕶️</span>
          <h2 className="text-xl font-black tracking-tight text-zinc-900">Stealth mode</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-full text-zinc-500 transition hover:bg-surface-2 hover:text-zinc-900"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <p className="mb-5 text-sm font-semibold text-muted">
          Disguise the tab and set up a panic key that hides the arcade in one press.
        </p>

        {/* Tab cloak */}
        <section className="mb-6">
          <h3 className="mb-2 text-[11px] font-black uppercase tracking-wider text-muted">
            Tab disguise
          </h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {CLOAK_LIST.map((cloak) => {
              const active = prefs.cloak === cloak.id;
              return (
                <button
                  key={cloak.id}
                  type="button"
                  onClick={() => setCloak(cloak.id)}
                  aria-pressed={active}
                  className={`flex items-center gap-2 rounded-xl border-2 px-3 py-2.5 text-left transition ${
                    active
                      ? "border-brand bg-brand-50"
                      : "border-border bg-white hover:border-brand-100"
                  }`}
                >
                  {cloak.favicon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={cloak.favicon} alt="" className="h-5 w-5 shrink-0" />
                  ) : (
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-brand text-[10px] font-black text-white">
                      H
                    </span>
                  )}
                  <span className="truncate text-[13px] font-bold text-zinc-900">
                    {cloak.label}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Panic key */}
        <section className="mb-6">
          <h3 className="mb-2 text-[11px] font-black uppercase tracking-wider text-muted">
            Panic key
          </h3>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setKeyError(null);
                setListening((v) => !v);
              }}
              className={`inline-flex min-h-11 items-center gap-2 rounded-full px-5 py-2.5 text-sm font-extrabold transition ${
                listening
                  ? "bg-accent-pink text-white"
                  : "bg-brand text-white hover:bg-brand-600"
              }`}
            >
              {listening ? "Press any key…" : "Change key"}
            </button>
            <span className="text-sm font-bold text-zinc-900">
              Current: <kbd className="rounded-md bg-surface-2 px-2 py-1 font-mono text-[13px]">{keyLabel(prefs.panicKey)}</kbd>
            </span>
          </div>
          {/* `role="alert"`: the refusal arrives in response to a keystroke the
              player made while looking at the button, not at this line. */}
          {keyError && (
            <p role="alert" className="mt-2 text-[13px] font-semibold text-accent-pink">
              {keyError}
            </p>
          )}
          <p className="mt-2 text-[13px] font-semibold text-muted">
            Press it anywhere on the site to instantly hide the arcade — press again to bring it back.
          </p>
        </section>

        {/* Shake to panic — phones & tablets, where there is no keyboard */}
        {canShake && (
          <section className="mb-6">
            <h3 className="mb-2 text-[11px] font-black uppercase tracking-wider text-muted">
              Shake to panic
            </h3>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={toggleShake}
                aria-pressed={prefs.shake}
                className={`inline-flex min-h-11 items-center gap-2 rounded-full border-2 px-5 py-2.5 text-sm font-extrabold transition ${
                  prefs.shake
                    ? "border-brand bg-brand text-white hover:bg-brand-600"
                    : "border-border bg-white text-zinc-700 hover:border-brand-100"
                }`}
              >
                <span aria-hidden>📳</span>
                {prefs.shake ? "On" : "Off"}
              </button>
              <span className="text-sm font-bold text-zinc-900">
                {prefs.shake
                  ? "Give your device a shake to hide the arcade."
                  : "No keyboard? Hide with a shake instead."}
              </span>
            </div>
            {shakeError && (
              <p className="mt-2 text-[13px] font-semibold text-accent-pink">{shakeError}</p>
            )}
            <p className="mt-2 text-[13px] font-semibold text-muted">
              Works even mid-game. Shake to hide; tap the bottom-right corner (or press your panic key) to bring it back.
            </p>
          </section>
        )}

        {/* Quiet notifications — the only setting here that is about what
            OTHER people see on your screen when you are not looking at it. */}
        <section className="mb-6">
          <h3 className="mb-2 text-[11px] font-black uppercase tracking-wider text-muted">
            Quiet notifications
          </h3>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setQuietNotifications(!prefs.quietNotifications)}
              aria-pressed={prefs.quietNotifications}
              className={`inline-flex min-h-11 items-center gap-2 rounded-full border-2 px-5 py-2.5 text-sm font-extrabold transition ${
                prefs.quietNotifications
                  ? "border-brand bg-brand text-white hover:bg-brand-600"
                  : "border-border bg-white text-zinc-700 hover:border-brand-100"
              }`}
            >
              <span aria-hidden>🔕</span>
              {prefs.quietNotifications ? "On" : "Off"}
            </button>
            <span className="text-sm font-bold text-zinc-900">
              {prefs.quietNotifications
                ? "Notifications just say “HallPass”."
                : "Notifications show who challenged you."}
            </span>
          </div>
          <p className="mt-2 text-[13px] font-semibold text-muted">
            Turn this on for a shared or school device: a challenge will show as
            “HallPass — you have a new challenge”, with no name and no game.
            This is per device, so your own phone can still show the details.
          </p>
        </section>

        {/* Panic screen */}
        <section>
          <h3 className="mb-2 text-[11px] font-black uppercase tracking-wider text-muted">
            Panic screen
          </h3>
          <div className="grid grid-cols-3 gap-2">
            {PANIC_SCREENS.map((screen) => {
              const active = prefs.panicScreen === screen.id;
              return (
                <button
                  key={screen.id}
                  type="button"
                  onClick={() => setPanicScreen(screen.id)}
                  aria-pressed={active}
                  className={`rounded-xl border-2 px-3 py-2.5 text-[13px] font-bold transition ${
                    active
                      ? "border-brand bg-brand-50 text-zinc-900"
                      : "border-border bg-white text-zinc-700 hover:border-brand-100"
                  }`}
                >
                  {screen.label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => {
              setListening(false);
              triggerPanic();
            }}
            className="mt-3 w-full rounded-xl border-2 border-dashed border-border py-2.5 text-[13px] font-extrabold text-zinc-700 transition hover:border-brand hover:text-brand"
          >
            Preview panic screen — press your key to return
          </button>
        </section>
      </div>
    </div>
  );
}
