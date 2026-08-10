"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import posthog from "posthog-js";
import { acquireOverlayLock, isOverlayOpen } from "../lib/overlay-lock";
import { openStealthSettings } from "../lib/stealth/store";
import {
  canUsePush,
  enablePush,
  fetchPushConfig,
  notificationPermission,
} from "../lib/push/client";
import { Wordmark } from "./Wordmark";
import type { MeResponse } from "@/sdk/src/contract";

/**
 * A one-time announcement modal for HALLPASS's headline capabilities.
 *
 * It shows the player the ONE thing they are missing — install the app, sign in,
 * claim a username, or add friends — and nothing once none apply. Dismissals are
 * remembered per variant, so declining "sign in" does not suppress a later
 * "claim your username" once they actually have an account.
 *
 * ── WHY IT IS NOT A NATIVE <dialog> ─────────────────────────────────────────
 * `showModal()` promotes the element to the browser's TOP LAYER, which sits
 * above every z-index on the page — including `PlayerOverlay` at `z-[100]`. A
 * promo that can cover a running game is worse than no promo, so this is a plain
 * fixed element at `z-[95]`: above the page, below the player. The focus trap,
 * Esc handling and scroll lock that `<dialog>` would have given for free are
 * hand-rolled below. It also refuses to open at all while anything else owns the
 * screen, which is belt-and-braces for the same concern.
 *
 * That last check asks {@link isOverlayOpen} rather than reading
 * `document.body.style.overflow` itself, and the difference is not cosmetic: the
 * string is only set by overlays that happen to lock scrolling, so a modal that
 * did not lock — stealth settings, at `z-[120]` — read as "nothing on screen".
 * The promo would then mount UNDER it and pull keyboard focus to a Close button
 * hidden behind an opaque panel. `overlay-lock.ts` has the full account.
 *
 * ── WHY IT DOES NOT BREAK THE PRERENDER ─────────────────────────────────────
 * Everything per-viewer arrives from `/api/`, which the service worker never
 * intercepts, so the pages this mounts on stay statically prerendered and stay
 * in the precache. `usePathname` is used rather than `useSearchParams` — the
 * latter would force a Suspense boundary and de-opt every page in the layout.
 */

/**
 * `install` and `beta` are different in kind from the social nags and are treated
 * accordingly.
 *
 * The social ones are NAGS — "you are missing a username", "you have no friends
 * yet" — and only the first missing thing is shown. `stealth`, `install` and
 * `beta` are NEWS: a capability the site has (hide the arcade in a blink), one
 * the device gained (the app can go offline), or one the player was granted (the
 * beta programme). All three take priority over the nags and are decided BEFORE
 * them; `stealth` and `install` need no `/api` data at all.
 */
type Variant =
  | "stealth"
  | "install"
  | "notifications"
  | "beta"
  | "signin"
  | "username"
  | "friends";

type SocialCounts = {
  signedIn: boolean;
  friends: number;
  hasUsername: boolean;
};

/**
 * The `beforeinstallprompt` event is not in the standard DOM lib types.
 * https://developer.mozilla.org/docs/Web/API/BeforeInstallPromptEvent
 */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

/** How the install variant can be completed on this device. */
type InstallMode = "native" | "ios";

const STORAGE_KEY = "hp:promo-dismissed";
/** Per-browser visit counter — the install nudge waits for a returning visitor. */
const VISITS_KEY = "hp:visits";
const SESSION_KEY = "hp:visitCounted";

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
  // `/embed/*` is a 360x440 panel the SDK mounts INSIDE a game. A full-screen
  // modal there does not sit beside the picker, it replaces it — the player
  // pressed "Challenge a friend" and got a stealth advert in a box too small to
  // show both. Same "mid-flow" reasoning as the sign-in routes below.
  "/embed",
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
     * social features — the beta and install variants pitch something else
     * entirely, so they moved in here rather than growing a conditional in the JSX.
     */
    points: { icon: string; text: string }[];
  }
