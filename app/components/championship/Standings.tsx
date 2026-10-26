"use client";

/**
 * /fright-fest standings: the overall Fright Points table and one tab per game
 * board. A client island over the CDN-cached public API, so the page itself
 * stays static (incident #131).
 *
 * What it will not do: invent rows, show sample names, or name a game that has
 * not joined yet (the API leaves those out and only counts them). Empty boards
 * say so. Before the first answer it shows a skeleton of the right height; if
 * the standings are unavailable it says that, rather than showing an empty
 * table that would read as "nobody played".
 *
 * Tabs follow the WAI-ARIA pattern: arrow keys move between tabs, the panel is
 * labelled by its tab, and `#board-<slug>` in the URL opens that board.
 */

import { useEffect, useRef, useState } from "react";
import { formatScore, formatTiebreak, ordinal } from "@/app/lib/championship/format";
import { clockPhase, type ChampionshipSummary } from "@/app/lib/championship/summary";
import type { PublicBoard, PublicOverallEntry } from "@/app/lib/championship/standings";
import { Avatar } from "../friends/Avatar";
import { useChampionship, useMinute, useMyChampionship } from "./data";

function Player({ name, avatar, publicId, you }: { name: string; avatar: string; publicId: string; you: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar person={{ image: avatar, displayName: name, publicId }} size={26} />
      <span className="truncate font-bold" title={name}>{name}</span>
      {you && <span className="shrink-0 rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-black uppercase text-white">You</span>}
    </span>
  );
}

const TH = "px-2 py-2 text-left text-[11px] font-black uppercase tracking-wider text-muted";
const TD = "px-2 py-2 align-middle";

