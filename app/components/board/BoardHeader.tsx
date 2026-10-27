"use client";

import { Wordmark } from "@/app/components/Wordmark";
import { copy } from "@/app/lib/boardpass/copy";
import type { RosterEntry } from "@/app/lib/boardpass/sessions";
import { PlayerDock } from "./PlayerDock";

/**
 * The console-style top bar: brand and mode on the left, the player dock in the
 * middle, Add Player and End Session on the right. End Session is outlined in the
 * danger colour and set apart by a divider so it is not hit while adding someone.
 */
export function BoardHeader({
  roster,
  loading,
  newestId,
  addDisabledReason,
  endsBy,
  onAdd,
  onEnd,
  onRemove,
}: {
  roster: RosterEntry[];
  /** First read of the session is still in flight: don't claim "no players" yet. */
  loading: boolean;
  newestId: string | null;
  /** Why Add Player is unavailable, or `null` when it is available. */
  addDisabledReason: string | null;
  /** Locale time string of the hard session limit, when a session exists. */
  endsBy: string | null;
  onAdd: () => void;
  onEnd: () => void;
  onRemove: (id: string) => void;
}) {
  return (
    <header className="bp-header">
      <div className="flex flex-none items-center gap-3">
        <Wordmark size="text-3xl" dotClass="h-2 w-2" />
        <span className="bp-modechip">{copy.boardMode}</span>
      </div>
      <PlayerDock roster={roster} loading={loading} newestId={newestId} onRemove={onRemove} />
      <div className="flex flex-none items-center gap-3">
        <button type="button" className="bp-btn bp-btn-primary bp-btn-lg" onClick={onAdd} disabled={addDisabledReason !== null} aria-describedby={addDisabledReason ? "bp-add-why" : undefined}>
          + {copy.addPlayer}
        </button>
        {addDisabledReason && <span id="bp-add-why" className="sr-only">{addDisabledReason}</span>}
        {roster.length > 0 && (
          <>
            {endsBy && <span className="hidden text-base font-bold xl:inline" style={{ color: "var(--bp-muted)" }}>{copy.endsBy(endsBy)}</span>}
            <span aria-hidden className="mx-2 h-10 w-px" style={{ background: "var(--bp-line)" }} />
            <button type="button" className="bp-btn bp-btn-danger" onClick={onEnd} title={copy.endSessionHint}>
              {copy.endSession}
            </button>
          </>
        )}
      </div>
    </header>
  );
}
