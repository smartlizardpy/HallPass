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

import { useEffect, useMemo, useRef, useState } from "react";
import { PlayerOverlay } from "@/app/components/PlayerOverlay";
import { copy } from "@/app/lib/boardpass/copy";
import type { Game } from "@/app/lib/games";
import { BoardHeader } from "@/app/components/board/BoardHeader";
import { categoryCounts, filterGames, isFiltering, NO_FILTER, pickFeatured, type LibraryFilter } from "@/app/components/board/board-filter";
import { FeaturedStrip } from "./FeaturedStrip";
import { GameCard } from "./GameCard";
import { LibraryControls } from "./LibraryControls";
import { LoginWindow } from "@/app/components/board/LoginWindow";
import { Sheet } from "@/app/components/board/Sheet";
import { UsernameKeyboard } from "@/app/components/board/UsernameKeyboard";
import { useBoardSession } from "@/app/components/board/useBoardSession";

export function BoardMode({ games }: { games: Game[] }) {
  const b = useBoardSession();
  const {
    state, loading, offline, roster, newestId, endsBy, addDisabledReason, windows, kbd, setKbd, kbdWindow,
    openWindow, closeWindow, focusWindow, setUsername, submitLogin, pick, setPick, playing, confirmEnd,
    setConfirmEnd, warning, notice, setNotice, launch, choose, closeGame, remove, end, stillHere,
  } = b;
  const [filter, setFilter] = useState<LibraryFilter>(NO_FILTER);
  const autoOpened = useRef(false);

  // First visit with nobody signed in: open one window so the screen isn't blank.
  useEffect(() => {
    if (state.state === "none" && !autoOpened.current && !playing) {
      autoOpened.current = true;
      openWindow();
    }
  }, [state.state, playing, openWindow]);

  const featured = useMemo(() => pickFeatured(games), [games]);
  const categories = useMemo(() => categoryCounts(games), [games]);
  const shown = useMemo(() => filterGames(games, filter), [games, filter]);
  const filtering = isFiltering(filter);

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