function OverallTable({ rows, boards, me }: { rows: PublicOverallEntry[]; boards: PublicBoard[]; me: string | null }) {
  const counting = boards.filter((b) => b.counting);
  const titleOf = new Map(boards.map((b) => [b.slug, b.modeShort]));
  return (
    <table className="w-full table-fixed border-collapse text-sm">
      <caption className="sr-only">Overall standings by Fright Points</caption>
      <thead>
        <tr className="border-b border-border">
          <th scope="col" className={`${TH} w-14`}>Rank</th>
          <th scope="col" className={TH}>Player</th>
          {counting.map((b) => (
            <th key={b.slug} scope="col" className={`${TH} hidden w-24 sm:table-cell`}>
              {b.modeShort}
            </th>
          ))}
          <th scope="col" className={`${TH} w-20 text-right`}>Points</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((o) => (
          <tr key={o.publicId} className={`border-b border-border/60 ${o.publicId === me ? "bg-brand/10" : ""}`}>
            <td className={`${TD} font-black tabular-nums`}>{ordinal(o.rank)}</td>
            <td className={TD}>
              <Player name={o.name} avatar={o.avatar} publicId={o.publicId} you={o.publicId === me} />
              {!o.eligible && o.missing.length > 0 && (
                <span className="mt-0.5 block text-xs text-muted">
                  Not yet played: {o.missing.map((s) => titleOf.get(s) ?? s).join(", ")}
                </span>
              )}
            </td>
            {counting.map((b) => {
              const g = o.games[b.slug];
              return (
                <td key={b.slug} className={`${TD} hidden tabular-nums text-foreground-2 sm:table-cell`}>
                  {g ? `${ordinal(g.rank)} · ${g.points}` : "–"}
                </td>
              );
            })}
            <td className={`${TD} text-right font-black tabular-nums`}>{o.points}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BoardTable({ board, me }: { board: PublicBoard; me: string | null }) {
  const m = board.metric;
  return (
    <table className="w-full table-fixed border-collapse text-sm">
      <caption className="sr-only">
        {board.title}: {board.mode}. {m.sort === "desc" ? "Higher" : "Lower"} {m.label.toLowerCase()} wins; ties go to{" "}
        {m.tiebreakSort === "asc" ? "the lower" : "the higher"} {m.tiebreakLabel.toLowerCase()}.
      </caption>
      <thead>
        <tr className="border-b border-border">
          <th scope="col" className={`${TH} w-14`}>Rank</th>
          <th scope="col" className={TH}>Player</th>
          <th scope="col" className={`${TH} w-24`}>{m.label}</th>
          <th scope="col" className={`${TH} hidden w-28 sm:table-cell`}>{m.tiebreakLabel}</th>
          <th scope="col" className={`${TH} w-16 text-right`}>Points</th>
        </tr>
      </thead>
      <tbody>
        {board.entries.map((e) => (
          <tr key={e.publicId} className={`border-b border-border/60 ${e.publicId === me ? "bg-brand/10" : ""}`}>
            <td className={`${TD} font-black tabular-nums`}>{ordinal(e.rank)}</td>
            <td className={TD}>
              <Player name={e.name} avatar={e.avatar} publicId={e.publicId} you={e.publicId === me} />
            </td>
            <td className={`${TD} font-mono tabular-nums`}>{formatScore(m, e.score)}</td>
            <td className={`${TD} hidden font-mono tabular-nums text-foreground-2 sm:table-cell`}>{formatTiebreak(m, e.tiebreak) ?? "–"}</td>
            <td className={`${TD} text-right font-black tabular-nums`}>{e.points}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted">{children}</p>;
}

export function ChampionshipStandings({ summary: s }: { summary: ChampionshipSummary }) {
  const { data, loading } = useChampionship(s.id);
  const { data: mine } = useMyChampionship(s.id);
  const now = useMinute();
  const me = mine && mine.signedIn ? mine.publicId : null;
  const standings = data?.standings ?? null;
  const boards = standings?.boards ?? [];
  const tabs = [{ id: "overall", label: "Overall" }, ...boards.map((b) => ({ id: b.slug, label: b.title }))];
  // `#board-<slug>` (from the homepage card) opens that board. Read once; until
  // the data arrives the skeleton renders whatever the tab is, so the server
  // and first client render still match.
  const [tab, setTab] = useState(() => (typeof window !== "undefined" && window.location.hash.startsWith("#board-") ? window.location.hash.slice(7) : "overall"));
  const sectionRef = useRef<HTMLElement>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());

  // There is no element with that id, so bring the standings into view once the board exists.
  const boardSlugs = boards.map((b) => b.slug).join(",");
  useEffect(() => {
    const want = window.location.hash.startsWith("#board-") ? window.location.hash.slice(7) : null;
    if (want && boardSlugs.split(",").includes(want)) sectionRef.current?.scrollIntoView({ block: "start" });
  }, [boardSlugs]);

  const phase = data?.available ? data.phase : now === null ? null : clockPhase(s, now);
  const final = !!data?.final;
  const active = boards.find((b) => b.slug === tab) ?? null;

  const onKey = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === (active ? active.slug : "overall"));
    const next = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const t = tabs[(next + tabs.length) % tabs.length];
    setTab(t.id);
    tabRefs.current.get(t.id)?.focus();
  };

  const champion = final && standings?.championPublicId ? standings.overall.find((o) => o.publicId === standings.championPublicId) : null;

  return (
    <section ref={sectionRef} id="standings" aria-labelledby="standings-h" className="hl-sec scroll-mt-24 rounded-2xl border border-border bg-surface p-4 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="standings-h" className="text-xl font-black">
          {final ? "Final standings" : "Standings"}
        </h2>
        {standings && !final && phase !== "upcoming" && <p className="text-xs text-muted">Provisional until results are checked</p>}
      </div>

      <p className="mt-2 text-sm text-foreground-2">
        Fright Points come from your rank on each game&apos;s board, and they decide the champion. They can&apos;t be spent.
      </p>

      {champion && (
        <p className="mt-3 rounded-xl bg-brand/10 px-4 py-3 text-sm">
          <b>Fright Fest champion: {champion.name}</b>, with {champion.points} Fright Points.
        </p>
      )}

      {loading ? (
        <div className="mt-4 h-48 animate-pulse rounded-xl bg-surface-2 motion-reduce:animate-none" aria-hidden="true" />
      ) : !data?.available || !standings ? (
        <div className="mt-4">
          <Empty>Standings are not available right now. Your runs are safe; check back soon.</Empty>
        </div>
      ) : (
        <>
          <div role="tablist" aria-label="Standings" className="mt-4 flex flex-wrap gap-2" onKeyDown={onKey}>
            {tabs.map((t) => {
              const selected = (active ? active.slug : "overall") === t.id;
              return (
                <button
                  key={t.id}
                  ref={(el) => {
                    if (el) tabRefs.current.set(t.id, el);
                    else tabRefs.current.delete(t.id);
                  }}
                  type="button"
                  role="tab"
                  id={`tab-${t.id}`}
                  aria-selected={selected}
                  aria-controls={`panel-${t.id}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setTab(t.id)}
                  className={`rounded-full px-4 py-2 text-sm font-extrabold transition ${
                    selected ? "bg-brand text-white" : "bg-surface-2 text-foreground-2 hover:text-foreground"
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
          <div role="tabpanel" id={`panel-${active ? active.slug : "overall"}`} aria-labelledby={`tab-${active ? active.slug : "overall"}`} className="mt-4">
            {active ? (
              <>
                <p className="mb-3 text-sm text-foreground-2">
                  <b>{active.mode}.</b> {active.metric.sort === "desc" ? "Higher" : "Lower"} {active.metric.label.toLowerCase()} wins; a tie goes to{" "}
                  {active.metric.tiebreakSort === "asc" ? "the lower" : "the higher"} {active.metric.tiebreakLabel.toLowerCase()}, then to whoever got there first.
                  {active.status === "paused" && " This board is paused: runs are not being ranked for now."}
                  {active.status === "withdrawn" && " This game was withdrawn from the championship; its results do not count."}
                </p>
                {active.entries.length > 0 ? (
                  <BoardTable board={active} me={me} />
                ) : (
                  <Empty>{phase === "upcoming" ? "Ranked runs open soon. Nobody is on this board yet." : "No ranked runs yet. The first one takes 1st place."}</Empty>
                )}
              </>
            ) : standings.overall.length > 0 ? (
              <OverallTable rows={standings.overall} boards={boards} me={me} />
            ) : (
              <Empty>
                {phase === "upcoming"
                  ? `Nobody is on the table yet: ranked runs open ${s.labels.opens} UK time.`
                  : "Nobody is on the table yet. Play a Fright Fest mode signed in to take the first place."}
              </Empty>
            )}
          </div>
          {standings.pendingGames > 0 && (
            <p className="mt-4 text-sm text-muted">
              {standings.pendingGames === 1 ? "One more game joins" : `${standings.pendingGames} more games join`} when{" "}
              {standings.pendingGames === 1 ? "its Fright Fest mode is" : "their Fright Fest modes are"} verified. A game counts from the moment it joins.
            </p>
          )}
        </>
      )}
    </section>
  );
}
