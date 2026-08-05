"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import posthog from "posthog-js";
import { Wordmark } from "./Wordmark";
import type { MeResponse } from "@/sdk/src/contract";

/**
 * A one-time announcement modal for the new social features.
 *
 * Shows the player the ONE thing they are missing — sign in, claim a username,
 * or add friends — and nothing once they have all three. Dismissals are
 * remembered per variant, so declining "sign in" does not suppress a later
 * "claim your username" once they actually have an account.
 *
 * ── WHY IT IS NOT A NATIVE <dialog> ─────────────────────────────────────────
 * `showModal()` promotes the element to the browser's TOP LAYER, which sits
 * above every z-index on the page — including `PlayerOverlay` at `z-[100]`. A
 * promo that can cover a running game is worse than no promo, so this is a plain
 * fixed element at `z-[95]`: above the page, below the player. The focus trap,
 * Esc handling and scroll lock that `<dialog>` would have given for free are
 * hand-rolled below. It also refuses to open at all while another modal has
 * locked body scroll, which is belt-and-braces for the same concern.
 *
 * ── WHY IT DOES NOT BREAK THE PRERENDER ─────────────────────────────────────
 * Everything per-viewer arrives from `/api/`, which the service worker never
 * intercepts, so the pages this mounts on stay statically prerendered and stay
 * in the precache. `usePathname` is used rather than `useSearchParams` — the
 * latter would force a Suspense boundary and de-opt every page in the layout.
 */

/**
 * `beta` is different in kind from the other three and is treated accordingly.
 *
 * The originals are NAGS — "you are missing a username", "you have no friends
 * yet" — and only the first missing thing is shown. `beta` is NEWS: something
 * the player has just been GIVEN, by an admin, at a moment the site cannot
 * predict. It therefore takes priority over the nags (being told you are in the
 * programme matters more than being reminded to add friends) and it is keyed
 * per player rather than per browser — see {@link dismissKey}.
 */
type Variant = "beta" | "signin" | "username" | "friends";

type SocialCounts = {
  signedIn: boolean;
  friends: number;
  hasUsername: boolean;
};

const STORAGE_KEY = "hp:promo-dismissed";

/**
 * Routes where a promo would interrupt rather than inform.
 *
 * The dashboard is someone working; the account and friends pages are where the
 * promo would send them anyway; sign-in and the SDK popup are mid-flow. A modal
 * over any of those is an obstacle.
 */
const SUPPRESSED_PREFIXES = [
  "/dashboard",
  "/admin",
  "/play/account",
  "/play/friends",
  "/play/signin",
  "/play/signout",
  "/play/welcome",
  "/play/auth",
  "/offline",
];

/** Let the page paint and settle before interrupting it. */
const DELAY_MS = 1500;

/** Shared by the three social variants, which all pitch the same features. */
const SOCIAL_POINTS = [
  { icon: "🏷️", text: "A unique @username other players can find" },
  { icon: "👑", text: "Badges earned from what you play and score" },
  { icon: "🤝", text: "See what your friends are playing" },
];

const COPY: Record<
  Variant,
  {
    badge: string;
    title: string;
    body: string;
    cta: string;
    href: string;
    /**
     * Per-variant selling points. These used to be a single hardcoded list in
     * the markup, which was fine while every variant was pitching the same
     * social features — the beta variant pitches something else entirely, so
     * they moved in here rather than growing a conditional in the JSX.
     */
    points: { icon: string; text: string }[];
  }
> = {
  beta: {
    badge: "Beta",
    title: "You're a beta tester",
    body: "You've been picked to try games before everyone else, and to break them on purpose.",
    cta: "See my games",
    href: "/beta",
    points: [
      { icon: "🎮", text: "Games assigned to you before they go live" },
      { icon: "🐛", text: "Earn XP for every bug we accept" },
      { icon: "📸", text: "Your screenshots on the game's page" },
    ],
  },
  signin: {
    badge: "New",
    title: "Usernames, badges and friends are here",
    body: "Sign in to claim your @username, earn badges as you play, and see what your friends are playing.",
    cta: "Sign in",
    href: "/play/signin?callbackUrl=/play/account",
    points: SOCIAL_POINTS,
  },
  username: {
    badge: "New",
    title: "Claim your @username",
    body: "Your username is how friends find you — and it is first come, first served. Grab yours before someone else does.",
    cta: "Claim it now",
    href: "/play/account",
    points: SOCIAL_POINTS,
  },
  friends: {
    badge: "New",
    title: "Add your friends",
    body: "See what your friends are playing, right on the game page. Add them by username or share your friend code.",
    cta: "Find friends",
    href: "/play/friends",
    points: SOCIAL_POINTS,
  },
};

/**
 * The dismissal key for a variant.
 *
 * `beta` is keyed PER PLAYER. A single shared key would mean the first tester to
 * use a school computer suppresses the announcement for every other account on
 * that machine — and unlike the social nags, this one is never shown again by
 * any other route, so a missed one is missed permanently. The nags keep their
 * plain per-browser key: seeing "claim your username" once per device is the
 * behaviour that already shipped, and re-keying them would re-nag everyone.
 */
function dismissKey(variant: Variant, playerId: string | null): string {
  return variant === "beta" && playerId ? `beta:${playerId}` : variant;
}

function readDismissed(): Set<string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    // Storage can be unavailable (private mode, blocked cookies). Treat that as
    // "nothing dismissed" rather than throwing — the same fail-soft posture as
    // `personalization.ts`.
    return new Set();
  }
}

