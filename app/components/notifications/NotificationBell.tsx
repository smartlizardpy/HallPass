"use client";

/**
 * HallPass — the header bell.
 *
 * A count of what is new, and a dropdown with the most recent notifications.
 * The full history and every preference live one tap further on, at
 * `/play/you/notifications`.
 *
 * ── IT RENDERS NOTHING FOR A SIGNED-OUT VISITOR ────────────────────────────
 * Not a disabled bell, not a bell that prompts you to sign in — nothing. Two
 * reasons, and the second is the load-bearing one:
 *
 *   1. There is genuinely nothing to show. A guest has no notifications and
 *      cannot acquire any.
 *   2. THE HEADER IS A HORIZONTAL BUDGET. `SiteHeader`'s docblock measures it:
 *      every control in that row costs the search field width, and on a 390px
 *      phone the wordmark was already dropped to stop the search placeholder
 *      clipping. Rendering `null` means the guest header — which is what most
 *      visitors see — is byte-for-byte what it was before this feature, and only
 *      a signed-in player pays the 44px.
 *
 * ── IT HYDRATES, IT DOES NOT PRERENDER ─────────────────────────────────────
 * Identity arrives from `/api/v1/me/notifications` after mount, exactly as
 * `AccountMenu` gets identity and its friend badge. Reading any of this on the
 * server would make every page that renders the header dynamic, which would drop
 * them out of `prerender-manifest.json` and therefore out of the service-worker
 * precache built by `scripts/build-sw-manifest.mjs`. The bell is not worth the
 * site's offline support.
 *
 * ── OPENING IT CLEARS THE BADGE, BUT NOT THE DOTS ──────────────────────────
 * Read state is one watermark per player (`024_notifications.sql`), so "mark
 * read" is all-or-nothing by construction. Opening the panel posts the mark and
 * zeroes the count immediately — but the per-item "new" dots are left alone
 * until the next fetch, so the player can still see WHICH ones were new. Zeroing
 * both at once would make the panel appear to have nothing new in it at the
 * exact moment it was opened to look.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { NOTIFICATION_KINDS, isNotificationKind } from "../../lib/notifications/config";

/**
 * The slice of `/api/v1/me/notifications` this component reads.
 *
 * Declared only as far as the bell needs, the same way `AccountMenu` declares
 * only `incoming` from the friend-count route: an unrelated change to the rest
 * of that payload cannot break this component.
 */
type BellItem = {
  id: string;
  kind: string;
  title: string;
  body: string;
  url: string;
  createdAt: string;
  isNew: boolean;
};

type BellResponse = {
  signedIn?: boolean;
  items?: BellItem[];
  unread?: number;
};

/** How often to look again while the tab is actually on screen. */
const POLL_MS = 60_000;

/**
 * The badge stops counting here.
 *
 * A precise "37" is not more useful than "9+" — both mean "more than you were
 * expecting" — and a three-digit badge changes the width of a control in a row
 * that is measured to the pixel.
 */
const BADGE_CAP = 9;

/**
 * "now", "4m", "3h", "2d", then a date.
 *
 * Deliberately coarse. A notification list is scanned, not read, and the only
 * question it answers is "is this from today". Computed on the client only —
 * this component never renders on the server, so there is no clock to
 * disagree about.
 */
function shortAgo(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, (Date.now() - then) / 1000);
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604_800) return `${Math.floor(seconds / 86_400)}d`;
  return new Date(then).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

/** The kind's glyph, or a neutral one for a kind this deploy does not know. */
function iconFor(kind: string): string {
  return isNotificationKind(kind) ? NOTIFICATION_KINDS[kind].icon : "🔔";
}

/** Everything the poll returns, held as ONE value — see {@link NotificationBell}. */
type BellState = {
  signedIn: boolean;
  items: BellItem[];
  unread: number;
};

const EMPTY: BellState = { signedIn: false, items: [], unread: 0 };

