/**
 * Tests for the public-profile read model.
 *
 * Three layers, and the split is the point:
 *
 *   1. `resolveVisibility` — EXHAUSTIVELY, all 24 combinations, against an
 *      explicit expectation table. This is the access decision for a page at a
 *      guessable URL that publishes things about children; "we tested the happy
 *      path" is not a standard it can be held to. The table is written out rather
 *      than computed so that a test cannot agree with a bug by reimplementing it.
 *
 *   2. `coarsenActivity` — the boundaries, and the property that actually matters:
 *      two instants hours apart must be indistinguishable in the output.
 *
 *   3. The reader, through the same fake-`sql` seam as `social/store.test.ts`: a
 *      function matching the tagged-template signature that records every call and
 *      returns canned rows. That seam is what lets us assert the things this
 *      module is DEFINED by — that a blocked viewer's badge and play queries are
 *      never issued at all, that the lookup binds a lowercased username and never
 *      wraps the column in `lower()`, and that no returned shape carries an
 *      `email` or an `id`.
 *
 * `server-only` is mocked because `profile.ts` imports the shared `sql` (and
 * `publicDisplayName`, and `db.ts`'s `isMissingColumnError`) — the live binding at
 * the bottom of the module is never exercised here, only the factory.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NeonQueryFunction } from "@neondatabase/serverless";

vi.mock("server-only", () => ({}));

const {
  coarsenActivity,
  createProfileReader,
  getPublicProfileByUsername,
  resolveVisibility,
  toProfileVisibility,
  PROFILE_IS_EMAIL_FREE,
  PROFILE_RECENT_PLAYS,
} = await import("./profile");
type ProfileVisibility = import("./profile").ProfileVisibility;
type ProfileDetail = import("./profile").ProfileDetail;
type FullProfile = import("./profile").FullProfile;

// ---------------------------------------------------------------------------
// The fake tagged template
// ---------------------------------------------------------------------------

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

/** A permissive `players` row; override the fields under test. */
function profileRow(over: Record<string, unknown> = {}) {
  return {
    id: "google-sub-1234567890",
    public_id: "0f8e1c22-1111-4aaa-8bbb-cccccccccccc",
    username: "cool_kid",
    handle: null,
    image: "https://example.test/avatar.png",
    profile_visibility: "public",
    is_owner: false,
    friend_status: null,
    requested_by_viewer: false,
    is_blocked: false,
    friend_count: 7,
    last_active: new Date().toISOString(),
    ...over,
  };
}

/** Row shape returned by `badgeStats`. */
const badgeStatsRow = {
  games_played: 6,
  total_plays: 12,
  boards_entered: 1,
  first_places: 0,
  reviews_written: 0,
  best_review_helpful: 0,
  friends: 7,
  account_age_days: 10,
};

/**
 * Route each query by a marker unique to it, so a test never depends on call
 * ORDER — the two follow-up queries are issued with `Promise.all`.
 */
function routed(
  row: Record<string, unknown> | null,
  plays: unknown[] = [],
  flair: Record<string, unknown>[] = [],
) {
  return (call: RecordedCall) => {
    if (call.text.includes("FROM players p")) return row ? [row] : [];
    if (call.text.includes("games_played")) return [badgeStatsRow];
    // The ORDER BY, not the FROM — the profile row's `last_active` subquery also
    // reads `player_plays`.
    if (call.text.includes("ORDER BY pp.last_played DESC")) {
      return plays as Record<string, unknown>[];
    }
    if (call.text.includes("FROM player_flair")) return flair;
    return [];
  };
}

// ---------------------------------------------------------------------------
// 1. The visibility matrix
// ---------------------------------------------------------------------------

const VISIBILITIES: ProfileVisibility[] = ["public", "friends", "private"];
const BOOLS = [false, true];

function matrixKey(input: {
  visibility: ProfileVisibility;
  isOwner: boolean;
  isFriend: boolean;
  isBlocked: boolean;
}) {
  return [
    input.visibility,
    `owner:${input.isOwner}`,
    `friend:${input.isFriend}`,
    `blocked:${input.isBlocked}`,
  ].join("|");
}

