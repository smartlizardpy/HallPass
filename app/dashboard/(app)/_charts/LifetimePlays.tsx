/**
 * Lifetime plays — a cumulative `AreaChart` of one game's total plays from its
 * first recorded play to today. Presentational: `data` is plain serializable
 * props built by `buildLifetimeSeries`.
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
import { COLORS, GRID, TICK, ChartTooltip, Placeholder, fmt, useMounted } from "./_shared";

export function LifetimePlays({
  data,
}: {
  data: { date: string; plays: number; total: number }[];
}) {
  const mounted = useMounted();
  if (!mounted) return <Placeholder className="h-56" />;

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 6, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="hp-grad-lifetime" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLORS.plays} stopOpacity={0.34} />
              <stop offset="100%" stopColor={COLORS.plays} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fill: TICK, fontSize: 11 }} minTickGap={48} />
          <YAxis tick={{ fill: TICK, fontSize: 11 }} width={44} tickFormatter={fmt} />
          <Tooltip
            cursor={{ stroke: COLORS.plays, strokeWidth: 1, strokeDasharray: "4 4" }}
            content={<ChartTooltip />}
          />
          <Area
            type="monotone"
            dataKey="total"
            name="Total plays"
            stroke={COLORS.plays}
            strokeWidth={2.5}
            fill="url(#hp-grad-lifetime)"
            fillOpacity={1}
            activeDot={{ r: 4, strokeWidth: 0 }}
          />
          <Area
            type="monotone"
            dataKey="plays"
            name="That day"
            stroke="none"
            fill="none"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