export function NotificationBell() {
  /**
   * The three fields the poll returns are ONE state, not three.
   *
   * They always change together — every one of them comes from the same
   * response — so three `useState`s would be three renders per poll, once a
   * minute, for a control mounted on every page. It also makes them impossible
   * to leave inconsistent: there is no render in which the item list has
   * updated but the unread count has not.
   */
  const [state, setState] = useState<BellState>(EMPTY);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  /**
   * A `.then` chain rather than `async`/`await`, matching `AccountMenu`.
   *
   * Not a style preference: every `setState` here has to sit inside a callback
   * so that calling this from an effect body cannot update state synchronously
   * during the effect, which is the cascading-render pattern the lint rule in
   * `eslint.config.mjs` rejects.
   */
  const load = useCallback((alive: () => boolean) => {
    fetch("/api/v1/me/notifications", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: BellResponse | null) => {
        if (!data || !alive()) return;
        setState({
          signedIn: data.signedIn === true,
          items: Array.isArray(data.items) ? data.items : [],
          unread: typeof data.unread === "number" ? data.unread : 0,
        });
      })
      .catch(() => {
        // Offline, or the round trip failed. The bell keeps whatever it last
        // knew rather than flashing empty — `/api/` is never served from the
        // service worker cache, so this is the ordinary offline path, not an
        // error.
      });
  }, []);

  // Load once, then poll ONLY while the tab is visible. A background tab polling
  // every minute is a request per minute per open tab, for a badge nobody can
  // see; the visibility listener also catches up the moment somebody returns,
  // which is when the count actually matters.
  useEffect(() => {
    let active = true;
    const alive = () => active;

    load(alive);

    const tick = () => {
      if (document.visibilityState === "visible") load(alive);
    };
    const timer = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);

    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [load]);

  // Close on an outside click or Escape — the same pair `StreakChip` handles,
  // and for the same reason: this is a dropdown, not a modal, so it does not
  // take the overlay lock or trap focus.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (!next || state.unread === 0) return;

    // Optimistic: the count goes now, and the request follows. A failed mark
    // means the count returns on the next poll, which is the right way round —
    // the alternative is a badge that lingers over a panel you are looking at.
    //
    // ONLY `unread` is cleared. The per-item `isNew` flags are left exactly as
    // they were, so the panel that just opened still shows WHICH ones were new;
    // they clear on the next poll, from the server's own watermark.
    setState((current) => ({ ...current, unread: 0 }));
    void fetch("/api/v1/me/notifications/seen", {
      method: "POST",
      credentials: "include",
    }).catch(() => {});
  };

  // Nothing at all for a guest — see the docblock. This is also the pre-fetch
  // state, so the header hydrates identical to its prerender and only grows the
  // bell once identity is known.
  if (!state.signedIn) return null;

  const { items, unread } = state;
  const badge = unread > BADGE_CAP ? `${BADGE_CAP}+` : String(unread);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={toggle}
        aria-label={
          unread > 0 ? `Notifications, ${unread} unread` : "Notifications"
        }
        aria-expanded={open}
        // `h-11 w-11` matches every other pill in the header row, so the bar
        // keeps one control height. `bg-surface-2` because the bar is white and
        // `bg-white` would leave it invisible — the same rule the streak chip
        // and the search field follow.
        className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-2 text-zinc-700 transition hover:text-brand focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/30"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="pointer-events-none"
        >
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread > 0 && (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 grid h-5 min-w-[1.25rem] place-items-center rounded-full bg-accent-pink-ink px-1 text-[10px] font-black leading-none text-white"
          >
            {badge}
          </span>
        )}
      </button>

      {open && (
        // ── THIS PANEL'S POSITION DEPENDS ON THE BELL BEING LAST ──────────
        // `right-0` anchors it to THIS BUTTON's right edge, not the viewport's,
        // and the panel is far wider than the button — so it grows LEFTWARD
        // from wherever the bell sits in the row. The `100vw` clamp below is
        // therefore only a size limit, NOT a position one: it stops the panel
        // being wider than the screen, and cannot stop it hanging off the left
        // edge when the anchor is inboard. That is exactly what happened when
        // the streak chip sat to the right of the bell — the panel started
        // ~70px in from the right of a 390px screen, ran 40px past the left
        // edge, and clipped its own heading to "otifications".
        //
        // `SiteHeader` keeps the bell LAST in the mobile row for this reason,
        // and says so at the call site. If a future control is ever added after
        // it, this panel needs viewport-relative positioning (`fixed` plus a
        // measured `top`) rather than another width clamp — no width alone can
        // fix an anchor that is too far inboard.
        <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-border bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="text-sm font-black text-zinc-900">Notifications</span>
            <Link
              href="/play/you/notifications"
              onClick={() => setOpen(false)}
              className="text-xs font-bold text-brand hover:underline"
            >
              See all
            </Link>
          </div>

          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] font-semibold text-muted">
              Nothing yet. Challenges, new games and what you unlock will show up
              here.
            </p>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto">
              {items.map((item) => (
                <li key={item.id}>
                  <Link
                    href={item.url}
                    onClick={() => setOpen(false)}
                    className={`flex gap-3 border-b border-border px-4 py-3 transition last:border-b-0 hover:bg-surface-2 ${
                      item.isNew ? "bg-brand-50/60" : ""
                    }`}
                  >
                    <span aria-hidden className="mt-0.5 shrink-0 text-base">
                      {iconFor(item.kind)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[13px] font-black text-zinc-900">
                          {item.title}
                        </span>
                        <span className="shrink-0 text-[11px] font-bold text-muted">
                          {shortAgo(item.createdAt)}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-[12px] font-semibold leading-snug text-muted">
                        {item.body}
                      </span>
                    </span>
                    {item.isNew && (
                      <span
                        aria-hidden
                        className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand"
                      />
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
