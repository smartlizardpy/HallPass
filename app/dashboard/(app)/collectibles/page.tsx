/**
 * HallPass dashboard — the collectibles desk (`/dashboard/collectibles`).
 *
 * Catalogue as published (read-only: definitions change by commit, which keeps
 * pack versions immutable and reviewed), grant a pack, revoke a sealed pack or
 * a pull, the newest grants and openings, and the audit log.
 *
 * PRIVACY. Players appear by public name and public id only; the store selects
 * nothing else. The emails in the audit log are staff dashboard accounts, which
 * is the point of an audit log.
 *
 * Failure modes follow `championship/page.tsx`: an unconfigured database or a
 * missing migration render a notice; any other error is rethrown, because "no
 * grants" must never be a disguised outage. The catalogue is code, so it
 * renders either way.
 *
 * The grant form's nonce is minted per render (see `actions.ts`).
 */

import type { Metadata } from "next";
import { requireRole } from "@/app/lib/auth";
import { SITE_WRITE_ROLE } from "@/app/lib/permissions";
import { isMissingColumnError, isUnconfiguredDbError } from "@/app/lib/db";
import { collectiblesStore } from "@/app/lib/collectibles";
import { CATALOGUE, cardsIn, currentVersion, getCollectible, type Pack, type Slot } from "@/app/lib/collectibles/catalogue";
import type { AdminLogEntry, AdminPackRow } from "@/app/lib/collectibles/store";
import { formatInstant } from "@/app/lib/championship/format";
import { DashHeader } from "../_ui/DashHeader";
import { Section } from "../_ui/Section";
import { grantPackAction, revokePackAction, revokePullAction } from "./actions";

