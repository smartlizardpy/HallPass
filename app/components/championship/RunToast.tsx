"use client";

/**
 * Tells a player what happened to a ranked championship run, over the game.
 *
 * Games are free to ignore `submitScore`'s answer (Last Bell does), so the SDK
 * (1.5.0) also posts a `hallpass:championship` message to the HallPass page
 * hosting the game. This listens for it and puts it into words: "Entered: 3rd",
 * "Held for review", "Sign in to be ranked". Without it a signed-out player
 * would finish a run believing it counted.
 *
 * TRUST. Only a message from THIS overlay's own game frame, on HallPass's own
 * origin, is read, and only its known fields, as text. It is a notice, never a
 * source of truth: the standings come from the server.
 *
 * One notice at a time, `role="status"` (polite), auto-dismissed after 8 s, with
 * a close button. "Could not start a ranked run" is shown once per board per
 * game session, not on every retry.
 */

import { useEffect, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { ordinal } from "@/app/lib/championship/format";
import { forgetChampionship } from "./data";

type Signal = {
  type: "hallpass:championship";
  phase: "start" | "submit";
  ok: boolean;
  board: string;
  championship?: string;
  status?: "accepted" | "flagged";
  rank?: number;
  best?: boolean;
  late?: boolean;
  reason?: string;
  detail?: string;
};

type Notice = { text: string; signIn?: boolean; tone: "good" | "info" | "warn" };

const MAX_DETAIL = 160;

/** The known fields only, type-checked. Anything else is not a signal. */
export function readSignal(data: unknown): Signal | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.type !== "hallpass:championship" || (d.phase !== "start" && d.phase !== "submit") || typeof d.ok !== "boolean") return null;
  if (typeof d.board !== "string" || d.board.length > 64) return null;
  const str = (v: unknown, max = 64) => (typeof v === "string" && v.length > 0 ? v.slice(0, max) : undefined);
  return {
    type: "hallpass:championship",
    phase: d.phase,
    ok: d.ok,
    board: d.board,
    championship: str(d.championship),
    status: d.status === "accepted" || d.status === "flagged" ? d.status : undefined,
    rank: typeof d.rank === "number" && Number.isInteger(d.rank) && d.rank > 0 && d.rank < 1e6 ? d.rank : undefined,
    best: typeof d.best === "boolean" ? d.best : undefined,
    late: typeof d.late === "boolean" ? d.late : undefined,
    reason: str(d.reason),
    detail: str(d.detail, MAX_DETAIL),
  };
}

/** The words for a signal, or null for one that needs no notice. */
export function noticeFor(s: Signal): Notice | null {
  if (s.ok && s.phase === "start") return null;
  if (s.ok) {
    if (s.status === "flagged") return { tone: "info", text: "Fright Fest: run received. A person checks it before it counts." };
    if (s.best === false) {
      return { tone: "info", text: `Fright Fest: run counted. Your best run still stands${s.rank ? ` (you're ${ordinal(s.rank)})` : ""}.` };
    }
    return { tone: "good", text: s.rank ? `Fright Fest: you're ${ordinal(s.rank)} on the board!` : "Fright Fest: run counted." };
  }
  const where = s.phase === "start" ? "This run won't be ranked" : "This run wasn't ranked";
  switch (s.reason) {
    case "signed-out":
      return { tone: "warn", signIn: true, text: `Sign in to enter Fright Fest. ${where}, but you can keep playing.` };
    case "closed":
      return { tone: "warn", text: s.detail ?? "Fright Fest isn't taking ranked runs right now." };
    case "expired":
    case "no-run":
      return { tone: "warn", text: `${where}: it ran too long, or started before you signed in. Start a new run to enter.` };
    case "rejected":
      return { tone: "warn", text: `${where}${s.detail ? `: ${s.detail}` : "."}` };
    case "rate-limited":
      return { tone: "warn", text: `${where}: too many runs too quickly. Take a breather and try again.` };
    default:
      return { tone: "warn", text: `${where}: Fright Fest is having trouble. Your game is fine.` };
  }
}

const TONE = {
  good: "border-emerald-400 bg-emerald-950/90 text-emerald-50",
  info: "border-white/20 bg-zinc-900/95 text-white",
  warn: "border-amber-400 bg-zinc-900/95 text-amber-50",
} as const;

export function ChampionshipRunToast({ frameWrap, gameKey }: { frameWrap: RefObject<HTMLElement | null>; gameKey: string }) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const startsShown = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // A new game is a new session: its start notices may show again.
    startsShown.current = new Set();
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const frame = frameWrap.current?.querySelector("iframe");
      if (!frame || e.source !== frame.contentWindow) return;
      const signal = readSignal(e.data);
      if (!signal) return;
      if (signal.phase === "start") {
        const key = `${signal.board}:${signal.reason ?? ""}`;
        if (startsShown.current.has(key)) return;
        startsShown.current.add(key);
      } else if (signal.championship) {
        forgetChampionship(signal.championship);
      }
      const next = noticeFor(signal);
      if (!next) return;
      setNotice(next);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setNotice(null), 8000);
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [frameWrap, gameKey]);

  return (
    <div role="status" aria-live="polite" className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center px-3">
      {notice && (
        <div className={`pointer-events-auto flex max-w-md items-start gap-3 rounded-2xl border px-4 py-3 text-sm font-bold shadow-2xl ${TONE[notice.tone]}`}>
          <p className="min-w-0 flex-1">
            {notice.text}{" "}
            {notice.signIn && (
              <Link href="/fright-fest#standings" className="underline underline-offset-2" target="_blank" rel="noopener">
                How to enter
              </Link>
            )}
          </p>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="-m-1 rounded-full p-1 text-base leading-none opacity-80 hover:opacity-100">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
