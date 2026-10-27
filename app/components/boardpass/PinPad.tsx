"use client";

/**
 * Masked six-digit PIN entry: dots plus a 3×4 keypad, and the physical keyboard
 * when the pad has focus. There is deliberately NO `<input>` holding the PIN, so
 * the browser never offers to save it or autofill it, and it never sits in a
 * form field a screenshot or an extension could read. The parent owns the value
 * so it can clear it on minimize, close, failure and success.
 */

import { useRef } from "react";
import { copy } from "@/app/lib/boardpass/copy";

export const PIN_LENGTH = 6;

export function PinPad({
  value,
  onChange,
  onComplete,
  disabled = false,
  label = copy.pinLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Called once when the sixth digit is entered. */
  onComplete?: (pin: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  const root = useRef<HTMLDivElement>(null);

  function push(d: string) {
    if (disabled || value.length >= PIN_LENGTH) return;
    const next = value + d;
    onChange(next);
    if (next.length === PIN_LENGTH) onComplete?.(next);
  }
  const back = () => !disabled && onChange(value.slice(0, -1));

  function onKeyDown(e: React.KeyboardEvent) {
    if (/^[0-9]$/.test(e.key)) {
      e.preventDefault();
      push(e.key);
    } else if (e.key === "Backspace") {
      e.preventDefault();
      back();
    } else if (e.key === "Escape") {
      onChange("");
    }
  }

  const key =
    "h-14 min-w-14 rounded-xl border border-black/10 dark:border-white/15 bg-white dark:bg-neutral-800 text-xl font-semibold " +
    "hover:bg-neutral-100 dark:hover:bg-neutral-700 active:scale-95 disabled:opacity-50 touch-manipulation select-none";

  return (
    <div ref={root} tabIndex={0} onKeyDown={onKeyDown} role="group" aria-label={label}
      className="outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-xl p-1">
      <div className="flex justify-center gap-2 py-3" role="img" aria-label={copy.pinProgress(value.length)}>
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <span key={i} aria-hidden
            className={`h-3.5 w-3.5 rounded-full border border-neutral-400 ${i < value.length ? "bg-neutral-900 dark:bg-white" : ""}`} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button key={d} type="button" className={key} disabled={disabled} onClick={() => push(d)}>
            {d}
          </button>
        ))}
        <button type="button" className={key + " text-sm"} disabled={disabled} onClick={() => onChange("")}>
          {copy.clearPin}
        </button>
        <button type="button" className={key} disabled={disabled} onClick={() => push("0")}>0</button>
        <button type="button" className={key} disabled={disabled} onClick={back} aria-label={copy.backspace}>⌫</button>
      </div>
    </div>
  );
}
