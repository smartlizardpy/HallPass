/**
 * Tests for the challenge store factory.
 *
 * Same fake-`sql` seam as `social/store.test.ts` and `tracker/store.test.ts`: a
 * function matching the tagged-template signature records every call and returns
 * canned rows, so the SHAPE of the emitted SQL is assertable without a database.
 *
 * That seam is the only way to test what matters here. The load-bearing property
 * of `create` is that six gates and the write happen in ONE statement — a live
 * test could not tell that from six checks that all happened to pass before a
 * separate insert, and the difference is a block that can be raced. The `neon()`
 * HTTP driver cannot make two calls transactional, so "one call" IS the
 * invariant, and `calls.length` is how you check it.
 */

import { describe, expect, it } from "vitest";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { createChallengeStore } from "./store";
import {
  CHALLENGE_DISMISSED_COOLDOWN_SECONDS,
  CHALLENGE_RESEND_COOLDOWN_SECONDS,
  CHALLENGE_SENDER_RATE_LIMIT,
  LINK_CLAIM_RATE_LIMIT,
  MAX_OPEN_SENT_CHALLENGES,
} from "./config";

interface RecordedCall {
  text: string;
  values: unknown[];
}

function makeFakeSql(rows: Record<string, unknown>[] = [{ id: 1 }]) {
  const calls: RecordedCall[] = [];
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("?"), values });
    return Promise.resolve(rows);
  };
  return { sql: fn as unknown as NeonQueryFunction<false, false>, calls };
}

/**
 * The two values bound immediately after `marker` in a recorded call.
 *
 * `text` is the template's static parts joined by "?", so the count of "?"
 * before a marker is exactly the number of bound values before it. Locating the
 * pair this way rather than by a fixed index keeps the assertion honest when a
 * CTE is added ahead of it — which has already happened twice.
 */
function pairBoundAt(call: RecordedCall, marker: string): unknown[] {
  const before = call.text.slice(0, call.text.indexOf(marker));
  const index = before.split("?").length - 1;
  return call.values.slice(index, index + 2);
}

/** A create() result row with every gate passing, overridable per test. */
function outcomeRow(over: Record<string, unknown> = {}) {
  return {
    id: 12,
    target_score: "4200",
    board_exists: true,
    is_friend: true,
    is_blocked: false,
    has_score: true,
    is_cooling: false,
    recent_n: "1",
    open_n: "2",
    ...over,
  };
}

