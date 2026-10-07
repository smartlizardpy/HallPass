"use client";

/**
 * HallPass — a dismissible strip inviting a signed-in player to the live survey.
 *
 * ── WHERE ITS DATA COMES FROM ───────────────────────────────────────────────
 * One `GET /api/v1/surveys/active` on mount. The pages this mounts on are
 * statically prerendered and precached, and everything per-viewer arrives from
 * `/api/` (the argument `FeaturePromo` makes), so the server never reads the
 * session to decide whether to render this. The route answers `null` for a guest
 * without touching the database, and for a player who has already answered.
 *
 * ── DISMISSAL IS PER SURVEY, PER DEVICE ─────────────────────────────────────
 * Closing the strip remembers the survey's slug in localStorage, so a player who
 * says "not now" is not nagged on every page, while the NEXT survey still gets
 * shown. It is a convenience, not a record: the storage can be missing or throw
 * (private window, blocked site data), in which case the strip simply shows again.
 * The server remains the only authority on whether someone has answered.
 *
 * ── WHERE IT DOES NOT APPEAR ────────────────────────────────────────────────
 * Not on the dashboard, and not on the survey page itself (it would point at the
 * page you are on). It sits at `z-[60]`, below the game player (`z-[100]`) and
 * the feature promo (`z-[95]`), so it can never cover a running game.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const STORAGE_KEY = "hp.survey.dismissed";

type Banner = { slug: string; title: string };

function readDismissed(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function writeDismissed(slugs: string[]): void {
  try {
    // Bounded: only the most recent few surveys matter.
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(slugs.slice(-20)));
  } catch {
    /* private mode / quota — the strip just shows again next time. */
  }
}

/** Routes the strip stays off. */
function isSuppressed(pathname: string): boolean {
  return pathname.startsWith("/dashboard") || pathname.startsWith("/survey/");
}

export function SurveyBanner() {
  const pathname = usePathname();
  const [banner, setBanner] = useState<Banner | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/v1/surveys/active", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { survey?: Banner | null } | null) => {
        const survey = data?.survey;
        if (!active || !survey) return;
        if (readDismissed().includes(survey.slug)) return;
        setBanner(survey);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  if (!banner || isSuppressed(pathname)) return null;

  function dismiss() {
    if (!banner) return;
    writeDismissed([...readDismissed(), banner.slug]);
    setBanner(null);
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex justify-center px-4 sm:bottom-4">
      <div
        role="region"
        aria-label="Survey"
        className="pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl border border-border bg-surface/95 py-2 pl-4 pr-2 shadow-xl backdrop-blur"
      >
        <p className="min-w-0 flex-1 text-sm font-bold text-foreground">
          <span className="block truncate">{banner.title}</span>
          <span className="block text-xs font-semibold text-muted">
            Tell us what to build next
          </span>
        </p>
        <Link
          href={`/survey/${banner.slug}`}
          className="shrink-0 rounded-full bg-brand px-4 py-1.5 text-xs font-extrabold text-white transition hover:bg-brand-600"
        >
          Take the survey
        </Link>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss the survey invitation"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted transition hover:bg-surface-2 hover:text-foreground"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
