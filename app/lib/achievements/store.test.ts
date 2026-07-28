/**
 * Tests for the achievement store factory.
 *
 * Same fake-`sql` seam as `reviews/store.test.ts` and `social/store.test.ts`: a
 * function matching the tagged-template signature records every call and returns
 * canned rows, so both the JS-side decoding and the SHAPE of the emitted SQL can
 * be asserted without a database.
 *
 * That seam is the whole reason this store is a factory, and it is doing more
 * work here than in the other two. Several of this file's invariants — "GREATEST
 * never regresses progress", "unlocked_at is never re-stamped" — live entirely
 * in the SQL text, so they are tested STRUCTURALLY: the clause that enforces
 * each one must be present, verbatim, in the single statement that is sent. A
 * refactor that "tidies" one of them away fails here rather than six months
 * later as a profile page whose "recently earned" order quietly reshuffles
 * itself on every beacon.
 */

// No `vi.mock("server-only")` here, deliberately: `store.ts` must not import it
// at all. The live connection is `index.ts`'s job, and keeping the factory free
// of it is what makes this whole file possible.
import { describe, expect, it } from "vitest";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { createAchievementStore } from "./store";
import { ACHIEVEMENT_PLAYER_RATE_LIMIT, MAX_BATCH_SIZE } from "./config";

interface RecordedCall {
  text: string;
  values: unknown[];
}

function makeFakeSql(
  responder: (call: RecordedCall) => Record<string, unknown>[],
) {
  const calls: RecordedCall[] = [];
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const call: RecordedCall = { text: strings.join("?"), values };
    calls.push(call);
    return Promise.resolve(responder(call));
  };
  return { sql: fn as unknown as NeonQueryFunction<false, false>, calls };
}

/** A `record()` result row with everything permissive; override under test. */
function unlockRow(over: Record<string, unknown> = {}) {
  return {
    recent: 0,
    key: "first-blood",
    target: 1,
    already_unlocked: false,
    unlocked: true,
    progress: 1,
    ...over,
  };
}

/** A catalogue row joined to a player; override under test. */
function shelfRow(over: Record<string, unknown> = {}) {
  return {
    key: "first-blood",
    name: "First Blood",
    description: "Land your first hit.",
    icon: "🩸",
    points: 10,
    target: 1,
    secret: false,
    progress: 0,
    unlocked_at: null,
    ...over,
  };
}

describe("catalogue", () => {
  it("reads one game's rows in display order and maps them unredacted", async () => {
    const { sql, calls } = makeFakeSql(() => [
      {
        id: 7,
        slug: "duskfall",
        key: "hidden_ending",
        name: "The Quiet Door",
        description: "",
        icon: "🚪",
        points: 50,
        target: 1,
        secret: true,
        position: 3,
      },
    ]);
    const store = createAchievementStore(sql);
    const defs = await store.catalogue("duskfall");

    // The admin surface is the ONE place a secret's real name is allowed out.
    expect(defs[0].name).toBe("The Quiet Door");
    expect(defs[0].secret).toBe(true);
    expect(calls[0].text).toContain("ORDER BY position ASC, id ASC");
    // Read-side backstop: the cap is enforced at provisioning, but a bad import
    // must not turn the store page into an unbounded render.
    expect(calls[0].text).toContain("LIMIT ?");
  });
});

