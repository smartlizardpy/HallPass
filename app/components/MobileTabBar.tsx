"use client";

/**
 * HallPass mobile — the bottom tab bar.
 *
 * WHY A GLOBAL ISLAND, not part of `ArcadeShell`. The tabs span pages that do NOT
 * share the arcade chrome — the `/play/you` section (profile, friends, settings)
 * is its own `<main>` with no `ArcadeShell` — so the bar has to live above it.
 * Rendering it once in the root layout body (next to `<PWA/>` / `<FeaturePromo/>`)
 * makes it route-agnostic and keeps every page otherwise untouched.
 *
 * WHY IT RENDERS NOTHING ON THE SERVER AND ON DESKTOP. `useDevicePlatform()` is
 * `null` until mounted, so the bar is absent from the prerendered HTML the crawler
 * and the service-worker precache see, and it only appears on the second paint on
 * an actual phone. Desktop never gets it. Same hydration rule as the rest of the
 * mobile shell.
 *
 * BOTTOM CHROME. Because it owns the bottom edge, it publishes its measured height
 * to `--hp-bottom-chrome` so other floating elements clear it — see the effect
 * below and `app/lib/bottom-chrome.ts`.
 *
 * WHERE THE TABS COME FROM. The destinations, their order and — the part that
 * matters — the rule each one uses to decide it is current all come from
 * `PRIMARY_NAV` in `./primary-nav`, the same table `SiteHeader` reads for its top
 * bar. Those two are the table's only consumers: the desktop rail drew these
 * three as well when the table was extracted, but it has since given the
 * destinations up to the header and kept only the genre filter. This bar is where
 * the three were first designed (that table's docblock calls itself "the desktop
 * answer to that bar"), and it carried its own hand-written copy of the matching
 * rules until the table existed. Two copies of the You/Friends carve-out below is
 * exactly the drift the table was extracted to prevent, so there is now one copy,
 * here as everywhere.
 *
 * WHAT STAYS LOCAL, AND WHY. A phone tab is a glyph with a word under it, so this
 * surface cares about the presentation the other two can shrug off:
 *
 *   1. THE ICONS ARE DRAWN, NOT WRAPPED. `PRIMARY_NAV`'s fragments are stroke-only
 *      line art on a 24-unit viewBox, which is this bar's grid as much as
 *      `NavIcon`'s — so the fragments come straight from the table, but into the
 *      local `<svg>` in `TabInner`, at 24x24 rather than `NavIcon`'s 20x20. A tab
 *      icon has to carry a row on its own at thumb distance; `NavIcon`'s 20px is
 *      sized for a glyph with a label beside it in a scan-column. Do not import
 *      `NavIcon` here to "share one more thing" — that would silently shrink
 *      every tab.
 *   2. `PHONE_FACE` OVERRIDES THE FACE, NEVER THE DESTINATION. Where the phone
 *      names or draws a shared destination differently, it says so there and
 *      nowhere else. It is deliberately not a second tab list: `href`, `match` and
 *      the order are the table's, and an entry with no override wears the table's
 *      label and glyph.
 *
 * THE WAIT BETWEEN THE TAP AND THE PAGE — the bar's one piece of behaviour that
 * is not navigation. You and Friends point into `/play/you`, which is dynamic
 * AND uncacheable (`public/sw.js` refuses to store it: `hp-runtime` is shared by
 * everyone on the browser profile), so a tap on either cannot be answered from
 * anything already on the device — it has to go to the server, and until the
 * first byte arrives the only thing that changes on screen is the tab turning
 * purple. On a school wifi that is several seconds of an app that looks like it
 * ignored you.
 *
 * Neither of the server-side answers can cover that window, because both live on
 * the far side of it: the `<Suspense>` bones in `app/play/you/layout.tsx` arrive
 * at the speed of the first byte, and the `/offline/you` card needs a navigation
 * to fail first AND a service worker recent enough to know about it — an
 * installed PWA keeps whichever one it last installed until it is relaunched
 * with a connection, so on a phone that card can be a deploy behind the browser
 * tab where it works. This bar is the only surface that can answer instantly, so
 * it does: a skeleton at 150ms, the same offline card at once when the device
 * knows it has no network, and a "still loading" notice when the wait passes
 * five seconds. `app/lib/tab-gate.ts` holds the rule and `offline/TabWaitOverlay`
 * draws it; which tabs are covered is DERIVED from the href (`needsNetwork`), so
 * it cannot drift from what the service worker will and will not cache.
 *
 * ADMIN. There is deliberately no admin tab. The dashboard is reachable from
 * inside the You tab (the `/play/you` section carries a role-gated Dashboard
 * link), so the bar never changes shape based on who is signed in.
 *
 * STEALTH — WHY THERE IS NO TAB ANY MORE. The phone shell drops the genre
 * hamburger, so the sidebar's "Stealth mode" entry is unreachable on a phone,
 * which once left shake-to-panic (a touch-only trigger) impossible to switch on
 * from the one class of device that can fire it. A Stealth tab was that door.
 * `/play/you/settings` now carries a stealth row, so the door still exists and
 * the case for spending a whole tab on it is gone. The need behind it has NOT
 * gone: if that settings row ever disappears, shake-to-panic goes unreachable on
 * a phone again, so give it another route rather than assuming the sidebar
 * covers it.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useDevicePlatform } from "../lib/use-device-platform";
import { useOnline } from "../lib/use-online";
import { clearBottomChrome, publishBottomChrome } from "../lib/bottom-chrome";
import {
  SKELETON_DELAY_MS,
  SLOW_NOTICE_MS,
  needsNetwork,
  tabGateView,
} from "../lib/tab-gate";
import { TabWaitOverlay } from "./offline/TabWaitOverlay";
import { PRIMARY_NAV, normalizePath } from "./primary-nav";

/** Routes that are their own full-screen world — no player tab bar over them. */
const HIDDEN_PREFIXES = [
  "/dashboard",
  // Same reason the promo is suppressed there: `/embed/*` is a small panel
  // mounted inside a game, and site navigation has no business inside it.
  "/embed",
  "/play/signin",
  "/play/signout",
  "/play/welcome",
  "/play/auth",
];

