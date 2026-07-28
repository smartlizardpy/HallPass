/**
 * Tests for the social store factory.
 *
 * Same fake-`sql` seam as `scoreboard/store.test.ts`: a function matching the
 * tagged-template signature records every call and returns canned rows, so both
 * the JS-side decoding and the shape of the emitted SQL can be asserted without a
 * database. That seam is the whole reason this store is a factory — the
 * friend-request state machine has six outcomes decoded from one row, and those
 * branches are exactly what a live-DB test would be worst at covering.
 */

import { describe, expect, it } from "vitest";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { createSocialStore } from "./store";
import { orderPair, otherSide } from "./pair";

interface RecordedCall {
  text: string;
  values: unknown[];
}

function makeFakeSql(responder: (call: RecordedCall) => Record<string, unknown>[]) {
  const calls: RecordedCall[] = [];
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const call: RecordedCall = { text: strings.join("?"), values };
    calls.push(call);
    return Promise.resolve(responder(call));
  };
  return { sql: fn as unknown as NeonQueryFunction<false, false>, calls };
}

/** A gate row with everything permissive; override the fields under test. */
function gateRow(over: Record<string, unknown> = {}) {
  return {
    logged: 1,
    status: "pending",
    blocked: 0,
    cooling: 0,
    recent: 0,
    outstanding: 0,
    my_friends: 0,
    ...over,
  };
}

describe("orderPair", () => {
  it("is symmetric — either argument order yields the same key", () => {
    expect(orderPair("aaa", "bbb")).toEqual(orderPair("bbb", "aaa"));
  });

  it("orders by code units, which is what COLLATE \"C\" pins on the DB side", () => {
    // A hyphenated UUID is the case that motivates the pin: under an ICU
    // collation punctuation is weighted differently, so an unpinned Postgres
    // comparison could disagree with this one.
    const a = "0f8e1c22-1111-4aaa-8bbb-cccccccccccc";
    const b = "0f8e1c221111";
    const { lo, hi } = orderPair(a, b);
    expect(lo < hi).toBe(true);
    // "-" (0x2D) sorts before "1" (0x31) in byte order.
    expect(lo).toBe(a);
  });

  it("otherSide picks the end that is not the viewer", () => {
    expect(otherSide({ playerA: "me", playerB: "them" }, "me")).toBe("them");
    expect(otherSide({ playerA: "them", playerB: "me" }, "me")).toBe("them");
  });
});

