/**
 * Top games — a horizontal (`layout="vertical"`) `BarChart` ranking games by
 * plays. Category-axis labels sit on the left; rounded brand bars run right with
 * the value surfaced on hover via the shared tooltip. Presentational; callers
 * pass already-resolved `{ label, value }` rows (slug → title done upstream).
 */

"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { COLORS, GRID, TICK, ChartTooltip, Placeholder, useMounted } from "./_shared";

export function TopGamesBar({
  data,
  barName = "Plays",
  color = COLORS.plays,
}: {
  data: { label: string; value: number }[];
  /** Tooltip series label. Defaults to "Plays" — the original use. */
  barName?: string;
  /** Bar fill. Defaults to the plays brand colour. */
  color?: string;
}) {
  const mounted = useMounted();
  if (!mounted) return <Placeholder className="h-64" />;

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 2, right: 10, bottom: 2, left: 4 }}
        >
          <CartesianGrid horizontal={false} stroke={GRID} strokeDasharray="3 3" />
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="label"
            width={116}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12, fill: TICK }}
          />
          <Tooltip
            cursor={{ fill: "rgba(124,46,239,0.06)" }}
            content={<ChartTooltip />}
          />
          <Bar
            dataKey="value"
            name={barName}
            fill={color}
            radius={[0, 6, 6, 0]}
            maxBarSize={22}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
