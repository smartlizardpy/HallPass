"use client";

/**
 * The shared-board lobby: who is signed in, the game catalogue, "Who's playing?",
 * and the expiry prompts. All personal data comes from `/api/v1/boardpass/*`
 * after load; the page itself ships only the public catalogue.
 *
 * No polling. State is re-read when something changes (own actions, another tab
 * via BroadcastChannel), when the tab becomes visible, and when a countdown
 * fires. Nothing here extends a session in the background — only the explicit
 * Keep Playing tap (or a real score from the chosen player) does.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import posthog from "posthog-js";
import { PlayerOverlay } from "@/app/components/PlayerOverlay";
import { copy } from "@/app/lib/boardpass/copy";
import type { Game } from "@/app/lib/games";
import type { RosterEntry } from "@/app/lib/boardpass/sessions";
import {
  bindGame, endSession, fetchState, keepPlaying, login, removeParticipant,
  unbindGame, unbindOnExit, type BoardState, type LoginResult,
} from "./board-client";
import { LoginWindow } from "./LoginWindow";

const WARN_MS = 60_000;
const MAX_WINDOWS = 4;
const CHANNEL = "hallpass-boardpass";

type Playing = { game: Game; who: RosterEntry };

export function BoardMode({ games }: { games: Game[] }) {
  const [state, setState] = useState<BoardState>({ state: "loading" });
  const [skew, setSkew] = useState(0);
  const [offline, setOffline] = useState(false);
  const [windows, setWindows] = useState<{ id: number; z: number }[]>([]);
  const [pick, setPick] = useState<Game | null>(null);
  const [playing, setPlaying] = useState<Playing | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [warning, setWarning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const nextId = useRef(1);
  const topZ = useRef(10);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const channel = useRef<BroadcastChannel | null>(null);
  const hadSession = useRef(false);
  const autoOpened = useRef(false);

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
      hadSession.current = false;
      setNotice(copy.sessionExpired);
    }
    setState(next);
    return next;
  }, []);

  const changed = useCallback(() => {
    try { channel.current?.postMessage("changed"); } catch { /* tab sync is best effort */ }
  }, []);

  // Initial read, tab sync, and refetch when the tab is visible again.
  useEffect(() => {
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
    window.addEventListener("pagehide", unbindOnExit);
    return () => {
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("online", online);
      window.removeEventListener("pagehide", unbindOnExit);
      channel.current?.close();
    };
  }, [refresh]);

  const session = state.state === "active" ? state.session : null;
  const roster = useMemo(() => session?.participants ?? [], [session]);

  // First visit with nobody signed in: open one window so the screen isn't blank.
  useEffect(() => {
    if (state.state === "none" && !autoOpened.current && !playing) {
      autoOpened.current = true;
      openWindow();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.state]);

  // The session ended under a running game: close the game.
  useEffect(() => {
    if (playing && state.state !== "active" && state.state !== "loading") setPlaying(null);
  }, [playing, state.state]);

  // Countdown: when the warning is due, RE-READ first — a score during a game
  // extends the session server-side, so the client's copy may be stale — and only
  // warn if it is still about to end. At expiry, re-read to show the notice.
  useEffect(() => {
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

  function openWindow() {
    setWindows((w) => (w.length >= MAX_WINDOWS ? w : [...w, { id: nextId.current++, z: ++topZ.current }]));
  }
  const closeWindow = (id: number) => setWindows((w) => w.filter((x) => x.id !== id));
  const focusWindow = (id: number) => setWindows((w) => w.map((x) => (x.id === id ? { ...x, z: ++topZ.current } : x)));

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
    setPlaying({ game, who });
    posthog.capture("boardpass_game_launched", { game_slug: game.slug, players: roster.length });
    void refresh();
  }

  function choose(game: Game) {
    if (roster.length === 0) {
      setNotice(copy.nobodyYet);
      if (windows.length === 0) openWindow();
      return;
    }
    if (roster.length === 1) void launch(game, roster[0]);
    else setPick(game);
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
    changed();
    await refresh();
  }
  async function stillHere() {
    await keepPlaying();
    setWarning(false);
    changed();
    await refresh();
  }

  const shown = games.filter((g) => !query || g.title.toLowerCase().includes(query.toLowerCase()));
  const btn = "rounded-xl border border-black/10 dark:border-white/15 px-4 py-3 text-sm font-semibold hover:bg-neutral-100 dark:hover:bg-neutral-800 touch-manipulation";

  if (state.state === "unavailable") {
    return <Centered title={copy.brand} body={copy.unavailable} />;
  }
  if (state.state === "google-session") {
    return <Centered title={copy.brand} body={copy.googleSession} />;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="mr-2 text-2xl font-black">{copy.boardMode}</h1>
        <ul className="flex flex-1 flex-wrap items-center gap-2" aria-label="Players on this board">
          {roster.map((p) => (
            <li key={p.id} className="flex items-center gap-2 rounded-full border border-black/10 dark:border-white/15 py-1 pl-1 pr-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.image} alt="" width={32} height={32} className="h-8 w-8 rounded-full" />
              <span className="text-sm font-semibold">{p.name}</span>
              <button type="button" onClick={() => void remove(p.id)} aria-label={`${copy.removePlayer}: ${p.name}`}
                className="h-8 w-8 rounded-full hover:bg-black/10 dark:hover:bg-white/10">✕</button>
            </li>
          ))}
        </ul>
        <button type="button" className={btn} onClick={openWindow} disabled={roster.length + windows.length >= 8 || windows.length >= MAX_WINDOWS}>
          + {copy.addPlayer}
        </button>
        {roster.length > 0 && (
          <button type="button" className={btn} onClick={() => setConfirmEnd(true)}>{copy.endSession}</button>
        )}
      </header>

      {offline && <p role="status" className="rounded-lg bg-amber-100 dark:bg-amber-900/40 px-4 py-2 text-sm">{copy.reconnecting}</p>}
      {notice && <p role="status" className="rounded-lg bg-indigo-100 dark:bg-indigo-900/40 px-4 py-2 text-sm">{notice}</p>}
      {warning && !playing && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg bg-amber-100 dark:bg-amber-900/40 px-4 py-3">
          <b>{copy.stillPlayingTitle}</b> <span className="text-sm">{copy.stillPlayingBody}</span>
          <button type="button" className={btn} onClick={() => void stillHere()}>{copy.keepPlaying}</button>
        </div>
      )}

      <input
        type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search games"
        aria-label="Search games"
        className="w-full max-w-md rounded-xl border border-black/15 dark:border-white/20 bg-transparent px-4 py-3"
      />
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        {shown.map((g) => (
          <li key={g.slug}>
            <button type="button" onClick={() => choose(g)}
              className="h-full w-full rounded-2xl border border-black/10 dark:border-white/15 p-4 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 touch-manipulation">
              <span className="block text-base font-bold">{g.title}</span>
              <span className="block text-xs text-neutral-600 dark:text-neutral-400">{g.category}</span>
            </button>
          </li>
        ))}
      </ul>

      {windows.map((w, i) => (
        <LoginWindow key={w.id} index={i} z={w.z} onFocus={() => focusWindow(w.id)}
          onSubmit={submitLogin} onDone={() => closeWindow(w.id)} onClose={() => closeWindow(w.id)} />
      ))}

      {pick && (
        <Sheet title={copy.whoIsPlaying(pick.title)} onClose={() => setPick(null)}>
          {pick.externalUrl && <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-400">{copy.externalNote}</p>}
          <ul className="grid gap-3 sm:grid-cols-2">
            {roster.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => void launch(pick, p)}
                  className="flex w-full items-center gap-3 rounded-2xl border border-black/10 dark:border-white/15 p-4 text-left text-lg font-bold hover:bg-neutral-100 dark:hover:bg-neutral-800 touch-manipulation">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.image} alt="" width={48} height={48} className="h-12 w-12 rounded-full" />
                  {p.name}
                </button>
              </li>
            ))}
          </ul>
        </Sheet>
      )}

      {confirmEnd && (
        <Sheet title={copy.endConfirmTitle} onClose={() => setConfirmEnd(false)}>
          <p className="mb-4 text-sm">{copy.endConfirmBody}</p>
          <div className="flex gap-2">
            <button type="button" className={btn} onClick={() => void end()}>{copy.endSession}</button>
            <button type="button" className={btn} onClick={() => setConfirmEnd(false)}>{copy.cancel}</button>
          </div>
        </Sheet>
      )}

      <PlayerOverlay
        board
        game={playing?.game ?? null}
        onClose={() => void closeGame()}
        chrome={
          playing && (
            <div className="flex items-center gap-2 text-xs font-bold">
              <span className="rounded-full bg-indigo-600 px-3 py-1 text-white">{copy.playingAs(playing.who.name)}</span>
              {warning && (
                <button type="button" className="rounded-full bg-amber-400 px-3 py-1 text-black" onClick={() => void stillHere()}>
                  {copy.stillPlayingTitle} {copy.keepPlaying}
                </button>
              )}
            </div>
          )
        }
      />
    </div>
  );
}

function Centered({ title, body }: { title: string; body: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6 text-center">
      <div className="max-w-md space-y-2">
        <h1 className="text-2xl font-black">{title}</h1>
        <p>{body}</p>
      </div>
    </main>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-2xl bg-white dark:bg-neutral-900 p-6 shadow-2xl">
        <h2 className="mb-4 text-xl font-black">{title}</h2>
        {children}
        <button type="button" className="mt-4 text-sm underline" onClick={onClose}>{copy.cancel}</button>
      </div>
    </div>
  );
}
