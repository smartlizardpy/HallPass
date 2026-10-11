/**
 * The avatar-privacy SQL against a REAL Postgres: opt-in (see
 * `app/lib/db-test-support.ts`). Needs migration 042 (`use_google_photo`).
 *
 * The rule under test: a player's Google photo (`players.image`, often a real
 * photograph of a child) reaches another player only when the owner opted in
 * (`use_google_photo`) AND the two are accepted friends; the owner always sees
 * their own. Public leaderboards never select it at all.
 *
 *   * scoreboard top scores: no photo, ever, in any period or direction;
 *   * friend lists / friends-playing: photo only for opted-in accepted friends;
 *   * friend standings on a game page: the same, plus pending/strangers absent;
 *   * the profile reader: owner or accepted friend with opt-in, never signed-out;
 *   * challenges (incoming, outgoing, per game): `from_image` / `to_image`.
 */

import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { neon } from "@neondatabase/serverless";
import { dbTestConnection, dbTestEnabled } from "@/app/lib/db-test-support";
import { createSocialStore } from "@/app/lib/social/store";
import { createProfileReader } from "@/app/lib/profile";
import { createStore as createScoreboardStore } from "@/app/lib/scoreboard/store";
import { createChallengeStore } from "@/app/lib/challenges/store";
import { memeAvatarFor } from "@/app/lib/avatars";

// `profile.ts` is `server-only`; the marker is a build-time guard.
vi.mock("server-only", () => ({}));