function rememberDismissed(key: string): void {
  try {
    const next = readDismissed();
    next.add(key);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
  } catch {
    /* best effort */
  }
}

export function FeaturePromo() {
  const pathname = usePathname();
  const router = useRouter();
  const [variant, setVariant] = useState<Variant | null>(null);
  /** Whose beta announcement this is — see {@link dismissKey}. */
  const [playerId, setPlayerId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const dismiss = useCallback(
    (reason: "dismissed" | "accepted") => {
      setVariant((current) => {
        if (current) {
          rememberDismissed(dismissKey(current, playerId));
          posthog.capture("feature_promo_closed", { variant: current, reason });
        }
        return null;
      });
    },
    [playerId],
  );

  useEffect(() => {
    if (SUPPRESSED_PREFIXES.some((p) => pathname.startsWith(p))) return;

    let active = true;
    const timer = setTimeout(() => {
      // Something else already owns the screen (the player overlay, the mobile
      // drawer). Do not stack a promo on top of it.
      if (document.body.style.overflow === "hidden") return;

      // Both in parallel: two round trips in sequence would delay the modal by
      // the slower one for no reason, and each is a cheap no-store read.
      Promise.all([
        fetch("/api/v1/me/friends/count", { credentials: "include" })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetch("/api/v1/me", { credentials: "include" })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ])
        .then(([data, me]: [SocialCounts | null, MeResponse | null]) => {
          if (!active || !data) return;

          const dismissed = readDismissed();
          const playerId = me?.player?.id ?? null;

          // NEWS BEFORE NAGS. Being told you are now a beta tester outranks a
          // reminder to add friends, and it is the only variant the site cannot
          // re-offer by another route.
          const next: Variant | null = me?.isBetaTester
            ? "beta"
            : !data.signedIn
              ? "signin"
              : !data.hasUsername
                ? "username"
                : data.friends === 0
                  ? "friends"
                  : null;

          if (!next) return;
          // A dismissed `beta` must not fall through to a social nag on the same
          // page load — the player has already been interrupted once by this
          // component's decision, and stacking a second ask reads as badgering.
          if (dismissed.has(dismissKey(next, playerId))) return;

          setPlayerId(playerId);
          setVariant(next);
          posthog.capture("feature_promo_shown", { variant: next });
        })
        .catch(() => {
          // Offline: /api/ is never intercepted by the service worker, so this
          // simply fails and no promo appears. Correct — an offline player
          // cannot act on any of these anyway.
        });
    }, DELAY_MS);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [pathname]);

  // Esc to close, scroll lock, and initial focus — the parts `<dialog>` would
  // have handled. The previous overflow value is saved and restored rather than
  // cleared, so this cannot stomp on a lock another component set.
  useEffect(() => {
    if (!variant) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss("dismissed");
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [variant, dismiss]);

  // Keep Tab inside the panel while it is open.
  const onKeyDownTrap = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !panelRef.current) return;
    const focusable = panelRef.current.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled])',
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!variant) return null;
  const copy = COPY[variant];

  return (
    <div
      className="promo-backdrop fixed inset-0 z-[95] flex items-end justify-center bg-zinc-900/60 p-4 backdrop-blur-sm sm:items-center"
      onClick={() => dismiss("dismissed")}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="promo-title"
        aria-describedby="promo-body"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDownTrap}
        className="promo-panel relative w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl sm:p-8"
      >
        <button
          ref={closeRef}
          type="button"
          onClick={() => dismiss("dismissed")}
          aria-label="Close"
          className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full text-muted transition hover:bg-surface-2 hover:text-zinc-900 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/30"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            className="pointer-events-none"
          >
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>

        {/*
          Flex ROW, not two inline elements. `Wordmark` is an inline-flex span, so
          a bare `inline-block` pill beside it shares the same line box and its
          `margin-top` drags it down over the logo. A block-level flex container
          takes both out of the inline formatting context entirely. `pr-10` keeps
          the row clear of the absolutely positioned close button.
        */}
        <div className="flex items-center gap-2.5 pr-10">
          <Wordmark />
          {/* Brand purple for the beta badge, pink for the social "New" ones —
              the badge names a programme here rather than flagging novelty, and
              it should read as the same purple the /beta surfaces use. */}
          <span
            className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase leading-none tracking-wider text-white ${
              variant === "beta" ? "bg-brand" : "bg-accent-pink"
            }`}
          >
            {copy.badge}
          </span>
        </div>

        <h2
          id="promo-title"
          className="mt-4 text-2xl font-black leading-tight tracking-tight text-zinc-900"
        >
          {copy.title}
        </h2>
        <p
          id="promo-body"
          className="mt-2 text-[15px] font-semibold leading-relaxed text-muted"
        >
          {copy.body}
        </p>

        <ul className="mt-5 space-y-2">
          {copy.points.map((point) => (
            <PromoPoint key={point.text} icon={point.icon}>
              {point.text}
            </PromoPoint>
          ))}
        </ul>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              dismiss("accepted");
              router.push(copy.href);
            }}
            className="rounded-full bg-brand px-6 py-3 text-sm font-extrabold text-white transition hover:bg-brand-600"
          >
            {copy.cta}
          </button>
          <button
            type="button"
            onClick={() => dismiss("dismissed")}
            className="text-sm font-bold text-muted transition hover:text-zinc-900"
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}

function PromoPoint({
  icon,
  children,
}: {
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-2.5 text-[14px] font-bold text-zinc-700">
      <span aria-hidden className="text-base">
        {icon}
      </span>
      {children}
    </li>
  );
}
