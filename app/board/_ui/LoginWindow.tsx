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
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { PinPad } from "@/app/components/boardpass/PinPad";
import { copy } from "@/app/lib/boardpass/copy";
import type { LoginResult } from "./board-client";
import { clampPosition, nudge, startPosition, type Point, type Size } from "./drag-math";

const FALLBACK: Size = { w: 340, h: 540 };

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
  onFocus,
  onSubmit,
  onDone,
  onClose,
}: {
  index: number;
  z: number;
  onFocus: () => void;
  onSubmit: (username: string, pin: string) => Promise<LoginResult>;
  /** Signed in: the parent closes this window. */
  onDone: () => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  // Windows only ever mount after the page has hydrated (they are opened by a tap
  // or by an effect), so reading the viewport during the first render is safe.
  const [pos, setPos] = useState<Point | null>(() =>
    typeof window === "undefined"
      ? null
      : startPosition(index, FALLBACK, { w: window.innerWidth, h: window.innerHeight }),
  );
  const [minimized, setMinimized] = useState(false);
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  const sizes = useCallback((): { win: Size; view: Size } => {
    const el = box.current;
    return {
      win: el ? { w: el.offsetWidth, h: el.offsetHeight } : FALLBACK,
      view: { w: window.innerWidth, h: window.innerHeight },
    };
  }, []);

  // Keep it on screen if the viewport changes.
  useEffect(() => {
    const onResize = () => {
      const s = sizes();
      setPos((p) => (p ? clampPosition(p, s.win, s.view) : p));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [sizes]);

  // A hidden tab never keeps a half-typed PIN.
  useEffect(() => {
    const hide = () => document.visibilityState === "hidden" && setPin("");
    document.addEventListener("visibilitychange", hide);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      setPin("");
    };
  }, []);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest("button")) return;
    onFocus();
    if (!pos) return;
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    const { win, view } = sizes();
    setPos(clampPosition({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy }, win, view));
  }
  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }
  function onTitleKey(e: React.KeyboardEvent) {
    if (!pos) return;
    const next = nudge(pos, e.key);
    if (!next) return;
    e.preventDefault();
    const { win, view } = sizes();
    setPos(clampPosition(next, win, view));
  }
  function reset() {
    const { win, view } = sizes();
    setPos(startPosition(index, win, view));
  }

  async function submit(code: string) {
    if (busy) return;
    const name = username.trim();
    setPin("");
    if (!name) {
      setMessage(copy.loginFailed);
      return;
    }
    setBusy(true);
    setMessage(null);
    const result = await onSubmit(name, code);
    setBusy(false);
    if (result.ok) {
      setUsername("");
      onDone();
    } else {
      setMessage(MESSAGES[result.error] ?? copy.loginFailed);
    }
  }

  function minimize() {
    setPin("");
    setMinimized(true);
  }

  const place = pos ?? { x: -9999, y: 0 };
  const chrome = "fixed rounded-2xl border border-black/10 dark:border-white/15 bg-white dark:bg-neutral-900 shadow-2xl";

  if (minimized) {
    return (
      <button type="button" style={{ left: place.x, top: place.y, zIndex: z }} onClick={() => setMinimized(false)}
        className={`${chrome} px-4 py-3 text-sm font-semibold`}>
        {copy.restore}
      </button>
    );
  }

  return (
    <div ref={box} role="dialog" aria-label={copy.loginTitle} onPointerDown={onFocus}
      style={{ left: place.x, top: place.y, zIndex: z, width: "min(340px, calc(100vw - 16px))", touchAction: "none" }}
      className={chrome}>
      <div
        tabIndex={0}
        role="toolbar"
        aria-label={`${copy.dragHandle}. ${copy.moveWindowHint}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onTitleKey}
        className="flex cursor-grab items-center justify-between gap-2 rounded-t-2xl bg-neutral-100 dark:bg-neutral-800 px-4 py-3 active:cursor-grabbing select-none"
        style={{ touchAction: "none" }}
      >
        <span className="text-sm font-bold">⠿ {copy.brand}</span>
        <span className="flex gap-1">
          <button type="button" onClick={reset} className="h-9 rounded-lg px-2 text-xs hover:bg-black/10 dark:hover:bg-white/10">{copy.resetPosition}</button>
          <button type="button" onClick={minimize} aria-label={copy.minimize} className="h-9 w-9 rounded-lg hover:bg-black/10 dark:hover:bg-white/10">–</button>
          <button type="button" onClick={onClose} aria-label={copy.close} className="h-9 w-9 rounded-lg hover:bg-black/10 dark:hover:bg-white/10">✕</button>
        </span>
      </div>
      <form className="space-y-2 p-4" onSubmit={(e) => { e.preventDefault(); if (pin.length === 6) void submit(pin); }}>
        <h2 className="text-center text-lg font-bold">{copy.loginTitle}</h2>
        <label className="block text-sm font-medium" htmlFor={`bp-user-${index}`}>{copy.usernameLabel}</label>
        <input
          id={`bp-user-${index}`}
          name="boardpass-username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={32}
          disabled={busy}
          className="w-full rounded-lg border border-black/15 dark:border-white/20 bg-transparent px-3 py-3 text-base"
        />
        <PinPad value={pin} onChange={setPin} onComplete={(p) => void submit(p)} disabled={busy} />
        {message && <p role="alert" className="text-center text-sm text-red-700 dark:text-red-300">{message}</p>}
        <p className="text-center text-xs text-neutral-500">{busy ? copy.joining : copy.loginSubtitle}</p>
      </form>
    </div>
  );
}
