/**
 * Daily rhythm — plays by hour of day, midnight to 23:00.
 *
 * Twenty-four vertical bars with the busiest hour picked out in brand purple
 * and the rest in a muted lilac, because the single fact this panel exists to
 * deliver is WHEN the spike is. Ticks are thinned to every third hour: a label
 * under all 24 bars is unreadable at panel width, and the tooltip carries the
 * exact hour anyway.
 *
 * `hourLabel` comes from `insights.ts`, which is pure and has no `server-only`
 * import, so the same clock formatting is shared with the server side rather
 * than reimplemented here. Presentational — the caller passes a dense 24-bucket
 * series (see `fillHours`).
 */

"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { type HourBucket, hourLabel, peak } from "@/app/lib/insights";
import { COLORS, GRID, TICK, ChartTooltip, Placeholder, useMounted } from "./_shared";

/** The non-peak bars: brand purple at low opacity, so the peak reads instantly. */
const QUIET = "#c9b0f5";

export function HourlyBars({ data }: { data: HourBucket[] }) {
  const mounted = useMounted();
  if (!mounted) return <Placeholder className="h-48" />;

  const busiest = peak(data, (h) => h.value);
  const rows = data.map((h) => ({ ...h, label: hourLabel(h.hour) }));

  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="3 3" />
          <XAxis
            dataKey="label"
            interval={2}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: TICK }}
          />
          <YAxis hide />
          <Tooltip
            cursor={{ fill: "rgba(124,46,239,0.06)" }}
            content={<ChartTooltip />}
          />
          <Bar dataKey="value" name="Plays" radius={[4, 4, 0, 0]} maxBarSize={18}>
            {rows.map((row) => (
              <Cell
                key={row.hour}
                fill={
                  busiest && busiest.value > 0 && row.hour === busiest.hour
                    ? COLORS.plays
                    : QUIET
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