describe("forPlayer", () => {
  it("is ONE query — the catalogue and the player's rows never split", async () => {
    const { sql, calls } = makeFakeSql(() => [shelfRow()]);
    const store = createAchievementStore(sql);
    await store.forPlayer("duskfall", "player-1");
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain("LEFT JOIN player_achievements");
  });

  it("binds a NULL player rather than branching into a second template", async () => {
    // `pa.player_id = NULL` is never true, so the LEFT JOIN keeps every
    // catalogue row with all-NULL player columns — the signed-out view falls out
    // of the same SQL instead of a parallel one that could drift.
    const { sql, calls } = makeFakeSql(() => [shelfRow()]);
    const store = createAchievementStore(sql);
    const { achievements } = await store.forPlayer("duskfall", null);

    expect(calls[0].values).toContain(null);
    expect(achievements[0].unlocked).toBe(false);
    expect(achievements[0].progress).toBe(0);
  });

  it("splits earned from total points", async () => {
    const { sql } = makeFakeSql(() => [
      shelfRow({ key: "a", points: 10, unlocked_at: "2026-01-01T00:00:00Z" }),
      shelfRow({ key: "b", points: 25, unlocked_at: null }),
      shelfRow({ key: "c", points: 5, unlocked_at: "2026-02-01T00:00:00Z" }),
    ]);
    const store = createAchievementStore(sql);
    const result = await store.forPlayer("duskfall", "player-1");

    expect(result.earnedPoints).toBe(15);
    expect(result.totalPoints).toBe(40);
  });

  it("REDACTS an unearned secret's name and description", async () => {
    const { sql } = makeFakeSql(() => [
      shelfRow({
        key: "hidden_ending",
        name: "The Quiet Door",
        description: "Leave without firing a shot.",
        secret: true,
        unlocked_at: null,
      }),
    ]);
    const store = createAchievementStore(sql);
    const { achievements } = await store.forPlayer("duskfall", "player-1");

    // A secret achievement whose name ships to the client is not secret — the
    // browser gets the whole payload, so "the UI does not render it" is not a
    // control, it is a hope.
    expect(achievements[0].name).toBe("Secret achievement");
    expect(achievements[0].description).toBe("");
    expect(JSON.stringify(achievements)).not.toContain("The Quiet Door");
    expect(JSON.stringify(achievements)).not.toContain("firing a shot");
    // The placeholder must still be marked secret so the UI can style it.
    expect(achievements[0].secret).toBe(true);
  });

  it("counts a redacted secret's points in the total", async () => {
    const { sql } = makeFakeSql(() => [
      shelfRow({ key: "a", points: 10, unlocked_at: "2026-01-01T00:00:00Z" }),
      shelfRow({ key: "s", points: 40, secret: true, unlocked_at: null }),
    ]);
    const store = createAchievementStore(sql);
    const result = await store.forPlayer("duskfall", "player-1");

    // Hiding the points would be theatre: the total is on screen, so any single
    // value is recoverable by subtraction. The name is the secret, not the count.
    expect(result.totalPoints).toBe(50);
    expect(result.earnedPoints).toBe(10);
  });

  it("reveals a secret once it is earned", async () => {
    const { sql } = makeFakeSql(() => [
      shelfRow({
        key: "hidden_ending",
        name: "The Quiet Door",
        description: "Leave without firing a shot.",
        secret: true,
        unlocked_at: "2026-03-01T12:00:00Z",
      }),
    ]);
    const store = createAchievementStore(sql);
    const { achievements } = await store.forPlayer("duskfall", "player-1");

    expect(achievements[0].name).toBe("The Quiet Door");
    expect(achievements[0].unlocked).toBe(true);
    expect(achievements[0].unlockedAt).toBe("2026-03-01T12:00:00.000Z");
  });

  it("clamps displayed progress to the target so a bar cannot overfill", async () => {
    // Stored progress may legitimately exceed the target: a game reports 120
    // kills against a target of 100, or an admin lowers a target afterwards.
    const { sql } = makeFakeSql(() => [
      shelfRow({ key: "zombies", target: 100, progress: 120 }),
    ]);
    const store = createAchievementStore(sql);
    const { achievements } = await store.forPlayer("duskfall", "player-1");
    expect(achievements[0].progress).toBe(100);
  });
});