/**
 * Every combination, written out. Read this as the specification: if a row here
 * is wrong, the feature is wrong, and no amount of agreeing with the
 * implementation would show it.
 */
const EXPECTED: Record<string, ProfileDetail> = {
  // --- public: open to everyone who is not blocked -------------------------
  "public|owner:false|friend:false|blocked:false": "full",
  "public|owner:false|friend:true|blocked:false": "full",
  // A block beats a public setting: the specific statement beats the general.
  "public|owner:false|friend:false|blocked:true": "minimal",
  "public|owner:false|friend:true|blocked:true": "minimal",
  "public|owner:true|friend:false|blocked:false": "full",
  "public|owner:true|friend:true|blocked:false": "full",
  "public|owner:true|friend:false|blocked:true": "full",
  "public|owner:true|friend:true|blocked:true": "full",

  // --- friends: the DEFAULT for every new account --------------------------
  "friends|owner:false|friend:false|blocked:false": "minimal",
  "friends|owner:false|friend:true|blocked:false": "full",
  "friends|owner:false|friend:false|blocked:true": "minimal",
  // Unreachable in practice — blocking deletes the friendship row — but it must
  // still resolve the safe way if the two ever disagree.
  "friends|owner:false|friend:true|blocked:true": "minimal",
  "friends|owner:true|friend:false|blocked:false": "full",
  "friends|owner:true|friend:true|blocked:false": "full",
  "friends|owner:true|friend:false|blocked:true": "full",
  "friends|owner:true|friend:true|blocked:true": "full",

  // --- private: nobody but the owner ---------------------------------------
  "private|owner:false|friend:false|blocked:false": "minimal",
  // Being a friend does NOT unlock a private profile. `private` means private.
  "private|owner:false|friend:true|blocked:false": "minimal",
  "private|owner:false|friend:false|blocked:true": "minimal",
  "private|owner:false|friend:true|blocked:true": "minimal",
  // The owner always sees their own, or the setting looks broken to the only
  // person who can change it.
  "private|owner:true|friend:false|blocked:false": "full",
  "private|owner:true|friend:true|blocked:false": "full",
  "private|owner:true|friend:false|blocked:true": "full",
  "private|owner:true|friend:true|blocked:true": "full",
};

describe("resolveVisibility", () => {
  const combos = VISIBILITIES.flatMap((visibility) =>
    BOOLS.flatMap((isOwner) =>
      BOOLS.flatMap((isFriend) =>
        BOOLS.map((isBlocked) => ({ visibility, isOwner, isFriend, isBlocked })),
      ),
    ),
  );

  it("covers the whole matrix — 3 settings x owner x friend x blocked", () => {
    expect(combos).toHaveLength(24);
    expect(Object.keys(EXPECTED)).toHaveLength(24);
    // No expectation may go stale: every key must correspond to a real combo.
    expect(new Set(combos.map(matrixKey))).toEqual(new Set(Object.keys(EXPECTED)));
  });

  for (const combo of VISIBILITIES.flatMap((visibility) =>
    BOOLS.flatMap((isOwner) =>
      BOOLS.flatMap((isFriend) =>
        BOOLS.map((isBlocked) => ({ visibility, isOwner, isFriend, isBlocked })),
      ),
    ),
  )) {
    const key = matrixKey(combo);
    it(`resolves ${key} to ${EXPECTED[key]}`, () => {
      expect(resolveVisibility(combo)).toBe(EXPECTED[key]);
    });
  }

  it("never lets a block through, whatever the setting", () => {
    for (const visibility of VISIBILITIES) {
      expect(
        resolveVisibility({
          visibility,
          isOwner: false,
          isFriend: true,
          isBlocked: true,
        }),
      ).toBe("minimal");
    }
  });
});

