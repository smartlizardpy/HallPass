/**
 * Compose a player's offline arcade download from prebuilt files, in the
 * browser (app/offline-arcade). Nothing is built per request: the launcher and
 * the packages are the static files `npm run hpg:arcade` wrote to
 * public/arcade/, and this only checks and zips them.
 *
 * Every file is checked against the sha256 in the catalog the page was
 * rendered with. A mismatch (a stale cache, a half-finished deploy, a proxy
 * rewriting responses) stops the download rather than handing the player an
 * arcade that refuses its own games.
 *
 *   HallPass Arcade/
 *     index.html   the launcher
 *     games.zip    the chosen .hpg packages, stored (they are already compressed)
 *     README.txt   how to use it
 */

import type { ArcadeCatalog, ArcadeCatalogGame } from "./build/arcade";
import { sha256Hex } from "./format/hash";
import { writeZip } from "./archive/zip";

export const DOWNLOAD_FOLDER = "HallPass Arcade";
export const DOWNLOAD_NAME = "hallpass-offline-arcade.zip";

export class ComposeError extends Error {
  constructor(
    message: string,
    readonly file: string,
  ) {
    super(message);
    this.name = "ComposeError";
  }
}

export type Fetcher = (path: string) => Promise<Uint8Array>;
export type ComposeProgress = (done: number, total: number, label: string) => void;

export function readmeText(games: readonly Pick<ArcadeCatalogGame, "name">[], builtOn: string): string {
  return [
    "HALLPASS OFFLINE ARCADE",
    "=======================",
    "",
    "Play HallPass games with no internet connection.",
    "",
    "HOW TO START",
    "  1. Unzip this download (on Windows: right-click > Extract All).",
    "  2. Open the folder and double-click index.html.",
    "     It opens in your web browser: Chrome, Edge or Firefox.",
    "  3. The first time, drop games.zip onto the page (or press Browse files",
    "     and choose games.zip from this folder).",
    "  4. Pick a game and play. Next time, just open index.html again.",
    "",
    "YOUR PROGRESS",
    "  Saves are kept in the browser on this computer. To move them to another",
    "  computer, or to keep a copy, open Saves and press Export saves.",
    "  Clearing your browser's site data also clears your arcade.",
    "",
    "GAMES IN THIS ARCADE",
    ...games.map((g) => `  - ${g.name}`),
    "",
    "NOTES",
    "  - Nothing here uses the internet. Online features (accounts, global",
    "    leaderboards, multiplayer) are switched off; scores stay on this computer.",
    "  - Only games built by HallPass for this arcade will open in it. To get new",
    "    or updated games, download a fresh arcade from HallPass.",
    "",
    `Built ${builtOn}.`,
    "",
  ].join("\r\n");
}

async function checked(fetcher: Fetcher, path: string, sha256: string): Promise<Uint8Array> {
  let bytes: Uint8Array;
  try {
    bytes = await fetcher(path);
  } catch (e) {
    throw new ComposeError(e instanceof Error ? e.message : String(e), path);
  }
  if ((await sha256Hex(bytes)) !== sha256) throw new ComposeError("file does not match this page's catalog", path);
  return bytes;
}

/** The download ZIP for the games with `ids`, in catalog order. */
export async function composeArcade(
  catalog: ArcadeCatalog,
  ids: ReadonlySet<string>,
  fetcher: Fetcher,
  builtOn: string,
  onProgress: ComposeProgress = () => {},
): Promise<Uint8Array> {
  if (!catalog.available || !catalog.launcher) throw new ComposeError("the offline arcade is not available on this deploy", "catalog.json");
  const games = catalog.games.filter((g) => ids.has(g.id));
  if (games.length === 0) throw new ComposeError("no games chosen", "");
  const total = games.length + 1;
  onProgress(0, total, "arcade");
  const launcher = await checked(fetcher, catalog.launcher.file, catalog.launcher.sha256);
  onProgress(1, total, "arcade");
  const packages = [];
  for (const [i, g] of games.entries()) {
    const bytes = await checked(fetcher, g.file, g.sha256);
    packages.push({ path: g.file.split("/").pop()!, data: bytes, level: 0 as const });
    onProgress(i + 2, total, g.name);
  }
  const gamesZip = writeZip(packages);
  return writeZip([
    { path: `${DOWNLOAD_FOLDER}/index.html`, data: launcher, level: 9 },
    { path: `${DOWNLOAD_FOLDER}/games.zip`, data: gamesZip, level: 0 },
    { path: `${DOWNLOAD_FOLDER}/README.txt`, data: new TextEncoder().encode(readmeText(games, builtOn)), level: 9 },
  ]);
}

/** Rough download size: packages are stored, the launcher compresses ~3×. */
export function estimateBytes(catalog: ArcadeCatalog, ids: ReadonlySet<string>): number {
  const pkgs = catalog.games.filter((g) => ids.has(g.id)).reduce((s, g) => s + g.size + 120, 0);
  return pkgs + Math.round((catalog.launcher?.size ?? 0) / 3) + 2048;
}
