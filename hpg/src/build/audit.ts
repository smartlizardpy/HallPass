/**
 * The compatibility audit: try to package EVERY game in `public/games/` with a
 * permissive default adapter, and report what would block it.
 *
 * This is the regenerable version of the matrix in
 * docs/offline-arcade-design.md §3. "Packageable" here means the PACKAGER
 * found nothing blocking. A game still has to pass the browser journey before
 * its adapter may say `verified`.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { GOOGLE_FONT_HOSTS, type GameAdapter } from "./adapter";
import { packageGame, type CatalogGame } from "./packager";

export type AuditRow = {
  id: string;
  verdict: "packageable" | "fonts-fall-back" | "blocked" | "not-published";
  reason: string;
  sizeKb: number | null;
  sdk: boolean;
  webgl: boolean;
  workers: boolean;
  wasm: boolean;
  storage: boolean;
  adapter: "verified" | "experimental" | "none";
};

export async function auditGames(repoRoot: string, catalog: readonly CatalogGame[], adapters: readonly GameAdapter[]): Promise<AuditRow[]> {
  const gamesDir = path.join(repoRoot, "public", "games");
  const ids = readdirSync(gamesDir)
    .filter((n) => !n.startsWith(".") && !n.startsWith("_") && statSync(path.join(gamesDir, n)).isDirectory())
    .sort();
  const rows: AuditRow[] = [];
  for (const id of ids) {
    const known = adapters.find((a) => a.id === id);
    const adapter: GameAdapter = known ?? {
      id,
      version: "0.0.0",
      status: "experimental",
      inputs: [],
      dropRemoteHosts: GOOGLE_FONT_HOSTS,
      workers: /(^|\/)[^/]*worker[^/]*\.js$/i,
    };
    const html = existsSync(path.join(gamesDir, id, "index.html")) ? readFileSync(path.join(gamesDir, id, "index.html"), "utf8") : "";
    const base = {
      id,
      storage: /localStorage/.test(html) || hasInFolder(path.join(gamesDir, id), /localStorage/),
      adapter: known ? known.status : ("none" as const),
    };
    const result = await packageGame(repoRoot, adapter, catalog);
    if (!result.ok) {
      const first = result.issues.find((i) => i.level === "error")?.message ?? "unknown";
      const notPublished = /not a published game|staged|off-site/.test(first);
      rows.push({ ...base, verdict: notPublished ? "not-published" : "blocked", reason: first, sizeKb: null, sdk: false, webgl: false, workers: false, wasm: false });
      continue;
    }
    const m = result.manifest;
    const fonts = result.issues.some((i) => i.message.startsWith("dropped remote"));
    const mentions = result.issues.filter((i) => i.message.startsWith("code mentions remote host")).map((i) => i.message.replace("code mentions remote host ", "").split(";")[0]);
    rows.push({
      ...base,
      verdict: fonts ? "fonts-fall-back" : "packageable",
      reason: mentions.length ? `mentions ${mentions.join(", ")}` : "",
      sizeKb: Math.round(result.bytes.length / 1024),
      sdk: m.features?.scores ?? false,
      webgl: m.compatibility?.webgl ?? false,
      workers: m.compatibility?.workers ?? false,
      wasm: m.runtime === "wasm",
    });
  }
  return rows;
}

function hasInFolder(dir: string, re: RegExp): boolean {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory() && hasInFolder(full, re)) return true;
    if (e.isFile() && /\.(js|mjs)$/.test(e.name) && re.test(readFileSync(full, "utf8"))) return true;
  }
  return false;
}

export function auditMarkdown(rows: readonly AuditRow[]): string {
  const yes = (b: boolean) => (b ? "yes" : "");
  const lines = [
    "| Game | Verdict | .hpg KB | SDK | WebGL | Workers | WASM | Saves | Adapter | Notes |",
    "|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const r of rows) {
    lines.push(
      `| ${r.id} | ${r.verdict} | ${r.sizeKb ?? ""} | ${yes(r.sdk)} | ${yes(r.webgl)} | ${yes(r.workers)} | ${yes(r.wasm)} | ${yes(r.storage)} | ${r.adapter} | ${r.reason.replace(/\|/g, "\\|").slice(0, 140)} |`,
    );
  }
  return lines.join("\n");
}