export const metadata: Metadata = {
  title: "Collectibles",
  description: "Grant and revoke packs, browse the catalogue, read the audit log.",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
const TZ = "Europe/London";
const when = (iso: string | null) => (iso ? formatInstant(iso, TZ) : "");

const BTN = "rounded-full px-3 py-1 text-xs font-bold transition disabled:opacity-40";
const BTN_PRIMARY = `${BTN} bg-brand text-white hover:bg-brand-600`;
const BTN_DANGER = `${BTN} bg-red-600 text-white hover:bg-red-700`;
const INPUT = "w-full rounded-lg border border-border bg-surface px-2 py-1 text-xs";

function Chip({ tone, children }: { tone: "green" | "amber" | "red" | "zinc" | "brand"; children: React.ReactNode }) {
  const tones = {
    green: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
    amber: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
    red: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
    zinc: "bg-surface-2 text-foreground-2",
    brand: "bg-brand/15 text-brand",
  } as const;
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${tones[tone]}`}>{children}</span>;
}

function Banner({ tone, children }: { tone: "ok" | "error" | "warn"; children: React.ReactNode }) {
  const cls =
    tone === "ok"
      ? "border-emerald-300 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200"
      : tone === "error"
        ? "border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-900 dark:text-red-200"
        : "border-amber-300 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200";
  return <div role={tone === "error" ? "alert" : "status"} className={`mb-6 rounded-xl border px-4 py-3 text-sm ${cls}`}>{children}</div>;
}

const cardName = (id: string) => getCollectible(id)?.name ?? id;

export default async function CollectiblesDeskPage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole(SITE_WRITE_ROLE);
  const params = await searchParams;
  const ok = one(params.ok);
  const error = one(params.error);

  let recent: AdminPackRow[] = [];
  let log: AdminLogEntry[] = [];
  let unavailable: "unconfigured" | "schema" | null = null;
  try {
    [recent, log] = await Promise.all([collectiblesStore.listRecentPacks(50), collectiblesStore.readLog(100)]);
  } catch (err) {
    if (isUnconfiguredDbError(err)) unavailable = "unconfigured";
    else if (isMissingColumnError(err)) unavailable = "schema";
    else throw err;
  }

  const nonce = crypto.randomUUID();
  return (
    <div className="mx-auto max-w-6xl">
      <DashHeader
        title="Collectibles"
        subtitle="Free sticker and card packs. Catalogue changes ship by commit; grants and revocations happen here."
      />
      {ok && <Banner tone="ok">{ok}</Banner>}
      {error && <Banner tone="error">{error}</Banner>}
      {unavailable === "unconfigured" && <Banner tone="warn">No database is configured (`DATABASE_URL`). The catalogue below is read from code.</Banner>}
      {unavailable === "schema" && (
        <Banner tone="warn">
          The collectibles tables are missing. Apply migration <code>049_collectibles.sql</code> (see <code>scripts/migrate-prod.sh</code>).
          Grants, revocations, history and the audit log are unavailable until then; the catalogue below is read from code.
        </Banner>
      )}
      <div className="space-y-6">
        {!unavailable && (
          <>
            <GrantPanel nonce={nonce} />
            <RevokePanel />
            <RecentPanel rows={recent} />
            <LogPanel log={log} />
          </>
        )}
        <CataloguePanel />
      </div>
    </div>
  );
}

function GrantPanel({ nonce }: { nonce: string }) {
  return (
    <Section title="Grant a pack" subtitle="Lands sealed in the player's Pack Room">
      <form action={grantPackAction} className="grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="nonce" value={nonce} />
        <label className="text-xs font-bold">
          Player (username or public id)
          <input name="player" required maxLength={100} placeholder="alice or 3f2a…" autoComplete="off" className={`${INPUT} mt-1 font-normal`} />
        </label>
        <label className="text-xs font-bold">
          Pack
          <select name="pack" required className={`${INPUT} mt-1 font-normal`}>
            {CATALOGUE.packs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.id} v{currentVersion(p).v})
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-bold sm:col-span-2">
          Reason (audit log)
          <input name="reason" required maxLength={500} placeholder="Why this player gets this pack" className={`${INPUT} mt-1 font-normal`} />
        </label>
        <div className="sm:col-span-2">
          <button type="submit" className={BTN_PRIMARY}>
            Grant pack
          </button>
          <span className="ml-3 text-xs text-muted">Submitting twice from this page creates one pack.</span>
        </div>
      </form>
    </Section>
  );
}

function RevokePanel() {
  return (
    <Section title="Revoke" subtitle="Ids are on the recent list below">
      <div className="grid gap-4 md:grid-cols-2">
        <details className="rounded-lg border border-border bg-surface-2 p-3">
          <summary className="cursor-pointer text-xs font-bold text-red-700 dark:text-red-300">Revoke a sealed pack…</summary>
          <p className="mt-2 text-xs text-foreground-2">
            The player can no longer open it. Only a sealed pack can be revoked; an opened pack is corrected one pull at a time.
          </p>
          <form action={revokePackAction} className="mt-2 flex flex-col gap-2">
            <input name="packId" required maxLength={36} placeholder="Pack public id (uuid)" autoComplete="off" className={INPUT} />
            <input name="reason" required maxLength={500} placeholder="Reason" className={INPUT} />
            <button type="submit" className={`${BTN_DANGER} self-start`}>
              Revoke pack
            </button>
          </form>
        </details>
        <details className="rounded-lg border border-border bg-surface-2 p-3">
          <summary className="cursor-pointer text-xs font-bold text-red-700 dark:text-red-300">Revoke a pull…</summary>
          <p className="mt-2 text-xs text-foreground-2">
            The card stops counting as owned (binder, progress, showcase). Copies from other pulls are untouched.
          </p>
          <form action={revokePullAction} className="mt-2 flex flex-col gap-2">
            <input name="pullId" required inputMode="numeric" pattern="[0-9]+" maxLength={15} placeholder="Pull id (number)" autoComplete="off" className={INPUT} />
            <input name="reason" required maxLength={500} placeholder="Reason" className={INPUT} />
            <button type="submit" className={`${BTN_DANGER} self-start`}>
              Revoke pull
            </button>
          </form>
        </details>
      </div>
    </Section>
  );
}

function RecentPanel({ rows }: { rows: AdminPackRow[] }) {
  return (
    <Section title="Recent grants and openings" subtitle={`Newest ${rows.length}, all players, UK time`}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No packs have been granted yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r) => {
            const state = r.pack.revokedAt ? "revoked" : r.pack.openedAt ? "opened" : "sealed";
            return (
              <li key={r.pack.publicId} className="py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{r.pack.packId}</span>
                  <span className="text-xs text-muted">v{r.pack.packVersion}</span>
                  <Chip tone={state === "sealed" ? "amber" : state === "opened" ? "green" : "red"}>{state}</Chip>
                  <Chip tone="zinc">{r.pack.source}</Chip>
                  <span>
                    {r.player.name} <code className="text-xs text-muted">{r.player.publicId}</code>
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted">
                  pack <code>{r.pack.publicId}</code> · granted {when(r.pack.grantedAt)}
                  {r.pack.openedAt && ` · opened ${when(r.pack.openedAt)}`}
                  {r.pack.revokedAt && ` · revoked ${when(r.pack.revokedAt)}`}
                </div>
                {r.pulls.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {r.pulls.map((p) => (
                      <li
                        key={p.id}
                        className={`rounded-lg border border-border bg-surface-2 px-2 py-1 text-xs ${p.revokedAt ? "line-through opacity-60" : ""}`}
                      >
                        <span className="font-bold">{cardName(p.collectibleId)}</span>
                        {p.wasNew && <span className="ml-1 font-black text-brand">NEW</span>}
                        <span className="ml-1 text-muted">
                          slot {p.slot} · pull <code>{p.id}</code>
                          {p.revokedAt && " · revoked"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function LogPanel({ log }: { log: AdminLogEntry[] }) {
  return (
    <Section title="Audit log" subtitle={`Newest ${log.length}`}>
      {log.length === 0 ? (
        <p className="text-sm text-muted">No admin changes yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {log.map((l) => (
            <li key={l.id} className="py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone={l.action === "grant-pack" ? "green" : "red"}>{l.action}</Chip>
                <span className="text-xs text-muted">{when(l.createdAt)}</span>
                <span className="text-xs">{l.actorEmail}</span>
                {l.name && (
                  <span className="text-xs">
                    → {l.name} <code className="text-muted">{l.publicId}</code>
                  </span>
                )}
              </div>
              <div className="mt-1 text-xs text-foreground-2">{l.reason}</div>
              {l.data != null && <pre className="mt-1 overflow-x-auto text-[11px] text-muted">{safeJson(l.data)}</pre>}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}

function describeSlot(s: Slot): string {
  if (s.kind === "fixed") return `fixed: ${cardName(s.collectible)}`;
  const w = Object.entries(s.rarityWeights)
    .map(([r, n]) => `${r} ${n}%`)
    .join(", ");
  return `random from ${s.pool}: ${w}`;
}

function PackBlock({ pack }: { pack: Pack }) {
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold">{pack.name}</span>
        <code className="text-xs text-muted">{pack.id}</code>
        <Chip tone="zinc">{pack.collection}</Chip>
        <span className="text-xs text-muted">new grants pin v{currentVersion(pack).v}</span>
      </div>
      {pack.versions.map((v) => (
        <div key={v.v} className="mt-2 text-xs">
          <div className="font-bold">
            v{v.v} · {v.size} cards
          </div>
          <ol className="ml-4 list-decimal text-foreground-2">
            {v.slots.map((s, i) => (
              <li key={i}>{describeSlot(s)}</li>
            ))}
          </ol>
        </div>
      ))}
    </li>
  );
}

const RARITY_TONE = { common: "zinc", uncommon: "green", rare: "brand", epic: "amber", legendary: "red" } as const;

function CataloguePanel() {
  const demo = CATALOGUE.collectibles.filter((c) => c.art.status === "demo").length;
  const final = CATALOGUE.collectibles.length - demo;
  return (
    <Section title="Catalogue" subtitle={`${CATALOGUE.collectibles.length} cards · ${demo} demo art · ${final} final art · read-only`}>
      <div className="space-y-6">
        {[...CATALOGUE.collections]
          .sort((a, b) => a.sort - b.sort)
          .map((col) => {
            const cards = cardsIn(col.id);
            const colDemo = cards.filter((c) => c.art.status === "demo").length;
            return (
              <details key={col.id} className="rounded-lg border border-border bg-surface-2 p-3">
                <summary className="cursor-pointer text-sm font-bold">
                  {col.name} <code className="text-xs font-normal text-muted">{col.id}</code>{" "}
                  <span className="text-xs font-normal text-muted">
                    {cards.length} cards · {colDemo} demo / {cards.length - colDemo} final
                  </span>
                </summary>
                <p className="mt-2 text-xs text-foreground-2">{col.description}</p>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="text-muted">
                      <tr>
                        <th className="py-1 pr-2">Art</th>
                        <th className="pr-2">#</th>
                        <th className="pr-2">Name</th>
                        <th className="pr-2">Rarity</th>
                        <th className="pr-2">Kind</th>
                        <th className="pr-2">Pool</th>
                        <th className="pr-2">Art status</th>
                        <th>State</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {cards.map((c) => (
                        <tr key={c.id}>
                          <td className="py-1 pr-2">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={c.art.src} alt={c.art.alt} width={32} height={32} loading="lazy" style={{ imageRendering: "pixelated" }} className="h-8 w-8" />
                          </td>
                          <td className="pr-2">{c.number}</td>
                          <td className="pr-2">
                            <span className="font-bold">{c.name}</span> <code className="text-muted">{c.id}</code>
                          </td>
                          <td className="pr-2">
                            <Chip tone={RARITY_TONE[c.rarity]}>{c.rarity}</Chip>
                          </td>
                          <td className="pr-2">{c.kind}</td>
                          <td className="pr-2">{c.pool}</td>
                          <td className="pr-2">
                            <Chip tone={c.art.status === "final" ? "green" : "amber"}>{c.art.status}</Chip>
                          </td>
                          <td>{c.retired ? <Chip tone="red">retired</Chip> : "active"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            );
          })}
        <div>
          <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">Packs, versions and odds as published</h3>
          <ul className="divide-y divide-border">
            {CATALOGUE.packs.map((p) => (
              <PackBlock key={p.id} pack={p} />
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
}
