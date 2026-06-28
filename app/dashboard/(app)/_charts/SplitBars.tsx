/**
 * Split bars — a compact horizontal `BarChart` for small categorical breakdowns
 * (devices, top countries). Single-color rounded bars keyed by `label`, value on
 * hover. `color` lets each instance carry its own accent. Presentational props.
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
import { GRID, TICK, ChartTooltip, Placeholder, useMounted } from "./_shared";

export function SplitBars({
  data,
  color,
}: {
  data: { label: string; value: number }[];
  color: string;
}) {
  const mounted = useMounted();
  if (!mounted) return <Placeholder className="h-48" />;

  return (
    <div className="h-48 w-full">
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
            width={96}
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
            name="Count"
            fill={color}
            radius={[0, 5, 5, 0]}
            maxBarSize={18}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
