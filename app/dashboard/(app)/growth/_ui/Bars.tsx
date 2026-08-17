/**
 * A ranked horizontal bar list — label, proportional bar, value.
 *
 * A server component with no Recharts behind it, unlike `_charts/*` on the
 * overview. These panels are all "N things ranked by one number", which a list
 * says more plainly than a chart does, and it costs no client JavaScript on a
 * page that already ships a link builder.
 *
 * Bars are scaled against the LARGEST ROW, not against a total, so the shape
 * stays readable when one source dwarfs the rest — which is the normal state of
 * an acquisition breakdown, not an edge case.
 */

export type Bar = {
  key: string;
  label: string;
  value: number;
  /** Optional muted text after the label (a count, a caveat). */
  note?: string;
  /** Renders the bar in the muted tone — used for "untagged" and "unknown". */
  subdued?: boolean;
};

const nf = new Intl.NumberFormat("en-US");

export function Bars({ rows, empty = "No data yet." }: { rows: Bar[]; empty?: string }) {
  if (rows.length === 0) {
    return <div className="py-8 text-center text-sm text-muted">{empty}</div>;
  }

  const peak = Math.max(1, ...rows.map((r) => r.value));

  return (
    <ul className="space-y-2.5">
      {rows.map((row) => (
        <li key={row.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-semibold text-foreground">
              {row.label}
              {row.note && (
                <span className="ml-1.5 font-medium text-muted">{row.note}</span>
              )}
            </span>
            <span className="shrink-0 font-bold tabular-nums">{nf.format(row.value)}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className={`h-full rounded-full ${row.subdued ? "bg-zinc-300" : "bg-brand"}`}
              style={{ width: `${Math.max(2, (row.value / peak) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
