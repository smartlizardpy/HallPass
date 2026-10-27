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
} from "@/app/components/board/board-client";
import { BoardHeader } from "@/app/components/board/BoardHeader";
import { categoryCounts, filterGames, isFiltering, NO_FILTER, pickFeatured, type LibraryFilter } from "@/app/components/board/board-filter";
import { FeaturedStrip } from "./FeaturedStrip";
import { GameCard } from "./GameCard";
import { planLaunch } from "@/app/components/board/launch-decision";
import { LibraryControls } from "./LibraryControls";
import { LoginWindow } from "@/app/components/board/LoginWindow";
import { Sheet } from "@/app/components/board/Sheet";
import { UsernameKeyboard } from "@/app/components/board/UsernameKeyboard";

const WARN_MS = 60_000;
const MAX_WINDOWS = 4;
const MAX_PLAYERS = 8;
const CHANNEL = "hallpass-boardpass";

type Playing = { game: Game; who: RosterEntry };

export function BoardMode({ games }: { games: Game[] }) {
  const [state, setState] = useState<BoardState>({ state: "loading" });
  const [skew, setSkew] = useState(0);
  const [offline, setOffline] = useState(false);
  // Window order IS stacking order: the last one is on top (see `focusWindow`).
  const [windows, setWindows] = useState<{ id: number; username: string }[]>([]);
  // What the on-screen keyboard is editing: one sign-in window's username, or the search.
  const [kbd, setKbd] = useState<{ kind: "window"; id: number } | { kind: "search" } | null>(null);
  const [filter, setFilter] = useState<LibraryFilter>(NO_FILTER);
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

  // Mark a player who just joined so the dock can welcome them with a brief pop.
  useEffect(() => {
    if (state.state === "loading") return;
    const fresh = seeded.current ? roster.find((p) => !knownIds.current.has(p.id)) : undefined;
    seeded.current = true; // players already signed in on page load don't "arrive"
    knownIds.current = new Set(roster.map((p) => p.id));
    if (fresh) setNewestId(fresh.id);
  }, [roster, state.state]);

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
    setWindows((w) => (w.length >= MAX_WINDOWS ? w : [...w, { id: nextId.current++, username: "" }]));
  }
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

  const featured = useMemo(() => pickFeatured(games), [games]);
  const categories = useMemo(() => categoryCounts(games), [games]);
  const shown = useMemo(() => filterGames(games, filter), [games, filter]);
  const filtering = isFiltering(filter);
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
  const loading = state.state === "loading";

  if (state.state === "unavailable") {
    return <Centered title={copy.brand} body={copy.unavailable} />;
  }
  if (state.state === "google-session") {
    return <Centered title={copy.brand} body={copy.googleSession} />;
  }

  return (
    <div className="bp-root">
      <BoardHeader
        roster={roster}
        loading={loading}
        newestId={newestId}
        addDisabledReason={addDisabledReason}
        endsBy={endsBy}
        onAdd={openWindow}
        onEnd={() => setConfirmEnd(true)}
        onRemove={(id) => void remove(id)}
      />

      <main>
        {offline && <p role="status" className="bp-banner" data-tone="warn"><span>{copy.reconnecting}</span></p>}
        {notice && (
          <p role="status" className="bp-banner">
            <span>{notice}</span>
            <button type="button" className="bp-btn" onClick={() => setNotice(null)}>{copy.dismiss}</button>
          </p>
        )}

        {featured && !filtering && <FeaturedStrip game={featured} onPlay={choose} />}

        <LibraryControls
          categories={categories}
          filter={filter}
          onChange={setFilter}
          keyboardOpen={kbd?.kind === "search"}
          onToggleKeyboard={() => setKbd((k) => (k?.kind === "search" ? null : { kind: "search" }))}
        />

        <p className="bp-meta" role="status">{copy.gamesCount(shown.length, games.length)}</p>
        <ul className="bp-grid">
          {shown.map((g, i) => (
            <li key={g.slug}>
              <GameCard game={g} onPlay={choose} eager={i < 10} />
            </li>
          ))}
          {shown.length === 0 && (
            <li className="bp-empty">
              <h3>{copy.noMatchTitle}</h3>
              <p>{copy.noMatchBody(filter.query.trim(), filter.category)}</p>
              <button type="button" className="bp-btn bp-btn-primary bp-btn-lg" onClick={() => setFilter(NO_FILTER)}>{copy.clearFilters}</button>
            </li>
          )}
        </ul>
      </main>

      {windows.map((w, i) => (
        <LoginWindow
          key={w.id}
          index={i}
          z={40 + i}
          username={w.username}
          onUsername={(u) => setUsername(w.id, u)}
          keyboardOpen={kbd?.kind === "window" && kbd.id === w.id}
          onKeyboard={(open) => setKbd(open ? { kind: "window", id: w.id } : (k) => (k?.kind === "window" && k.id === w.id ? null : k))}
          onFocus={() => focusWindow(w.id)}
          onSubmit={submitLogin}
          onDone={() => closeWindow(w.id)}
          onClose={() => closeWindow(w.id)}
        />
      ))}

      {kbd?.kind === "window" && kbdWindow && (
        <UsernameKeyboard mode="username" value={kbdWindow.username} onChange={(u) => setUsername(kbdWindow.id, u)} onClose={() => setKbd(null)} />
      )}
      {kbd?.kind === "search" && (
        <UsernameKeyboard mode="search" value={filter.query} onChange={(q) => setFilter((f) => ({ ...f, query: q }))} onClose={() => setKbd(null)} />
      )}

      {warning && !playing && state.state === "active" && (
        <div role="alert" className="bp-session-card">
          <div>
            <strong>{copy.stillPlayingTitle}</strong>
            <span className="bp-sc-body">{copy.stillPlayingBody}</span>
          </div>
          <button type="button" className="bp-btn bp-btn-primary bp-btn-lg" onClick={() => void stillHere()}>{copy.keepPlaying}</button>
          <button type="button" className="bp-btn bp-btn-danger" onClick={() => setConfirmEnd(true)}>{copy.endSession}</button>
        </div>
      )}

      {pick && (
        <Sheet title={copy.whoIsPlaying(pick.title)} onClose={() => setPick(null)}>
          {pick.externalUrl ? <p>{copy.externalNote}</p> : <p>{copy.creditNote}</p>}
          <ul className="bp-who">
            {roster.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => void launch(pick, p)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.image} alt="" width={80} height={80} />
                  {p.name}
                </button>
              </li>
            ))}
          </ul>
        </Sheet>
      )}

      {confirmEnd && (
        <Sheet title={copy.endConfirmTitle} onClose={() => setConfirmEnd(false)} closeLabel={null}>
          <p>{copy.endConfirmBody}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button type="button" className="bp-btn bp-btn-lg" onClick={() => setConfirmEnd(false)}>{copy.cancel}</button>
            <button type="button" className="bp-btn bp-btn-danger bp-btn-lg" onClick={() => void end()}>{copy.endSession}</button>
          </div>
        </Sheet>
      )}

      <PlayerOverlay
        board
        closeLabel={copy.backToBoard}
        game={playing?.game ?? null}
        onClose={() => void closeGame()}
        chrome={
          playing && (
            <div className="flex items-center gap-3 text-lg font-bold">
              <span className="inline-flex items-center gap-3 rounded-full bg-indigo-600 py-1.5 pl-1.5 pr-5 text-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={playing.who.image} alt="" width={40} height={40} className="h-10 w-10 rounded-full bg-white/20" />
                {copy.playingAs(playing.who.name)}
              </span>
              {warning && (
                <button type="button" className="min-h-12 rounded-full bg-amber-400 px-5 py-2 text-black" onClick={() => void stillHere()}>
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
    <main className="bp-root bp-centered">
      <div className="max-w-md space-y-2">
        <h1 className="text-3xl font-black">{title}</h1>
        <p className="text-lg" style={{ color: "var(--bp-muted)" }}>{body}</p>
      </div>
    </main>
  );
}