describe("toProfileVisibility", () => {
  it("passes the three legal settings through", () => {
    expect(toProfileVisibility("public")).toBe("public");
    expect(toProfileVisibility("friends")).toBe("friends");
    expect(toProfileVisibility("private")).toBe("private");
  });

  it("fails CLOSED on anything else, including null and junk", () => {
    // Unreachable while `players_profile_visibility_chk` holds, but the cost of
    // being wrong is asymmetric: an over-shared profile cannot be un-shared.
    expect(toProfileVisibility(null)).toBe("private");
    expect(toProfileVisibility(undefined)).toBe("private");
    expect(toProfileVisibility("PUBLIC")).toBe("private");
    expect(toProfileVisibility("everyone")).toBe("private");
    expect(toProfileVisibility(1)).toBe("private");
  });
});

// ---------------------------------------------------------------------------
// 2. Coarse time
// ---------------------------------------------------------------------------

describe("coarsenActivity", () => {
  const now = new Date("2026-07-27T12:00:00.000Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const HOUR = 3_600_000;
  const DAY = 86_400_000;

  it("returns null for no activity at all", () => {
    expect(coarsenActivity(null, now)).toBeNull();
    expect(coarsenActivity(undefined, now)).toBeNull();
  });

  it("returns null rather than guessing at an unparseable value", () => {
    expect(coarsenActivity("not a date", now)).toBeNull();
    expect(coarsenActivity(new Date("nonsense"), now)).toBeNull();
  });

  it("buckets by elapsed time", () => {
    expect(coarsenActivity(now, now)).toBe("today");
    expect(coarsenActivity(ago(HOUR), now)).toBe("today");
    expect(coarsenActivity(ago(23 * HOUR), now)).toBe("today");
    expect(coarsenActivity(ago(25 * HOUR), now)).toBe("this-week");
    expect(coarsenActivity(ago(6 * DAY), now)).toBe("this-week");
    expect(coarsenActivity(ago(8 * DAY), now)).toBe("this-month");
    expect(coarsenActivity(ago(30 * DAY), now)).toBe("this-month");
    expect(coarsenActivity(ago(32 * DAY), now)).toBe("a-while-ago");
    expect(coarsenActivity(ago(400 * DAY), now)).toBe("a-while-ago");
  });

  it("puts each boundary in the LATER bucket", () => {
    expect(coarsenActivity(ago(DAY), now)).toBe("this-week");
    expect(coarsenActivity(ago(7 * DAY), now)).toBe("this-month");
    expect(coarsenActivity(ago(31 * DAY), now)).toBe("a-while-ago");
  });

  it("reads a future timestamp as 'today', not 'a while ago'", () => {
    // Clock skew between Neon and the runtime is real; someone who just played
    // showing as inactive for a month is the failure people disbelieve.
    expect(coarsenActivity(new Date(now.getTime() + HOUR), now)).toBe("today");
  });

  it("accepts the driver's ISO strings and epoch millis", () => {
    expect(coarsenActivity(ago(2 * HOUR).toISOString(), now)).toBe("today");
    expect(coarsenActivity(ago(2 * HOUR).getTime(), now)).toBe("today");
  });

  it("erases the presence signal — hours apart is indistinguishable", () => {
    // This is the whole reason the helper exists. If these ever differ, the page
    // can be used to work out when someone is at a screen.
    const morning = coarsenActivity(ago(2 * HOUR), now);
    const overnight = coarsenActivity(ago(20 * HOUR), now);
    expect(morning).toBe(overnight);
    expect(coarsenActivity(ago(2 * DAY), now)).toBe(
      coarsenActivity(ago(5 * DAY), now),
    );
  });
});

// ---------------------------------------------------------------------------
// 3. The reader
// ---------------------------------------------------------------------------

describe("getPublicProfileByUsername — lookup", () => {
  it("binds a LOWERCASED username and never wraps the column in lower()", async () => {
    // Usernames are stored lowercase so a plain UNIQUE btree IS the
    // case-insensitive index. `lower(p.username)` would not use it.
    const { sql, calls } = makeFakeSql(routed(profileRow()));
    await createProfileReader(sql).getPublicProfileByUsername("Cool_KID", null);
    expect(calls[0].values).toContain("cool_kid");
    expect(calls[0].text).toMatch(/p\.username = \?/);
    expect(calls[0].text).not.toMatch(/lower\s*\(/i);
  });

  it("trims the input before binding it", async () => {
    const { sql, calls } = makeFakeSql(routed(profileRow()));
    await createProfileReader(sql).getPublicProfileByUsername("  cool_kid \n", null);
    expect(calls[0].values).toContain("cool_kid");
  });

  it("reports not-found for an unknown username", async () => {
    const { sql } = makeFakeSql(routed(null));
    const result = await createProfileReader(sql).getPublicProfileByUsername(
      "nobody_here",
      null,
    );
    expect(result).toEqual({ found: false });
  });

  it("never touches the database for a name no row could hold", async () => {
    const { sql, calls } = makeFakeSql(routed(profileRow()));
    const reader = createProfileReader(sql);
    for (const bad of ["", "ab", "a".repeat(21), "has spaces", "Ünïcode", "a-b"]) {
      expect(await reader.getPublicProfileByUsername(bad, null)).toEqual({
        found: false,
      });
    }
    expect(calls).toHaveLength(0);
  });

  it("still looks up names the CLAIM validator would now reject", async () => {
    // `validateUsernameFormat` rejects reserved words, `__` and all-digits. Those
    // rules can tighten; a name claimed under the old ones must not 404.
    const { sql, calls } = makeFakeSql(routed(profileRow({ username: "a__b" })));
    const result = await createProfileReader(sql).getPublicProfileByUsername(
      "a__b",
      null,
    );
    // Row lookup, then badge stats + recent plays + flair in parallel.
    expect(calls).toHaveLength(4);
    expect(result.found).toBe(true);
  });

  it("issues a viewer-free statement when nobody is signed in", async () => {
    const { sql, calls } = makeFakeSql(routed(profileRow()));
    await createProfileReader(sql).getPublicProfileByUsername("cool_kid", null);
    expect(calls[0].text).not.toContain("player_blocks");
    expect(calls[0].text).not.toContain("LEFT JOIN friendships");
    // The lookup binds exactly one value: the username.
    expect(calls[0].values).toEqual(["cool_kid"]);
  });

  it("issues the relationship statement when there IS a viewer", async () => {
    const { sql, calls } = makeFakeSql(routed(profileRow()));
    await createProfileReader(sql).getPublicProfileByUsername("cool_kid", "viewer-1");
    expect(calls[0].text).toContain("player_blocks");
    expect(calls[0].text).toContain("LEFT JOIN friendships");
    expect(calls[0].values).toContain("viewer-1");
  });
});

describe("getPublicProfileByUsername — what a viewer gets", () => {
  it("gives a stranger the full profile of a public account", async () => {
    const { sql } = makeFakeSql(
      routed(profileRow({ profile_visibility: "public" }), [
        { slug: "duskfall", last_played: new Date().toISOString() },
      ]),
    );
    const result = await createProfileReader(sql).getPublicProfileByUsername(
      "cool_kid",
      "viewer-1",
    );
    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.visibility).toBe("full");
    const profile = result.profile as FullProfile;
    expect(profile.friendCount).toBe(7);
    expect(profile.recentPlays).toEqual([{ slug: "duskfall", recency: "today" }]);
    expect(profile.stats.gamesPlayed).toBe(6);
    expect(profile.friendship).toBe("none");
    expect(profile.canSendFriendRequest).toBe(true);
  });

  it("gives a stranger the MINIMAL profile of a friends-only account", async () => {
    const { sql, calls } = makeFakeSql(
      routed(profileRow({ profile_visibility: "friends" })),
    );
    const result = await createProfileReader(sql).getPublicProfileByUsername(
      "cool_kid",
      "viewer-1",
    );
    expect(result.found && result.visibility).toBe("minimal");
    // The entitled-only data is never even READ.
    expect(calls).toHaveLength(1);
  });

  it("gives an accepted friend the full profile of a friends-only account", async () => {
    const { sql } = makeFakeSql(
      routed(profileRow({ profile_visibility: "friends", friend_status: "accepted" })),
    );
    const result = await createProfileReader(sql).getPublicProfileByUsername(
      "cool_kid",
      "viewer-1",
    );
    expect(result.found && result.visibility).toBe("full");
    if (!result.found || result.visibility !== "full") return;
    expect(result.profile.friendship).toBe("friends");
    // Already friends, so there is nothing to send.
    expect(result.profile.canSendFriendRequest).toBe(false);
  });

  it("distinguishes an outgoing request from an incoming one", async () => {
    const outgoing = makeFakeSql(
      routed(profileRow({ friend_status: "pending", requested_by_viewer: true })),
    );
    const a = await createProfileReader(
      outgoing.sql,
    ).getPublicProfileByUsername("cool_kid", "viewer-1");
    expect(a.found && a.profile.friendship).toBe("pending-out");

    const incoming = makeFakeSql(
      routed(profileRow({ friend_status: "pending", requested_by_viewer: false })),
    );
    const b = await createProfileReader(
      incoming.sql,
    ).getPublicProfileByUsername("cool_kid", "viewer-1");
    expect(b.found && b.profile.friendship).toBe("pending-in");
    // Either way the add button is gone: there is already a request in flight.
    expect(a.found && a.profile.canSendFriendRequest).toBe(false);
    expect(b.found && b.profile.canSendFriendRequest).toBe(false);
  });

  it("gives the OWNER their own private profile in full", async () => {
    const { sql } = makeFakeSql(
      routed(profileRow({ profile_visibility: "private", is_owner: true })),
    );
    const result = await createProfileReader(sql).getPublicProfileByUsername(
      "cool_kid",
      "google-sub-1234567890",
    );
    expect(result.found && result.visibility).toBe("full");
    if (!result.found || result.visibility !== "full") return;
    expect(result.profile.friendship).toBe("self");
    expect(result.profile.canSendFriendRequest).toBe(false);
    // Locked badges are the owner's own to-do list.
    expect(result.profile.lockedBadges.length).toBeGreaterThan(0);
  });

  it("never shows anyone else what a player has NOT achieved", async () => {
    const { sql } = makeFakeSql(routed(profileRow({ friend_status: "accepted" })));
    const result = await createProfileReader(sql).getPublicProfileByUsername(
      "cool_kid",
      "viewer-1",
    );
    if (!result.found || result.visibility !== "full") throw new Error("expected full");
    expect(result.profile.lockedBadges).toEqual([]);
    expect(result.profile.badges.length).toBeGreaterThan(0);
  });

  it("gives a signed-OUT viewer no button to press", async () => {
    const { sql } = makeFakeSql(routed(profileRow()));
    const result = await createProfileReader(sql).getPublicProfileByUsername(
      "cool_kid",
      null,
    );
    // There is no such thing as an anonymous friend request, so the page shows a
    // sign-in prompt instead — it knows the viewer is absent without being told.
    expect(result.found && result.profile.canSendFriendRequest).toBe(false);
    expect(result.found && result.profile.friendship).toBe("none");
  });
});

describe("getPublicProfileByUsername — a blocked viewer", () => {
  it("sees a profile, not a 404 and not an error", async () => {
    const { sql } = makeFakeSql(
      routed(profileRow({ profile_visibility: "public", is_blocked: true })),
    );
    const result = await createProfileReader(sql).getPublicProfileByUsername(
      "cool_kid",
      "viewer-1",
    );
    // A 404 would advertise the block, because the profile reappears on sign-out.
    expect(result.found).toBe(true);
    expect(result.found && result.visibility).toBe("minimal");
  });

  it("is indistinguishable from a private profile", async () => {
    const blocked = makeFakeSql(
      routed(profileRow({ profile_visibility: "public", is_blocked: true })),
    );
    const priv = makeFakeSql(routed(profileRow({ profile_visibility: "private" })));
    const a = await createProfileReader(blocked.sql).getPublicProfileByUsername(
      "cool_kid",
      "viewer-1",
    );
    const b = await createProfileReader(priv.sql).getPublicProfileByUsername(
      "cool_kid",
      "viewer-1",
    );
    // Same shape, same fields — nothing on the page can tell the two apart, which
    // is what makes the block deniable.
    expect(Object.keys(a.found ? a.profile : {}).sort()).toEqual(
      Object.keys(b.found ? b.profile : {}).sort(),
    );
    expect(a.found && a.profile.canSendFriendRequest).toBe(false);
  });

  it("loses the add-friend button — the block's entire enforcement here", async () => {
    const { sql, calls } = makeFakeSql(
      routed(profileRow({ is_blocked: true, profile_visibility: "public" })),
    );
    const result = await createProfileReader(sql).getPublicProfileByUsername(
      "cool_kid",
      "viewer-1",
    );
    expect(result.found && result.profile.canSendFriendRequest).toBe(false);
    // And nothing about them is read beyond the one row.
    expect(calls).toHaveLength(1);
  });
});

describe("getPublicProfileByUsername — what must never be in the payload", () => {
  let profileKeys: string[] = [];

  beforeEach(async () => {
    const { sql } = makeFakeSql(
      routed(profileRow({ profile_visibility: "public", handle: "Cool Kid" }), [
        { slug: "duskfall", last_played: new Date().toISOString() },
      ]),
    );
    const result = await createProfileReader(sql).getPublicProfileByUsername(
      "cool_kid",
      "viewer-1",
    );
    profileKeys = result.found ? Object.keys(result.profile) : [];
  });

  it("has no email field — the type says so, and so does the value", () => {
    expect(PROFILE_IS_EMAIL_FREE).toBe(true);
    expect(profileKeys).not.toContain("email");
  });

  it("has no `id`, so the Google subject cannot leak through it", () => {
    expect(profileKeys).not.toContain("id");
    expect(profileKeys).toContain("publicId");
  });

  it("has a friend COUNT and no friend list", () => {
    expect(profileKeys).toContain("friendCount");
    expect(profileKeys).not.toContain("friends");
    expect(profileKeys).not.toContain("friendList");
  });

  it("carries no precise timestamp anywhere in the payload", async () => {
    const { sql } = makeFakeSql(
      routed(profileRow({ profile_visibility: "public" }), [
        { slug: "duskfall", last_played: "2026-07-27T09:41:07.123Z" },
      ]),
    );
    const result = await createProfileReader(sql).getPublicProfileByUsername(
      "cool_kid",
      "viewer-1",
    );
    const serialised = JSON.stringify(result);
    // No ISO-8601 instant survives into anything the page can render.
    expect(serialised).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    expect(result.found && result.visibility === "full" && result.profile.lastActive).
      toMatch(/^(today|this-week|this-month|a-while-ago)$/);
  });

  it("never shows the Google name, even when there is no chosen handle", async () => {
    // `players.name` is not selected at all, so there is nothing to fall back to
    // — an account with no handle renders as "@username", never as a real name.
    const { sql } = makeFakeSql(
      routed(profileRow({ handle: null, name: "Real Childname" })),
    );
    const result = await createProfileReader(sql).getPublicProfileByUsername(
      "cool_kid",
      null,
    );
    expect(result.found && result.profile.displayName).toBe("@cool_kid");
    expect(JSON.stringify(result)).not.toContain("Real Childname");
  });

  it("prefers the chosen handle when there is one", async () => {
    const { sql } = makeFakeSql(routed(profileRow({ handle: "Cool Kid" })));
    const result = await createProfileReader(sql).getPublicProfileByUsername(
      "cool_kid",
      null,
    );
    expect(result.found && result.profile.displayName).toBe("Cool Kid");
  });

  it("caps recent plays at the configured few", async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      slug: `game-${i}`,
      last_played: new Date().toISOString(),
    }));
    const { sql, calls } = makeFakeSql(
      routed(profileRow({ profile_visibility: "public" }), many),
    );
    await createProfileReader(sql).getPublicProfileByUsername("cool_kid", null);
    // Matched on the ORDER BY, not the FROM: the profile row's `last_active`
    // subquery reads `player_plays` too.
    const playsCall = calls.find((c) =>
      c.text.includes("ORDER BY pp.last_played DESC"),
    );
    expect(playsCall?.values).toContain(PROFILE_RECENT_PLAYS);
  });
});

