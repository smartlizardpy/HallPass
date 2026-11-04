import { Section } from "../../../_ui/Section";
import { LifetimePlays } from "../../../_charts/LifetimePlays";
import { buildLifetimeSeries } from "@/app/lib/play-history";
import { getGameDailyPlays } from "@/app/lib/stats";
import { playTotals } from "@/app/lib/play-totals";

/**
 * A game's plays since it was added: the permanent total and a cumulative graph
 * from its first recorded play. Both reads fail soft — the panel degrades to a
 * notice rather than taking the control center down.
 */
export async function LifetimePlaysPanel({ slug }: { slug: string }) {
  const [daily, totals] = await Promise.all([
    getGameDailyPlays(slug),
    playTotals.totals().catch(() => null),
  ]);
  const series = buildLifetimeSeries(daily);
  const permanent = totals?.[slug];

  return (
    <Section title="Total plays" subtitle="Everything since the game was added, not just 30 days">
      <p className="text-3xl font-black tracking-tight">
        {permanent !== undefined ? permanent.toLocaleString("en-US") : "—"}
        <span className="ml-2 text-sm font-semibold text-muted">all-time plays</span>
      </p>
      {series.length > 0 ? (
        <div className="mt-4">
          <LifetimePlays data={series} />
          <p className="mt-2 text-xs text-muted">
            Graph starts at the first play PostHog recorded ({series[0].date}).
          </p>
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted">No play history available yet.</p>
      )}
    </Section>
  );
}
