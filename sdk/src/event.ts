/**
 * `HallPass.getEvent()` and the `"event"` event: is the seasonal event on?
 *
 * The server owns the answer (`GET /api/v1/event`: the event's dates plus the
 * dashboard switch). This module only fetches it, validates it, remembers it for
 * a moment and, for a game that listens, keeps it fresh.
 *
 * FAIL TOWARDS "NO EVENT". An unreachable server, a malformed body or inert mode
 * resolve `null`, which the contract tells games to treat as "show the normal
 * game". The one exception is a REFRESH that fails after a good answer: that
 * keeps the last good state, so a network blip in the middle of a run does not
 * strip the event off a player who is playing it.
 *
 * Never throws; every path resolves.
 */

import type { ResolvedConfig } from "./config";
import type { EventName, EventState, GetEventOptions, Mode } from "./contract";
import { getJSON } from "./transport";

/** How long a good answer is reused without asking again. */
const FRESH_MS = 30 * 1000;
/** How often a game that LISTENS re-asks, so a dashboard flip reaches an open tab. */
const WATCH_MS = 60 * 1000;

export interface EventDeps {
  cfg: ResolvedConfig;
  mode: Mode;
  emit: (event: EventName, payload: unknown) => void;
}

export interface EventApi {
  getEvent(opts?: GetEventOptions): Promise<EventState | null>;
  /** Start keeping the state fresh and emitting `"event"` on change. Idempotent. */
  watch(): void;
}

const PHASES = ["off", "live", "ended"] as const;
const strOrNull = (v: unknown) => (typeof v === "string" ? v : null);

/** A well-formed {@link EventState}, or `null`. Inactive states are forced to carry no name or dates. */
export function parseEventState(data: unknown): EventState | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.active !== "boolean") return null;
  const phase = (PHASES as readonly unknown[]).includes(d.phase) ? (d.phase as EventState["phase"]) : null;
  if (!phase) return null;
  const serverTime = strOrNull(d.serverTime) ?? new Date().toISOString();
  if (!d.active) {
    return { active: false, event: null, phase, startAt: null, opensAt: null, endAt: null, serverTime };
  }
  const event = strOrNull(d.event);
  if (!event) return null; // "active" with no event name is not an answer we can trust
  return {
    active: true,
    event,
    phase,
    startAt: strOrNull(d.startAt),
    opensAt: strOrNull(d.opensAt),
    endAt: strOrNull(d.endAt),
    serverTime,
  };
}

/** Same event state apart from the server clock, which differs on every request. */
function same(a: EventState | null | undefined, b: EventState): boolean {
  return (
    !!a &&
    a.active === b.active &&
    a.event === b.event &&
    a.phase === b.phase &&
    a.startAt === b.startAt &&
    a.opensAt === b.opensAt &&
    a.endAt === b.endAt
  );
}

export function createEvent(deps: EventDeps): EventApi {
  const { cfg, mode, emit } = deps;
  let last: EventState | null = null;
  let lastAt = 0;
  let inflight: Promise<EventState | null> | null = null;
  let watching = false;

  async function fetchState(): Promise<EventState | null> {
    const res = await getJSON(cfg.api + "/api/v1/event");
    const parsed = res.ok ? parseEventState(res.data) : null;
    if (!parsed) return last; // keep the last good state; `null` if there never was one
    const changed = !same(last, parsed);
    last = parsed;
    lastAt = Date.now();
    if (changed) emit("event", parsed);
    return parsed;
  }

  function getEvent(opts?: GetEventOptions): Promise<EventState | null> {
    try {
      if (mode === "inert") return Promise.resolve(null);
      if (!opts?.refresh && last && Date.now() - lastAt < FRESH_MS) return Promise.resolve(last);
      if (!inflight) {
        inflight = fetchState()
          .catch(() => last)
          .finally(() => {
            inflight = null;
          });
      }
      return inflight;
    } catch {
      return Promise.resolve(null);
    }
  }

  function refreshIfVisible(): void {
    try {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void getEvent({ refresh: true });
    } catch {
      // never throw out of a timer
    }
  }

  function watch(): void {
    try {
      if (watching || mode === "inert") return;
      watching = true;
      void getEvent(); // a late listener gets a value even if the game never called getEvent
      setInterval(refreshIfVisible, WATCH_MS);
      if (typeof document !== "undefined" && document.addEventListener) {
        document.addEventListener("visibilitychange", refreshIfVisible);
      }
    } catch {
      // ignore
    }
  }

  return { getEvent, watch };
}
