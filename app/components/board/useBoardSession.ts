"use client";

/**
 * Everything a shared board needs that is not drawing: the session read from
 * `/api/v1/boardpass/*`, the sign-in windows, the queued logins, "Who's playing?",
 * the expiry countdown and the launch/return binding.
 *
 * No polling. State is re-read when something changes (own actions, another tab
 * via BroadcastChannel), when the tab becomes visible, and when a countdown
 * fires. Nothing here extends a session in the background — only the explicit
 * Keep Playing tap (or a real score from the chosen player) does.
 *
 * This used to be the body of `BoardMode`. It is a hook so the same behaviour can
 * sit under the homepage as well as the old page, and so the page that hosts it
 * decides what to draw.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import posthog from "posthog-js";
import { copy } from "@/app/lib/boardpass/copy";
import type { Game } from "@/app/lib/games";
import type { RosterEntry } from "@/app/lib/boardpass/sessions";
import {
  bindGame, endSession, fetchState, keepPlaying, login, removeParticipant,
  unbindGame, unbindOnExit, type BoardState, type LoginResult,
} from "./board-client";
import { planLaunch } from "./launch-decision";

const WARN_MS = 60_000;
export const MAX_WINDOWS = 4;
export const MAX_PLAYERS = 8;
const CHANNEL = "hallpass-boardpass";

export type Playing = { game: Game; who: RosterEntry };
export type KeyboardTarget = { kind: "window"; id: number } | { kind: "search" } | null;

export function useBoardSession() {
  const [state, setState] = useState<BoardState>({ state: "loading" });
  const [skew, setSkew] = useState(0);
  const [offline, setOffline] = useState(false);
  // Window order IS stacking order: the last one is on top (see `focusWindow`).
  const [windows, setWindows] = useState<{ id: number; username: string }[]>([]);
  // What the on-screen keyboard is editing: one sign-in window's username, or the search.
  const [kbd, setKbd] = useState<KeyboardTarget>(null);
  const [newestId, setNewestId] = useState<string | null>(null);
  const [pick, setPick] = useState<Game | null>(null);
  const [playing, setPlaying] = useState<Playing | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [warning, setWarning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const nextId = useRef(1);
  const knownIds = useRef<Set<string>>(new Set());
  const seeded = useRef(false);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const channel = useRef<BroadcastChannel | null>(null);
  const hadSession = useRef(false);

  const refresh = useCallback(async (): Promise<BoardState | null> => {
    const next = await fetchState();
    if (!next) {
      setOffline(true);
      return null;
    }
    setOffline(false);
    if (next.state === "active") {
      setSkew(Date.parse(next.session.now) - Date.now());
      hadSession.current = true;
    } else if (hadSession.current) {
      // The session is gone (expiry, ended in another tab, or revoked): nothing
      // from it may stay on screen for the next group.
      hadSession.current = false;
      setNotice(copy.sessionExpired);
      setWindows([]);
      setKbd(null);
      setPick(null);
      setConfirmEnd(false);
    }
    setState(next);
    return next;
  }, []);

  const changed = useCallback(() => {
    try { channel.current?.postMessage("changed"); } catch { /* tab sync is best effort */ }
  }, []);

  // Initial read, tab sync, and refetch when the tab is visible again.
  useEffect(() => {
    // The first read of an external system (the server session) on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    try {
      const bc = new BroadcastChannel(CHANNEL);
      bc.onmessage = () => void refresh();
      channel.current = bc;
    } catch { /* no BroadcastChannel: the visibility refetch still covers it */ }
    const vis = () => document.visibilityState === "visible" && void refresh();
    const online = () => void refresh();
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("online", online);
    return () => {
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("online", online);
      channel.current?.close();
    };
  }, [refresh]);

  const session = state.state === "active" ? state.session : null;
  const roster = useMemo(() => session?.participants ?? [], [session]);

  // Only a page that actually holds a session unbinds on the way out; on the
  // public homepage a visitor with no board never sends this request.
  const active = state.state === "active";
  useEffect(() => {
    if (!active) return;
    window.addEventListener("pagehide", unbindOnExit);
    return () => window.removeEventListener("pagehide", unbindOnExit);
  }, [active]);

  // Mark a player who just joined so the dock can welcome them with a brief pop.
  useEffect(() => {
    if (state.state === "loading") return;
    const fresh = seeded.current ? roster.find((p) => !knownIds.current.has(p.id)) : undefined;
    seeded.current = true; // players already signed in on page load don't "arrive"
    knownIds.current = new Set(roster.map((p) => p.id));
    // Reacts to the roster the server just returned; nothing to derive it from.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (fresh) setNewestId(fresh.id);
  }, [roster, state.state]);

  // The session ended under a running game: close the game.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (playing && state.state !== "active" && state.state !== "loading") setPlaying(null);
  }, [playing, state.state]);

  // Countdown: when the warning is due, RE-READ first — a score during a game
  // extends the session server-side, so the client's copy may be stale — and only
  // warn if it is still about to end. At expiry, re-read to show the notice.
  useEffect(() => {
    // A new session snapshot restarts the countdown, so the prompt is cleared first.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWarning(false);
    if (!session) return;
    const end = Math.min(Date.parse(session.idleExpiresAt), Date.parse(session.absoluteExpiresAt));
    const inMs = end - (Date.now() + skew);
    const t = setTimeout(
      async () => {
        const next = await refresh();
        if (next?.state === "active") {
          const e = Math.min(Date.parse(next.session.idleExpiresAt), Date.parse(next.session.absoluteExpiresAt));
          if (e - (Date.now() + skew) <= WARN_MS + 1500) setWarning(true);
        }
      },
      Math.max(0, inMs - WARN_MS),
    );
    const t2 = setTimeout(() => void refresh(), Math.max(0, inMs) + 800);
    return () => { clearTimeout(t); clearTimeout(t2); };
  }, [session, skew, refresh]);

  const openWindow = useCallback(() => {
    setWindows((w) => (w.length >= MAX_WINDOWS ? w : [...w, { id: nextId.current++, username: "" }]));
  }, []);
  const closeWindow = (id: number) => {
    setWindows((w) => w.filter((x) => x.id !== id));
    setKbd((k) => (k?.kind === "window" && k.id === id ? null : k));
  };
  // Raise a window by moving it to the end; its z-index is derived from position.
  const focusWindow = (id: number) =>
    setWindows((w) => (w[w.length - 1]?.id === id ? w : [...w.filter((x) => x.id !== id), ...w.filter((x) => x.id === id)]));
  const setUsername = (id: number, username: string) =>
    setWindows((w) => w.map((x) => (x.id === id ? { ...x, username } : x)));

  // Logins go through ONE queue, so two windows submitted together can't both
  // create a session; the second joins the first.
  function submitLogin(username: string, pin: string): Promise<LoginResult> {
    const run = queue.current.then(() => login(username, pin));
    queue.current = run.catch(() => {});
    return run.then(async (r) => {
      posthog.capture(r.ok ? "boardpass_login_succeeded" : "boardpass_login_failed", r.ok ? undefined : { reason: r.error });
      if (r.ok) {
        setNotice(null);
        await refresh();
        changed();
      } else if (r.error === "google-session") {
        await refresh();
      }
      return r;
    });
  }

  async function launch(game: Game, who: RosterEntry) {
    setPick(null);
    let r = await bindGame(who.id, game.slug);
    if (r === "busy") {
      await unbindGame(); // a stale binding from a closed tab
      r = await bindGame(who.id, game.slug);
    }
    if (r !== "ok") {
      setNotice(
        r === "network" ? copy.reconnecting : r === "gone" ? copy.sessionExpired : copy.launchFailed,
      );
      await refresh();
      return;
    }
    setWindows([]); // PIN entry never shares a screen with a game
    setKbd(null);
    setPlaying({ game, who });
    posthog.capture("boardpass_game_launched", { game_slug: game.slug, players: roster.length });
    void refresh();
  }

  function choose(game: Game) {
    const plan = planLaunch(roster);
    if (plan.kind === "needs-player") {
      setNotice(copy.nobodyYet);
      if (windows.length === 0) openWindow();
    } else if (plan.kind === "launch") {
      void launch(game, plan.who);
    } else {
      setPick(game);
    }
  }

  const closeGame = useCallback(async () => {
    setPlaying(null);
    await unbindGame();
    await refresh();
  }, [refresh]);

  async function remove(id: string) {
    await removeParticipant(id);
    changed();
    await refresh();
  }
  async function end() {
    setConfirmEnd(false);
    await endSession();
    posthog.capture("boardpass_session_ended");
    setWindows([]);
    setKbd(null);
    changed();
    await refresh();
  }
  async function stillHere() {
    await keepPlaying();
    setWarning(false);
    changed();
    await refresh();
  }

  const endsBy = session
    ? new Date(session.absoluteExpiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : null;
  const addDisabledReason =
    roster.length >= MAX_PLAYERS
      ? copy.addPlayerFull
      : windows.length >= MAX_WINDOWS || roster.length + windows.length >= MAX_PLAYERS
        ? copy.addPlayerWindows
        : null;
  const kbdWindow = kbd?.kind === "window" ? windows.find((w) => w.id === kbd.id) : undefined;

  return {
    state, loading: state.state === "loading", offline, roster, newestId, endsBy, addDisabledReason,
    windows, kbd, setKbd, kbdWindow, openWindow, closeWindow, focusWindow, setUsername, submitLogin,
    pick, setPick, playing, confirmEnd, setConfirmEnd, warning, notice, setNotice,
    launch, choose, closeGame, remove, end, stillHere,
  };
}