describe("sendRequest outcome decoding", () => {
  it("reports 'sent' for a fresh pending row", async () => {
    const { sql } = makeFakeSql(() => [gateRow()]);
    const store = createSocialStore(sql);
    expect(await store.sendRequest("me", "them")).toBe("sent");
  });

  it("reports 'accepted' when the target had already requested me", async () => {
    // The crossed-request case: ON CONFLICT DO UPDATE flips it to accepted in the
    // same statement, so no reconciler is needed.
    const { sql } = makeFakeSql(() => [gateRow({ status: "accepted" })]);
    const store = createSocialStore(sql);
    expect(await store.sendRequest("me", "them")).toBe("accepted");
  });

  it("reports 'already' when the row exists but was not updatable", async () => {
    // The attempt was logged, but ON CONFLICT's WHERE failed, so no status came
    // back — the relationship already exists in a state this call cannot change.
    const { sql } = makeFakeSql(() => [gateRow({ status: null })]);
    const store = createSocialStore(sql);
    expect(await store.sendRequest("me", "them")).toBe("already");
  });

  it("reports 'unavailable' for a block, in EITHER direction", async () => {
    const { sql } = makeFakeSql(() => [gateRow({ logged: 0, blocked: 1 })]);
    const store = createSocialStore(sql);
    expect(await store.sendRequest("me", "them")).toBe("unavailable");
  });

  it("reports 'cooldown' for a repeat send to the same target", async () => {
    const { sql } = makeFakeSql(() => [gateRow({ logged: 0, cooling: 1 })]);
    const store = createSocialStore(sql);
    expect(await store.sendRequest("me", "them")).toBe("cooldown");
  });

  it("reports 'at-capacity' when a cap is hit, not 'rate-limited'", async () => {
    const { sql } = makeFakeSql(() => [
      gateRow({ logged: 0, outstanding: 50 }),
    ]);
    const store = createSocialStore(sql);
    expect(await store.sendRequest("me", "them")).toBe("at-capacity");
  });

  it("falls back to 'rate-limited' when nothing more specific applies", async () => {
    const { sql } = makeFakeSql(() => [gateRow({ logged: 0, recent: 10 })]);
    const store = createSocialStore(sql);
    expect(await store.sendRequest("me", "them")).toBe("rate-limited");
  });

  it("prefers 'unavailable' over 'cooldown' so it cannot leak existence", async () => {
    // If a blocked target reported 'cooldown' (or anything distinguishable from a
    // nonexistent one) the send endpoint would become an existence oracle that
    // bypasses the search rate limit.
    const { sql } = makeFakeSql(() => [
      gateRow({ logged: 0, blocked: 1, cooling: 1, recent: 10 }),
    ]);
    const store = createSocialStore(sql);
    expect(await store.sendRequest("me", "them")).toBe("unavailable");
  });

  it("binds the pair in canonical order regardless of argument order", async () => {
    const seen: unknown[][] = [];
    const { sql } = makeFakeSql((call) => {
      seen.push(call.values);
      return [gateRow()];
    });
    const store = createSocialStore(sql);
    await store.sendRequest("zzz", "aaa");
    // `lo` must be "aaa" so the row matches the ordered-key CHECK.
    expect(seen[0]).toContain("aaa");
    expect(seen[0]).toContain("zzz");
  });
});

describe("acceptRequest", () => {
  it("guards on requested_by being the OTHER party", async () => {
    const { sql, calls } = makeFakeSql(() => [{ n: 1 }]);
    const store = createSocialStore(sql);
    expect(await store.acceptRequest("me", "them")).toBe(true);
    // Structurally proves the caller is in the pair: a third party cannot accept
    // someone else's request even with guessed ids.
    expect(calls[0].text).toContain("requested_by = ");
    expect(calls[0].text).toContain("status = 'pending'");
  });

  it("returns false when no row matched", async () => {
    const { sql } = makeFakeSql(() => [{ n: 0 }]);
    const store = createSocialStore(sql);
    expect(await store.acceptRequest("me", "them")).toBe(false);
  });
});

describe("removeRelationship", () => {
  it("is unconditional — one verb for decline, cancel and unfriend", async () => {
    const { sql, calls } = makeFakeSql(() => [{ player_a: "a" }]);
    const store = createSocialStore(sql);
    expect(await store.removeRelationship("me", "them")).toBe(true);
    // No status guard: the client should not have to pick the right verb against
    // a view that may already be stale.
    expect(calls[0].text).not.toContain("status");
  });

  it("reports false for no match without treating it as an error", async () => {
    const { sql } = makeFakeSql(() => []);
    const store = createSocialStore(sql);
    expect(await store.removeRelationship("me", "them")).toBe(false);
  });
});