describe("create", () => {
  it("runs every gate and the write in ONE statement", async () => {
    // Six gates in six round trips would each be a window where the answer
    // changes before the insert — a block especially.
    const { sql, calls } = makeFakeSql([outcomeRow()]);
    const store = createChallengeStore(sql);

    await store.create({ challengerId: "a", targetId: "b", boardId: "duskfall" });

    expect(calls).toHaveLength(1);
    const { text } = calls[0];
    expect(text).toContain("friendships");
    expect(text).toContain("player_blocks");
    expect(text).toContain("INSERT INTO challenges");
    expect(text).toContain("ON CONFLICT");
  });

  it("derives the score to beat from the challenger's own best", async () => {
    // Never supplied by the caller: that is what makes "you have no score here"
    // fall out of the same query, and makes it impossible to dare somebody to
    // beat a number you never scored.
    const { sql, calls } = makeFakeSql([outcomeRow()]);
    const store = createChallengeStore(sql);

    await store.create({ challengerId: "a", targetId: "b", boardId: "duskfall" });

    const { text } = calls[0];
    expect(text).toContain("min(s.score)");
    expect(text).toContain("max(s.score)");
    expect(text).toContain("FROM scores");
  });

  it("picks min on an asc board and max on a desc board", async () => {
    // asc boards are time/golf, where the BEST score is the lowest one. Getting
    // this backwards would dare a friend to beat your worst run.
    const { sql, calls } = makeFakeSql([outcomeRow()]);
    const store = createChallengeStore(sql);

    await store.create({ challengerId: "a", targetId: "b", boardId: "duskfall" });

    expect(calls[0].text).toContain("CASE WHEN board.sort = 'asc' THEN min(s.score) ELSE max(s.score) END");
  });

  it("re-sending REPLACES and clears every lifecycle stamp", async () => {
    // A rematch must start genuinely fresh rather than inheriting a stale
    // accepted_at from the challenge it replaces.
    const { sql, calls } = makeFakeSql([outcomeRow()]);
    const store = createChallengeStore(sql);

    await store.create({ challengerId: "a", targetId: "b", boardId: "duskfall" });

    const { text } = calls[0];
    expect(text).toContain("DO UPDATE SET");
    expect(text).toContain("accepted_at    = NULL");
    expect(text).toContain("resolved_at    = NULL");
    expect(text).toContain("dismissed_at   = NULL");
  });

  it("infers the partial unique index with a matching predicate", async () => {
    // `ON CONFLICT (...) WHERE kind = 'friend'` only works if it matches
    // challenges_friend_pair_idx exactly. A mismatch is a runtime error on a
    // path nobody re-tests.
    const { sql, calls } = makeFakeSql([outcomeRow()]);
    const store = createChallengeStore(sql);

    await store.create({ challengerId: "a", targetId: "b", boardId: "duskfall" });

    expect(calls[0].text).toContain(
      "ON CONFLICT (challenger_id, target_id, board_id) WHERE kind = 'friend'",
    );
  });

  it("binds the three cooldowns as values, never as spliced SQL", async () => {
    const { sql, calls } = makeFakeSql([outcomeRow()]);
    const store = createChallengeStore(sql);

    await store.create({ challengerId: "a", targetId: "b", boardId: "duskfall" });

    const { values } = calls[0];
    expect(values).toContain(CHALLENGE_DISMISSED_COOLDOWN_SECONDS);
    expect(values).toContain(CHALLENGE_RESEND_COOLDOWN_SECONDS);
    expect(values).toContain(CHALLENGE_SENDER_RATE_LIMIT.maxPerWindow);
    expect(values).toContain(MAX_OPEN_SENT_CHALLENGES);
  });

  it("never wraps a bare-parameter CASE in make_interval", async () => {
    // Postgres resolves a CASE whose every branch is an untyped parameter to
    // `text`, and there is no implicit text -> double precision cast, so
    // `make_interval(secs => CASE …)` fails to resolve at all:
    //   ERROR 42883: function make_interval(secs => text) does not exist
    // The Neon HTTP driver sends no type OIDs, so that fires on EVERY call. It
    // shipped once; this is the guard. 42883 is not matched by
    // isMissingColumnError either, so it degraded to a 503 saying only that
    // challenges were unavailable.
    const { sql, calls } = makeFakeSql([outcomeRow()]);
    await createChallengeStore(sql).create({
      challengerId: "a", targetId: "b", boardId: "duskfall",
    });

    const { text } = calls[0];
    expect(text).toContain("make_interval");
    expect(text).not.toMatch(/make_interval\(\s*secs\s*=>\s*CASE/i);
    // Every make_interval in this statement takes exactly one bind param.
    for (const call of text.match(/make_interval\([^)]*\)/g) ?? []) {
      expect(call).toBe("make_interval(secs => ?)");
    }
  });

  it("times the dismissal cooldown from dismissed_at, not created_at", async () => {
    // created_at is reset by ON CONFLICT DO UPDATE, and more importantly it
    // marks the wrong event: sit on a challenge for a day, dismiss it, and a
    // cooldown measured from when it was SENT has already elapsed — so the
    // sender could re-challenge instantly, which is the one thing the dismissal
    // was asking not to happen.
    const { sql, calls } = makeFakeSql([outcomeRow()]);
    await createChallengeStore(sql).create({
      challengerId: "a", targetId: "b", boardId: "duskfall",
    });

    expect(calls[0].text).toContain("dismissed_at >= now() - make_interval");
    expect(calls[0].text).toContain("resolved_at >= now() - make_interval");
  });

  it("orders the friendship pair so either argument order finds the row", async () => {
    // friendships is ONE row per pair with ordered keys; querying with the raw
    // arguments would miss the row half the time.
    const forward = makeFakeSql([outcomeRow()]);
    const backward = makeFakeSql([outcomeRow()]);
    await createChallengeStore(forward.sql).create({
      challengerId: "aaa", targetId: "bbb", boardId: "x",
    });
    await createChallengeStore(backward.sql).create({
      challengerId: "bbb", targetId: "aaa", boardId: "x",
    });

    // Both directions must bind lo then hi at `player_a`/`player_b`, or half
    // the sends miss the row entirely.
    expect(pairBoundAt(forward.calls[0], "player_a = ")).toEqual(["aaa", "bbb"]);
    expect(pairBoundAt(backward.calls[0], "player_a = ")).toEqual(["aaa", "bbb"]);
  });

  it("reports the id and the score when every gate passes", async () => {
    const { sql } = makeFakeSql([outcomeRow()]);
    const store = createChallengeStore(sql);

    const out = await store.create({ challengerId: "a", targetId: "b", boardId: "d" });

    expect(out.id).toBe(12);
    expect(out.targetScore).toBe(4200);
    expect(out.isFriend).toBe(true);
    expect(out.isBlocked).toBe(false);
  });

  it("reports WHICH gate refused, not just that nothing happened", async () => {
    // Three different things to tell somebody; collapsing them into null would
    // produce a popup that says only that it did not work.
    const notFriends = makeFakeSql([
      outcomeRow({ id: null, target_score: null, is_friend: false }),
    ]);
    const out = await createChallengeStore(notFriends.sql).create({
      challengerId: "a", targetId: "b", boardId: "d",
    });
    expect(out.id).toBeNull();
    expect(out.isFriend).toBe(false);

    const noScore = makeFakeSql([
      outcomeRow({ id: null, target_score: null, has_score: false }),
    ]);
    expect(
      (await createChallengeStore(noScore.sql).create({
        challengerId: "a", targetId: "b", boardId: "d",
      })).hasScore,
    ).toBe(false);

    const cooling = makeFakeSql([
      outcomeRow({ id: null, target_score: null, is_cooling: true }),
    ]);
    expect(
      (await createChallengeStore(cooling.sql).create({
        challengerId: "a", targetId: "b", boardId: "d",
      })).isCooling,
    ).toBe(true);
  });

  it("reads the counts as over-limit only at the limit", async () => {
    const under = makeFakeSql([
      outcomeRow({ recent_n: String(CHALLENGE_SENDER_RATE_LIMIT.maxPerWindow - 1) }),
    ]);
    expect(
      (await createChallengeStore(under.sql).create({
        challengerId: "a", targetId: "b", boardId: "d",
      })).overRateLimit,
    ).toBe(false);

    const at = makeFakeSql([
      outcomeRow({ recent_n: String(CHALLENGE_SENDER_RATE_LIMIT.maxPerWindow) }),
    ]);
    expect(
      (await createChallengeStore(at.sql).create({
        challengerId: "a", targetId: "b", boardId: "d",
      })).overRateLimit,
    ).toBe(true);
  });

  it("survives an empty result set without throwing", async () => {
    const { sql } = makeFakeSql([]);
    const out = await createChallengeStore(sql).create({
      challengerId: "a", targetId: "b", boardId: "d",
    });
    expect(out.id).toBeNull();
    expect(out.boardExists).toBe(false);
  });
});

