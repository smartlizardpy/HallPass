/**
 * Community trend — sign-ups, scores and comments over the last 30 days.
 *
 * A `ComposedChart` rather than a third area chart, because the three series are
 * not the same ORDER OF MAGNITUDE. A busy day is dozens of scores and one or two
 * sign-ups; drawn against a single axis the human series flatten into the
 * baseline and the panel says nothing that the Scores number did not already
 * say. So scores are bars on the left axis and the two people-shaped series are
 * lines on their own right axis, which is the honest way to show "did activity
 * and the community move together" without pretending the units compare.
 *
 * The axes stay hidden, like every other chart on this dashboard — the shared
 * tooltip carries the exact numbers on hover and the panel's own header carries
 * the totals. Presentational: `data` arrives as plain serializable props, dense
 * and zero-filled upstream (see `mergeDays`).
 */

"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { COLORS, GRID, ChartTooltip, Placeholder, useMounted } from "./_shared";

export function CommunityTrend({
  data,
}: {
  data: { date: string; players: number; scores: number; comments: number }[];
}) {
  const mounted = useMounted();
  if (!mounted) return <Placeholder className="h-56" />;

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 6, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="3 3" />
          <XAxis dataKey="date" hide />
          <YAxis yAxisId="activity" hide />
          <YAxis yAxisId="people" orientation="right" hide />
          <Tooltip
            cursor={{ fill: "rgba(124,46,239,0.06)" }}
            content={<ChartTooltip />}
          />
          <Bar
            yAxisId="activity"
            dataKey="scores"
            name="Scores"
            fill={COLORS.cyan}
            radius={[3, 3, 0, 0]}
            maxBarSize={14}
          />
          <Line
            yAxisId="people"
            type="monotone"
            dataKey="players"
            name="New players"
            stroke={COLORS.plays}
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0 }}
          />
          <Line
            yAxisId="people"
            type="monotone"
            dataKey="comments"
            name="Comments"
            stroke={COLORS.visitors}
            strokeWidth={2}
            strokeDasharray="4 3"
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