describe("earnedForPlayer", () => {
  it("filters to earned only and carries the slug for linking", async () => {
    const { sql, calls } = makeFakeSql(() => [
      {
        slug: "duskfall",
        key: "first-blood",
        name: "First Blood",
        description: "",
        icon: "🩸",
        points: 10,
        unlocked_at: "2026-05-01T09:00:00Z",
      },
    ]);
    const store = createAchievementStore(sql);
    const earned = await store.earnedForPlayer("player-1");

    expect(earned[0].slug).toBe("duskfall");
    expect(calls[0].text).toContain("pa.unlocked_at IS NOT NULL");
    // A batch unlock stamps several rows with the same transaction `now()`, so
    // ordering on the timestamp alone is non-deterministic exactly when a player
    // earns a cluster.
    expect(calls[0].text).toContain("ORDER BY pa.unlocked_at DESC, a.id DESC");
  });

  it("clamps a hostile or nonsense limit", async () => {
    const { sql, calls } = makeFakeSql(() => []);
    const store = createAchievementStore(sql);

    await store.earnedForPlayer("player-1", 1_000_000);
    expect(calls[0].values).toContain(200);

    await store.earnedForPlayer("player-1", -5);
    expect(calls[1].values).toContain(1);

    await store.earnedForPlayer("player-1", Number.NaN);
    expect(calls[2].values).toContain(50);
  });
});

describe("pointsForPlayer", () => {
  it("sums earned points and survives an empty result", async () => {
    const { sql, calls } = makeFakeSql((call) =>
      call.values.includes("empty") ? [] : [{ points: 85 }],
    );
    const store = createAchievementStore(sql);
    expect(await store.pointsForPlayer("player-1")).toBe(85);
    expect(await store.pointsForPlayer("empty")).toBe(0);
    expect(calls[0].text).toContain("unlocked_at IS NOT NULL");
  });
});

describe("rarity", () => {
  it("maps key -> percentage", async () => {
    const { sql } = makeFakeSql(() => [
      { key: "first-blood", pct: 87 },
      { key: "hidden_ending", pct: 2 },
    ]);
    const store = createAchievementStore(sql);
    expect(await store.rarity("duskfall")).toEqual({
      "first-blood": 87,
      hidden_ending: 2,
    });
  });

  it("guards the zero denominator inside the query, not by skipping rows", async () => {
    const { sql, calls } = makeFakeSql(() => [{ key: "first-blood", pct: 0 }]);
    const store = createAchievementStore(sql);
    expect(await store.rarity("brand-new")).toEqual({ "first-blood": 0 });
    // Postgres raises 22012 for `x / 0`, which would 500 the store page on the
    // one day the denominator is GUARANTEED to be zero: launch day.
    expect(calls[0].text).toContain("WHEN (SELECT n FROM denom) = 0 THEN 0");
  });

  it("clamps a decoded percentage into 0-100", async () => {
    const { sql } = makeFakeSql(() => [{ key: "a", pct: 130 }]);
    const store = createAchievementStore(sql);
    expect(await store.rarity("duskfall")).toEqual({ a: 100 });
  });
});