describe.skipIf(!dbTestEnabled)("avatar privacy against Postgres", () => {
  const sql = neon(dbTestConnection);
  const tag = randomBytes(4).toString("hex");
  const slug = `zz-ap-${tag}`;
  const boardA = `zz-ap-${tag}-a`;
  const boardB = `zz-ap-${tag}-b`;
  const photo = (k: string) => `https://photos.invalid/${tag}/${k}.jpg`;

  // `optIn` is `use_google_photo`; `rel` is the relationship to `me`.
  const spec = {
    me: { optIn: true, rel: "self" },
    friendOn: { optIn: true, rel: "accepted" },
    friendOff: { optIn: false, rel: "accepted" },
    pendingOn: { optIn: true, rel: "pending" },
    strangerOn: { optIn: true, rel: "none" },
  } as const;
  type Key = keyof typeof spec;
  const keys = Object.keys(spec) as Key[];
  const id = (k: Key) => `zz-ap-${tag}-${k}`;
  const pub = {} as Record<Key, string>;
  const username = (k: Key) => `ap${tag}${k.toLowerCase()}`.slice(0, 20);

  const social = createSocialStore(sql);
  const scoreboard = createScoreboardStore(sql);
  const challenges = createChallengeStore(sql);
  const reader = createProfileReader(sql);

  async function relate(a: string, b: string, status: "accepted" | "pending") {
    const [lo, hi] = a < b ? [a, b] : [b, a];
    await sql`INSERT INTO friendships (player_a, player_b, status, requested_by, responded_at)
              VALUES (${lo}, ${hi}, ${status}, ${a}, ${status === "accepted" ? new Date().toISOString() : null})`;
  }

  beforeAll(async () => {
    for (const k of keys) {
      const rows = await sql`
        INSERT INTO players (id, email, name, image, handle, username, use_google_photo)
        VALUES (${id(k)}, ${`${id(k)}@ap-db-test.invalid`}, ${`Real ${k}`}, ${photo(k)}, ${`H${k}`.slice(0, 12)}, ${username(k)}, ${spec[k].optIn})
        RETURNING public_id`;
      pub[k] = String(rows[0].public_id);
      if (spec[k].rel === "accepted" || spec[k].rel === "pending") {
        await relate(id("me"), id(k), spec[k].rel);
      }
    }
    await sql`INSERT INTO boards (id, game_slug, title, sort) VALUES (${boardA}, ${slug}, 'AP A', 'desc'), (${boardB}, ${slug}, 'AP B', 'asc')`;
    for (const [i, k] of keys.entries()) {
      await sql`INSERT INTO scores (board_id, handle, score, player_id) VALUES (${boardA}, ${`snap${k}`.slice(0, 12)}, ${100 + i}, ${id(k)})`;
      await sql`INSERT INTO scores (board_id, handle, score, player_id) VALUES (${boardB}, ${`snap${k}`.slice(0, 12)}, ${100 + i}, ${id(k)})`;
      await sql`INSERT INTO player_plays (player_id, slug, last_played) VALUES (${id(k)}, ${slug}, now())`;
    }
    // One challenge TO `me` from each other player, and one from `me` to each.
    for (const k of keys.filter((x) => x !== "me")) {
      await sql`INSERT INTO challenges (kind, board_id, challenger_id, target_id, target_score) VALUES ('friend', ${boardA}, ${id(k)}, ${id("me")}, 1)`;
      await sql`INSERT INTO challenges (kind, board_id, challenger_id, target_id, target_score) VALUES ('friend', ${boardB}, ${id("me")}, ${id(k)}, 1)`;
    }
  });

  afterAll(async () => {
    const ids = keys.map(id);
    await sql`DELETE FROM challenges WHERE board_id = ANY(${[boardA, boardB]}::text[])`;
    await sql`DELETE FROM boards WHERE id = ANY(${[boardA, boardB]}::text[])`;
    await sql`DELETE FROM player_plays WHERE slug = ${slug}`;
    await sql`DELETE FROM players WHERE id = ANY(${ids}::text[])`;
  });

  const pubKey = (p: string): Key => keys.find((k) => pub[k] === p)!;

  it("scoreboard top scores never carry a Google photo, for any period or direction", async () => {
    for (const board of [boardA, boardB]) {
      for (const period of ["all", "day", "week"] as const) {
        for (const sort of ["asc", "desc"] as const) {
          const top = await scoreboard.getTopScores(board, { limit: 20, period, sort });
          const ours = top.filter((t) => t.playerId && keys.some((k) => pub[k] === t.playerId));
          expect(ours.length).toBeGreaterThan(0);
          expect(JSON.stringify(top)).not.toContain("photos.invalid");
          for (const entry of ours) expect(entry.avatar).toBe(memeAvatarFor(entry.playerId!));
          // Nor the account name, nor the stored snapshot, for a verified row.
          expect(JSON.stringify(ours)).not.toMatch(/Real |snap/);
        }
      }
    }
  });

  it("the friend list shows the photo only for opted-in accepted friends", async () => {
    const friends = await social.listFriends(id("me"));
    expect(friends.map((f) => f.id).sort()).toEqual([pub.friendOn, pub.friendOff].sort());
    expect(friends.find((f) => f.id === pub.friendOn)!.image).toBe(photo("friendOn"));
    expect(friends.find((f) => f.id === pub.friendOff)!.image).toBeNull();
  });

  it("requests and search never carry a photo", async () => {
    const strangerView = await social.listIncomingRequests(id("pendingOn"));
    expect(strangerView.map((r) => r.id)).toEqual([pub.me]);
    expect(strangerView[0].image).toBeNull();
    expect((await social.listOutgoingRequests(id("me"))).every((r) => r.image === null)).toBe(true);
    const found = await social.searchPlayers(id("me"), `ap${tag}`);
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((r) => r.image === null)).toBe(true);
  });

  it("friends-playing carries the photo only for opted-in accepted friends", async () => {
    const playing = await social.friendsPlaying(id("me"), [slug]);
    expect(playing.map((p) => p.friend.id).sort()).toEqual([pub.friendOn, pub.friendOff].sort());
    expect(playing.find((p) => p.friend.id === pub.friendOn)!.friend.image).toBe(photo("friendOn"));
    expect(playing.find((p) => p.friend.id === pub.friendOff)!.friend.image).toBeNull();
  });

  it("friend standings include only me and accepted friends, with the photo rule applied", async () => {
    const standings = await scoreboard.getFriendStandingsForGame(id("me"), slug);
    const players = new Set(standings.map((s) => pubKey(s.player.id)));
    expect(players).toEqual(new Set<Key>(["me", "friendOn", "friendOff"]));
    for (const s of standings) {
      const k = pubKey(s.player.id);
      expect(s.player.image).toBe(k === "friendOff" ? null : photo(k));
    }
    // A stranger asking sees their own photo and no one else's.
    const strangerView = await scoreboard.getFriendStandingsForGame(id("strangerOn"), slug);
    expect(strangerView.map((s) => pubKey(s.player.id))).toEqual(["strangerOn", "strangerOn"]);
    expect(strangerView.every((s) => s.player.image === photo("strangerOn"))).toBe(true);
  });

  it("the profile gives the photo to the owner and to an accepted friend with opt-in only", async () => {
    const seen = async (target: Key, viewer: Key | null) => {
      const res = await reader.getPublicProfileByUsername(username(target), viewer ? id(viewer) : null);
      expect(res.found).toBe(true);
      if (!res.found) throw new Error("unreachable");
      return res.profile.image;
    };
    expect(await seen("me", "me")).toBe(photo("me")); // owner
    expect(await seen("friendOn", "me")).toBe(photo("friendOn")); // accepted + opt-in
    expect(await seen("friendOff", "me")).toBeNull(); // accepted, no opt-in
    expect(await seen("pendingOn", "me")).toBeNull(); // pending is not a friend
    expect(await seen("strangerOn", "me")).toBeNull();
    expect(await seen("me", "friendOn")).toBe(photo("me")); // the reverse direction
    expect(await seen("me", "strangerOn")).toBeNull();
    expect(await seen("friendOn", null)).toBeNull(); // signed out
  });

  it("challenges carry the other party's photo only for opted-in accepted friends", async () => {
    const incoming = await challenges.listIncoming(id("me"));
    const byFrom = Object.fromEntries(incoming.filter((c) => c.boardId === boardA).map((c) => [pubKey(c.from.id), c.from.image]));
    expect(byFrom).toEqual({ friendOn: photo("friendOn"), friendOff: null, pendingOn: null, strangerOn: null });

    const outgoing = await challenges.listOutgoing(id("me"));
    const byTo = Object.fromEntries(outgoing.filter((c) => c.boardId === boardB).map((c) => [pubKey(c.to.id), c.to.image]));
    expect(byTo).toEqual({ friendOn: photo("friendOn"), friendOff: null, pendingOn: null, strangerOn: null });

    const forGame = await challenges.listForGame(id("me"), slug);
    const byGame = Object.fromEntries(forGame.map((c) => [pubKey(c.from.id), c.from.image]));
    expect(byGame).toEqual({ friendOn: photo("friendOn"), friendOff: null, pendingOn: null, strangerOn: null });

    // From the stranger's side, `me` (opted in, but not their friend) is hidden.
    const strangerInbox = await challenges.listIncoming(id("strangerOn"));
    expect(strangerInbox.find((c) => c.boardId === boardB)?.from.image).toBeNull();
  });
});