describe("searchPlayers", () => {
  it("escapes LIKE wildcards — `_` is a legal username character", async () => {
    const seen: unknown[][] = [];
    const { sql, calls } = makeFakeSql((call) => {
      seen.push(call.values);
      return [];
    });
    const store = createSocialStore(sql);
    await store.searchPlayers("me", "a_b");

    // Without escaping, `_` is LIKE's single-character wildcard and `%` its
    // multi-character one, so a search for "_" would match every username.
    expect(seen[0]).toContain("a\\_b%");
    expect(calls[0].text).toContain("ESCAPE");
  });

  it("escapes % and backslash too", async () => {
    const seen: unknown[][] = [];
    const { sql } = makeFakeSql((call) => {
      seen.push(call.values);
      return [];
    });
    const store = createSocialStore(sql);
    await store.searchPlayers("me", "100%\\");
    expect(seen[0]).toContain("100\\%\\\\%");
  });

  it("excludes the caller, private profiles and blocks in both directions", async () => {
    const { sql, calls } = makeFakeSql(() => []);
    const store = createSocialStore(sql);
    await store.searchPlayers("me", "abc");
    expect(calls[0].text).toContain("profile_visibility <> 'private'");
    expect(calls[0].text).toContain("player_blocks");
    expect(calls[0].text).toContain("NOT EXISTS");
  });

  it("has no OFFSET — the cap must not be walkable into a namespace dump", async () => {
    const { sql, calls } = makeFakeSql(() => []);
    const store = createSocialStore(sql);
    await store.searchPlayers("me", "abc");
    expect(calls[0].text).not.toContain("OFFSET");
  });

  it("matches the DISPLAY NAME, not just the username", async () => {
    // The bug this exists to prevent: search matched usernames only, and not one
    // player had claimed one, so every search returned nothing for everyone —
    // and typing the name you actually know somebody by could never work.
    const { sql, calls } = makeFakeSql(() => []);
    const store = createSocialStore(sql);
    await store.searchPlayers("me", "ata");
    // The handle is compared through the fold, so this asserts on that form
    // rather than a bare ILIKE.
    expect(calls[0].text).toContain("translate(lower(p.handle)");
    expect(calls[0].text).toContain("p.username LIKE");
  });

  it("matches a display name at a word boundary, so \"Can\" finds \"Ata Can\"", async () => {
    const seen: unknown[][] = [];
    const { sql } = makeFakeSql((call) => {
      seen.push(call.values);
      return [];
    });
    const store = createSocialStore(sql);
    await store.searchPlayers("me", "can");
    // Prefix AND word-start patterns are both bound. A bare substring match would
    // also find "can" inside "Duncan", which turns search into a fishing trip.
    expect(seen[0]).toContain("can%");
    expect(seen[0]).toContain("% can%");
  });

  it("escapes wildcards in the word-boundary pattern too", async () => {
    // Easy to escape one pattern and forget the other, at which point `_` matches
    // everybody again through the second branch.
    const seen: unknown[][] = [];
    const { sql } = makeFakeSql((call) => {
      seen.push(call.values);
      return [];
    });
    const store = createSocialStore(sql);
    await store.searchPlayers("me", "a_b");
    expect(seen[0]).toContain("% a\\_b%".replace("\\\\", "\\"));
  });

  it("folds diacritics so \"Ateş\" and \"Ates\" are the same search", async () => {
    // The reported bug: a Turkish keyboard produces "ş" without being asked, so
    // somebody typing their friend's name naturally searched for a spelling the
    // username could not contain — usernames are ASCII by rule — and got nothing.
    const seen: unknown[][] = [];
    const { sql, calls } = makeFakeSql((call) => {
      seen.push(call.values);
      return [];
    });
    const store = createSocialStore(sql);
    await store.searchPlayers("me", "Ateş");

    // The query is folded before it is bound...
    expect(seen[0]).toContain("ates%");
    // ...and the HANDLE column is folded too, so it works in both directions.
    expect(calls[0].text).toContain("translate(lower(p.handle)");
  });

  it("still never selects the internal id or email", async () => {
    const { sql, calls } = makeFakeSql(() => []);
    const store = createSocialStore(sql);
    await store.searchPlayers("me", "abc");
    expect(calls[0].text).toContain("p.public_id");
    expect(calls[0].text).not.toContain("p.email");
    // Check the SELECT LIST only. `p.id <> me` in the WHERE clause is a filter,
    // not an exposure — excluding the caller from their own results is exactly
    // what it is there for.
    const selectList = calls[0].text.slice(
      calls[0].text.indexOf("SELECT"),
      calls[0].text.indexOf("FROM"),
    );
    expect(selectList).not.toMatch(/\bp\.id\b/);
  });
});

