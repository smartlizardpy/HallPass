"use client";

import { useEffect, useRef } from "react";
import { copy } from "@/app/lib/boardpass/copy";

/**
 * A modal dialog over a scrim. Focus moves in on open, Tab stays inside, Escape
 * and a tap on the scrim close it, and focus goes back to whatever opened it.
 */
export function Sheet({
  title,
  onClose,
  children,
  closeLabel = copy.cancel,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Pass `null` to omit the footer close button when the body supplies its own. */
  closeLabel?: string | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const focusables = () =>
      [...(box.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])') ?? [])];
    (focusables()[0] ?? box.current)?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
      } else if (e.key === "Tab") {
        const items = focusables();
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      before?.focus?.();
    };
  }, []);

  return (
    <div className="bp-scrim" onClick={onClose}>
      <div ref={box} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className="bp-sheet" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
        {closeLabel && (
          <div className="mt-6">
            <button type="button" className="bp-btn" onClick={onClose}>{closeLabel}</button>
          </div>
        )}
      </div>
    </div>
  );
}
