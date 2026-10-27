"use client";

/**
 * Board Mode on the homepage. Owns the one `useBoardSession` for the page and
 * shares it, so the header entry button, the board bar and the play button on every
 * game card all talk to the same session.
 *
 * STAYING STATIC. Nothing here runs on the server and nothing reads a cookie
 * there; the session is one client fetch after mount (`useBoardSession`). A visitor
 * with no board, a Google session, or BoardPass switched off sees `available ===
 * false` and gets no board UI at all — the homepage is unchanged for them.
 *
 * NOT IN A FRAME. PIN entry used to live on `/board`, which the server sent with
 * `frame-ancestors 'none'`. The homepage cannot carry that header (it is cached,
 * indexable and shared), so the equivalent is enforced here: when the page is
 * framed, the board does not render and there is nothing to type a PIN into.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Game } from "@/app/lib/games";
import { setBoardActive } from "./board-active-store";
import { MAX_PLAYERS, useBoardSession } from "./useBoardSession";

type Session = ReturnType<typeof useBoardSession>;

export interface BoardApi {
  /** A board can be used here: BoardPass is on, no Google session, not framed. */
  available: boolean;
  /** The board bar is showing (a session exists, or someone opened the panel). */
  visible: boolean;
  openPanel: () => void;
  closePanel: () => void;
  /**
   * Called by the shell before it opens a game. `true` means the board took the
   * play (it will ask who is playing, then launch); `false` means no board
   * session, so the page opens the game exactly as it always did.
   */
  interceptPlay: (game: Game) => boolean;
  session: Session;
}

const BoardContext = createContext<BoardApi | null>(null);

/** `null` on any page without a provider, so callers can render nothing. */
export function useBoard(): BoardApi | null {
  return useContext(BoardContext);
}

/** Cross-origin parents make `window.top` throw: that counts as framed. */
const isFramed = () => {
  try {
    return window.top !== window.self;
  } catch {
    return true;
  }
};
const noSubscribe = () => () => {};

/** Read once, then dropped from the address bar so a reload does not reopen it. */
function takeBoardParam(): boolean {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get("board") !== "1") return false;
    url.searchParams.delete("board");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    return true;
  } catch {
    return false;
  }
}

export function BoardProvider({ children }: { children: React.ReactNode }) {
  const session = useBoardSession();
  const { state, windows, playing, openWindow, closeWindow, setKbd, roster, choose } = session;
  const [panelOpen, setPanelOpen] = useState(false);
  const wanted = useRef<boolean | null>(null);

  const framed = useSyncExternalStore(noSubscribe, isFramed, () => false);
  const available = !framed && (state.state === "none" || state.state === "active");
  const visible = available && (panelOpen || state.state === "active");

  // `?board=1` (a bookmark or the sign-in page's link) opens the panel once the
  // session has been read — and only if a board can be used here at all.
  useEffect(() => {
    if (wanted.current === null) wanted.current = takeBoardParam();
    if (!wanted.current || !available) return;
    wanted.current = false;
    // Reacts to the session read arriving; there is nothing to derive it from.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPanelOpen(true);
    if (state.state === "none") openWindow();
  }, [available, state.state, openWindow]);

  const busy = visible || windows.length > 0 || playing !== null;
  useEffect(() => {
    setBoardActive(busy);
    return () => setBoardActive(false);
  }, [busy]);

  const openPanel = useCallback(() => {
    if (!available) return;
    setPanelOpen(true);
    if (windows.length === 0 && roster.length < MAX_PLAYERS) openWindow();
  }, [available, windows.length, roster.length, openWindow]);

  const closePanel = useCallback(() => {
    windows.forEach((w) => closeWindow(w.id));
    setKbd(null);
    setPanelOpen(false);
  }, [windows, closeWindow, setKbd]);

  const interceptPlay = useCallback(
    (game: Game) => {
      if (!available || state.state !== "active") return false;
      choose(game);
      return true;
    },
    [available, state.state, choose],
  );

  const value = useMemo<BoardApi>(
    () => ({ available, visible, openPanel, closePanel, interceptPlay, session }),
    [available, visible, openPanel, closePanel, interceptPlay, session],
  );

  return <BoardContext.Provider value={value}>{children}</BoardContext.Provider>;
}
