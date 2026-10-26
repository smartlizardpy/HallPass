"use client";

/**
 * The hall's one client root. It owns what every part of the room shares:
 *
 *  - which cabinet is selected (cabinets, the details panel and the phone's
 *    arrows all read it);
 *  - the championship's phase and standings, from the page-wide shared fetch
 *    (`components/championship/data.ts` keeps ONE request per URL, so the room's
 *    board and the sections below it cost a single call between them);
 *  - ONE persistent `aria-live="polite"` announcer, created here once and never
 *    re-mounted, so a screen reader hears each selection exactly once;
 *  - the one-line toast the eggs use;
 *  - pausing every loop while the room is off-screen or the tab is hidden.
 *
 * The server draws the room (Room.tsx); this wraps it and the pieces that need
 * state are leaves inside it. The prerendered HTML carries no clock and no data:
 * the phase is `null` until the effects run, and everything says the same thing
 * for every visitor until then.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { forgetChampionship, useChampionship, useMinute, useMyChampionship, type MeResponse } from "@/app/components/championship/data";
import type { PublicChampionship } from "@/app/lib/championship";
import { clockPhase, type ChampionshipSummary } from "@/app/lib/championship/summary";
import { useDevicePlatform, type DevicePlatform } from "@/app/lib/use-device-platform";
import { cabinetStatus, selectedAnnouncement, type CabinetStatus, type HallPhase } from "./logic";
import type { CabinetProps } from "./props";

export interface HallState {
  cabinets: CabinetProps[];
  summary: ChampionshipSummary | null;
  selected: number;
  /** Choose a cabinet and tell the announcer. `focus` moves keyboard focus to it once it has rendered. */
  select: (index: number, opts?: { focus?: boolean }) => void;
  /** The index whose button should take focus after the next render (roving tabindex). */
  focusRequest: number | null;
  clearFocusRequest: () => void;
  phase: HallPhase;
  status: CabinetStatus;
  champ: PublicChampionship | null;
  me: MeResponse | null;
  /** True until the standings request has answered either way. */
  loading: boolean;
  /** The request has answered and there is nothing: the scores are offline. */
  offline: boolean;
  retry: () => void;
  device: DevicePlatform | null;
  toast: (message: string) => void;
}

const Ctx = createContext<HallState | null>(null);

export function useHall(): HallState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useHall must be used inside <HallProvider>");
  return v;
}

export function HallProvider({
  cabinets,
  summary,
  children,
}: {
  cabinets: CabinetProps[];
  summary: ChampionshipSummary | null;
  children: ReactNode;
}) {
  const [selected, setSelected] = useState(0);
  const [focusRequest, setFocusRequest] = useState<number | null>(null);
  const [retryN, setRetryN] = useState(0);
  const [said, setSaid] = useState("");
  const [toastText, setToastText] = useState("");
  const toastTimer = useRef<number | undefined>(undefined);
  const root = useRef<HTMLElement | null>(null);

  const id = summary?.id ?? "";
  const on = summary !== null;
  const { data: champ, loading } = useChampionship(id, on, retryN);
  const { data: me } = useMyChampionship(id, on, retryN);
  const now = useMinute();
  const device = useDevicePlatform();

  const phase: HallPhase = !summary ? null : champ?.available ? champ.phase : now === null ? null : clockPhase(summary, now);
  const status = cabinetStatus(cabinets[selected] ?? { open: false }, phase, summary);

  const select = useCallback(
    (index: number, opts?: { focus?: boolean }) => {
      const i = ((index % cabinets.length) + cabinets.length) % cabinets.length;
      setSelected(i);
      if (opts?.focus) setFocusRequest(i);
      const cab = cabinets[i];
      if (cab) {
        const st = cabinetStatus(cab, phase, summary);
        // A trailing no-break space makes a repeated message a change the live region will read.
        setSaid((prev) => {
          const msg = selectedAnnouncement(cab, st);
          return prev === msg ? `${msg} ` : msg;
        });
      }
    },
    [cabinets, phase, summary],
  );

  const toast = useCallback((message: string) => {
    setToastText(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastText(""), 2600);
  }, []);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const retry = useCallback(() => {
    if (id) forgetChampionship(id);
    setRetryN((n) => n + 1);
  }, [id]);

  // Loops run only while the room is on screen and the tab is visible: no work for a room nobody can see.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let visible = true;
    const apply = () => {
      if (visible && !document.hidden) el.removeAttribute("data-paused");
      else el.setAttribute("data-paused", "");
    };
    const io = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting);
      apply();
    });
    io?.observe(el);
    document.addEventListener("visibilitychange", apply);
    apply();
    return () => {
      io?.disconnect();
      document.removeEventListener("visibilitychange", apply);
    };
  }, []);

  const value = useMemo<HallState>(
    () => ({
      cabinets,
      summary,
      selected,
      select,
      focusRequest,
      clearFocusRequest: () => setFocusRequest(null),
      phase,
      status,
      champ: champ ?? null,
      me: me ?? null,
      loading: on && loading,
      offline: on && !loading && !champ,
      retry,
      device,
      toast,
    }),
    [cabinets, summary, selected, select, focusRequest, phase, status, champ, me, on, loading, retry, device, toast],
  );

  return (
    <Ctx.Provider value={value}>
      <section ref={root} className="hl" aria-label="The Fright Fest Arcade Hall" data-phase={phase ?? "neutral"}>
        {children}
        {/* One announcer for the whole hall, mounted once. */}
        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="hl-announcer">
          {said}
        </div>
        <div className="hl-toast" data-show={toastText ? "1" : undefined} aria-hidden="true">
          {toastText}
        </div>
      </section>
    </Ctx.Provider>
  );
}