describe("record — refusals decided before any query", () => {
  it("refuses a signed-out player without touching the database", async () => {
    const { sql, calls } = makeFakeSql(() => []);
    const store = createAchievementStore(sql);
    const result = await store.record({
      slug: "duskfall",
      playerId: null,
      entries: [{ key: "first-blood" }],
    });

    // Anonymous achievements have nothing to attach to. Typed nullable so a
    // route that forgets its own check fails as `signed-out` rather than as a
    // foreign-key violation the player reads as "the game is broken".
    expect(result).toEqual({ ok: false, reason: "signed-out", results: [] });
    expect(calls).toHaveLength(0);
  });

  it("refuses a missing slug", async () => {
    const { sql, calls } = makeFakeSql(() => []);
    const store = createAchievementStore(sql);
    expect(
      await store.record({
        slug: "",
        playerId: "player-1",
        entries: [{ key: "first-blood" }],
      }),
    ).toEqual({ ok: false, reason: "no-game", results: [] });
    expect(calls).toHaveLength(0);
  });

  it("refuses an EMPTY batch", async () => {
    const { sql, calls } = makeFakeSql(() => []);
    const store = createAchievementStore(sql);
    expect(
      await store.record({ slug: "duskfall", playerId: "player-1", entries: [] }),
    ).toEqual({ ok: false, reason: "bad-request", results: [] });
    expect(calls).toHaveLength(0);
  });

  it("refuses an OVERSIZED batch", async () => {
    const { sql, calls } = makeFakeSql(() => []);
    const store = createAchievementStore(sql);
    const entries = Array.from({ length: MAX_BATCH_SIZE + 1 }, (_, i) => ({
      key: `key-${i}`,
    }));
    expect(
      await store.record({ slug: "duskfall", playerId: "player-1", entries }),
    ).toEqual({ ok: false, reason: "bad-request", results: [] });
    // Rejected wholesale rather than truncated: silently dropping the tail would
    // make a game's last few unlocks vanish with no signal at all.
    expect(calls).toHaveLength(0);
  });

  it("accepts a batch of exactly MAX_BATCH_SIZE", async () => {
    const { sql, calls } = makeFakeSql(() => [unlockRow()]);
    const store = createAchievementStore(sql);
    const entries = Array.from({ length: MAX_BATCH_SIZE }, (_, i) => ({
      key: `key-${i}`,
    }));
    await store.record({ slug: "duskfall", playerId: "player-1", entries });
    expect(calls).toHaveLength(1);
  });

  it("refuses a batch whose keys are ALL malformed", async () => {
    const { sql, calls } = makeFakeSql(() => []);
    const store = createAchievementStore(sql);
    const result = await store.record({
      slug: "duskfall",
      playerId: "player-1",
      entries: [{ key: "Frist Blood!" }, { key: "" }],
    });

    // A malformed key is the GAME's bug and can never match the
    // `achievements_key_format` CHECK, so it reads as `bad-request` — distinct
    // from `unknown-achievement`, which is a provisioning gap on our side.
    expect(result).toEqual({ ok: false, reason: "bad-request", results: [] });
    expect(calls).toHaveLength(0);
  });

  it("drops individual malformed keys but still sends the good ones", async () => {
    const { sql, calls } = makeFakeSql(() => [unlockRow()]);
    const store = createAchievementStore(sql);
    await store.record({
      slug: "duskfall",
      playerId: "player-1",
      entries: [{ key: "first-blood" }, { key: "NOT VALID" }],
    });
    expect(calls[0].values).toContainEqual(["first-blood"]);
  });
});

