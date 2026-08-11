/**
 * Game achievements — `GET|POST|OPTIONS /api/v1/games/[slug]/achievements`.
 *
 * The only achievement surface a running game talks to. GET reads the shelf,
 * POST reports unlocks and progress. It sits beside `reviews/route.ts` as a
 * route handler rather than a server action for the same reason that one does:
 * every `requireRole` server action in this codebase is admin-only, and this is
 * a write by an ordinary player with no role.
 *
 * ── THE CACHING TRAP, WHICH IS THE WHOLE REASON THIS DOCBLOCK IS LONG ───────
 *
 * The GET body is PERSONALISED whenever a session exists — it carries this
 * child's progress and unlock timestamps. A `public, s-maxage=…` on that body
 * hands one child's progress to a shared CDN edge, which then serves it to every
 * other player who asks for the same URL. There is no error, no log line, and
 * nothing on screen looks wrong to the person who caused it; the first symptom
 * is a player seeing someone else's trophies.
 *
 * So the cache header BRANCHES on whether a player resolved, and the branch is
 * written out explicitly rather than folded into a ternary inside the header
 * object, because this is the line a future edit is most likely to "tidy":
 *
 *   session  → `private, no-store`                    (never leaves the browser)
 *   no session → `public, s-maxage=30, s-w-r=120`     (identical for everyone)
 *
 * `Vary: Cookie` rides along on BOTH branches as a second lock. It is not the
 * control — `no-store` is — but it means that even the guest response, which is
 * genuinely shareable, is keyed by the cookie header and so can never be handed
 * to a signed-in player as their own (they would see a permanently empty shelf
 * and quite reasonably report it as lost progress).
 *
 * ── CORS: WILDCARD ON THE READ, NOTHING ON THE WRITE ────────────────────────
 *
 * GET carries `Access-Control-Allow-Origin: *` exactly like
 * `/api/v1/leaderboard/[slug]` — an embedded game on another origin must be able
 * to render its own trophy shelf, and the guest body it gets there is public
 * data anyway (no cookie travels cross-origin, so the cross-origin read is
 * always the un-personalised branch).
 *
 * The OPTIONS handler deliberately emits NO `Access-Control-Allow-Origin`,
 * mirroring `/api/v1/me/handle`: this POST is a cookie-credentialed write, and a
 * wildcard origin cannot legally carry credentials. That combination is not a
 * contradiction, it is precisely what we want, and it works because of an
 * asymmetry in the CORS spec worth writing down:
 *
 *   - A cross-origin GET with no custom headers is a SIMPLE request. It is not
 *     preflighted at all; the browser sends it and reads the ACAO on the GET
 *     RESPONSE. So the wildcard on GET is sufficient for the embedded read.
 *   - A cross-origin POST with `Content-Type: application/json` IS preflighted.
 *     The preflight lands on OPTIONS, finds no ACAO, and the browser refuses to
 *     send the write. The method is advertised (so a same-origin caller sees a
 *     coherent Allow-Methods) without the write being opened cross-origin.
 *
 * The residual case — a cross-origin `sendBeacon` with `text/plain`, which is
 * simple and so escapes the preflight — is harmless: no SameSite cookie rides
 * along, so it resolves to no player and gets `signed-out`.
 *
 * ── NO `isTrustedOrigin()` HERE, AND THAT IS DELIBERATE ─────────────────────
 *
 * Every other credentialed write (`reviews`, `friends`, `handle`) calls
 * `isTrustedOrigin()`, whose allowlist pointedly EXCLUDES `/game-html/`. This
 * endpoint is the one whose legitimate caller lives at `/game-html/<slug>/`, so
 * that guard would reject exactly the traffic it exists to serve. The
 * substitute control is that a game cannot mint achievements: the catalogue is
 * admin-provisioned, so the worst a hostile game can do with the player's cookie
 * is grant that same player an achievement in the game they are already
 * playing — which is a thing the game gets to decide anyway.
 */