> = {
  stealth: {
    badge: "Stealth",
    title: "Hide the arcade in a blink",
    body: "Disguise the tab as Google Docs and throw a fake homework screen over everything the moment someone looks over — set your own escape.",
    cta: "Set up stealth",
    // Unused: `onPrimary` opens the stealth settings modal instead of navigating.
    href: "",
    points: [
      { icon: "🕶️", text: "Cloak the tab as Docs, Classroom or Drive" },
      { icon: "🚨", text: "A panic key hides everything in one press" },
      { icon: "📳", text: "On a phone or tablet, just give it a shake" },
    ],
  },
  notifications: {
    badge: "Challenges",
    title: "Know when you're challenged",
    body: "A friend has dared you to beat their score. Turn on notifications and you'll know the moment the next one lands — instead of finding out days later.",
    cta: "Turn on notifications",
    // Unused: `onPrimary` asks the browser rather than navigating.
    href: "",
    points: [
      { icon: "\u2694\ufe0f", text: "Told the moment a friend challenges you" },
      { icon: "\ud83d\udd15", text: "On a shared device? Stealth settings hides the details" },
      { icon: "\ud83d\udcf5", text: "Only challenges — nothing else notifies you" },
    ],
  },
  install: {
    badge: "Offline",
    title: "Play offline, anywhere",
    body: "Add HALLPASS to your home screen and the whole arcade keeps working with no connection — through school filters, dead zones and locked-down wifi.",
    cta: "Install app",
    // Unused: the install variant fires the native prompt from `onPrimary`
    // rather than navigating anywhere.
    href: "",
    points: [
      { icon: "📴", text: "Every game you've opened plays with no wifi" },
      { icon: "⚡", text: "One tap from your home screen — no browser, no URL" },
      { icon: "🚀", text: "Loads instantly, even on a slow school network" },
    ],
  },
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
 * any other route, so a missed one is missed permanently. The nags — and the
 * install nudge, which is a property of the device, not the account — keep their
 * plain per-browser key.
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

/** Already installed / launched from the home screen — never pitch the install. */
function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const mm = window.matchMedia?.("(display-mode: standalone)").matches ?? false;
  const iosStandalone =
    (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  return mm || iosStandalone;
}

/** iOS never fires `beforeinstallprompt`; it needs a manual Share-sheet hint. */
function detectIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const iPhone = /iphone|ipad|ipod/i.test(ua);
  // iPadOS 13+ masquerades as desktop Safari.
  const iPadOS = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return iPhone || iPadOS;
}

/**
 * This visit's running count, incremented once per tab session. Returns 1 when
 * storage is blocked — where a dismissal could not be remembered either, so the
 * conservative "treat as a first visit" keeps the install nudge silent rather
 * than nagging every session.
 */
function bumpVisits(): number {
  try {
    if (!sessionStorage.getItem(SESSION_KEY)) {
      const v = Number(localStorage.getItem(VISITS_KEY) || "0") + 1;
      localStorage.setItem(VISITS_KEY, String(v));
      sessionStorage.setItem(SESSION_KEY, "1");
      return v;
    }
    return Number(localStorage.getItem(VISITS_KEY) || "0");
  } catch {
    return 1;
  }
}