describe("record — one statement, two bound arrays", () => {
  it("sends exactly ONE statement", async () => {
    const { sql, calls } = makeFakeSql(() => [unlockRow()]);
    const store = createAchievementStore(sql);
    await store.record({
      slug: "duskfall",
      playerId: "player-1",
      entries: [{ key: "first-blood" }, { key: "zombies", progress: 57 }],
    });
    // `neon()` is SQL-over-HTTP: two calls are two stateless requests with no
    // transaction between them, so a check-then-write split has a real window.
    expect(calls).toHaveLength(1);
  });

  it("zips the batch from parallel arrays instead of splicing VALUES", async () => {
    const { sql, calls } = makeFakeSql(() => [unlockRow()]);
    const store = createAchievementStore(sql);
    await store.record({
      slug: "duskfall",
      playerId: "player-1",
      entries: [{ key: "first-blood" }, { key: "zombies", progress: 57 }],
    });

    expect(calls[0].text).toContain("unnest(?::text[], ?::int[])");
    expect(calls[0].text).toContain("WITH ORDINALITY AS x(key, progress, ord)");
    expect(calls[0].values).toContainEqual(["first-blood", "zombies"]);
    expect(calls[0].values).toContainEqual([null, 57]);
  });

  it("sends NULL progress for a bare unlock so the DB substitutes the target", async () => {
    const { sql, calls } = makeFakeSql(() => [unlockRow()]);
    const store = createAchievementStore(sql);
    await store.record({
      slug: "duskfall",
      playerId: "player-1",
      entries: [{ key: "first-blood" }],
    });

    // `unlock("first-blood")` must EARN the thing, and the target is the only
    // place that number can come from — the client does not know it.
    expect(calls[0].values).toContainEqual([null]);
    expect(calls[0].text).toContain("COALESCE(i.progress, a.target) AS incoming");
  });

  it("floors, clamps and non-negates an incoming progress value", async () => {
    const { sql, calls } = makeFakeSql(() => [unlockRow()]);
    const store = createAchievementStore(sql);
    await store.record({
      slug: "duskfall",
      playerId: "player-1",
      entries: [
        { key: "a", progress: 12.9 },
        { key: "b", progress: -4 },
        { key: "c", progress: 1e30 },
      ],
    });

    // An out-of-range INTEGER makes Postgres raise 22003 for the WHOLE
    // statement, so one game's arithmetic bug would take out every other entry
    // in the same batch.
    expect(calls[0].values).toContainEqual([12, 0, 2_147_483_647]);
  });

  it("drops an entry whose progress is not a finite number", async () => {
    const { sql, calls } = makeFakeSql(() => [unlockRow()]);
    const store = createAchievementStore(sql);
    await store.record({
      slug: "duskfall",
      playerId: "player-1",
      entries: [
        { key: "first-blood" },
        { key: "zombies", progress: Number.NaN },
      ],
    });
    // NaN must NOT fall through to the null sentinel — that would silently
    // convert a broken counter into a full unlock.
    expect(calls[0].values).toContainEqual(["first-blood"]);
    expect(calls[0].values).toContainEqual([null]);
  });

  it("DEDUPES repeated keys, keeping the larger progress", async () => {
    const { sql, calls } = makeFakeSql(() => [unlockRow()]);
    const store = createAchievementStore(sql);
    await store.record({
      slug: "duskfall",
      playerId: "player-1",
      entries: [
        { key: "zombies", progress: 12 },
        { key: "zombies", progress: 57 },
      ],
    });

    // Not an optimisation: `INSERT ... ON CONFLICT DO UPDATE` raises 21000 when
    // the source produces two rows with the same conflict key, so a duplicate
    // would fail the ENTIRE batch rather than merging.
    expect(calls[0].values).toContainEqual(["zombies"]);
    expect(calls[0].values).toContainEqual([57]);
  });

  it("lets a bare unlock win over an explicit progress for the same key", async () => {
    const { sql, calls } = makeFakeSql(() => [unlockRow()]);
    const store = createAchievementStore(sql);
    await store.record({
      slug: "duskfall",
      playerId: "player-1",
      entries: [{ key: "zombies", progress: 12 }, { key: "zombies" }],
    });
    // "Unlock this" is the stronger statement of the two.
    expect(calls[0].values).toContainEqual([null]);
  });
});

