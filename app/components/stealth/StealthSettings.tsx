"use client";

/**
 * HallPass — the stealth-mode SETTINGS modal.
 *
 * Lets a player choose their tab disguise, rebind the panic key, and pick which
 * fake screen the panic key raises. Every control writes straight through
 * {@link useStealth} to localStorage, so changes take effect live — the cloak
 * re-applies and the controller re-binds the moment a value changes, with no save
 * button. Pure client UI; it renders only when `open`.
 */

import { useCallback, useEffect, useState } from "react";
import { CLOAK_LIST } from "../../lib/stealth/cloaks";
import { PANIC_SCREENS } from "../../lib/stealth/config";
import { triggerPanic, useStealth } from "../../lib/stealth/store";

/** Turn a raw `KeyboardEvent.key` into something readable in the UI. */
function keyLabel(key: string): string {
  if (key === " ") return "Space";
  if (key === "`") return "Backtick ( ` )";
  if (key.length === 1) return key.toUpperCase();
  return key; // Escape, F2, ArrowUp, …
}

export function StealthSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { prefs, setCloak, setPanicKey, setPanicScreen } = useStealth();
  const [listening, setListening] = useState(false);

  // While "listening", the very next keypress becomes the panic key.
  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      // Ignore modifier-only presses — wait for a real key to bind.
      if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
      setPanicKey(e.key);
      setListening(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [listening, setPanicKey]);

  // Reset any in-progress key capture when the modal is dismissed. This is the
  // only close path (backdrop, ✕, or the parent), so no separate effect is needed
  // to clear `listening` when `open` flips false.
  const handleClose = useCallback(() => {
    setListening(false);
    onClose();
  }, [onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Stealth settings"
    >
      <div className="absolute inset-0 bg-zinc-900/50 backdrop-blur-sm" onClick={handleClose} />

      <div className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-6 shadow-2xl sm:rounded-3xl">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-xl">🕶️</span>
          <h2 className="text-xl font-black tracking-tight text-zinc-900">Stealth mode</h2>
          <button
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
              onClick={() => setListening((v) => !v)}
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
          <p className="mt-2 text-[13px] font-semibold text-muted">
            Press it anywhere on the site to instantly hide the arcade — press again to bring it back.
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