import { isMissingColumnError } from "@/app/lib/db";
import { isResolvedSlug } from "@/app/lib/games-store";
import {
  getAchievementCatalogue,
  getAchievementRarity,
  getPlayerAchievements,
  recordAchievements,
  type PlayerAchievement,
  type UnlockResult,
} from "@/app/lib/achievements";
import { findGame } from "@/app/lib/games";
import { achievementCopy } from "@/app/lib/notifications/copy";
import { notifyPlayer } from "@/app/lib/notifications/deliver";
import {
  ACHIEVEMENT_PLAYER_RATE_LIMIT,
  MAX_BATCH_SIZE,
  type UnlockReason,
} from "@/app/lib/achievements/config";
import {
  NO_STORE,
  credentialedOptions,
  currentPlayerId,
} from "@/app/lib/social/request-guard";

/**
 * File a bell notification for each achievement this call newly unlocked.
 *
 * ── IT RESOLVES NAMES, AND ONLY WHEN IT HAS TO ─────────────────────────────
 * `UnlockResult` carries the `key` — a slug like `no-deaths` — and a
 * notification reading "You unlocked no-deaths" is the same mistake the
 * challenge copy exists to avoid. So the catalogue is read for the display
 * names, and the static game list for the game's title.
 *
 * Both reads happen ONLY when something was actually unlocked, which is the rare
 * path: this route is called on every score event a game reports, and the
 * overwhelming majority of those unlock nothing. The early return is what keeps
 * a notification feature off the hot path of a game loop.
 *
 * ── A GAME NOT IN THE STATIC CATALOGUE STILL NOTIFIES ──────────────────────
 * `findGame` covers bundled games; an EXTERNAL game is not in it. Rather than
 * skip the notification — an external game is a real game a real player really
 * played, which is the bug `favorites.ts` is cited for elsewhere in this file —
 * the copy falls back to the slug for the game name only. The achievement's own
 * name, which is the subject of the sentence, is always the real one.
 *
 * Never rejects. The scores and unlocks are already written by the time this
 * runs, and none of them may be lost to a notification that could not be filed.
 */
async function notifyUnlocks(
  slug: string,
  playerId: string,
  results: UnlockResult[],
): Promise<void> {
  const unlocked = results.filter((result) => result.unlocked);
  if (unlocked.length === 0) return;

  try {
    const catalogue = await getAchievementCatalogue(slug);
    const names = new Map(catalogue.map((def) => [def.key, def.name]));
    const gameTitle = findGame(slug)?.title ?? slug;

    // Concurrent. Several achievements can land on one call, and the per-kind
    // push tag collapses them into a single banner on the device — so the cost
    // of unlocking five at once is five bell rows and one buzz.
    await Promise.all(
      unlocked.map((result) =>
        notifyPlayer(playerId, {
          kind: "achievement_unlocked",
          copy: achievementCopy({
            achievement: names.get(result.key) ?? result.key,
            gameTitle,
            slug,
          }),
          dedupeKey: `achievement:${slug}:${result.key}`,
        }),
      ),
    );
  } catch (error) {
    console.error("achievement notification failed:", error);
  }
}

/**
 * Readable cross-origin by any embed. Paired with a cache header chosen per
 * request below — never merged into one constant, so the two cannot be edited
 * as if they were one decision.
 */
const READ_CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  // Belt-and-braces on both branches; see the docblock. A shared cache that
  // honours this cannot serve a guest-shaped entry to a cookie-bearing player.
  Vary: "Cookie",
};

/** Identity-free body: identical for every caller, so a CDN may hold it. */
const PUBLIC_CACHE: Record<string, string> = {
  ...READ_CORS,
  "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120",
};

/** Personalised body: this player's progress. Must never reach a shared cache. */
const PRIVATE_CACHE: Record<string, string> = { ...READ_CORS, ...NO_STORE };

