/**
 * Plays & visitors trend — the dashboard's hero chart. A gradient-filled
 * `AreaChart` of two daily series over the last 30 days: plays (brand purple)
 * and unique visitors (accent pink). Axes are hidden for a clean sparkline-like
 * read; a vertical crosshair cursor + the shared dark tooltip surface exact
 * values on hover. Presentational — `data` arrives as plain serializable props.
 */

"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { COLORS, GRID, ChartTooltip, Placeholder, useMounted } from "./_shared";

export function PlaysVisitorsArea({
  data,
}: {
  data: { date: string; plays: number; visitors: number }[];
}) {
  const mounted = useMounted();
  if (!mounted) return <Placeholder className="h-64" />;

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 6, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="hp-grad-plays" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLORS.plays} stopOpacity={0.34} />
              <stop offset="100%" stopColor={COLORS.plays} stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="hp-grad-visitors" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLORS.visitors} stopOpacity={0.26} />
              <stop offset="100%" stopColor={COLORS.visitors} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="3 3" />
          <XAxis dataKey="date" hide />
          <YAxis hide />
          <Tooltip
            cursor={{ stroke: COLORS.plays, strokeWidth: 1, strokeDasharray: "4 4" }}
            content={<ChartTooltip />}
          />
          <Area
            type="monotone"
            dataKey="visitors"
            name="Unique visitors"
            stroke={COLORS.visitors}
            strokeWidth={2}
            fill="url(#hp-grad-visitors)"
            fillOpacity={1}
            activeDot={{ r: 3, strokeWidth: 0 }}
          />
          <Area
            type="monotone"
            dataKey="plays"
            name="Plays"
            stroke={COLORS.plays}
            strokeWidth={2.5}
            fill="url(#hp-grad-plays)"
            fillOpacity={1}
            activeDot={{ r: 4, strokeWidth: 0 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
