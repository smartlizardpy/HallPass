import "server-only";

/**
 * Scoreboard / leaderboard data layer backed by Pantry (getpantry.cloud).
 *
 * Pantry contract (verified live against the real service):
 *   - GET  /                  -> { name, percentFull, baskets:[{name, ttl}] }
 *   - GET  /basket/{name}     -> basket JSON contents
 *                                (HTTP 400 with "does not exist" if missing)
 *   - POST /basket/{name}     -> CREATE or fully REPLACE the basket with the body
 *   - PUT  /basket/{name}     -> DEEP-MERGE the body into the existing basket;
 *                                arrays are APPENDED. PUT to a NON-existent
 *                                basket FAILS (HTTP 400) — it does NOT create.
 *                                The PUT/POST response echoes the full basket.
 *
 * Why this matters:
 *   - `PUT {scores:[entry]}` appends one entry without a read-modify-write, so
 *     concurrent submissions don't clobber each other (no lost updates).
 *   - Because PUT can't create, a board MUST be POST-initialized first. The API
 *     layer enforces this ("board not initialized" -> 409).
 *
 * Throttle: the whole pantry is limited to ~100 calls / 60s. Therefore reads
 * are cached (~45s via Next fetch revalidate) and writes are kept to a single
 * call each.
 */

const PANTRY_BASE = "https://getpantry.cloud/apiv1/pantry";

/** Cache window for board reads, in seconds. Keeps us well under the rate limit. */
export const BOARD_CACHE_SECONDS = 45;

/** Compact a board's `scores` array once it grows past this many entries. */
const COMPACT_THRESHOLD = 200;
/** Number of top entries to keep when compacting. */
const COMPACT_KEEP = 100;

/** Stored shape — short keys to keep baskets small (handle, score, timestamp-ms). */
export type ScoreEntry = { h: string; s: number; t: number };

/** Public-facing shape returned by the data layer / APIs. */
export type PublicScore = { handle: string; score: number; rank: number };

export type Period = "all" | "day";

export type BoardResult = {
  /** Game slug. */
  game: string;
  scores: PublicScore[];
};

type BasketContents = { scores?: ScoreEntry[] } & Record<string, unknown>;

export type PantryBasketInfo = { name: string; ttl: number };
export type PantryDetails = {
  name: string;
  percentFull: number;
  baskets: PantryBasketInfo[];
};

/** Basket name for the all-time board of a given game slug. */
export function basketForSlug(slug: string): string {
  return `lb_${slug}`;
}

/** Recover a game slug from a basket name, or null if it isn't a board basket. */
export function slugFromBasket(name: string): string | null {
  return name.startsWith("lb_") ? name.slice(3) : null;
}

function pantryId(): string | null {
  return process.env.PANTRY_ID?.trim() || null;
}

function basketUrl(name: string): string {
  // pantryId() is checked by callers before this is used.
  return `${PANTRY_BASE}/${pantryId()}/basket/${encodeURIComponent(name)}`;
}

/** Redact the pantry id from a URL before logging (never log the secret). */
function redact(url: string): string {
  return url.replace(/pantry\/[^/]+/, "pantry/***");
}

/** Small backoff (ms) before each write retry when Pantry replies 429. */
const WRITE_429_BACKOFF_MS = [250, 600];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type WriteOutcome =
  | { ok: true; res: Response }
  | { ok: false; rateLimited: boolean };

/**
 * POST/PUT to Pantry with small backoff specifically on HTTP 429 — Pantry's
 * shared free-tier rate limit, which is the real write ceiling for the
 * scoreboard. Distinguishes a transient 429 ("busy, retry") from a hard failure
 * so routes can answer with 503 + Retry-After instead of a misleading 502.
 * Never throws.
 */
async function pantryWrite(
  url: string,
  init: RequestInit
): Promise<WriteOutcome> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) return { ok: true, res };
      if (res.status === 429) {
        if (attempt < WRITE_429_BACKOFF_MS.length) {
          await sleep(WRITE_429_BACKOFF_MS[attempt]);
          continue;
        }
        console.warn(
          `[scoreboard] Pantry rate-limited (429) after ${attempt + 1} tries: ${redact(url)}`
        );
        return { ok: false, rateLimited: true };
      }
      console.warn(`[scoreboard] Pantry write failed: HTTP ${res.status}`);
      return { ok: false, rateLimited: false };
    } catch {
      // network error / timeout — not a rate-limit; don't retry.
      return { ok: false, rateLimited: false };
    }
  }
}

/**
 * Read a basket's contents. Returns null if the basket is missing or Pantry is
 * unreachable/unconfigured — callers treat null as "empty / not initialized".
 *
 * Cached for BOARD_CACHE_SECONDS via Next's fetch cache so repeated reads don't
 * hammer Pantry's shared rate limit. Tagged so it can be invalidated later.
 */
async function readBasket(name: string): Promise<BasketContents | null> {
  if (!pantryId()) return null;
  try {
    const res = await fetch(basketUrl(name), {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      next: { revalidate: BOARD_CACHE_SECONDS, tags: [`board:${name}`] },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      // 400/404 => missing basket. Anything else is also treated as "empty"
      // so a dead board never throws into the request path.
      return null;
    }
    const data = (await res.json()) as BasketContents;
    return data ?? null;
  } catch {
    return null;
  }
}

function normalizeScores(contents: BasketContents | null): ScoreEntry[] {
  const raw = contents?.scores;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (e): e is ScoreEntry =>
      !!e &&
      typeof e === "object" &&
      typeof (e as ScoreEntry).h === "string" &&
      typeof (e as ScoreEntry).s === "number" &&
      Number.isFinite((e as ScoreEntry).s)
  );
}