export function FeaturePromo() {
  const pathname = usePathname();
  const router = useRouter();
  const [variant, setVariant] = useState<Variant | null>(null);
  /** Whose beta announcement this is — see {@link dismissKey}. */
  const [playerId, setPlayerId] = useState<string | null>(null);
  /** Set alongside the install variant so the panel knows which CTA to render. */
  const [installMode, setInstallMode] = useState<InstallMode | null>(null);
  /**
   * The VAPID public key, fetched while DECIDING rather than on the click.
   * `requestPermission()` needs transient user activation, and an await ahead of
   * it in the handler can outlive that — see `push/client.ts`.
   */
  const [pushKey, setPushKey] = useState<string | null>(null);
  /** The captured, deferred `beforeinstallprompt` event — the only way to install. */
  const deferredRef = useRef<BeforeInstallPromptEvent | null>(null);
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
    // A SINGLE decision per navigation. The install path (device event) and the
    // account-nag path (an `/api` round trip) both race to fill this one slot;
    // `decided` makes the first winner final and the loser a silent no-op, so
    // the two can never stack a modal on a modal.
    let decided = false;
    const cleanups: Array<() => void> = [];

    const commit = (next: Variant, forPlayer: string | null = null) => {
      if (!active || decided) return;
      // Something else already owns the screen (the player overlay, the mobile
      // drawer, stealth settings). Do not stack a promo on top of it.
      if (isOverlayOpen()) return;
      decided = true;
      setPlayerId(forPlayer);
      setVariant(next);
      posthog.capture("feature_promo_shown", { variant: next });
    };

    // ── Stealth mode (NEWS, everyone) ────────────────────────────────────────
    // The site's headline hide-from-the-room feature. Announced once to every
    // visitor so the cloak, the panic key and shake-to-panic actually get
    // discovered — needs no `/api` data. Scheduled FIRST so that while it is still
    // un-dismissed it wins the single slot ahead of install and the nags; they are
    // all one-time, so whatever loses simply shows on a later visit.
    if (!readDismissed().has("stealth")) {
      const t = window.setTimeout(() => commit("stealth"), DELAY_MS);
      cleanups.push(() => window.clearTimeout(t));
    }

    // ── Install / offline (NEWS, device-driven) ──────────────────────────────
    // Eligible only when the app is not already installed, the nudge has not been
    // dismissed, and this is a RETURNING visitor — a first-time visitor is left to
    // just play. `bumpVisits()` is called exactly once here (session-guarded).
    const installEligible =
      !isStandalone() && !readDismissed().has("install") && bumpVisits() >= 2;
    const ios = detectIOS();

    if (installEligible) {
      // iOS can never fire `beforeinstallprompt`, so offer the Share-sheet hint on
      // the same settle delay the nags use.
      if (ios) {
        const t = window.setTimeout(() => {
          setInstallMode("ios");
          commit("install");
        }, DELAY_MS);
        cleanups.push(() => window.clearTimeout(t));
      }
      // Chromium/Android: wait for the browser to confirm the app is installable,
      // capture the event so the CTA can replay it, then offer the one-tap install.
      const onBeforeInstallPrompt = (e: Event) => {
        e.preventDefault();
        deferredRef.current = e as BeforeInstallPromptEvent;
        const t = window.setTimeout(() => {
          setInstallMode("native");
          commit("install");
        }, DELAY_MS);
        cleanups.push(() => window.clearTimeout(t));
      };
      window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      cleanups.push(() =>
        window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt),
      );
    }

    // ── Account nags (existing behaviour) ────────────────────────────────────
    const timer = window.setTimeout(() => {
      if (decided) return;
      if (isOverlayOpen()) return;
      // Prefer the install nudge whenever it can actually be completed: on iOS
      // (always) or once a `beforeinstallprompt` has been captured. Its own timer
      // will show it a beat later; skipping the fetch here avoids a wasted round
      // trip and keeps the offline pitch ahead of the social ones.
      if (installEligible && (ios || deferredRef.current)) return;

      // Both in parallel: two round trips in sequence would delay the modal by
      // the slower one for no reason, and each is a cheap no-store read.
      // The notification ask is only worth a round trip when it could actually
      // be accepted: the browser can do push, the player has never answered the
      // prompt (a denial cannot be re-asked from script), and they have not
      // dismissed this promo. All three are local checks, so a player who fails
      // any of them costs nothing extra.
      const askAboutNotifications =
        canUsePush() &&
        notificationPermission() === "default" &&
        !readDismissed().has("notifications");

      Promise.all([
        fetch("/api/v1/me/friends/count", { credentials: "include" })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetch("/api/v1/me", { credentials: "include" })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        // Only asked for when it could matter — see above.
        askAboutNotifications
          ? fetch("/api/v1/me/challenges", { credentials: "include" })
              .then((r) => (r.ok ? r.json() : null))
              .catch(() => null)
          : Promise.resolve(null),
        // In the same batch, so the click handler has the key already and needs
        // to await nothing before asking for permission.
        askAboutNotifications ? fetchPushConfig() : Promise.resolve(null),
      ])
        .then(
          ([data, me, challenges, key]: [
            SocialCounts | null,
            MeResponse | null,
            { incoming?: unknown[] } | null,
            string | null,
          ]) => {
          if (!active || !data || decided) return;

          const dismissed = readDismissed();
          const nagPlayerId = me?.player?.id ?? null;

          // ASK ABOUT NOTIFICATIONS ONLY ONCE SOMEBODY HAS ACTUALLY BEEN
          // CHALLENGED. Prompting on arrival spends the one permission prompt a
          // player will ever get on a feature they have not seen work — and a
          // denial is close to permanent. Waiting until a real challenge is
          // sitting there means the ask arrives with its own reason attached.
          // Both must hold: somebody has actually challenged them, AND the
          // server can honour a subscription. Offering to turn on notifications
          // that cannot be sent would spend the prompt for nothing.
          const challenged = (challenges?.incoming?.length ?? 0) > 0 && key !== null;
          if (key) setPushKey(key);

          // NEWS BEFORE NAGS. Being told you are now a beta tester outranks a
          // reminder to add friends, and it is the only variant the site cannot
          // re-offer by another route.
          const next: Variant | null = me?.isBetaTester
            ? "beta"
            : challenged && askAboutNotifications
              ? "notifications"
              : !data.signedIn
              ? "signin"
              : !data.hasUsername
                ? "username"
                : data.friends === 0
                  ? "friends"
                  : null;

          if (!next) return;
          // A dismissed variant must not fall through to another on the same page
          // load — the player has already been interrupted once by this
          // component's decision, and stacking a second ask reads as badgering.
          if (dismissed.has(dismissKey(next, nagPlayerId))) return;

          commit(next, nagPlayerId);
        },
        )
        .catch(() => {
          // Offline: /api/ is never intercepted by the service worker, so this
          // simply fails and no promo appears. Correct — an offline player
          // cannot act on any of these anyway.
        });
    }, DELAY_MS);
    cleanups.push(() => window.clearTimeout(timer));

    return () => {
      active = false;
      for (const fn of cleanups) fn();
    };
  }, [pathname]);

  // Esc to close, scroll lock, and initial focus — the parts `<dialog>` would
  // have handled. The lock is ref-counted (see `overlay-lock.ts`), so the page is
  // handed back to whoever else is holding it rather than to nobody.
  useEffect(() => {
    if (!variant) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss("dismissed");
    };
    document.addEventListener("keydown", onKey);
    const releaseLock = acquireOverlayLock();
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      releaseLock();
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

  const isInstall = variant === "install";
  const iosInstall = isInstall && installMode === "ios";
  // iOS cannot be handed a one-tap install, so the panel becomes instructional
  // and the CTA just acknowledges it.
  const body = iosInstall
    ? "In Safari, tap the Share button, then “Add to Home Screen.” The whole arcade then plays offline — no wifi, no filters, no problem."
    : copy.body;
  const ctaLabel = iosInstall ? "Got it" : copy.cta;

  const onPrimary = () => {
    if (isInstall) {
      const deferred = deferredRef.current;
      if (installMode === "native" && deferred) {
        // Consume the event first: it is single-use, and dismissing before the
        // async prompt keeps our modal from lingering behind the browser's.
        deferredRef.current = null;
        dismiss("accepted");
        void deferred
          .prompt()
          .then(() => deferred.userChoice)
          .catch(() => {
            /* user closed the native prompt — nothing to do */
          });
        return;
      }
      // iOS (or a native event that vanished): the how-to is on screen already.
      dismiss("accepted");
      return;
    }
    if (variant === "stealth") {
      // Open the settings modal `StealthController` owns rather than navigating.
      dismiss("accepted");
      openStealthSettings();
      return;
    }
    if (variant === "notifications" && pushKey) {
      // Dismiss FIRST, then ask. The browser's permission prompt is modal and
      // would otherwise appear on top of this panel, and `enablePush` must run
      // inside this click — a permission request outside a user gesture is
      // refused, and on some browsers that counts as a denial the player can
      // never undo from script.
      dismiss("accepted");
      void enablePush(pushKey);
      return;
    }
    dismiss("accepted");
    router.push(copy.href);
  };

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
          {/* Brand purple for the news badges (stealth, beta, install,
              notifications) — they name a capability rather than flagging
              novelty — pink for the social "New" ones. */}
          <span
            className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase leading-none tracking-wider text-white ${
              variant === "beta" ||
              variant === "install" ||
              variant === "stealth" ||
              variant === "notifications"
                ? "bg-brand"
                : "bg-accent-pink-ink"
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
          {body}
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
            onClick={onPrimary}
            className="rounded-full bg-brand px-6 py-3 text-sm font-extrabold text-white transition hover:bg-brand-600"
          >
            {ctaLabel}
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
