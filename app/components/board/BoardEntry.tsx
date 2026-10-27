"use client";

import Link from "next/link";
import { copy } from "@/app/lib/boardpass/copy";
import { useBoard } from "./BoardProvider";

/**
 * The header button that opens Board Mode. Renders nothing on a page without the
 * board, when BoardPass is off, or for a Google-signed-in visitor, so for almost
 * everyone the header is exactly what it was.
 */
export function BoardEntry() {
  const board = useBoard();
  if (!board || !board.available) return null;
  return (
    <button
      type="button"
      onClick={board.openPanel}
      aria-expanded={board.visible}
      className="flex h-11 flex-none items-center gap-2 whitespace-nowrap rounded-full bg-surface-2 px-4 text-[15px] font-extrabold text-foreground-2 transition hover:bg-brand-50 hover:text-brand"
    >
      <span aria-hidden>▦</span>
      <span className="hidden sm:inline">{copy.boardMode}</span>
      <span className="sr-only sm:hidden">{copy.boardMode}</span>
    </button>
  );
}

const PILL =
  "flex h-11 items-center gap-2 rounded-full bg-brand px-4 text-sm font-extrabold text-white shadow-lg shadow-brand/30 transition hover:bg-brand-600";

/**
 * The account menu's stand-in on a browser that is a board ("Board Mode · name").
 * Where the board is mounted it brings the panel up; on every other page it is a
 * link to the homepage, which opens the panel on arrival.
 */
export function BoardPill({ label }: { label: string }) {
  const board = useBoard();
  if (board?.available) {
    return (
      <button type="button" onClick={board.openPanel} className={PILL}>
        {label}
      </button>
    );
  }
  return (
    <Link href="/?board=1" className={PILL}>
      {label}
    </Link>
  );
}