/**
 * What the phone calls a shared destination, and what it draws for it — keyed by
 * the `PRIMARY_NAV` href it overrides. Presentation ONLY: nothing in here can add,
 * remove, reorder or re-point a tab, so this bar and the desktop surfaces cannot
 * end up disagreeing about where a tab goes or when it is lit.
 *
 * Only `/` needs an entry. Friends and You wear the table's own label and glyph,
 * because those two marks were drawn for this bar in the first place and
 * `PRIMARY_NAV` adopted them verbatim (its icon comments say so) — sharing them is
 * how they stay one mark instead of two that drift.
 *
 * `/` is the exception on both counts. On desktop that destination is "Games", one
 * of several places the rail can take you. Here it is the way back out of every
 * other tab, which is what a phone tab bar's first slot means, so it is "Home"
 * under a house — the word and the glyph a thumb expects at the bottom-left of a
 * phone. It is deliberately NOT the table's gamepad, which reads as "the games
 * section" rather than "back to the start".
 */
const PHONE_FACE: Record<string, { label?: string; icon?: React.ReactNode }> = {
  "/": {
    label: "Home",
    icon: <path d="M3 11l9-8 9 8M5 10v10h14V10" />,
  },
};

/**
 * What the offline card calls a destination, keyed by href.
 *
 * The card says "connect to wifi to open ___", which wants a noun phrase rather
 * than a tab label: "your You page" reads, "You" does not. Only the gated tabs
 * need an entry — anything missing falls back to the tab's own label, which is
 * the correct answer for a tab that never shows the card anyway.
 */
const OFFLINE_DESTINATION: Record<string, string> = {
  "/play/you": "your You page",
  "/play/you/friends": "your friends list",
};

function destinationName(href: string, label: string): string {
  return OFFLINE_DESTINATION[href] ?? `the ${label} tab`;
}

/**
 * One tap on a gated tab: where it was going, what to call that, and — the field
 * everything hangs off — the page it was made FROM.
 *
 * `from` is what makes the overlay self-clearing. While the router is still on
 * that page nothing has happened yet; the instant `usePathname()` reports
 * anything else, the navigation has committed (or been abandoned for another
 * one) and the journey is over. No timer, no completion callback, no state to
 * unwind — and no way to leave a skeleton on top of a page that has arrived.
 */