function toPublic(entries: ScoreEntry[], limit: number): PublicScore[] {
  return [...entries]
    .sort((a, b) => b.s - a.s || a.t - b.t) // score desc, earlier wins ties
    .slice(0, Math.max(0, limit))
    .map((e, i) => ({ handle: e.h, score: e.s, rank: i + 1 }));
}

/** Compute the 1-based rank a given score would occupy on the full board. */
function rankForScore(entries: ScoreEntry[], score: number): number {
  // Rank = 1 + (number of strictly-higher scores).
  let higher = 0;
  for (const e of entries) if (e.s > score) higher++;
  return higher + 1;
}

/**
 * Whether a board exists (has been initialized). Uses the cached basket read,
 * so it shares the read budget with getBoard.
 */
export async function boardExists(slug: string): Promise<boolean> {
  const contents = await readBasket(basketForSlug(slug));
  return contents !== null;
}

/**
 * Read a board and return the top-N public scores.
 * `period` is accepted for forward-compat; 'day' currently falls back to 'all'.
 * TODO(daily-boards): implement rolling daily baskets (e.g. lbd_<slug>_<yyyymmdd>).
 */
export async function getBoard(
  slug: string,
  opts: { limit?: number; period?: Period } = {}
): Promise<BoardResult> {
  const limit = clampLimit(opts.limit);
  const contents = await readBasket(basketForSlug(slug));
  const entries = normalizeScores(contents);

  // Best-effort compaction: if the board has grown large, keep only the top
  // COMPACT_KEEP entries and POST-replace the basket. Fire-and-forget; never
  // blocks or fails the read.
  if (entries.length > COMPACT_THRESHOLD) {
    void compactBoard(slug, entries).catch(() => {});
  }

  return { game: slug, scores: toPublic(entries, limit) };
}

export function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return 10;
  return Math.min(100, Math.max(1, Math.floor(limit as number)));
}

export type CreateResult = { ok: true } | { ok: false; rateLimited: boolean };

/**
 * Initialize a board by creating an empty basket. POST creates-or-replaces, so
 * calling this on an existing board would wipe it — the API layer guards against
 * re-init by checking boardExists first. Retries on Pantry 429 and reports
 * whether a failure was rate-limiting so the route can say "try again".
 */
export async function createBoard(slug: string): Promise<CreateResult> {
  if (!pantryId()) return { ok: false, rateLimited: false };
  const outcome = await pantryWrite(basketUrl(basketForSlug(slug)), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scores: [] }),
  });
  return outcome.ok
    ? { ok: true }
    : { ok: false, rateLimited: outcome.rateLimited };
}

export type AppendResult =
  | { ok: true; rank: number }
  | { ok: false; reason: "not-configured" | "rate-limited" | "write-failed" };

/**
 * Append a single score via PUT (deep-merge append — race-safe, no read first).
 * Pantry echoes the full merged basket in the PUT response, so we derive the
 * new entry's rank from that body without an extra read. Retries on Pantry 429.
 */
export async function appendScore(
  slug: string,
  entry: ScoreEntry
): Promise<AppendResult> {
  if (!pantryId()) return { ok: false, reason: "not-configured" };
  const outcome = await pantryWrite(basketUrl(basketForSlug(slug)), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scores: [entry] }),
  });
  if (!outcome.ok) {
    return {
      ok: false,
      reason: outcome.rateLimited ? "rate-limited" : "write-failed",
    };
  }

  // PUT returns the full merged basket; use it to compute rank exactly.
  let rank = 1;
  try {
    const merged = (await outcome.res.json()) as BasketContents;
    rank = rankForScore(normalizeScores(merged), entry.s);
  } catch {
    // Fall back to optimistic rank 1 if the body can't be parsed.
  }
  return { ok: true, rank };
}

/**
 * Best-effort compaction: replace the basket with its top COMPACT_KEEP entries.
 * Called opportunistically from getBoard. Never throws.
 */
async function compactBoard(slug: string, entries: ScoreEntry[]): Promise<void> {
  if (!pantryId()) return;
  const kept = [...entries]
    .sort((a, b) => b.s - a.s || a.t - b.t)
    .slice(0, COMPACT_KEEP);
  // Best-effort; pantryWrite handles 429 backoff and never throws.
  await pantryWrite(basketUrl(basketForSlug(slug)), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scores: kept }),
  });
}

/** Fetch pantry-level details (which boards exist, fullness, etc.). */
export async function pantryDetails(): Promise<PantryDetails | null> {
  if (!pantryId()) return null;
  try {
    const res = await fetch(`${PANTRY_BASE}/${pantryId()}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      next: { revalidate: BOARD_CACHE_SECONDS, tags: ["pantry:details"] },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<PantryDetails>;
    return {
      name: typeof data.name === "string" ? data.name : "",
      percentFull: typeof data.percentFull === "number" ? data.percentFull : 0,
      baskets: Array.isArray(data.baskets)
        ? data.baskets
            .filter(
              (b): b is PantryBasketInfo =>
                !!b && typeof b.name === "string"
            )
            .map((b) => ({ name: b.name, ttl: Number(b.ttl) || 0 }))
        : [],
    };
  } catch {
    return null;
  }
}

/** Returns the slugs of all currently-initialized boards. */
export async function listInitializedSlugs(): Promise<string[]> {
  const details = await pantryDetails();
  if (!details) return [];
  return details.baskets
    .map((b) => slugFromBasket(b.name))
    .filter((s): s is string => s !== null);
}

/** True when a Pantry id is configured (server-side feature flag). */
export function isScoreboardConfigured(): boolean {
  return pantryId() !== null;
}
