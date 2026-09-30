/**
 * Allowlist guard for the INCLUDING-STAGED catalogue APIs.
 *
 * `resolveGames`, `resolveGame` and `isResolvedSlug` are public-only, so any code
 * may call them safely. `resolveGamesIncludingStaged`, `resolveGameIncludingStaged`,
 * `isKnownSlug` and `isStagedSlug` see staged games, so a file that imports one
 * must have a reason to and must gate what it does with the result
 * (`canViewStaged()`, a dashboard role check, or a write that only needs to know
 * the game exists). This test scans every non-test source file under `app/` and
 * fails when an unlisted file imports one. The failure message is the review
 * prompt: decide whether the new importer is gated, then add its path here.
 *
 * ENTRIES ARE PATH PREFIXES (relative to the repo root, forward slashes), so one
 * entry covers a directory or names a single file. The list is written AHEAD of
 * the code: several of these paths do not exist yet, and a prefix that matches
 * nothing is harmless — that is what lets parallel work land importers without
 * touching this file. Each prefix and why it is here:
 *
 *   app/dashboard/                          Admin pages and actions: the game
 *                                           page, publish, games list, curation,
 *                                           board provisioning. Role-gated.
 *   app/beta/                               The tester's pages (staged-games
 *                                           section, session player). Tester-gated.
 *   app/game-html/                          Serves a game's files; must know if a
 *                                           slug is staged to apply the 404 gate.
 *   app/game-media/                         Same, for screenshots and covers.
 *   app/api/v1/games/[slug]/reviews/        Reviews POST on staged games for
 *                                           testers; GET hides them otherwise.
 *   app/api/v1/reviews/                     translate/helpful/report resolve a
 *                                           review id back to its game's slug so
 *                                           sequential ids cannot leak a staged
 *                                           game's reviews.
 *   app/api/v1/games/[slug]/leaderboard/    The store panel returns empty for a
 *                                           staged slug.
 *   app/api/v1/leaderboard/                 Per-board route: a board is staged
 *                                           when its linked game is.
 *   app/api/v1/games/[slug]/achievements/   Testers earn achievements on staged
 *                                           games; public GETs are gated.
 *   app/api/v1/beta/                        clip-token accepts staged slugs for
 *                                           testers.
 *   app/play/you/                           Drops standings rows for staged
 *                                           boards unless the viewer can see them.
 *   app/api/v1/me/friends/scores/           Skips the friends' standings on a
 *                                           staged game unless the viewer can
 *                                           see it.
 *   app/lib/games-store.ts                  Defines the APIs (and uses them).
 *   app/lib/beta/                           Beta helpers: staged-access, publish
 *                                           and shot handling.
 *   app/lib/game-media.ts                   Hero/cover media knows which games
 *                                           are staged.
 *
 * Anything else is deliberately NOT here: public pages, sitemap, llms, OG images,
 * challenges and the game page itself use the public-only resolvers, which is the
 * whole point of the split.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");

const GUARDED = [
  "resolveGamesIncludingStaged",
  "resolveGameIncludingStaged",
  "isKnownSlug",
  "isStagedSlug",
];

const ALLOWED_PREFIXES = [
  "app/dashboard/",
  "app/beta/",
  "app/game-html/",
  "app/game-media/",
  "app/api/v1/games/[slug]/reviews/",
  "app/api/v1/reviews/",
  "app/api/v1/games/[slug]/leaderboard/",
  "app/api/v1/leaderboard/",
  "app/api/v1/games/[slug]/achievements/",
  "app/api/v1/beta/",
  "app/play/you/",
  "app/api/v1/me/friends/scores/",
  "app/lib/games-store.ts",
  "app/lib/beta/",
  "app/lib/game-media.ts",
];

/** Every non-test `.ts`/`.tsx` file under `dir`, as repo-relative posix paths. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(path.relative(ROOT, full).split(path.sep).join("/"));
    }
  }
  return out;
}

/**
 * Whether `source` imports (or re-exports) a guarded name from a games-store
 * module. A `* as ns` import counts too, since it can reach any of them.
 */
function importsGuarded(source: string): string[] {
  const hits: string[] = [];
  const named =
    /(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
  for (const m of source.matchAll(named)) {
    if (!/games-store$/.test(m[2])) continue;
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, "");
      if (GUARDED.includes(name)) hits.push(name);
    }
  }
  const ns = /import\s+\*\s+as\s+\w+\s+from\s*["']([^"']*games-store)["']/g;
  for (const m of source.matchAll(ns)) hits.push(`* as (${m[1]})`);
  return hits;
}

const isAllowed = (file: string) =>
  ALLOWED_PREFIXES.some((p) => file.startsWith(p));

describe("including-staged APIs are imported only by allowlisted files", () => {
  it("has no unlisted importer", () => {
    const offenders = sourceFiles(path.join(ROOT, "app"))
      .filter((f) => !isAllowed(f))
      .map((f) => ({ f, hits: importsGuarded(readFileSync(path.join(ROOT, f), "utf8")) }))
      .filter((x) => x.hits.length > 0)
      .map((x) => `${x.f} imports ${x.hits.join(", ")}`);
    expect(
      offenders,
      "These files import an including-staged API but are not on the allowlist in " +
        "app/lib/staged-allowlist.test.ts. Gate the call (canViewStaged() / a role " +
        "check) and then add the path, or use the public-only resolver.",
    ).toEqual([]);
  });

  it("detects a guarded import (the scan itself works)", () => {
    expect(
      importsGuarded(`import {\n  resolveGames,\n  isStagedSlug as s,\n} from "@/app/lib/games-store";`),
    ).toEqual(["isStagedSlug"]);
    expect(importsGuarded(`import { resolveGames } from "@/app/lib/games-store";`)).toEqual([]);
    expect(importsGuarded(`import { isKnownSlug } from "./other";`)).toEqual([]);
    expect(importsGuarded(`import * as s from "@/app/lib/games-store";`)).toHaveLength(1);
    expect(isAllowed("app/dashboard/games/x.ts")).toBe(true);
    expect(isAllowed("app/page.tsx")).toBe(false);
  });
});