describe("record — the invariants that live in the SQL", () => {
  async function emittedSql(): Promise<string> {
    const { sql, calls } = makeFakeSql(() => [unlockRow()]);
    const store = createAchievementStore(sql);
    await store.record({
      slug: "duskfall",
      playerId: "player-1",
      entries: [{ key: "zombies", progress: 57 }],
    });
    return calls[0].text;
  }

  it("takes GREATEST on progress so a counter can never regress", async () => {
    // The absolute-progress contract: a retried, duplicated or out-of-order
    // beacon must be a no-op, never a rollback and never a double-count.
    expect(await emittedSql()).toContain(
      "progress    = GREATEST(player_achievements.progress, EXCLUDED.progress)",
    );
  });

  it("COALESCEs unlocked_at so an earned achievement is never re-stamped", async () => {
    // Without this, every later progress beacon would move the timestamp and
    // "recently earned" ordering would reshuffle forever — no error, no log.
    expect(await emittedSql()).toContain(
      "unlocked_at = COALESCE(player_achievements.unlocked_at, EXCLUDED.unlocked_at)",
    );
  });

  it("stamps the unlock from progress the player ALREADY had", async () => {
    // Computed in the INSERT's source against `before`, not from the incoming
    // value alone, so an admin lowering a target under players who are already
    // past it still resolves to earned.
    expect(await emittedSql()).toContain(
      "WHEN GREATEST(r.incoming, b.prev_progress) >= r.target THEN now()",
    );
  });

  it("captures the pre-update state in a CTE rather than reading RETURNING", async () => {
    const text = await emittedSql();
    expect(text).toContain("before AS (");
    expect(text).toContain("pa.unlocked_at           AS prev_unlocked_at");
    // `RETURNING` hands back the row AFTER the upsert, where "already earned"
    // and "just earned" are indistinguishable.
    expect(text).toContain("(b.prev_unlocked_at IS NOT NULL)");
  });

  it("rate-limits by PLAYER over updated_at, never by IP", async () => {
    const text = await emittedSql();
    expect(text).toContain("FROM player_achievements\n          WHERE player_id = ?");
    expect(text).toContain("AND updated_at >= now() - make_interval(0,0,0,0,0,0,?)");
    // A school NATs its whole network to one egress address; an IP limit tight
    // enough to matter locks out a computing lab.
    expect(text).not.toContain("ip_hash");
  });

  it("resolves keys through the (slug, key) unique index", async () => {
    expect(await emittedSql()).toContain(
      "JOIN achievements a ON a.slug = ? AND a.key = i.key",
    );
  });

  it("anchors the outer select on the rate-limit CTE", async () => {
    // `recent` is an unqualified count(*), so it always yields exactly one row.
    // Joining out of it guarantees a row back even when nothing resolved —
    // otherwise "rate-limited" and "all keys unknown" are indistinguishable.
    const text = await emittedSql();
    expect(text).toContain("FROM recent rc");
    expect(text).toContain("LEFT JOIN resolved r ON true");
  });
});