type Journey = {
  href: string;
  from: string;
  destination: string;
  /** Does this destination need the network — i.e. is the overlay involved? */
  gated: boolean;
};

const journeyId = (journey: Journey) => `${journey.from}>${journey.href}`;

export function MobileTabBar() {
  const device = useDevicePlatform();
  const isMobile = device === "mobile";
  // Normalised, because `next.config.ts` sets `skipTrailingSlashRedirect: true`:
  // `/play/you/` is SERVED rather than redirected, so `usePathname()` reports
  // whatever spelling the browser is on, and `PRIMARY_NAV`'s `match` predicates
  // compare bare paths and document that the caller owes them this call. Same line
  // as the rail and the top bar, so all three agree on a slashed URL.
  const pathname = normalizePath(usePathname() ?? "/");
  const barRef = useRef<HTMLElement | null>(null);

  const hidden =
    !isMobile || HIDDEN_PREFIXES.some((p) => pathname.startsWith(p));

  // ── THE WAIT BETWEEN THE TAP AND THE PAGE ─────────────────────────────────
  //
  // Two taps to remember, one clock. `app/lib/tab-gate.ts` holds the rule and
  // `TabWaitOverlay` draws it; this is only the bookkeeping.
  //
  // BOTH RECORD THE PAGE THEY WERE MADE ON, and everything else is DERIVED from
  // comparing that with the live `pathname`. That is what makes "the navigation
  // finished" and "the overlay goes away" the same event rather than two that
  // can disagree: the moment the route commits — to the destination, or to Home
  // because the player gave up and tapped it — `from` stops matching and the
  // overlay is gone on that render. No effect, no cascading setState, and no way
  // for bones to outlive the page they were standing in for.
  const online = useOnline();
  const [navigation, setNavigation] = useState<Journey | null>(null);
  const [refusal, setRefusal] = useState<Journey | null>(null);
  const [stage, setStage] = useState<{ id: string; ms: number } | null>(null);

  const pending = navigation !== null && navigation.from === pathname;
  const waiting = pending && navigation.gated;
  const refusedFor = refusal?.from === pathname ? refusal.destination : null;
  const waitedMs =
    waiting && stage?.id === journeyId(navigation) ? stage.ms : 0;

  // The two thresholds, as two timeouts keyed to this particular journey. A
  // `setTimeout` firing is not a synchronous setState during an effect, which is
  // the pattern the lint rule (correctly) forbids; and the `id` check above
  // means a stale timer from a previous tap cannot age the current one.
  useEffect(() => {
    if (!waiting || !navigation) return;
    const id = journeyId(navigation);
    const toSkeleton = setTimeout(
      () => setStage({ id, ms: SKELETON_DELAY_MS }),
      SKELETON_DELAY_MS,
    );
    const toNotice = setTimeout(
      () => setStage({ id, ms: SLOW_NOTICE_MS }),
      SLOW_NOTICE_MS,
    );
    return () => {
      clearTimeout(toSkeleton);
      clearTimeout(toNotice);
    };
  }, [waiting, navigation]);

  // The card goes away by itself the moment the thing it asked for happens —
  // "connect to wifi" still on screen after you have is just a second wrong
  // answer. Done through the event rather than by watching `online` in an
  // effect, so the state is CLEARED rather than merely hidden: a card that was
  // only hidden would come back on the next disconnection, with nobody having
  // asked for it.
  useEffect(() => {
    const clear = () => setRefusal(null);
    window.addEventListener("online", clear);
    return () => window.removeEventListener("online", clear);
  }, []);

  const dismissRefusal = useCallback(() => setRefusal(null), []);

  const startJourney = useCallback((journey: Journey) => {
    // A new tap supersedes whatever the last one was told.
    setRefusal(null);
    setNavigation(journey);
  }, []);

  const refuseJourney = useCallback((journey: Journey) => {
    setNavigation(null);
    setRefusal(journey);
  }, []);

  const view = tabGateView({
    refused: refusedFor !== null,
    online,
    pending: waiting,
    waitedMs,
  });

  // The bar covers the bottom edge of the viewport, so it owes two things to the
  // rest of the app: padding at the end of the page, so it never sits over the
  // last row of content, and a published height, so anything FLOATING above the
  // bottom edge clears it (`app/lib/bottom-chrome.ts`). Both are done from here,
  // not in global CSS, so they exist exactly when the bar does — on a phone, after
  // mount — and are removed cleanly on desktop or on a route that hides it.
  //
  // MEASURED, not the `calc(4rem + env(safe-area-inset-bottom))` constant this
  // used to hardcode. The constant lies in one real case: `lg:hidden` keeps the
  // bar off screen on a large tablet that still reports a coarse, hoverless
  // pointer, and there the component mounts while the bar renders nothing.
  // `offsetHeight` is 0 for a hidden element, so both the padding and the
  // published height correctly become "no bar here". It also picks up the bar's
  // own safe-area padding and its top border, so the number is what the bar
  // actually costs rather than what it was assumed to cost.
  useEffect(() => {
    if (hidden) return;
    const bar = barRef.current;
    if (!bar) return;

    const previousPadding = document.body.style.paddingBottom;
    const measure = () => {
      const height = bar.offsetHeight;
      publishBottomChrome(height);
      document.body.style.paddingBottom =
        height > 0 ? `${height}px` : previousPadding;
    };

    measure();
    // Crossing the `lg` breakpoint and rotating the device (which changes the
    // safe-area inset) both arrive as a resize; re-measuring is idempotent, so
    // the noisier triggers — an Android keyboard opening, say — cost nothing.
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
      clearBottomChrome();
      document.body.style.paddingBottom = previousPadding;
    };
  }, [hidden]);

  if (hidden) return null;

  return (
    <>
      {/* The overlay is a SIBLING of the bar, not a child: it covers the page,
          and the bar stays above it (`z-40` over `z-30`) so Home is always one
          tap away. The destination named is the refused one if there is one, and
          otherwise whatever is currently being fetched. */}
      {view !== "none" && (
        <TabWaitOverlay
          view={view}
          destination={refusedFor ?? navigation?.destination ?? "this page"}
          onDismiss={dismissRefusal}
        />
      )}

      <nav
        ref={barRef}
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-border bg-white/95 backdrop-blur-xl lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {/* One tab per `PRIMARY_NAV` entry, in the table's order — never a
            hand-typed copy of the hrefs or the matching rules. `entry.match` is why:
            Friends lives UNDER the You section, so both tabs would light up on
            `/play/you/friends` if You matched the whole subtree, and that carve-out
            (Friends wins its own route, You covers the rest of the section — profile,
            settings) is stated once, in the table, for all three nav surfaces. The
            copy that used to sit here is exactly the kind that gets "corrected" into
            a two-tabs-lit bug.

            `PHONE_FACE` supplies the label and glyph where the phone's differ; the
            fragment lands in `TabInner`'s own 24x24 `<svg>`, which shares the table's
            24-unit grid but not `NavIcon`'s 20px size. */}
        {PRIMARY_NAV.map((entry) => {
          const face = PHONE_FACE[entry.href];
          const label = face?.label ?? entry.label;
          return (
            <TabLink
              key={entry.href}
              href={entry.href}
              label={label}
              // ONE TAB IS LIT AT A TIME, ALWAYS. `entry.match(pathname)` is the
              // right answer at rest, but during a navigation the router is
              // still on the old route while the tapped tab lights up from its
              // own `useLinkStatus` — so for as long as the trip lasted, TWO
              // tabs were purple: the page you were leaving and the one you
              // asked for. On the tabs this bar is built around that is seconds,
              // and it reads as the bar having lost track of where you are.
              // While a journey is in flight the destination IS the answer, and
              // the moment it commits `pathname` takes over again.
              active={pending ? entry.href === navigation.href : entry.match(pathname)}
              // Which tabs are watched is DERIVED from the href, not listed:
              // `needsNetwork` asks the same question `public/sw.js` asks about
              // what it may cache, so a fourth tab pointing into that subtree is
              // covered the day it is added, and Home — precached, and instant
              // offline — is left completely alone.
              gated={needsNetwork(entry.href)}
              from={pathname}
              destination={destinationName(entry.href, label)}
              online={online}
              onStart={startJourney}
              onRefuse={refuseJourney}
            >
              {face?.icon ?? entry.icon}
            </TabLink>
          );
        })}
      </nav>
    </>
  );
}

