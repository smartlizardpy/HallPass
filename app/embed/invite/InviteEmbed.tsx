"use client";

/**
 * The invite picker's client half: choose friends, invite them, share a link.
 *
 * ── HOW IT TALKS BACK TO THE SDK ───────────────────────────────────────────
 * The challenge picker's three transports (`ChallengeEmbed.tsx` explains why
 * all three), under its own key. MIRRORED BY HAND from `sdk/src/invite.ts`: the
 * key, the `phase` words and the fields. Change one and change the other.
 *
 *   - `open` once mounted — tells an inline host the page actually loaded;
 *   - `update` after every invite or link, with RUNNING TOTALS, so a popup the
 *     player closes with the window's own button has already reported;
 *   - `closed` from the Close button, after which the host tears down.
 *
 * Every message carries the nonce from the URL, which is how the SDK ignores a
 * picker that belongs to another call. `targetOrigin` is `"*"` for the reason
 * `ChallengeEmbed.tsx` gives (a cross-origin opener's origin is unknown); what
 * crosses is a count and a link the player chose to make — never a name, an id
 * or anything about the friend list.
 *
 * ── THE PLAYER CLOSES IT ───────────────────────────────────────────────────
 * Inviting does not dismiss the panel: the player may invite more people or
 * make a link afterwards, and an `update` does not tear the frame down.
 *
 * ── KID SAFETY ─────────────────────────────────────────────────────────────
 * The list is the player's OWN friends (public display names, the avatar they
 * already see on their friends page). Nothing here goes into the shared text of
 * a link but the game's title: the sender is named only on `/i/<code>`, by
 * public display name.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import posthog from "posthog-js";
import type { InvitableFriend } from "@/app/lib/invites/store";
import { inviteRefusalText } from "@/app/lib/invites/config";
import { Avatar } from "@/app/components/friends/Avatar";

/** Mirrored by hand in `sdk/src/invite.ts`. */
const SIGNAL_KEY = "hallpass:invite";

const BTN_PRIMARY =
  "rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white transition hover:bg-brand-600 disabled:opacity-50";
const BTN_SECONDARY =
  "rounded-full border border-border bg-surface px-4 py-2 text-sm font-bold text-foreground-2 transition hover:bg-surface-2 disabled:opacity-50";

type Phase = "open" | "update" | "closed";

/**
 * Announce on all three channels. Every step is guarded on its own: a sandboxed
 * frame, private mode or a COOP-severed opener must not stop the others.
 */
function signal(nonce: string, phase: Phase, sent: number, link: string | null): void {
  const payload = { type: SIGNAL_KEY, n: nonce, phase, sent, link };
  try {
    const host = window.opener ?? window.parent;
    if (host && host !== window) host.postMessage(payload, "*");
  } catch {
    // COOP can make even reading `opener` throw.
  }
  try {
    const channel = new BroadcastChannel(SIGNAL_KEY);
    channel.postMessage(payload);
    channel.close();
  } catch {
    // No BroadcastChannel here.
  }
  try {
    // Written, then removed: the `storage` event fires for other documents on
    // the write, and removing it leaves nothing — not even a link — sitting in
    // storage on a shared machine. `t` makes a repeated payload a new value.
    window.localStorage.setItem(SIGNAL_KEY, JSON.stringify({ ...payload, t: Date.now() }));
    window.localStorage.removeItem(SIGNAL_KEY);
  } catch {
    // Private mode, or storage is full.
  }
}

/** A popup closes itself; an inline frame is removed by the SDK on `closed`. */
function closeSelf(): void {
  try {
    if (window.opener) window.close();
  } catch {
    // The signal already told the SDK to tear down.
  }
}

type LinkState =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "done"; url: string; how: "shared" | "copied" | "shown" }
  | { kind: "failed"; message: string };

type InviteState = { kind: "idle" } | { kind: "sending" } | { kind: "failed"; message: string };