describe("resolveForScore", () => {
  it("closes every won challenge in ONE statement", async () => {
    const { sql, calls } = makeFakeSql([
      {
        id: "3", challenger_id: "a", target_score: "4200", board_id: "duskfall",
        game_slug: "duskfall", board_title: "High score",
      },
    ]);
    const store = createChallengeStore(sql);

    const won = await store.resolveForScore({
      playerId: "b", boardId: "duskfall", score: 5100,
    });

    expect(calls).toHaveLength(1);
    expect(won).toEqual([
      {
        id: 3, challengerId: "a", targetScore: 4200, boardId: "duskfall",
        gameSlug: "duskfall", boardTitle: "High score",
      },
    ]);
  });

  it("carries the board's game and title out of the UPDATE", async () => {
    // So telling the challenger "somebody beat your 4,200 on Duskfall" needs no
    // second round trip on the score path. The statement already joins `boards`
    // to read `sort`, so both come free.
    const { sql, calls } = makeFakeSql([]);
    await createChallengeStore(sql).resolveForScore({
      playerId: "b", boardId: "d", score: 1,
    });
    expect(calls[0].text).toContain("b.game_slug");
    expect(calls[0].text).toContain("b.title AS board_title");
  });

  it("mirrors beats() strictly — a tie does not win", async () => {
    // The one copy of the rule that lives in SQL. `>=` here would silently
    // rewrite who won, and resolve.test.ts could not catch it.
    const { sql, calls } = makeFakeSql([]);
    await createChallengeStore(sql).resolveForScore({
      playerId: "b", boardId: "d", score: 1,
    });

    const { text } = calls[0];
    expect(text).toContain("b.sort = 'asc'");
    expect(text).toContain("< c.target_score");
    expect(text).toContain("> c.target_score");
    expect(text).not.toContain(">= c.target_score");
    expect(text).not.toContain("<= c.target_score");
  });

  it("mirrors isWithinWindow — lower inclusive, upper exclusive", async () => {
    const { sql, calls } = makeFakeSql([]);
    await createChallengeStore(sql).resolveForScore({
      playerId: "b", boardId: "d", score: 1,
    });

    const { text } = calls[0];
    expect(text).toContain("c.starts_at <= now()");
    expect(text).toContain("c.ends_at   >  now()");
  });

  it("never consults accepted_at", async () => {
    // Beating the score after launching from the catalogue counts. Gating on
    // acceptance would make that not count, which is absurd.
    const { sql, calls } = makeFakeSql([]);
    await createChallengeStore(sql).resolveForScore({
      playerId: "b", boardId: "d", score: 1,
    });
    expect(calls[0].text).not.toContain("accepted_at");
  });

  it("does not filter on kind — the seam working", async () => {
    // A live seasonal challenge resolves through this same statement with no
    // new branch. That property is the entire reason for the kind column's
    // nullable dimensions.
    const { sql, calls } = makeFakeSql([]);
    await createChallengeStore(sql).resolveForScore({
      playerId: "b", boardId: "d", score: 1,
    });
    expect(calls[0].text).not.toContain("kind =");
  });

  it("skips rows already resolved or dismissed", async () => {
    const { sql, calls } = makeFakeSql([]);
    await createChallengeStore(sql).resolveForScore({
      playerId: "b", boardId: "d", score: 1,
    });
    expect(calls[0].text).toContain("c.resolved_at  IS NULL");
    expect(calls[0].text).toContain("c.dismissed_at IS NULL");
  });
});

