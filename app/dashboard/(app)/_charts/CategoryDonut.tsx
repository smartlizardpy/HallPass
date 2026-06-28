/**
 * Category mix — a donut `PieChart` (hollow `innerRadius`) of plays per game
 * category. Slices cycle the brand token palette; a legend names them and the
 * shared tooltip shows exact counts on hover. Presentational `{ label, value }`.
 */

"use client";

import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { PALETTE, ChartTooltip, Placeholder, useMounted } from "./_shared";

export function CategoryDonut({
  data,
}: {
  data: { label: string; value: number }[];
}) {
  const mounted = useMounted();
  if (!mounted) return <Placeholder className="h-64" />;

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            cx="50%"
            cy="50%"
            innerRadius={52}
            outerRadius={84}
            paddingAngle={2}
            stroke="var(--color-surface)"
            strokeWidth={2}
          >
            {data.map((entry, i) => (
              <Cell key={entry.label} fill={PALETTE[i % PALETTE.length]} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip />} />
          <Legend
            verticalAlign="bottom"
            iconType="circle"
            iconSize={9}
            wrapperStyle={{ fontSize: 12, color: "var(--color-muted)" }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
