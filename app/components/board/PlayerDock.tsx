"use client";

import { useEffect, useRef, useState } from "react";
import { copy } from "@/app/lib/boardpass/copy";
import type { RosterEntry } from "@/app/lib/boardpass/sessions";

const MENU_WIDTH = 300;
const ARM_MS = 4000;

/**
 * The signed-in players as large avatar buttons. Removing someone is an explicit
 * two-step: tap the player → a menu → "Remove" turns into "Tap again to remove",
 * so an ordinary tap can never sign a student out. The menu is a proper
 * `role="menu"` (arrow keys, Escape, focus returns to the player button); it is
 * positioned `fixed` from the button's rect so the dock's horizontal scrolling
 * cannot clip it.
 */
export function PlayerDock({
  roster,
  loading,
  newestId,
  onRemove,
}: {
  roster: RosterEntry[];
  loading: boolean;
  newestId: string | null;
  onRemove: (id: string) => void;
}) {
  const [open, setOpen] = useState<{ id: string; x: number; y: number } | null>(null);
  const [armed, setArmed] = useState(false);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const menu = useRef<HTMLDivElement>(null);

  // A player removed elsewhere (another tab) closes their menu with them.
  const active = open && roster.some((p) => p.id === open.id) ? open : null;
  const player = active ? roster.find((p) => p.id === active.id)! : null;

  function close(returnFocus: boolean) {
    const id = open?.id;
    setOpen(null);
    setArmed(false);
    if (returnFocus && id) buttons.current.get(id)?.focus();
  }

  function toggle(p: RosterEntry, el: HTMLButtonElement) {
    if (open?.id === p.id) return close(true);
    const r = el.getBoundingClientRect();
    const x = Math.max(8, Math.min(r.left, window.innerWidth - MENU_WIDTH - 8));
    setArmed(false);
    setOpen({ id: p.id, x, y: r.bottom + 8 });
  }

  // Focus the first item when it opens; close on outside tap or Escape.
  useEffect(() => {
    if (!active) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menu.current?.contains(t)) return;
      if ([...buttons.current.values()].some((b) => b.contains(t))) return;
      setOpen(null);
      setArmed(false);
    };
    document.addEventListener("pointerdown", down);
    return () => document.removeEventListener("pointerdown", down);
  }, [active?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // The armed state expires, so a stray second tap much later is just a first tap.
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), ARM_MS);
    return () => clearTimeout(t);
  }, [armed]);

  function onMenuKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      return close(true);
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
  }

  if (roster.length === 0) {
    if (loading) return <div className="flex-1" />;
    return <p className="flex-1 px-2 text-lg font-semibold" style={{ color: "var(--bp-muted)" }}>{copy.noPlayers}</p>;
  }

  return (
    <>
      <ul className="bp-dock" aria-label={copy.playersLabel}>
        {roster.map((p) => (
          <li key={p.id} className="flex-none">
            <button
              type="button"
              ref={(el) => {
                if (el) buttons.current.set(p.id, el);
                else buttons.current.delete(p.id);
              }}
              className={`bp-player${p.id === newestId ? " bp-player-new" : ""}`}
              aria-haspopup="menu"
              aria-expanded={active?.id === p.id}
              aria-label={copy.playerOptions(p.name)}
              onClick={(e) => toggle(p, e.currentTarget)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.image} alt="" width={54} height={54} />
              <span>{p.name}</span>
            </button>
          </li>
        ))}
      </ul>
      {active && player && (
        <div ref={menu} role="menu" aria-label={copy.playerOptions(player.name)} className="bp-menu" style={{ left: active.x, top: active.y, width: MENU_WIDTH }} onKeyDown={onMenuKey}>
          <button
            type="button"
            role="menuitem"
            data-danger="true"
            data-armed={armed}
            onClick={() => {
              if (!armed) return setArmed(true);
              const id = player.id;
              close(false);
              onRemove(id);
            }}
          >
            {armed ? copy.confirmRemove(player.name) : copy.removeFromBoard(player.name)}
          </button>
          <button type="button" role="menuitem" onClick={() => close(true)}>
            {copy.cancel}
          </button>
        </div>
      )}
    </>
  );
}
