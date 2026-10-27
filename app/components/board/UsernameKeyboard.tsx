"use client";

/**
 * The on-screen keyboard: a SEPARATE floating panel (not part of a sign-in
 * window), docked bottom-centre until it is moved. It edits one text value — a
 * sign-in window's username, or the library search — and never the PIN, which has
 * its own pad and is never held as text.
 *
 * Tapping a key must not steal focus from the field being edited, so the key rows
 * swallow `mousedown` (touch taps synthesise one too). Drag by the title bar, or
 * use the arrow keys on it; Dock puts it back; Done/Close hides it.
 */

import { useRef } from "react";
import { copy } from "@/app/lib/boardpass/copy";
import { applyKey, BACKSPACE, CLEAR, maxLength, rowsFor, type KeyboardMode } from "./keyboard-keys";
import { useFloatingDrag } from "./useFloatingDrag";

const FALLBACK = { w: 900, h: 420 };
const KEY_LABELS: Record<string, string> = { _: "underscore", "-": "hyphen" };

export function UsernameKeyboard({
  mode,
  value,
  onChange,
  onClose,
}: {
  mode: KeyboardMode;
  value: string;
  onChange: (next: string) => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const { pos, setPos, handle } = useFloatingDrag(box, () => null, FALLBACK);
  const rows = rowsFor(mode);
  const full = value.length >= maxLength(mode);
  const press = (k: string) => onChange(applyKey(value, k, mode));

  const placed = pos
    ? { left: pos.x, top: pos.y, width: "min(900px, calc(100vw - 32px))" }
    : { left: "50%", bottom: 16, transform: "translateX(-50%)", width: "min(900px, calc(100vw - 32px))" };

  return (
    <div ref={box} role="dialog" aria-label={copy.keyboardTitle} className="bp-kbd" style={placed}>
      <div
        tabIndex={0}
        role="toolbar"
        aria-label={`${copy.dragHandle}. ${copy.moveWindowHint}`}
        className="bp-titlebar"
        {...handle}
      >
        <span className="text-lg font-black">⠿ {mode === "username" ? copy.keyboardForUsername : copy.keyboardForSearch}</span>
        <span className="flex gap-2">
          <button type="button" className="bp-btn bp-btn-ghost bp-icon" onClick={() => setPos(null)}>{copy.keyboardDock}</button>
          <button type="button" className="bp-btn bp-btn-ghost bp-icon" onClick={onClose} aria-label={copy.hideKeyboard}>✕</button>
        </span>
      </div>

      <div className="px-4 pt-3" onMouseDown={(e) => e.preventDefault()}>
        <div
          className="mb-3 flex min-h-14 items-center rounded-2xl px-4 text-2xl font-black tracking-wide"
          style={{ background: "var(--bp-bg)", border: "1px solid var(--bp-line)", color: value ? "var(--bp-text)" : "var(--bp-muted)" }}
          aria-live="polite"
        >
          {value || <span className="text-lg font-semibold">{copy.keyboardEmpty}</span>}
          <span className="ml-auto text-base font-bold" style={{ color: "var(--bp-muted)" }}>{value.length}/{maxLength(mode)}</span>
        </div>

        <div className="flex flex-col gap-2">
          {rows.map((row, i) => (
            <div key={i} className="grid gap-2" style={{ gridTemplateColumns: "repeat(10, minmax(0, 1fr))" }}>
              {row.map((k) => (
                <button key={k} type="button" className="bp-key" disabled={full} onClick={() => press(k)} aria-label={KEY_LABELS[k] ?? k}>
                  {k}
                </button>
              ))}
              {i === rows.length - 1 && (
                <button type="button" className="bp-key bp-key-sm" style={{ gridColumn: `span ${10 - row.length}` }} onClick={() => press(BACKSPACE)} aria-label={copy.keyboardDelete}>
                  ⌫
                </button>
              )}
            </div>
          ))}
          <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(10, minmax(0, 1fr))" }}>
            <button type="button" className="bp-key bp-key-sm" style={{ gridColumn: "span 3" }} onClick={() => press(CLEAR)}>{copy.keyboardClear}</button>
            {mode === "search" ? (
              <button type="button" className="bp-key bp-key-sm" style={{ gridColumn: "span 4" }} disabled={full} onClick={() => press(" ")}>{copy.keyboardSpace}</button>
            ) : (
              <span className="flex items-center justify-center text-sm font-semibold" style={{ gridColumn: "span 4", color: "var(--bp-muted)" }}>{copy.keyboardCapHint}</span>
            )}
            <button type="button" className="bp-key bp-key-sm" style={{ gridColumn: "span 3", background: "var(--bp-brand)" }} onClick={onClose}>{copy.keyboardDone}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