describe("accept", () => {
  it("is idempotent — a second Play keeps the FIRST timestamp", async () => {
    const { sql, calls } = makeFakeSql([]);
    const changed = await createChallengeStore(sql).accept("b", 3);

    expect(changed).toBe(false);
    expect(calls[0].text).toContain("accepted_at IS NULL");
  });

  it("guards ownership inside the statement, not before it", async () => {
    // A read-then-write would leave a window between the two.
    const { sql, calls } = makeFakeSql([{ id: "3" }]);
    expect(await createChallengeStore(sql).accept("b", 3)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain("target_id = ?");
  });
});

describe("dismiss", () => {
  it("stamps rather than deletes — the row IS the cooldown record", async () => {
    // Deleting would hand the sender an instant retry, which is exactly what
    // the dismissal was asking not to happen.
    const { sql, calls } = makeFakeSql([{ id: "3" }]);
    expect(await createChallengeStore(sql).dismiss("b", 3)).toBe(true);

    const { text } = calls[0];
    expect(text).toContain("SET dismissed_at = now()");
    expect(text).not.toContain("DELETE");
  });

  it("refuses to bin a challenge that was already won", async () => {
    const { sql, calls } = makeFakeSql([]);
    await createChallengeStore(sql).dismiss("b", 3);
    expect(calls[0].text).toContain("resolved_at IS NULL");
  });
});

describe("blocks", () => {
  // Blocking deletes the friendship, but NOT the challenges. Without a filter a
  // blocked person's open challenge sits in the inbox with their name and
  // avatar on it — the precise thing a block is for preventing.
  it.each([
    ["listIncoming", (s: ReturnType<typeof createChallengeStore>) => s.listIncoming("me")],
    ["listForGame", (s: ReturnType<typeof createChallengeStore>) => s.listForGame("me", "duskfall")],
    ["listOutgoing", (s: ReturnType<typeof createChallengeStore>) => s.listOutgoing("me")],
  ])("%s filters out a block in either direction", async (_name, run) => {
    const { sql, calls } = makeFakeSql([]);
    await run(createChallengeStore(sql));

    const { text } = calls[0];
    expect(text).toContain("player_blocks");
    expect(text).toContain("pb.blocker_id = ?");
    expect(text).toContain("pb.blocked_id = ?");
  });

  it("accept refuses a challenge from someone now blocked", async () => {
    const { sql, calls } = makeFakeSql([]);
    await createChallengeStore(sql).accept("me", 3);
    expect(calls[0].text).toContain("player_blocks");
  });
});

describe("listOutgoing", () => {
  it("hides dismissed challenges from the sender", async () => {
    // Telling a child that a named friend binned their challenge is the same
    // unkindness social/config.ts avoids by deleting declined friend requests.
    const { sql, calls } = makeFakeSql([]);
    await createChallengeStore(sql).listOutgoing("a");
    expect(calls[0].text).toContain("c.dismissed_at IS NULL");
  });

  it("keeps resolved challenges — losing is the payoff", async () => {
    const { sql, calls } = makeFakeSql([]);
    await createChallengeStore(sql).listOutgoing("a");
    expect(calls[0].text).not.toContain("c.resolved_at IS NULL");
  });
});

describe("listIncoming", () => {
  it("shows only open challenges and sends public_id, never players.id", async () => {
    const { sql, calls } = makeFakeSql([
      {
        id: "5", target_score: "900", created_at: "2026-01-01T00:00:00Z",
        accepted_at: null, board_id: "duskfall", game_slug: "duskfall",
        board_title: "High score", score_label: "Points", sort: "desc",
        from_public_id: "uuid-1", from_username: "ozan",
        from_handle: null, from_image: null,
      },
    ]);
    const out = await createChallengeStore(sql).listIncoming("b");

    expect(calls[0].text).toContain("c.resolved_at IS NULL AND c.dismissed_at IS NULL");
    expect(calls[0].text).toContain("p.public_id AS from_public_id");
    expect(out[0].from.id).toBe("uuid-1");
    expect(out[0].from.displayName).toBe("@ozan");
    expect(out[0].targetScore).toBe(900);
  });

  it("prefers a handle over the username for the display name", async () => {
    const { sql } = makeFakeSql([
      {
        id: "5", target_score: "1", created_at: "2026-01-01T00:00:00Z",
        accepted_at: null, board_id: "b", game_slug: null,
        board_title: "T", score_label: "S", sort: "asc",
        from_public_id: "u", from_username: "ozan",
        from_handle: "  OZ  ", from_image: null,
      },
    ]);
    const out = await createChallengeStore(sql).listIncoming("b");
    expect(out[0].from.displayName).toBe("OZ");
    expect(out[0].sort).toBe("asc");
    expect(out[0].gameSlug).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

describe("mintLink", () => {
  it("derives the score in SQL and writes in ONE statement", async () => {
    const { sql, calls } = makeFakeSql([
      { code: "CDFGHJKMNP", target_score: "4200", game_slug: "snake",
        board_title: "Snake", board_exists: true, has_score: true },
    ]);
    const out = await createChallengeStore(sql).mintLink({
      ownerId: "alice", boardId: "snake", code: "CDFGHJKMNP",
    });

    expect(calls).toHaveLength(1);
    // Never taken from the caller — the same rule `create` follows, so nobody
    // can publish a link to a number they did not score.
    expect(calls[0].text).toContain("min(s.score)");
    expect(calls[0].text).toContain("max(s.score)");
    expect(calls[0].values).toContain("CDFGHJKMNP");
    expect(out.code).toBe("CDFGHJKMNP");
    expect(out.targetScore).toBe(4200);
  });

  it("upserts on the (owner, board) partial index, so sharing twice is one link", async () => {
    const { sql, calls } = makeFakeSql([{}]);
    await createChallengeStore(sql).mintLink({
      ownerId: "alice", boardId: "snake", code: "CDFGHJKMNP",
    });
    // Must match `challenges_link_owner_idx` exactly or Postgres cannot infer it.
    expect(calls[0].text).toContain(
      "ON CONFLICT (challenger_id, board_id) WHERE kind = 'link'",
    );
  });

  it("keeps a live link's code and replaces a revoked one's", async () => {
    const { sql, calls } = makeFakeSql([{}]);
    await createChallengeStore(sql).mintLink({
      ownerId: "alice", boardId: "snake", code: "NEWCODE123",
    });
    // A posted URL must not rotate underneath the people holding it; a revoked
    // one must never come back to life.
    expect(calls[0].text).toContain("WHEN challenges.revoked_at IS NULL");
    expect(calls[0].text).toContain("THEN challenges.code");
    expect(calls[0].text).toContain("ELSE EXCLUDED.code");
    expect(calls[0].text).toContain("revoked_at = NULL");
  });

  it("reports the gates rather than throwing when there is no score", async () => {
    const { sql } = makeFakeSql([
      { code: null, target_score: null, game_slug: null, board_title: "Snake",
        board_exists: true, has_score: false },
    ]);
    const out = await createChallengeStore(sql).mintLink({
      ownerId: "alice", boardId: "snake", code: "CDFGHJKMNP",
    });
    expect(out.code).toBeNull();
    expect(out.boardExists).toBe(true);
    expect(out.hasScore).toBe(false);
  });
});

describe("getLinkByCode", () => {
  it("never selects an avatar or a public id", async () => {
    const { sql, calls } = makeFakeSql([
      { id: "7", code: "CDFGHJKMNP", target_score: "4200", revoked_at: null,
        board_id: "snake", game_slug: "snake", board_title: "Snake",
        score_label: "Points", sort: "desc",
        owner_username: "ozan", owner_handle: "Oz" },
    ]);
    const out = await createChallengeStore(sql).getLinkByCode("CDFGHJKMNP");

    // THE SAFETY ASSERTION. A link is built to be pasted into a public chat and
    // rendered as a preview card on other people's devices, and a Google-only
    // product's avatar is frequently a real photograph of a child.
    expect(calls[0].text).not.toContain("image");
    expect(calls[0].text).not.toContain("public_id");
    expect(out?.owner).toEqual({ username: "ozan", displayName: "Oz" });
    expect(out).not.toHaveProperty("owner.image");
  });

  it("returns a revoked link rather than hiding it", async () => {
    const { sql } = makeFakeSql([
      { id: "7", code: "C", target_score: "1", revoked_at: "2026-01-01T00:00:00Z",
        board_id: "b", game_slug: null, board_title: "T", score_label: "S",
        sort: "desc", owner_username: null, owner_handle: "Oz" },
    ]);
    const out = await createChallengeStore(sql).getLinkByCode("C");
    // The landing has to explain itself to somebody who followed a dead URL.
    expect(out?.revokedAt).not.toBeNull();
  });

  it("is null when there is no such code", async () => {
    const { sql } = makeFakeSql([]);
    expect(await createChallengeStore(sql).getLinkByCode("NOPE")).toBeNull();
  });
});

describe("claimLink", () => {
  it("gates on blocks, self and the claimer's own rate limit, in ONE statement", async () => {
    const { sql, calls } = makeFakeSql([
      { id: "9", target_score: "4200", link_found: true, is_revoked: false,
        is_self: false, is_blocked: false, recent_n: "2" },
    ]);
    const out = await createChallengeStore(sql).claimLink({
      code: "CDFGHJKMNP", playerId: "bob",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain("player_blocks");
    expect(calls[0].text).toContain("link.challenger_id <> ");
    expect(calls[0].text).toContain("kind = 'link_claim'");
    expect(out.id).toBe(9);
    expect(out.overRateLimit).toBe(false);
  });

  it("does NOT require a friendship — that is the whole feature", async () => {
    const { sql, calls } = makeFakeSql([{}]);
    await createChallengeStore(sql).claimLink({ code: "C", playerId: "bob" });
    // `create` joins `friendships`; this deliberately must not.
    expect(calls[0].text).not.toContain("friendships");
  });

  it("keeps the original snapshot when the same link is taken up twice", async () => {
    const { sql, calls } = makeFakeSql([{}]);
    await createChallengeStore(sql).claimLink({ code: "C", playerId: "bob" });
    // A no-op update, so the row still RETURNs but the owner's improved score
    // cannot move the target under somebody who is already playing for it.
    expect(calls[0].text).toContain(
      "ON CONFLICT (parent_id, target_id) WHERE kind = 'link_claim'",
    );
    expect(calls[0].text).toContain("DO UPDATE SET target_score = challenges.target_score");
  });

  it("counts the press on the link it came from", async () => {
    const { sql, calls } = makeFakeSql([{}]);
    await createChallengeStore(sql).claimLink({ code: "C", playerId: "bob" });
    expect(calls[0].text).toContain("SET opens = opens + 1");
  });

  it("reports the rate limit once the window is full", async () => {
    const { sql } = makeFakeSql([
      { id: null, target_score: null, link_found: true, is_revoked: false,
        is_self: false, is_blocked: false,
        recent_n: String(LINK_CLAIM_RATE_LIMIT.maxPerWindow) },
    ]);
    const out = await createChallengeStore(sql).claimLink({ code: "C", playerId: "bob" });
    expect(out.overRateLimit).toBe(true);
    expect(out.id).toBeNull();
  });

  it("separates a missing link from a revoked one", async () => {
    const { sql } = makeFakeSql([
      { id: null, link_found: false, is_revoked: false, is_self: false,
        is_blocked: false, recent_n: "0" },
    ]);
    const out = await createChallengeStore(sql).claimLink({ code: "C", playerId: "bob" });
    expect(out.linkFound).toBe(false);
    expect(out.isRevoked).toBe(false);
  });
});

describe("noteLinkOpen", () => {
  it("cannot drive up a revoked link's counter", async () => {
    const { sql, calls } = makeFakeSql([]);
    await createChallengeStore(sql).noteLinkOpen("CDFGHJKMNP");
    expect(calls[0].text).toContain("revoked_at IS NULL");
    expect(calls[0].values).toContain("CDFGHJKMNP");
  });
});

describe("revokeLink", () => {
  it("is scoped to the owner — holding the code is not authority to kill it", async () => {
    const { sql, calls } = makeFakeSql([{ id: "3" }]);
    const ok = await createChallengeStore(sql).revokeLink({
      ownerId: "alice", code: "CDFGHJKMNP",
    });
    expect(calls[0].text).toContain("challenger_id = ");
    // Idempotent, and it never deletes: the code must stay claimed so a killed
    // URL can never be reissued to somebody else.
    expect(calls[0].text).toContain("revoked_at IS NULL");
    expect(calls[0].text).not.toContain("DELETE");
    expect(ok).toBe(true);
  });

  it("reports false when there was nothing to revoke", async () => {
    const { sql } = makeFakeSql([]);
    expect(
      await createChallengeStore(sql).revokeLink({ ownerId: "a", code: "C" }),
    ).toBe(false);
  });
});

describe("listLinks", () => {
  it("returns the payoff counts alongside each link", async () => {
    const { sql, calls } = makeFakeSql([
      { id: "1", code: "CDFGHJKMNP", target_score: "4200", opens: "14",
        claims: "6", beaten: "2", revoked_at: null,
        created_at: "2026-01-01T00:00:00Z", board_id: "snake",
        game_slug: "snake", board_title: "Snake", score_label: "Points",
        sort: "desc" },
    ]);
    const out = await createChallengeStore(sql).listLinks("alice");
    expect(calls[0].text).toContain("kind = 'link'");
    expect(out[0].opens).toBe(14);
    expect(out[0].claims).toBe(6);
    expect(out[0].beaten).toBe(2);
  });
});

describe("kind scoping on the pre-existing reads", () => {
  it("keeps invitations and link claims out of the outbox", async () => {
    const { sql, calls } = makeFakeSql([]);
    await createChallengeStore(sql).listOutgoing("alice");
    // A `link` row has no target and would be dropped by the inner join anyway;
    // a `link_claim` WOULD show, and one link round a class is a row per person.
    expect(calls[0].text).toContain("c.kind = 'friend'");
  });

  it("does not let a popular link fill its owner's send quota", async () => {
    const { sql, calls } = makeFakeSql([outcomeRow()]);
    await createChallengeStore(sql).create({
      challengerId: "alice", targetId: "bob", boardId: "snake",
    });
    // Both counters must be friend-only. A link_claim's challenger is the link
    // OWNER, but the row is written by whoever took it up — counting those
    // would lock a popular owner out of challenging their actual friends.
    const recent = calls[0].text.slice(calls[0].text.indexOf("recent AS"));
    expect(recent).toContain("kind = 'friend'");
    const openSent = calls[0].text.slice(calls[0].text.indexOf("open_sent AS"));
    expect(openSent).toContain("kind = 'friend'");
  });
});
