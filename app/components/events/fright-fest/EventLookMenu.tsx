"use client";

/**
 * Fright Fest — the event look menu and its shared fields.
 *
 * WHY THIS KEYS ON `data-hp-event`, NOT `data-hp-skin`: a player who chose
 * "Normal HallPass" has the event window open but no skin painted, and still
 * needs a way back. So `ThemeMenuButton` renders its ordinary cycle button AND
 * this menu from the same slot, and `sidebar.css` swaps them on
 * `html[data-hp-event]`. The server never reads the clock, so the prerendered
 * markup is identical for everyone.
 *
 * This component never writes an html attribute: it only calls the look store,
 * and `EventController` applies the attributes.
 *
 * The three looks are native radios, so arrow keys and screen readers work with
 * no custom code. Escape closes and returns focus to the trigger.
 */

import { FRIGHT_FEST_THEME } from "../../../lib/events/fright-fest";
import { eventDateLabels } from "../../../lib/events/labels";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useEventLook } from "@/app/lib/events/look-store";
import { useTheme } from "@/app/lib/theme/store";
import type { EventLook } from "@/app/lib/events/types";

export const EVENT_LOOKS: readonly { id: EventLook; label: string; hint: string }[] = [
  { id: "dark", label: "Haunted Dark", hint: "The event default" },
  { id: "light", label: "Haunted Light", hint: "Dusk instead of midnight" },
  { id: "normal", label: "Normal HallPass", hint: "Turns the seasonal look off" },
];

const NOTE = `Saved for this event only. Your usual theme is untouched and comes back on ${eventDateLabels(FRIGHT_FEST_THEME).restoreShort}.`;

/** The look that is actually in effect when nothing has been chosen yet. */
function useEffectiveLook(): EventLook {
  const { look } = useEventLook();
  const { choice } = useTheme();
  return look ?? (choice === "light" ? "light" : "dark");
}

const ringChecked =
  "has-[:checked]:bg-surface-2 has-[:checked]:shadow-[inset_0_0_0_2px_var(--ha-focus,var(--brand))]";

/** Radios + Still mode + note. Used by the sidebar menu and the Settings card. */
export function EventLookFields({ legend }: { legend?: string }) {
  const name = useId();
  const { still, setLook, setStill } = useEventLook();
  const current = useEffectiveLook();
  return (
    <>
      <fieldset className="flex flex-col gap-0.5 border-0 p-0">
        <legend className="px-2 pb-1 text-xs font-extrabold text-muted">
          {legend ?? "Fright Fest look"}
        </legend>
        {EVENT_LOOKS.map((o) => (
          <label
            key={o.id}
            className={`grid cursor-pointer grid-cols-[18px_1fr] items-start gap-x-2.5 rounded-[10px] p-2 text-sm font-extrabold text-foreground hover:bg-surface-2 ${ringChecked}`}
          >
            <input
              type="radio"
              name={name}
              value={o.id}
              checked={current === o.id}
              onChange={() => setLook(o.id)}
              className="mt-0.5 h-4 w-4 accent-[var(--brand)]"
            />
            {o.label}
            <small className="col-start-2 text-xs font-semibold text-muted">{o.hint}</small>
          </label>
        ))}
      </fieldset>
      <div className="mt-1.5 border-t border-border pt-2.5">
        <label
          className={`grid cursor-pointer grid-cols-[18px_1fr] items-start gap-x-2.5 rounded-[10px] p-2 text-sm font-extrabold text-foreground hover:bg-surface-2`}
        >
          <input
            type="checkbox"
            checked={still}
            onChange={(e) => setStill(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[var(--brand)]"
          />
          Still mode
          <small className="col-start-2 text-xs font-semibold text-muted">
            Keeps the decorations, stops the bats and ghosts moving. Good for class.
          </small>
        </label>
      </div>
      <p className="px-2 pb-0.5 pt-1.5 text-xs font-semibold leading-snug text-muted">{NOTE}</p>
    </>
  );
}

/** The sidebar-foot trigger plus its popover. Hidden unless html[data-hp-event]. */
export function EventLookMenu() {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const current = useEffectiveLook();
  const label = EVENT_LOOKS.find((o) => o.id === current)?.label ?? "Haunted Dark";

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  }, []);

  const openMenu = () => {
    const r = trigger.current?.getBoundingClientRect();
    if (r) {
      const W = 264;
      // The desktop rail grows to 192px while the pointer or focus is in it, so
      // anchor to that width rather than the 64px strip the button sits in now.
      const rail = trigger.current?.closest(".ha-rail")?.getBoundingClientRect();
      const right = rail ? Math.max(r.right, rail.left + 192) : r.right;
      const beside = right + 8 + W <= window.innerWidth - 8;
      setPos({
        left: beside ? right + 8 : Math.max(8, Math.min(r.left, window.innerWidth - W - 8)),
        bottom: beside ? Math.max(8, window.innerHeight - r.bottom - 6) : window.innerHeight - r.top + 8,
      });
    }
    setOpen(true);
  };

  // Focus the checked radio on open; close on an outside press.
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLInputElement>("input:checked")?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !trigger.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="ha-event-menu ha-deco">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        title={`Look: ${label}`}
        onClick={() => (open ? close(true) : openMenu())}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
            e.preventDefault();
            openMenu();
          }
        }}
        className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-extrabold text-foreground-2 transition hover:bg-brand-50 hover:text-brand"
      >
        <span aria-hidden className="text-base">
          🎃
        </span>
        Look · {label}
      </button>
      {open && (
        <div
          ref={panel}
          id={id}
          role="dialog"
          aria-label="Appearance"
          style={pos ? { left: pos.left, bottom: pos.bottom } : undefined}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              close(true);
            }
          }}
          onBlur={(e) => {
            const to = e.relatedTarget as Node | null;
            if (to && !e.currentTarget.contains(to) && to !== trigger.current) setOpen(false);
          }}
          className="fixed z-[120] flex w-[264px] flex-col gap-0.5 rounded-2xl border border-border bg-surface p-2.5 text-left text-sm font-normal text-foreground shadow-[0_20px_40px_-12px_rgba(0,0,0,0.45)]"
        >
          <h2 className="px-2 pb-1.5 pt-1 text-[15px] font-black">Appearance</h2>
          <EventLookFields />
        </div>
      )}
    </div>
  );
}