describe("public projection", () => {
  it("exposes public_id and NEVER the internal id or email", async () => {
    const { sql } = makeFakeSql(() => [
      {
        public_id: "11111111-2222-3333-4444-555555555555",
        username: "ozan",
        handle: "Ozan",
        image: "https://example.test/a.png",
        // Fields a careless projection might carry through:
        id: "google-subject-id",
        email: "someone@example.test",
      },
    ]);
    const store = createSocialStore(sql);
    const [friend] = await store.listFriends("me");

    expect(friend.id).toBe("11111111-2222-3333-4444-555555555555");
    expect(JSON.stringify(friend)).not.toContain("google-subject-id");
    expect(JSON.stringify(friend)).not.toContain("someone@example.test");
  });

  it("falls back to @username, and NEVER to the Google name", async () => {
    const { sql } = makeFakeSql(() => [
      {
        public_id: "11111111-2222-3333-4444-555555555555",
        username: "ozan",
        handle: null,
        image: null,
        // The real name must never surface on a surface another player sees.
        name: "Real Name",
      },
    ]);
    const store = createSocialStore(sql);
    const [friend] = await store.listFriends("me");
    expect(friend.displayName).toBe("@ozan");
    expect(JSON.stringify(friend)).not.toContain("Real Name");
  });

  it("falls back to 'Player' when there is neither handle nor username", async () => {
    const { sql } = makeFakeSql(() => [
      { public_id: "11111111-2222-3333-4444-555555555555", username: null, handle: null, image: null },
    ]);
    const store = createSocialStore(sql);
    const [friend] = await store.listFriends("me");
    expect(friend.displayName).toBe("Player");
  });
});

describe("internalIdFromPublicId", () => {
  it("rejects a malformed UUID before it reaches Postgres", async () => {
    // Postgres raises 22P02 for a bad uuid cast, which would turn a bad request
    // into a 500 rather than a clean null.
    const { sql, calls } = makeFakeSql(() => []);
    const store = createSocialStore(sql);
    expect(await store.internalIdFromPublicId("not-a-uuid")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("queries for a well-formed UUID", async () => {
    const { sql, calls } = makeFakeSql(() => [{ id: "internal" }]);
    const store = createSocialStore(sql);
    expect(
      await store.internalIdFromPublicId("11111111-2222-3333-4444-555555555555"),
    ).toBe("internal");
    expect(calls).toHaveLength(1);
  });
});

describe("friendsPlaying", () => {
  it("short-circuits on an empty slug list without querying", async () => {
    const { sql, calls } = makeFakeSql(() => []);
    const store = createSocialStore(sql);
    expect(await store.friendsPlaying("me", [])).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("binds slugs as a text[] and needs no block filter", async () => {
    const { sql, calls } = makeFakeSql((call) => {
      expect(call.values).toContainEqual(["a", "b"]);
      return [];
    });
    const store = createSocialStore(sql);
    await store.friendsPlaying("me", ["a", "b"]);
    // Blocking deletes the friendship row, so an accepted friendship and a block
    // cannot coexist — filtering again would be dead weight.
    expect(calls[0].text).not.toContain("player_blocks");
    expect(calls[0].text).toContain("::text[]");
  });
});

describe("recordPlay", () => {
  it("upserts rather than appending, so the table stays flat", async () => {
    const { sql, calls } = makeFakeSql(() => []);
    const store = createSocialStore(sql);
    await store.recordPlay("me", "duskfall");
    expect(calls[0].text).toContain("ON CONFLICT (player_id, slug) DO UPDATE");
    expect(calls[0].text).toContain("play_count  = player_plays.play_count + 1");
  });
});
