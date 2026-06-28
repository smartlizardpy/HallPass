/**
 * Shared chart primitives — the common theme + scaffolding every `_charts`
 * component reuses so the dashboard's Recharts visuals read as one coherent set.
 *
 * Exposes the brand token palette (used for series strokes/fills and donut
 * cycling), a faint grid stroke, a `useMounted` guard (Recharts'
 * `ResponsiveContainer` measures the DOM, so charts must not render during SSR
 * or the first paint — see `Placeholder`), and one shared dark, rounded
 * `ChartTooltip` so hover cards look identical across area/bar/pie charts.
 *
 * This module is `"use client"`: it is imported only by the sibling client
 * chart components, never by a server component directly.
 */

"use client";

import { useEffect, useState } from "react";

/** Core series colors, straight from the design tokens. */
export const COLORS = {
  plays: "#7c2eef", // --brand
  visitors: "#ff4f8b", // --accent-pink
  cyan: "#00cfd6", // --accent-cyan
  yellow: "#ffc700", // --accent-yellow
} as const;

/** Cycling palette for categorical splits (donut slices, etc.). */
export const PALETTE = [
  COLORS.plays,
  COLORS.visitors,
  COLORS.cyan,
  COLORS.yellow,
  "#6920d6", // brand-600
  "#ff8fb3", // pink-300-ish
  "#5ce0e5", // cyan-300-ish
  "#ffd84d", // yellow-300-ish
] as const;

/** Faint grid/axis lines — the design's `--border`. */
export const GRID = "#e4e4ec";
/** Muted tick labels — the design's `--muted`. */
export const TICK = "#6b6b7b";

const nf = new Intl.NumberFormat("en-US");
export const fmt = (n: number) => nf.format(n);

/**
 * True once mounted on the client. `ResponsiveContainer` needs real layout to
 * size itself; gating on this avoids SSR/hydration mismatches and a 0×0 flash.
 */
export function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

/** Fixed-height stand-in rendered until the chart is allowed to mount. */
export function Placeholder({ className = "" }: { className?: string }) {
  return (
    <div
      className={`w-full animate-pulse rounded-lg bg-surface-2/60 ${className}`}
      aria-hidden
    />
  );
}

type TipEntry = {
  name?: string | number;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
  payload?: Record<string, unknown> & { fill?: string };
};

/**
 * One dark, rounded tooltip shared by every chart. Renders the hovered label
 * (date or category) and each series as a colored dot + name + formatted value.
 * Slice/bar colors come from `entry.color` or the datum's own `fill` (Cells).
 */
export function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TipEntry[];
  label?: string | number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-xl border border-white/10 bg-[#1c1c28]/95 px-3 py-2 text-xs text-white shadow-xl backdrop-blur">
      {label != null && label !== "" && (
        <div className="mb-1.5 font-semibold text-white/70">{String(label)}</div>
      )}
      <div className="space-y-1">
        {payload.map((entry, i) => {
          const dot = entry.color ?? entry.payload?.fill ?? COLORS.plays;
          const value =
            typeof entry.value === "number" ? fmt(entry.value) : entry.value;
          return (
            <div
              key={`${entry.dataKey ?? entry.name ?? i}`}
              className="flex items-center gap-2"
            >
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ background: dot }}
              />
              {entry.name != null && (
                <span className="text-white/70">{String(entry.name)}</span>
              )}
              <span className="ml-auto font-mono font-bold tabular-nums">
                {value}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