describe("getPublicProfileByUsername — failure modes", () => {
  it("degrades a missing column or table to not-found", async () => {
    // A deploy that lands before the migration must render "no such profile", not
    // a 500 on a public page.
    for (const code of ["42703", "42P01"]) {
      const { sql } = makeFakeSql(() => {
        throw Object.assign(new Error("column p.username does not exist"), { code });
      });
      const result = await createProfileReader(sql).getPublicProfileByUsername(
        "cool_kid",
        null,
      );
      expect(result).toEqual({ found: false });
    }
  });

  it("lets a REAL failure through rather than faking an absence", async () => {
    // A Neon outage quietly reporting "no such profile" would tell every viewer
    // that their friend's account is gone.
    const { sql } = makeFakeSql(() => {
      throw Object.assign(new Error("connection terminated"), { code: "08006" });
    });
    await expect(
      createProfileReader(sql).getPublicProfileByUsername("cool_kid", null),
    ).rejects.toThrow(/connection terminated/);
  });
});

describe("getPublicProfileByUsername — admin-granted flair", () => {
  it("carries granted flair on a full profile, decoded to pills", async () => {
    const { sql } = makeFakeSql(
      routed(profileRow({ profile_visibility: "public" }), [], [
        { id: "3", label: "Beta Tester", icon: "🧪", tone: "gold" },
        { id: "4", label: "Founder", icon: null, tone: "brand" },
      ]),
    );
    const result = await createProfileReader(sql).getPublicProfileByUsername(
      "cool_kid",
      "viewer-1",
    );
    if (!result.found || result.visibility !== "full") throw new Error("expected full");
    expect(result.profile.flair).toEqual([
      { id: 3, label: "Beta Tester", icon: "🧪", tone: "gold" },
      { id: 4, label: "Founder", icon: null, tone: "brand" },
    ]);
  });

  it("never fetches flair for a viewer who only gets the minimal profile", async () => {
    const { sql, calls } = makeFakeSql(
      routed(profileRow({ profile_visibility: "friends" })),
    );
    await createProfileReader(sql).getPublicProfileByUsername("cool_kid", "viewer-1");
    // Only the one row lookup runs — no flair query for an unentitled viewer.
    expect(calls).toHaveLength(1);
    expect(calls.some((c) => c.text.includes("FROM player_flair"))).toBe(false);
  });

  it("degrades to no flair when the player_flair table is missing", async () => {
    // The newest table here — a deploy can land before `014_player_flair.sql`
    // runs. That must be an empty pill row, not a 500 on a public profile.
    const responder = routed(profileRow({ profile_visibility: "public" }));
    const { sql } = makeFakeSql((call) => {
      if (call.text.includes("FROM player_flair")) {
        throw Object.assign(new Error("relation player_flair does not exist"), {
          code: "42P01",
        });
      }
      return responder(call);
    });
    const result = await createProfileReader(sql).getPublicProfileByUsername(
      "cool_kid",
      "viewer-1",
    );
    if (!result.found || result.visibility !== "full") throw new Error("expected full");
    expect(result.profile.flair).toEqual([]);
  });
});

describe("the live binding", () => {
  it("is exported as a plain function, callable without a receiver", () => {
    // It delegates to a reader bound to the shared `sql`; nothing here calls it,
    // since that would need a database. This only pins the surface the page uses.
    expect(typeof getPublicProfileByUsername).toBe("function");
    expect(getPublicProfileByUsername.length).toBe(2);
  });
});