/**
 * Sent with 429 and 503 so a game's retry is scheduled rather than guessed.
 * Derived from the config window rather than hardcoded: a future widening of the
 * rate limit that left a stale literal here would tell games to retry into a
 * wall.
 */
const RETRY_AFTER: Record<string, string> = {
  "Retry-After": String(ACHIEVEMENT_PLAYER_RATE_LIMIT.windowSeconds),
};

type GetBody = {
  slug: string;
  /** Whether the progress in `achievements` belongs to anyone. */
  signedIn: boolean;
  achievements: PlayerAchievement[];
  /** Points this player holds in this game (0 for a guest). */
  earnedPoints: number;
  /** Points on offer in this game — the denominator for a "3/10" chip. */
  totalPoints: number;
  /** `key -> 0..100`. Present only when `?rarity=1` was asked for. */
  rarity?: Record<string, number>;
};

type PostBody = {
  ok: boolean;
  reason?: UnlockReason;
  results: UnlockResult[];
};

/**
 * The shelf for one game, plus this player's progress if there is a player.
 *
 * DOES NOT VALIDATE THE SLUG. An unprovisioned game and a nonexistent game both
 * answer `200` with an empty list, and that is the right call for a read: the
 * only way to tell them apart is `isResolvedSlug()`, which resolves the entire
 * catalogue, and paying that on a public cacheable read to turn one empty
 * response into a different empty response buys nothing. The POST validates,
 * because there a 404 tells a game author their slug is wrong before they ship.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const playerId = await currentPlayerId();

  // Opt-in, not default: rarity is a second query and the common caller (the SDK
  // asking "what should I show on the pause screen") does not need it. The store
  // page, which does, asks for it explicitly.
  const rarityParam = new URL(req.url).searchParams.get("rarity");
  const wantRarity = rarityParam === "1" || rarityParam === "true";

  try {
    const [shelf, rarity] = await Promise.all([
      getPlayerAchievements(slug, playerId),
      wantRarity ? getAchievementRarity(slug) : Promise.resolve(null),
    ]);

    const body: GetBody = {
      slug,
      signedIn: playerId !== null,
      achievements: shelf.achievements,
      earnedPoints: shelf.earnedPoints,
      totalPoints: shelf.totalPoints,
    };
    if (rarity) body.rarity = rarity;

    // THE BRANCH. A personalised body is `private, no-store`; only the
    // identity-free guest body may be publicly cached. Collapsing these two into
    // one header set caches one child's progress onto a CDN edge and serves it
    // to everyone who opens the same game.
    return Response.json(body, {
      headers: playerId ? PRIVATE_CACHE : PUBLIC_CACHE,
    });
  } catch (error) {
    // Both reads are already fail-soft (they degrade to an empty shelf), so this
    // is unreachable in practice — it exists so that a future non-degrading read
    // added here cannot turn a game page's trophy strip into a 500.
    console.error("achievements GET failed:", error);
    return Response.json(
      {
        slug,
        signedIn: playerId !== null,
        achievements: [],
        earnedPoints: 0,
        totalPoints: 0,
      } satisfies GetBody,
      { headers: PRIVATE_CACHE },
    );
  }
}

/**
 * One entry as it arrives on the wire, before the store sees it.
 *
 * `progress` is `number | undefined` here and never `null`-by-accident: the
 * store reads a nullish progress as "reach the target", so a malformed number
 * silently converting to `undefined` would turn a broken counter into a full
 * unlock. See {@link readEntries}.
 */
type ParsedEntry = { key: string; progress?: number };

type ParseOutcome =
  | { ok: true; entries: ParsedEntry[] }
  | { ok: false; reason: "bad-request" };