describe("record — decoding the single row set", () => {
  it("reports a NEW unlock as the toast signal", async () => {
    const { sql } = makeFakeSql(() => [
      unlockRow({ already_unlocked: false, unlocked: true, progress: 1 }),
    ]);
    const store = createAchievementStore(sql);
    const result = await store.record({
      slug: "duskfall",
      playerId: "player-1",
      entries: [{ key: "first-blood" }],
    });

    expect(result.ok).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(result.results).toEqual([
      {
        key: "first-blood",
        unlocked: true,
        alreadyUnlocked: false,
        progress: 1,
        target: 1,
      },
    ]);
  });

  it("is IDEMPOTENT — an already-held achievement is ok, not an error", async () => {
    const { sql } = makeFakeSql(() => [
      unlockRow({ already_unlocked: true, unlocked: true }),
    ]);
    const store = createAchievementStore(sql);
    const result = await store.record({
      slug: "duskfall",
      playerId: "player-1",
      entries: [{ key: "first-blood" }],
    });

    expect(result.ok).toBe(true);
    // `unlocked` is "newly earned by THIS call". Reporting true here would
    // re-fire the celebration on every subsequent beacon.
    expect(result.results[0].unlocked).toBe(false);
    expect(result.results[0].alreadyUnlocked).toBe(true);
  });

  it("reports in-progress entries with no unlock", async () => {
    const { sql } = makeFakeSql(() => [
      unlockRow({
        key: "zombies",
        target: 100,
        unlocked: false,
        already_unlocked: false,
        progress: 57,
      }),
    ]);
    const store = createAchievementStore(sql);
    const result = await store.record({
      slug: "duskfall",
      playerId: "player-1",
      entries: [{ key: "zombies", progress: 57 }],
    });

    expect(result.results[0]).toEqual({
      key: "zombies",
      unlocked: false,
      alreadyUnlocked: false,
      progress: 57,
      target: 100,
    });
  });

  it("omits UNKNOWN keys from results while recording the known ones", async () => {
    const { sql } = makeFakeSql(() => [unlockRow({ key: "first-blood" })]);
    const store = createAchievementStore(sql);
    const result = await store.record({
      slug: "duskfall",
      playerId: "player-1",
      entries: [{ key: "first-blood" }, { key: "not-provisioned-yet" }],
    });

    // A game that ships a new achievement before an admin provisions it must
    // keep working for the keys that DO exist.
    expect(result.ok).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(result.results.map((r) => r.key)).toEqual(["first-blood"]);
  });

  it("reports unknown-achievement ONLY when every key was unknown", async () => {
    // The anchor row comes back with a null key because nothing resolved.
    const { sql } = makeFakeSql(() => [
      {
        recent: 0,
        key: null,
        target: null,
        already_unlocked: null,
        unlocked: null,
        progress: null,
      },
    ]);
    const store = createAchievementStore(sql);
    const result = await store.record({
      slug: "duskfall",
      playerId: "player-1",
      entries: [{ key: "ghost-key" }],
    });

    // Still `ok`: the reason is a diagnostic for the game's author, not a
    // failure for the player, and nothing was lost.
    expect(result).toEqual({
      ok: true,
      reason: "unknown-achievement",
      results: [],
    });
  });

  it("reports rate-limited and records NOTHING when the window is full", async () => {
    const { sql } = makeFakeSql(() => [
      unlockRow({ recent: ACHIEVEMENT_PLAYER_RATE_LIMIT.maxPerWindow }),
    ]);
    const store = createAchievementStore(sql);
    const result = await store.record({
      slug: "duskfall",
      playerId: "player-1",
      entries: [{ key: "first-blood" }],
    });

    // Empty results, not results-with-unlocked-false: nothing was written, and
    // reporting per-entry state would describe a write that did not happen.
    expect(result).toEqual({ ok: false, reason: "rate-limited", results: [] });
  });

  it("still records when the window is one short of full", async () => {
    const { sql } = makeFakeSql(() => [
      unlockRow({ recent: ACHIEVEMENT_PLAYER_RATE_LIMIT.maxPerWindow - 1 }),
    ]);
    const store = createAchievementStore(sql);
    const result = await store.record({
      slug: "duskfall",
      playerId: "player-1",
      entries: [{ key: "first-blood" }],
    });
    expect(result.ok).toBe(true);
    expect(result.results).toHaveLength(1);
  });

  it("gates the INSERT on the same limit, inside the statement", async () => {
    const { sql, calls } = makeFakeSql(() => [unlockRow()]);
    const store = createAchievementStore(sql);
    await store.record({
      slug: "duskfall",
      playerId: "player-1",
      entries: [{ key: "first-blood" }],
    });
    // Decoding the limit in JS is for the CALLER's benefit. Enforcement has to
    // be in the statement, or a rate-limited call would still write.
    expect(calls[0].text).toContain("WHERE (SELECT n FROM recent) < ?");
    expect(calls[0].values).toContain(
      ACHIEVEMENT_PLAYER_RATE_LIMIT.maxPerWindow,
    );
  });

  it("does not confuse an empty result set with a successful write", async () => {
    // Defensive: a driver returning nothing must not decode as "recorded".
    const { sql } = makeFakeSql(() => []);
    const store = createAchievementStore(sql);
    const result = await store.record({
      slug: "duskfall",
      playerId: "player-1",
      entries: [{ key: "first-blood" }],
    });
    expect(result.results).toEqual([]);
    expect(result.reason).toBe("unknown-achievement");
  });
});
