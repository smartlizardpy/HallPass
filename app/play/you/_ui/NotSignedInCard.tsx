import Link from "next/link";
import { BackButton } from "@/app/components/BackButton";
import { Wordmark } from "@/app/components/Wordmark";
import { StealthSettingsRow } from "./StealthSettingsRow";

/**
 * The "you are not signed in" card for the whole `/play/you` subtree.
 *
 * Lifted verbatim from `/play/account`, which had it inline, because there are
 * now three tabs that need the identical answer and one copy is the only way
 * they stay identical. It covers BOTH of the two ways identity can be missing:
 *
 *   1. no `playerId` on the session — genuinely signed out;
 *   2. a `playerId` with no `players` row behind it — never provisioned, or
 *      self-deleted in another tab.
 *
 * They render the same thing on purpose. "Go and sign in again" is the safe,
 * non-throwing recovery for both, and distinguishing them would tell a visitor
 * something about the database rather than something about themselves.
 *
 * The `BackButton` is here for the same reason it is on every other `/play/*`
 * page: these pages render a bare `<main>` with no header and no sidebar, so
 * without it the only way out is the browser's own back button — which on an
 * installed PWA is not always on screen. A dead end for a signed-out visitor is
 * just as much a dead end as one for a signed-in player.
 *
 * `callbackUrl` points at `/play/you`, so signing in lands on the Profile tab
 * rather than bouncing to the arcade root.
 *
 * ── STEALTH IS OFFERED HERE, AND THAT IS LOAD-BEARING ───────────────────────
 * On a real phone this card is the ONLY route to the stealth settings modal for
 * somebody who is not signed in. Trace it: `SiteHeader` drops the hamburger when
 * `isMobile`, so the drawer — and the `StealthMenuButton` inside it — cannot be
 * opened at all; `MobileTabBar` no longer carries a Stealth tab; and
 * `StealthSettingsRow`'s home on the Settings tab sits behind this very check.
 * Without the launcher below, a signed-out phone player could not switch on
 * shake-to-panic, which is the one feature on this site whose whole value is
 * being ready BEFORE somebody walks over.
 *
 * Nothing about it needs an account. The preferences are per-device and live in
 * `localStorage` via `app/lib/stealth/store`, so the modal works identically
 * signed in or out — the account gate above it was incidental, not intended.
 *
 * If a Stealth entry ever returns to the tab bar or the phone header, this can
 * go. Until then, deleting it silently removes the feature for most of the
 * people it was built for.
 */
export function NotSignedInCard() {
  return (
    <main className="relative flex min-h-screen items-center justify-center bg-background px-6 py-10">
      <div className="absolute left-6 top-6">
        <BackButton />
      </div>
      <div className="w-full max-w-md space-y-4">
        <div className="rounded-xl border border-border bg-surface p-8 text-center">
          <Wordmark size="text-3xl" dotClass="h-2 w-2" />
          <h1 className="mt-3 text-2xl font-black tracking-tight">Not signed in</h1>
          <p className="mt-3 text-sm text-muted">
            Sign in to choose a display name and tag your scores.
          </p>
          <Link
            href="/play/signin?callbackUrl=/play/you"
            className="mt-6 inline-block rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white hover:bg-brand-600"
          >
            Sign in
          </Link>
        </div>

        {/* See the docblock: on a phone this is the only way in. */}
        <StealthSettingsRow />
      </div>
    </main>
  );
}
