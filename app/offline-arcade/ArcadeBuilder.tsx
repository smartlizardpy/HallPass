"use client";

/**
 * The game picker and download button for `/offline-arcade`.
 *
 * Selection starts with every game chosen (most people want them all). The
 * size shown is an estimate from the catalog (hpg/src/compose.ts). Pressing
 * Download fetches the prebuilt files, checks each against the page's
 * catalog, zips them in the browser and saves the result. Nothing is sent
 * anywhere.
 *
 * Covers are plain <img>s of the same-origin cover PNGs the rest of the site
 * uses, as elsewhere in app/components (no next/image for decorative
 * thumbnails).
 */

import { useMemo, useState } from "react";
import type { ArcadeCatalog } from "@/hpg/src/build/arcade";
import { ComposeError, composeArcade, DOWNLOAD_NAME, estimateBytes } from "@/hpg/src/compose";

export type BuilderGame = {
  id: string;
  name: string;
  tagline: string;
  category: string | null;
  size: number;
  cover: string;
  gradient: [string, string];
};

type Status =
  | { kind: "idle" }
  | { kind: "building"; done: number; total: number; label: string }
  | { kind: "done"; bytes: number }
  | { kind: "error"; message: string };

function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

async function fetchBytes(file: string): Promise<Uint8Array> {
  // `no-cache` revalidates, so a file from an earlier deploy is not reused.
  const res = await fetch(`/arcade/${file}`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

function save(bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/zip" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = DOWNLOAD_NAME;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function ArcadeBuilder({ catalog, games }: { catalog: ArcadeCatalog; games: BuilderGame[] }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(games.map((g) => g.id)));
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const estimate = useMemo(() => estimateBytes(catalog, selected), [catalog, selected]);
  const busy = status.kind === "building";

  const toggle = (id: string) => {
    setStatus({ kind: "idle" });
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const download = async () => {
    if (busy || selected.size === 0) return;
    setStatus({ kind: "building", done: 0, total: selected.size + 1, label: "arcade" });
    try {
      const builtOn = new Date().toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
      const zip = await composeArcade(catalog, selected, fetchBytes, builtOn, (done, total, label) =>
        setStatus({ kind: "building", done, total, label }),
      );
      save(zip);
      setStatus({ kind: "done", bytes: zip.length });
    } catch (e) {
      const stale = e instanceof ComposeError && /catalog/.test(e.message);
      setStatus({
        kind: "error",
        message: stale
          ? "HallPass was updated while this page was open. Refresh the page and try again."
          : "The download couldn't be put together. Check your connection and try again.",
      });
    }
  };

  const pct = status.kind === "building" ? Math.round((status.done / status.total) * 100) : 0;

  return (
    <section className="mt-8" aria-labelledby="pick-heading">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="pick-heading" className="mr-auto text-xl font-black text-foreground">
          Choose your games <span className="text-muted">({selected.size} of {games.length})</span>
        </h2>
        <button
          type="button"
          onClick={() => setSelected(new Set(games.map((g) => g.id)))}
          disabled={busy || selected.size === games.length}
          className="rounded-full bg-surface-2 px-4 py-2 text-sm font-extrabold text-foreground transition hover:bg-brand-50 hover:text-brand disabled:opacity-50"
        >
          Select all
        </button>
        <button
          type="button"
          onClick={() => setSelected(new Set())}
          disabled={busy || selected.size === 0}
          className="rounded-full bg-surface-2 px-4 py-2 text-sm font-extrabold text-foreground transition hover:bg-brand-50 hover:text-brand disabled:opacity-50"
        >
          Clear
        </button>
      </div>

      <ul className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {games.map((g) => {
          const on = selected.has(g.id);
          return (
            <li key={g.id}>
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                disabled={busy}
                onClick={() => toggle(g.id)}
                className={`group relative flex w-full flex-col overflow-hidden rounded-3xl bg-surface text-left transition ${
                  on ? "ring-2 ring-brand shadow-xl shadow-brand/15" : "opacity-75 ring-1 ring-border hover:opacity-100"
                }`}
              >
                <span
                  className="relative block aspect-[16/9] w-full overflow-hidden"
                  style={{ background: `linear-gradient(135deg, ${g.gradient[0]}, ${g.gradient[1]})` }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- decorative same-origin cover, as elsewhere */}
                  <img src={g.cover} alt="" loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
                  <span
                    aria-hidden="true"
                    className={`absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full text-base font-black shadow-lg transition ${
                      on ? "bg-brand text-white" : "bg-black/45 text-white/80"
                    }`}
                  >
                    {on ? "✓" : "+"}
                  </span>
                </span>
                <span className="grid gap-1 p-4">
                  <span className="text-lg font-black leading-tight text-foreground">{g.name}</span>
                  <span className="line-clamp-2 text-sm font-semibold text-muted">{g.tagline}</span>
                  <span className="mt-1 flex flex-wrap gap-1.5 text-xs font-extrabold text-muted">
                    {g.category && <span className="rounded-full bg-surface-2 px-2 py-0.5">{g.category}</span>}
                    <span className="rounded-full bg-surface-2 px-2 py-0.5">{formatBytes(g.size)}</span>
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="sticky bottom-4 z-10 mt-8 flex flex-wrap items-center gap-4 rounded-3xl bg-surface p-5 shadow-xl ring-1 ring-border">
        <div className="mr-auto grid">
          <span className="text-base font-black text-foreground">
            {selected.size === 0 ? "No games chosen" : `${selected.size} ${selected.size === 1 ? "game" : "games"} · about ${formatBytes(estimate)}`}
          </span>
          <span className="text-sm font-semibold text-muted" role="status" aria-live="polite">
            {status.kind === "building" && `Packing ${status.done < status.total ? status.label : "your arcade"}…`}
            {status.kind === "done" && `Downloaded (${formatBytes(status.bytes)}). Unzip it and open index.html.`}
            {status.kind === "error" && <span className="text-[#d61f5d] dark:text-[#ff6b9a]">{status.message}</span>}
            {status.kind === "idle" && "One ZIP file: the arcade page, your games and a short guide."}
          </span>
          {status.kind === "building" && (
            <span className="mt-2 block h-2 w-full max-w-xs overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
              <span className="block h-full rounded-full bg-brand transition-[width]" style={{ width: `${pct}%` }} />
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={download}
          disabled={busy || selected.size === 0}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-brand px-6 py-3 text-base font-extrabold text-white shadow-lg shadow-brand/25 transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Packing…" : "Download arcade"}
        </button>
      </div>
    </section>
  );
}