/**
 * Accept BOTH body shapes, because both will be reached for:
 *
 *   { unlock: "first-blood" }                     ← the one a game author types
 *   { unlock: ["first-blood", "no-damage"] }
 *   { entries: [{ key: "kills", progress: 57 }] } ← the one with counters
 *
 * They are additive rather than exclusive: a body carrying both is merged, since
 * refusing it would be a rule with no purpose that a game author discovers at
 * runtime. Duplicate keys across the two are fine — the store dedupes before
 * binding, which it must do anyway to avoid Postgres 21000.
 *
 * A PRESENT-BUT-MALFORMED `progress` FAILS THE WHOLE REQUEST rather than being
 * dropped or coerced. This is the one place where being lenient is dangerous:
 * `progress` absent means "reach the target", i.e. a full unlock, so quietly
 * treating `progress: NaN` (or `"57"`, or `undefined` from a bad expression) as
 * absent would hand out the achievement the game was trying to report 3% of.
 * An explicit `null` IS honoured as absent, because that is what the store's own
 * `progress?: number | null` signature promises.
 */
function readEntries(payload: unknown): ParseOutcome {
  const body = (payload ?? {}) as { unlock?: unknown; entries?: unknown };
  const entries: ParsedEntry[] = [];

  const unlock = body.unlock;
  if (typeof unlock === "string") {
    entries.push({ key: unlock });
  } else if (Array.isArray(unlock)) {
    for (const key of unlock) {
      // A non-string in the array is the caller's bug, not ours; dropping it
      // silently would hide it, and the batch is small enough that failing it
      // whole costs one retry.
      if (typeof key !== "string") return { ok: false, reason: "bad-request" };
      entries.push({ key });
    }
  } else if (unlock !== undefined && unlock !== null) {
    return { ok: false, reason: "bad-request" };
  }

  const raw = body.entries;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") {
        return { ok: false, reason: "bad-request" };
      }
      const { key, progress } = item as { key?: unknown; progress?: unknown };
      if (typeof key !== "string") return { ok: false, reason: "bad-request" };
      if (progress === undefined || progress === null) {
        entries.push({ key });
        continue;
      }
      if (typeof progress !== "number" || !Number.isFinite(progress)) {
        return { ok: false, reason: "bad-request" };
      }
      entries.push({ key, progress });
    }
  } else if (raw !== undefined && raw !== null) {
    return { ok: false, reason: "bad-request" };
  }

  return { ok: true, entries };
}

