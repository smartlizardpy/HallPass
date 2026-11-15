/**
 * Per-game packaging configuration.
 *
 * An adapter describes HOW to package a game. It never changes the game itself:
 * gameplay code in `public/games/<slug>/` is read as-is, and the online
 * version keeps working untouched. Display metadata (name, description,
 * category, colours, author) is NOT repeated here; it comes from the site
 * catalogue (`app/lib/games.ts`), so a rename there reaches the package too.
 *
 * An adapter exists only for a game someone has actually checked offline.
 * `status: "verified"` means it passed the real-browser journey
 * (`npm run hpg:e2e`) and appears in the website's arcade builder;
 * `"experimental"` packages build but are not offered to players.
 */

import type { HpgInput, HpgPermission } from "../format/constants";

export type GameAdapter = {
  /** The slug: `public/games/<id>/` and the `games.ts` entry. */
  id: string;
  /**
   * Package version, MAJOR.MINOR.PATCH. Bump it when the adapter's output
   * changes in a way players should see as an update. Content changes are
   * always captured anyway by the build hash in the full version.
   */
  version: string;
  status: "verified" | "experimental";
  /** Entry HTML inside the game folder. Default `index.html`. */
  entry?: string;
  inputs: HpgInput[];
  display?: { width?: number; height?: number; orientation?: "landscape" | "portrait" | "any" };
  /** Local leaderboard order. Default `"desc"` (higher is better). */
  scoreOrder?: "desc" | "asc";
  /** The game keeps progress in localStorage (saved through the launcher). */
  saves?: boolean;
  permissions?: HpgPermission[];
  /**
   * Worker scripts the game starts with `new Worker(new URL(…, import.meta.url))`,
   * matched against paths relative to the game folder. Each is rebuilt as a
   * self-contained CLASSIC worker (module workers cannot start from a blob in
   * an opaque-origin frame) and resolved through `hpg:/`.
   */
  workers?: RegExp;
  /** Extra files kept as separate package entries, reachable as `hpg:/<path>`. */
  assets?: RegExp;
  /**
   * Remote hosts whose resources may be DROPPED because they are cosmetic
   * (web fonts: the game falls back to a system font). Every drop is listed in
   * the build report and in the package's compatibility notes. Any other
   * remote dependency fails the build; it is never silently removed.
   */
  dropRemoteHosts?: string[];
  /** Shown to players in the launcher's game details. */
  notes?: string[];
};

/** Hosts serving the networked HallPass SDK; its tag is replaced by the offline SDK. */
export const HALLPASS_SDK_PATHS = ["/sdk/v1/hallpass.js"];
// hallpass-rouge.vercel.app is the site's original Vercel domain, which older
// games still load the SDK from (docs/championship-design.md).
export const HALLPASS_HOSTS = ["hallpass.games", "www.hallpass.games", "hallpass-rouge.vercel.app"];

/**
 * The HallPass P2P (co-op) SDK, which games import as a module from the site.
 * The packager bundles the repo's own copy (`public/sdk/p2p/v1/`, the exact
 * file the site serves) instead, so the game loads offline; co-op itself still
 * needs the network and fails the way the game already handles. Reported in
 * the build log, never silent.
 */
export const HALLPASS_P2P_SDK_PATHS = ["/sdk/p2p/v1/hallpass-p2p.js", "/sdk/p2p/v1/hallpass-p2p.min.js"];

export const GOOGLE_FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];
