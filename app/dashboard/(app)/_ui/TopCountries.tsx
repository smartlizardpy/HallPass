"use client";

/**
 * Top Countries — where SIGNED-IN players' accounts were first detected.
 *
 * A client component only because of the All/Active toggle (`useState`); the
 * two lists themselves are plain server-fetched data (`getCommunityStats`),
 * not live-refreshed. Deliberately separate from the dashboard's existing
 * "Top countries" panel, which is anonymous PostHog visitor geo by full
 * country NAME — a different dataset, and conflating the two would blur
 * "traffic came from" with "accounts belong to".
 *
 * Percentage is of the selected cohort's OWN total (`allTotal`/`activeTotal`),
 * not the sum of the top rows shown — the list is capped at ten countries, so
 * summing just those would overstate each share once there is an eleventh.
 */

import { useState } from "react";
import type { ReactNode } from "react";
import { countryDisplayName, countryFlagEmoji } from "@/app/lib/countries";
import { share } from "@/app/lib/insights";
import type { CountryCount } from "@/app/lib/overview";

type Mode = "all" | "active";

export function TopCountries({
  all,
  active,
  allTotal,
  activeTotal,
}: {
  all: CountryCount[];
  active: CountryCount[];
  allTotal: number;
  activeTotal: number;
}) {
  const [mode, setMode] = useState<Mode>("all");
  const rows = mode === "all" ? all : active;
  const total = mode === "all" ? allTotal : activeTotal;

  return (
    <div>
      <div className="mb-4 inline-flex gap-1 rounded-lg border border-border p-0.5 text-xs">
        <ToggleButton active={mode === "all"} onClick={() => setMode("all")}>
          All signed-in users
        </ToggleButton>
        <ToggleButton active={mode === "active"} onClick={() => setMode("active")}>
          Active · 30 days
        </ToggleButton>
      </div>

      {total === 0 || rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">
          No players have signed in yet.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((row) => {
            const pct = share(row.count, total) ?? 0;
            return (
              <li
                key={row.code ?? "unknown"}
                className="flex items-center gap-3 text-sm"
              >
                <span className="text-lg" aria-hidden>
                  {countryFlagEmoji(row.code)}
                </span>
                <span className="min-w-0 flex-1 truncate font-semibold">
                  {countryDisplayName(row.code)}
                </span>
                <span className="hidden w-24 shrink-0 sm:block">
                  <span className="block h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                    <span
                      className="block h-full rounded-full bg-amber-400"
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                </span>
                <span className="w-12 shrink-0 text-right font-mono tabular-nums text-muted">
                  {pct}%
                </span>
                <span className="w-10 shrink-0 text-right font-mono tabular-nums text-muted">
                  {row.count}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-md px-2.5 py-1 font-semibold transition-colors ${
        active
          ? "bg-brand-50 text-brand"
          : "text-muted hover:bg-surface-2 hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