export function InviteEmbed({
  nonce,
  signedIn,
  problem,
  game,
  data,
  minutes,
  friends,
}: {
  nonce: string;
  signedIn: boolean;
  /** A sentence explaining why nothing can be sent, or `null`. */
  problem: string | null;
  game: { slug: string; title: string } | null;
  data: Record<string, unknown> | null;
  minutes: number;
  friends: InvitableFriend[];
}) {
  const [chosen, setChosen] = useState<Set<string>>(() => new Set());
  const [invited, setInvited] = useState<Set<string>>(
    () => new Set(friends.filter((f) => f.invitedRecently).map((f) => f.id)),
  );
  const [inviteState, setInviteState] = useState<InviteState>({ kind: "idle" });
  const [linkState, setLinkState] = useState<LinkState>({ kind: "idle" });
  const [sentNote, setSentNote] = useState<string | null>(null);

  // Running totals for the SDK. Refs, so every signal carries the latest
  // values without re-creating the handlers that read them.
  const sentTotal = useRef(0);
  const lastLink = useRef<string | null>(null);
  const closed = useRef(false);

  useEffect(() => {
    signal(nonce, "open", 0, null);
  }, [nonce]);

  const close = useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    signal(nonce, "closed", sentTotal.current, lastLink.current);
    closeSelf();
  }, [nonce]);

  const toggle = useCallback((id: string) => {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const sendInvites = useCallback(async () => {
    if (!game || !data || chosen.size === 0) return;
    setInviteState({ kind: "sending" });
    setSentNote(null);
    const to = [...chosen];
    try {
      const res = await fetch("/api/v1/me/invites", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ game: game.slug, data, to, expiresInMinutes: minutes }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; sent?: number; reason?: string };
      if (!res.ok || !body.ok) {
        setInviteState({ kind: "failed", message: inviteRefusalText(body.reason) });
        return;
      }
      const sent = typeof body.sent === "number" ? body.sent : 0;
      sentTotal.current += sent;
      // Everybody asked is now "Invited": those just sent, and any the server
      // skipped because they already have a live invite from this player.
      setInvited((prev) => new Set([...prev, ...to]));
      setChosen(new Set());
      setInviteState({ kind: "idle" });
      setSentNote(
        sent === 0
          ? "They already have an invite from you."
          : `Invited ${sent} ${sent === 1 ? "friend" : "friends"}. They have ${minutes} minutes to join.`,
      );
      posthog.capture("game_invite_sent", { game: game.slug, count: sent });
      signal(nonce, "update", sentTotal.current, lastLink.current);
    } catch {
      setInviteState({ kind: "failed", message: "No connection. Try again in a moment." });
    }
  }, [chosen, data, game, minutes, nonce]);

  const shareLink = useCallback(async () => {
    if (!game || !data) return;
    let url = linkState.kind === "done" ? linkState.url : null;
    if (!url) {
      setLinkState({ kind: "working" });
      try {
        const res = await fetch("/api/v1/me/invites", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ game: game.slug, data, link: true, expiresInMinutes: minutes }),
        });
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean; code?: string; reason?: string };
        if (!res.ok || !body.ok || !body.code) {
          setLinkState({ kind: "failed", message: inviteRefusalText(body.reason) });
          return;
        }
        // From THIS page's origin, like `ShareChallenge`: a preview deployment
        // shares a preview link.
        url = new URL(`/i/${encodeURIComponent(body.code)}`, window.location.origin).toString();
      } catch {
        setLinkState({ kind: "failed", message: "No connection. Try again in a moment." });
        return;
      }
      lastLink.current = url;
      signal(nonce, "update", sentTotal.current, url);
    }

    if (typeof navigator.share === "function") {
      try {
        // Names the game, never the player: this text lands in group chats.
        await navigator.share({ title: `Play ${game.title}`, text: `Come and play ${game.title} with me!`, url });
        posthog.capture("game_invite_link_shared", { game: game.slug, via: "sheet" });
        setLinkState({ kind: "done", url, how: "shared" });
        return;
      } catch {
        // Dismissed, or refused in this frame. Copy instead.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      posthog.capture("game_invite_link_shared", { game: game.slug, via: "clipboard" });
      setLinkState({ kind: "done", url, how: "copied" });
    } catch {
      // No clipboard here. The URL on screen is the last rung, and it works.
      posthog.capture("game_invite_link_shared", { game: game.slug, via: "manual" });
      setLinkState({ kind: "done", url, how: "shown" });
    }
  }, [data, game, linkState, minutes, nonce]);

  const canShare = Boolean(game && data && !problem);

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <h1 className="text-sm font-black tracking-tight text-foreground">
        {game ? <>Invite friends to {game.title}</> : <>Invite friends</>}
      </h1>

      {problem ? (
        <p className="mt-2 text-[13px] font-semibold text-muted">{problem}</p>
      ) : !signedIn ? (
        <p className="mt-2 text-[13px] font-semibold text-muted">
          Sign in to invite friends. You can still share a link.
        </p>
      ) : friends.length === 0 ? (
        <p className="mt-2 text-[13px] font-semibold text-muted">
          None of your friends can join this game yet. Share a link instead.
        </p>
      ) : (
        <>
          <p className="mt-1 text-[13px] font-semibold text-muted">
            Pick friends to join you. Invites last {minutes} minutes.
          </p>
          <ul aria-label="Your friends" className="mt-3 max-h-56 space-y-1 overflow-y-auto">
            {friends.map((friend) => {
              const done = invited.has(friend.id);
              const on = chosen.has(friend.id);
              return (
                <li key={friend.id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={done || on}
                    aria-disabled={done}
                    disabled={done || inviteState.kind === "sending"}
                    onClick={() => toggle(friend.id)}
                    className={`flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left transition disabled:cursor-default ${
                      on ? "bg-brand-50" : "hover:bg-surface-2"
                    }`}
                  >
                    <Avatar person={friend} size={28} />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-foreground">
                      {friend.displayName}
                    </span>
                    {done ? (
                      <span className="text-xs font-bold text-muted">Invited</span>
                    ) : (
                      <span
                        aria-hidden
                        className={`grid h-4 w-4 place-items-center rounded border text-[10px] font-black ${
                          on ? "border-brand bg-brand text-white" : "border-border"
                        }`}
                      >
                        {on ? "✓" : ""}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {sentNote ? (
        <p role="status" className="mt-3 text-[13px] font-semibold text-brand">
          {sentNote}
        </p>
      ) : null}
      {inviteState.kind === "failed" ? (
        <p role="alert" className="mt-3 text-[13px] font-semibold text-rose-700 dark:text-rose-300">
          {inviteState.message}
        </p>
      ) : null}

      {linkState.kind === "done" ? (
        <div className="mt-3">
          <p className="text-xs font-bold text-brand">
            {linkState.how === "copied" ? "Link copied" : linkState.how === "shared" ? "Link shared" : "Your link"}
          </p>
          {/* `readOnly`, not `disabled`, so it can be selected and copied by hand. */}
          <input
            readOnly
            value={linkState.url}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Your invite link"
            className="mt-1 w-full rounded-lg border border-border bg-surface-2 px-2 py-1 text-xs text-muted"
          />
        </div>
      ) : null}
      {linkState.kind === "failed" ? (
        <p role="alert" className="mt-3 text-[13px] font-semibold text-rose-700 dark:text-rose-300">
          {linkState.message}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        {canShare ? (
          <button
            type="button"
            className={BTN_SECONDARY}
            disabled={linkState.kind === "working"}
            onClick={shareLink}
          >
            {linkState.kind === "working" ? "Making link…" : "Share link"}
          </button>
        ) : null}
        <button type="button" className={BTN_SECONDARY} onClick={close}>
          Close
        </button>
        {canShare && signedIn && friends.length > 0 ? (
          <button
            type="button"
            className={BTN_PRIMARY}
            disabled={chosen.size === 0 || inviteState.kind === "sending"}
            onClick={sendInvites}
          >
            {inviteState.kind === "sending"
              ? "Inviting…"
              : chosen.size > 1
                ? `Invite ${chosen.size}`
                : "Invite"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
