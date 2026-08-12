"use client";

/**
 * HallPass — the links this player has posted, and the way to kill one.
 *
 * ── REVOKE IS THE REASON THIS COMPONENT EXISTS ─────────────────────────────
 * A challenge link is the one thing in HallPass a child publishes about
 * themselves into a place we cannot reach — a story, a group chat, a bio. The
 * design accepted that on the condition that they can always take it back, and
 * a revoke endpoint with no button in front of it does not satisfy that
 * condition. Everything else here — the counts, the copy button — is the
 * payoff; this is the safety control.
 *
 * ── WHAT THE NUMBERS MEAN, AND WHY THEY ARE WORTH SHOWING ──────────────────
 * `opens` counts presses of "Beat it", including from people with no account,
 * so it is the only evidence a player gets that posting the link did anything
 * at all. `beaten` is the sting, and it is the whole point of the feature: the
 * number that makes somebody go and reclaim their board.
 *
 * A revoked link keeps its row and its counts. It is history rather than
 * clutter, and the code stays claimed so it can never be handed to somebody
 * else — see `025_challenge_links.sql`.
 *
 * ── OPTIMISTIC, BUT ONLY IN THE SAFE DIRECTION ─────────────────────────────
 * Revoking marks the row dead in the UI immediately and reconciles on the next
 * load. If the request actually failed, the player believes a live link is dead
 * — which is the wrong way round for a safety control, so the row says so
 * loudly on failure rather than silently reverting.
 */

import { useCallback, useState } from "react";
import type { OwnedLink } from "@/app/lib/challenges/store";
import { challengeLinkPath } from "@/app/lib/challenges/link";

type RowState = "live" | "revoking" | "revoked" | "failed";

export function ChallengeLinks({ links }: { links: OwnedLink[] }) {
  const [states, setStates] = useState<Record<string, RowState>>({});

  const revoke = useCallback(async (code: string) => {
    setStates((s) => ({ ...s, [code]: "revoking" }));
    try {
      const res = await fetch("/api/v1/me/challenges/link", {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      setStates((s) => ({ ...s, [code]: res.ok ? "revoked" : "failed" }));
    } catch {
      setStates((s) => ({ ...s, [code]: "failed" }));
    }
  }, []);

  if (links.length === 0) return null;

  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <h2 className="text-sm font-black uppercase tracking-wide text-foreground">
        Your challenge links
      </h2>
      <p className="mt-2 text-sm text-muted">
        Anyone with the link can play — no account needed. Take one down
        whenever you like.
      </p>

      <ul className="mt-4 space-y-2">
        {links.map((link) => {
          const state = states[link.code] ?? (link.revokedAt ? "revoked" : "live");
          const dead = state === "revoked";
          return (
            <li
              key={link.code}
              className={`rounded-lg border border-border bg-surface-2 px-4 py-3 ${
                dead ? "opacity-60" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-bold text-foreground">
                    {link.boardTitle}
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    {dead ? (
                      "Taken down"
                    ) : (
                      <>
                        {link.opens.toLocaleString("en-US")} opened ·{" "}
                        {link.beaten.toLocaleString("en-US")} beat your{" "}
                        {link.targetScore.toLocaleString("en-US")}
                      </>
                    )}
                  </div>
                </div>

                {dead ? null : (
                  <button
                    type="button"
                    onClick={() => revoke(link.code)}
                    disabled={state === "revoking"}
                    className="shrink-0 rounded-full border border-border bg-white px-3 py-1 text-xs font-bold text-zinc-700 transition hover:border-rose-400 hover:text-rose-700 disabled:opacity-50"
                  >
                    {state === "revoking" ? "…" : "Take down"}
                    <span className="sr-only"> the link for {link.boardTitle}</span>
                  </button>
                )}
              </div>

              {dead ? null : (
                <input
                  readOnly
                  value={challengeLinkPath(link.code)}
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label={`Link for ${link.boardTitle}`}
                  className="mt-2 w-full rounded-lg border border-border bg-white px-2 py-1 text-xs text-muted"
                />
              )}

              {state === "failed" ? (
                <p role="alert" className="mt-2 text-xs font-semibold text-rose-700">
                  We couldn&rsquo;t take that down — it may still be live. Try again.
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
