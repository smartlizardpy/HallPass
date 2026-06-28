/**
 * Sparkline — a tiny, chromeless `AreaChart` (no axes, grid, or tooltip) that
 * trails a single metric inside a KPI card. Takes a plain `number[]` and a
 * `color`; renders a faint gradient fill under a thin line at ~`h-10`.
 */

"use client";

import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { Placeholder, useMounted } from "./_shared";

export function Sparkline({ data, color }: { data: number[]; color: string }) {
  const mounted = useMounted();
  if (!mounted) return <Placeholder className="h-10" />;

  // Recharts wants objects; a stable gradient id keyed by color lets multiple
  // sparklines coexist without their <defs> colliding.
  const series = data.map((v, i) => ({ i, v }));
  const gradId = `hp-spark-${color.replace(/[^a-z0-9]/gi, "")}`;

  return (
    <div className="h-10 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gradId})`}
            fillOpacity={1}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
