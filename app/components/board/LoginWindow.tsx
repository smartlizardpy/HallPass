"use client";

/**
 * One floating BoardPass login window: draggable by its title bar, so several
 * students can sign in side by side on a big screen.
 *
 * SECURITY SHAPE. These windows exist only in the lobby; `BoardMode` unmounts
 * every one before a game frame mounts, so a game can never share a screen with
 * PIN entry. The PIN lives in this component's state only — never in an input
 * element, a URL, storage or a ref that outlives the window — and is cleared on
 * every submit, minimize, close, tab-hide and unmount.
 *
 * The username is NOT secret and is held by the parent (`BoardMode`) so the
 * separate on-screen keyboard panel can edit it. The keyboard never sees the PIN.
 */

import { useEffect, useRef, useState } from "react";
import { PinPad, PIN_LENGTH } from "@/app/components/boardpass/PinPad";
import { copy } from "@/app/lib/boardpass/copy";
import type { LoginResult } from "./board-client";
import { startPosition, type Size } from "./drag-math";
import { useFloatingDrag } from "./useFloatingDrag";

const FALLBACK: Size = { w: 380, h: 640 };

const MESSAGES: Record<string, string> = {
  invalid: copy.loginFailed,
  throttled: copy.loginThrottled,
  duplicate: copy.alreadyPlaying,
  full: copy.boardFull,
  "google-session": copy.googleSession,
  unavailable: copy.unavailable,
  network: copy.reconnecting,
};

export function LoginWindow({
  index,
  z,
  username,
  onUsername,
  keyboardOpen,
  onKeyboard,
  onFocus,
  onSubmit,
  onDone,
  onClose,
}: {
  index: number;
  z: number;
  username: string;
  onUsername: (next: string) => void;
  /** Whether the on-screen keyboard panel is currently editing THIS window. */
  keyboardOpen: boolean;
  onKeyboard: (open: boolean) => void;
  onFocus: () => void;
  onSubmit: (username: string, pin: string) => Promise<LoginResult>;
  /** Signed in: the parent closes this window. */
  onDone: () => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  // Windows only ever mount after hydration (opened by a tap or an effect), so
  // reading the viewport during the first render is safe.
  const { pos, setPos, handle, sizes } = useFloatingDrag(
    box,
    () => (typeof window === "undefined" ? null : startPosition(index, FALLBACK, { w: window.innerWidth, h: window.innerHeight })),
    FALLBACK,
    onFocus,
  );
  const [minimized, setMinimized] = useState(false);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // A hidden tab never keeps a half-typed PIN.
  useEffect(() => {
    const hide = () => document.visibilityState === "hidden" && setPin("");
    document.addEventListener("visibilitychange", hide);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      setPin("");
    };
  }, []);

  function reset() {
    const { win, view } = sizes();
    setPos(startPosition(index, win, view));
  }

  async function submit(code: string) {
    if (busy) return;
    const name = username.trim();
    if (!name) {
      // Keep the digits (they are state only) so typing the name completes sign-in.
      setMessage(copy.usernameFirst);
      return;
    }
    setPin("");
    setBusy(true);
    setMessage(null);
    const result = await onSubmit(name, code);
    setBusy(false);
    if (result.ok) {
      onDone();
    } else {
      setMessage(MESSAGES[result.error] ?? copy.loginFailed);
    }
  }

  function minimize() {
    setPin("");
    onKeyboard(false);
    setMinimized(true);
  }

  const place = pos ?? { x: -9999, y: 0 };

  if (minimized) {
    return (
      <button type="button" className="bp-btn bp-btn-primary fixed" style={{ left: place.x, top: place.y, zIndex: z }} onClick={() => setMinimized(false)}>
        {copy.restore}
      </button>
    );
  }

  return (
    <div
      ref={box}
      role="dialog"
      aria-label={copy.loginTitle}
      onPointerDown={onFocus}
      className="bp-window"
      style={{ left: place.x, top: place.y, zIndex: z, width: "min(380px, calc(100vw - 16px))" }}
    >
      <div tabIndex={0} role="toolbar" aria-label={`${copy.dragHandle}. ${copy.moveWindowHint}`} className="bp-titlebar" {...handle}>
        <span className="whitespace-nowrap text-lg font-black">⠿ {copy.brand}</span>
        <span className="flex gap-1">
          <button type="button" onClick={reset} className="bp-btn bp-btn-ghost bp-icon" aria-label={copy.resetPosition} title={copy.resetPosition}>⟲</button>
          <button type="button" onClick={minimize} aria-label={copy.minimize} className="bp-btn bp-btn-ghost bp-icon">–</button>
          <button type="button" onClick={onClose} aria-label={copy.close} className="bp-btn bp-btn-ghost bp-icon">✕</button>
        </span>
      </div>
      <form
        className="space-y-3 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (pin.length === PIN_LENGTH) void submit(pin);
        }}
      >
        <h2 className="text-center text-2xl font-black">{copy.loginTitle}</h2>
        <div>
          <label className="mb-1 flex items-center justify-between text-base font-bold" htmlFor={`bp-user-${index}`}>
            {copy.usernameLabel}
            <button type="button" className="bp-btn bp-icon" style={{ minHeight: 44, padding: "0 14px", fontSize: 16 }} aria-pressed={keyboardOpen} onClick={() => onKeyboard(!keyboardOpen)}>
              ⌨ {copy.showKeyboard}
            </button>
          </label>
          <input
            id={`bp-user-${index}`}
            name="boardpass-username"
            className="bp-field"
            value={username}
            onChange={(e) => onUsername(e.target.value.slice(0, 32))}
            onPointerDown={(e) => {
              // Touch or pen on the field opens our keyboard; a mouse user has a
              // physical keyboard and can open the panel from the button.
              if (e.pointerType !== "mouse") onKeyboard(true);
            }}
            inputMode={keyboardOpen ? "none" : undefined}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={32}
            disabled={busy}
            placeholder={copy.usernameHint}
          />
        </div>
        <PinPad variant="board" value={pin} onChange={setPin} onComplete={(p) => void submit(p)} disabled={busy} />
        {message && (
          <p role="alert" className="text-center text-base font-bold" style={{ color: "var(--bp-danger)" }}>
            {message}
          </p>
        )}
        <button type="submit" className="bp-btn bp-btn-primary bp-btn-lg w-full" disabled={busy || pin.length !== PIN_LENGTH || !username.trim()}>
          {busy ? copy.joining : copy.join}
        </button>
      </form>
    </div>
  );
}
