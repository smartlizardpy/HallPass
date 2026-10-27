"use client";

/**
 * What Board Mode draws on the homepage: the bar under the site header (players,
 * Add Player, End Session), the floating sign-in windows and their separate
 * keyboard, "Who's playing?", the expiry prompts, and the board's game overlay.
 * Everything else on the page is the normal arcade.
 *
 * The game overlay here is the board's own, and the shell's overlay stays for
 * ordinary play. They never open together: `ArcadeShell` hands the play to the
 * board whenever a board session exists, and the board opens only this one.
 * Sign-in windows are unmounted before a game mounts, so PIN entry never shares
 * a screen with a game frame.
 */

import "./board.css";
import { PlayerOverlay } from "@/app/components/PlayerOverlay";
import { copy } from "@/app/lib/boardpass/copy";
import { useBoard } from "./BoardProvider";
import { LoginWindow } from "./LoginWindow";
import { PlayerDock } from "./PlayerDock";
import { Sheet } from "./Sheet";
import { UsernameKeyboard } from "./UsernameKeyboard";

export function BoardLayer() {
  const board = useBoard();
  if (!board || !board.available) return null;
  const b = board.session;
  const { roster, kbdWindow, pick, playing, warning } = b;

  return (
    <>
      {board.visible && (
        <section className="bp-root bp-bar" aria-label={copy.boardMode}>
          <div className="bp-bar-row">
            <span className="bp-modechip flex-none">{copy.boardMode}</span>
            <PlayerDock roster={roster} loading={b.loading} newestId={b.newestId} onRemove={(id) => void b.remove(id)} />
            <button
              type="button"
              className="bp-btn bp-btn-primary flex-none"
              onClick={b.openWindow}
              disabled={b.addDisabledReason !== null}
              aria-describedby={b.addDisabledReason ? "bp-add-why" : undefined}
            >
              + {copy.addPlayer}
            </button>
            {b.addDisabledReason && <span id="bp-add-why" className="sr-only">{b.addDisabledReason}</span>}
            {roster.length > 0 ? (
              <>
                {b.endsBy && <span className="hidden flex-none text-base font-bold xl:inline" style={{ color: "var(--bp-muted)" }}>{copy.endsBy(b.endsBy)}</span>}
                <button type="button" className="bp-btn bp-btn-danger flex-none" onClick={() => b.setConfirmEnd(true)} title={copy.endSessionHint}>
                  {copy.endSession}
                </button>
              </>
            ) : (
              <button type="button" className="bp-btn flex-none" onClick={board.closePanel}>{copy.closeBoard}</button>
            )}
          </div>
          {b.offline && <p role="status" className="bp-banner" data-tone="warn"><span>{copy.reconnecting}</span></p>}
          {b.notice && (
            <p role="status" className="bp-banner">
              <span>{b.notice}</span>
              <button type="button" className="bp-btn" onClick={() => b.setNotice(null)}>{copy.dismiss}</button>
            </p>
          )}
        </section>
      )}

      <div className="bp-root bp-layer">
        {b.windows.map((w, i) => (
          <LoginWindow
            key={w.id}
            index={i}
            z={60 + i}
            username={w.username}
            onUsername={(u) => b.setUsername(w.id, u)}
            keyboardOpen={b.kbd?.kind === "window" && b.kbd.id === w.id}
            onKeyboard={(open) => b.setKbd(open ? { kind: "window", id: w.id } : (k) => (k?.kind === "window" && k.id === w.id ? null : k))}
            onFocus={() => b.focusWindow(w.id)}
            onSubmit={b.submitLogin}
            onDone={() => b.closeWindow(w.id)}
            onClose={() => b.closeWindow(w.id)}
          />
        ))}

        {kbdWindow && (
          <UsernameKeyboard mode="username" value={kbdWindow.username} onChange={(u) => b.setUsername(kbdWindow.id, u)} onClose={() => b.setKbd(null)} />
        )}

        {warning && !playing && b.state.state === "active" && (
          <div role="alert" className="bp-session-card">
            <div>
              <strong>{copy.stillPlayingTitle}</strong>
              <span className="bp-sc-body">{copy.stillPlayingBody}</span>
            </div>
            <button type="button" className="bp-btn bp-btn-primary bp-btn-lg" onClick={() => void b.stillHere()}>{copy.keepPlaying}</button>
            <button type="button" className="bp-btn bp-btn-danger" onClick={() => b.setConfirmEnd(true)}>{copy.endSession}</button>
          </div>
        )}

        {pick && (
          <Sheet title={copy.whoIsPlaying(pick.title)} onClose={() => b.setPick(null)}>
            {pick.externalUrl ? <p>{copy.externalNote}</p> : <p>{copy.creditNote}</p>}
            <ul className="bp-who">
              {roster.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => void b.launch(pick, p)}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.image} alt="" width={80} height={80} />
                    {p.name}
                  </button>
                </li>
              ))}
            </ul>
          </Sheet>
        )}

        {b.confirmEnd && (
          <Sheet title={copy.endConfirmTitle} onClose={() => b.setConfirmEnd(false)} closeLabel={null}>
            <p>{copy.endConfirmBody}</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button type="button" className="bp-btn bp-btn-lg" onClick={() => b.setConfirmEnd(false)}>{copy.cancel}</button>
              <button type="button" className="bp-btn bp-btn-danger bp-btn-lg" onClick={() => void b.end()}>{copy.endSession}</button>
            </div>
          </Sheet>
        )}
      </div>

      <PlayerOverlay
        board
        closeLabel={copy.backToBoard}
        game={playing?.game ?? null}
        onClose={() => void b.closeGame()}
        chrome={
          playing && (
            <div className="flex items-center gap-3 text-lg font-bold">
              <span className="inline-flex items-center gap-3 rounded-full bg-indigo-600 py-1.5 pl-1.5 pr-5 text-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={playing.who.image} alt="" width={40} height={40} className="h-10 w-10 rounded-full bg-white/20" />
                {copy.playingAs(playing.who.name)}
              </span>
              {warning && (
                <button type="button" className="min-h-12 rounded-full bg-amber-400 px-5 py-2 text-black" onClick={() => void b.stillHere()}>
                  {copy.stillPlayingTitle} {copy.keepPlaying}
                </button>
              )}
            </div>
          )
        }
      />
    </>
  );
}