/**
 * Record unlocks and progress for the signed-in player.
 *
 * THE PLAYER COMES FROM `auth()` AND ONLY FROM `auth()`. Nothing in the body can
 * name a player — the same invariant `/api/v1/me/favorites` documents — because
 * the caller here is arbitrary game JavaScript running on our origin, and a
 * body-supplied id would let any game write trophies into any account.
 *
 * A GUEST GETS `200 { ok:false, reason:"signed-out" }`, NOT A 401. Verbatim the
 * reasoning already written into `/api/v1/me/plays`: this fires from inside a
 * running game on a natural cadence, so a 401 paints a red error in every
 * signed-out child's console every time they cross a threshold — dozens per
 * session, for a condition that is not an error. The SDK reads `reason` and goes
 * quiet. Favorites answers 401 because it is user-initiated and a failure there
 * is worth shouting about; this is not.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;

  const playerId = await currentPlayerId();
  // Checked FIRST, before parsing or touching the database: the guest path is
  // the hot one on a public game page and it must cost nothing.
  if (!playerId) {
    return Response.json(
      { ok: false, reason: "signed-out", results: [] } satisfies PostBody,
      { headers: NO_STORE },
    );
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return Response.json(
      { ok: false, reason: "bad-request", results: [] } satisfies PostBody,
      { status: 400, headers: NO_STORE },
    );
  }

  const parsed = readEntries(payload);
  if (!parsed.ok) {
    return Response.json(
      { ok: false, reason: parsed.reason, results: [] } satisfies PostBody,
      { status: 400, headers: NO_STORE },
    );
  }

  // REFUSED, NOT TRUNCATED. Silently keeping the first `MAX_BATCH_SIZE` entries
  // would drop real unlocks with no signal anywhere — the player would simply
  // never receive an achievement they earned. A 400 makes the game author split
  // the batch.
  if (parsed.entries.length === 0 || parsed.entries.length > MAX_BATCH_SIZE) {
    return Response.json(
      { ok: false, reason: "bad-request", results: [] } satisfies PostBody,
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    // `isResolvedSlug`, NOT the static `games` array: an external game is a real
    // game a real player really played, and validating against the static list
    // is the bug that makes `favorites.ts` silently drop them.
    if (!(await isResolvedSlug(slug))) {
      return Response.json(
        { ok: false, reason: "no-game", results: [] } satisfies PostBody,
        { status: 404, headers: NO_STORE },
      );
    }

    const outcome = await recordAchievements({
      slug,
      playerId,
      entries: parsed.entries,
    });

    if (outcome.ok) {
      // File a bell notification for anything NEWLY unlocked.
      //
      // `unlocked` is exactly-once by the store's own guarantee — true only when
      // the achievement was unearned before the statement and earned after it —
      // so this cannot fire twice for the same unlock even without a key. The
      // key is here anyway because it costs nothing and makes a replayed request
      // idempotent at the database rather than by trusting that guarantee from
      // two modules away.
      //
      // AWAITED, like every other producer: on serverless a floating promise can
      // be cancelled when the response ends. `notifyUnlocks` never rejects, and
      // it returns immediately when nothing was unlocked — which is the common
      // case on this route, since it is called on every score event a game
      // reports, not only on the rare one that earns something.
      await notifyUnlocks(slug, playerId, outcome.results);

      // `ok:true` with `reason:"unknown-achievement"` is a real, deliberate
      // combination: a game that ships a key before an admin provisions it is
      // not broken, and the reason is a developer diagnostic rather than a
      // player-facing failure. Passed straight through.
      //
      // `reason` is assigned unconditionally and simply omitted from the wire
      // when it is `undefined` — `Response.json` runs `JSON.stringify`, which
      // drops undefined properties. A conditional spread would produce the same
      // bytes with more places to get it wrong.
      return Response.json(
        { ok: true, reason: outcome.reason, results: outcome.results } satisfies PostBody,
        { headers: NO_STORE },
      );
    }

    if (outcome.reason === "rate-limited") {
      return Response.json(
        { ok: false, reason: "rate-limited", results: [] } satisfies PostBody,
        { status: 429, headers: { ...NO_STORE, ...RETRY_AFTER } },
      );
    }

    // Everything left (`bad-request`, and `signed-out`/`no-game` which cannot
    // reach here because both are checked above) is the caller's fault.
    return Response.json(
      { ok: false, reason: outcome.reason ?? "bad-request", results: [] } satisfies PostBody,
      { status: 400, headers: NO_STORE },
    );
  } catch (error) {
    // 503, NEVER 500. `recordAchievements` already folds a missing table into
    // `unknown-achievement` and rethrows everything else, so anything arriving
    // here is the database being unreachable — a transient server condition the
    // game should retry, not a bug in its request. A 500 would tell the SDK to
    // give up and the author to go hunting for a request it got right.
    //
    // The body carries `reason:"http"` — the enum member the SDK would derive
    // from the status code anyway — so a caller that reads only the body reaches
    // the same conclusion as one that reads only the status. The two can never
    // disagree.
    if (!isMissingColumnError(error)) {
      console.error("achievements POST failed:", error);
    }
    return Response.json(
      { ok: false, reason: "http", results: [] } satisfies PostBody,
      { status: 503, headers: { ...NO_STORE, ...RETRY_AFTER } },
    );
  }
}

/**
 * Methods only — NO `Access-Control-Allow-Origin`, mirroring `/api/v1/me/handle`.
 *
 * This advertises that POST exists without opening the write cross-origin: a
 * wildcard origin cannot legally carry credentials, and this write is keyed by
 * the session cookie. The cross-origin GET still works, because a simple GET is
 * never preflighted and reads the wildcard off the GET response itself.
 */
export async function OPTIONS(): Promise<Response> {
  return credentialedOptions("GET, POST, OPTIONS");
}