/** Shared visual shell for a tab — an icon over a label, active in brand colour. */
function TabInner({
  label,
  active,
  children,
}: {
  label: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-bold ${
        active ? "text-brand" : "text-zinc-500"
      }`}
    >
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none"
      >
        {children}
      </svg>
      {label}
    </span>
  );
}

/**
 * The tab body, rendered INSIDE the `Link` so it can read `useLinkStatus`. A tap
 * lights the tab up the instant navigation starts — `pending` counts as active —
 * so the bar feels responsive even when the destination (e.g. the dynamic You
 * page) takes a moment to arrive. The Next docs recommend exactly this pairing:
 * prefetch for speed, `useLinkStatus` for immediate feedback while it completes.
 *
 * THE OVERLAY DOES NOT READ THIS. It could — `pending` is the same fact — but it
 * would have to be reported upward from inside the `Link`, which means a
 * setState in an effect on every tap and a second render pass behind it. The bar
 * derives the same thing from `pathname` instead (see `Journey`), and this stays
 * what it always was: the glyph lighting up under a thumb.
 */
function TabLinkContent({
  label,
  active,
  children,
}: {
  label: string;
  active: boolean;
  children: React.ReactNode;
}) {
  const { pending } = useLinkStatus();
  return (
    <TabInner label={label} active={active || pending}>
      {children}
    </TabInner>
  );
}

function TabLink({
  href,
  label,
  active,
  gated,
  from,
  destination,
  online,
  onStart,
  onRefuse,
  children,
}: {
  href: string;
  label: string;
  active: boolean;
  /** Does this destination need the network to render at all? */
  gated: boolean;
  /** The path this tap is being made from — see `Journey`. */
  from: string;
  /** How the overlay names the destination. */
  destination: string;
  online: boolean;
  onStart: (journey: Journey) => void;
  onRefuse: (journey: Journey) => void;
  children: React.ReactNode;
}) {
  return (
    // Prefetch left at the default (auto): the bar is always on screen, so all
    // three routes warm up ahead of the tap, which is what makes the switch feel
    // instant in production. `prefetch={false}` here was the mistake — it forced a
    // cold round-trip on every tap.
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      style={{ touchAction: "manipulation" }}
      className="flex-1 transition active:opacity-50"
      // WHERE THE TAP IS ANSWERED. `onNavigate` runs for SPA navigations only,
      // which is exactly the right scope: a ⌘-click or "open in new tab" is a new
      // document the browser owns, and hijacking one would break a legitimate way
      // to open a page.
      //
      // OFFLINE, THE NAVIGATION IS CANCELLED RATHER THAN STARTED. A gated
      // destination has nowhere to come from with no network: the router's RSC
      // fetch rejects, Next falls back to a full browser navigation
      // (`fetch-server-response.js`, "Falling back to browser navigation"), and
      // whether THAT lands on the `/offline/you` card or on the browser's own
      // error page depends on which service worker the device happens to be
      // running — an installed app keeps the one it last installed until it is
      // relaunched with a connection. That is a coin toss which costs a page load
      // to lose. The card says the same thing immediately, on every device, and
      // leaves the player on the page they were already on.
      //
      // ONLINE, the journey is recorded and the navigation proceeds untouched.
      // Nothing here delays or intercepts it — the overlay is drawn over the page
      // it left behind, and disappears when the route commits.
      onNavigate={(event) => {
        // Already here: Next may not navigate at all, so there would be no route
        // change to end the journey — the lighting would freeze and, on a gated
        // tab, the bones would sit there for good.
        if (normalizePath(href) === from) return;
        if (gated && !online) {
          event.preventDefault();
          onRefuse({ href, from, destination, gated });
          return;
        }
        // EVERY tab records its journey, gated or not, because the one-lit-tab
        // rule above is about navigation in general — tapping Home from a slow
        // page lit two tabs just as tapping You did. Only a GATED journey brings
        // up the overlay; Home is precached and needs nothing but the lighting.
        onStart({ href, from, destination, gated });
      }}
    >
      <TabLinkContent label={label} active={active}>
        {children}
      </TabLinkContent>
    </Link>
  );
}
