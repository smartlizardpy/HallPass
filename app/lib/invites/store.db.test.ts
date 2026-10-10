/**
 * The invites store's SQL against a REAL Postgres — opt-in, because it needs a
 * database with migration 041 applied. The fake-`sql` tests in store.test.ts
 * check statement shape; this one checks the statements actually run and mean
 * what they say: the unnest/ordinality join, both friendship directions, blocks
 * either way, the cooldown, the all-or-nothing hourly limit, the staged-viewer
 * rule, garbage collection and the table's CHECKs.
 *
 *   INVITES_DB_TEST=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run app/lib/invites/store.db.test.ts
 *
 * Refuses to run when DATABASE_URL is the same endpoint as PROD_DATABASE_URL.
 * It creates throwaway players (ids and emails under a random tag) and deletes
 * them — and with them, by cascade, every friendship, beta row and invite — in
 * `afterAll`.
 */

import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { neon } from "@neondatabase/serverless";
import { createInviteStore } from "./store";
import { generateInviteCode } from "./code";
import { FRIEND_INVITE_RATE_LIMIT } from "./config";

const url = process.env.DATABASE_URL ?? "";
const endpoint = (u: string) => {
  try {
    return new URL(u).hostname.split(".")[0].replace(/-pooler$/, "");
  } catch {
    return "";
  }
};
const isProd = !!process.env.PROD_DATABASE_URL && endpoint(url) === endpoint(process.env.PROD_DATABASE_URL);
const enabled = process.env.INVITES_DB_TEST === "1" && !!url && !isProd;

describe.skipIf(!enabled)("invites store against Postgres", () => {
  // The describe body runs even when skipped; never hand neon() an empty URL.
  const sql = neon(enabled ? url : "postgres://skipped@localhost/skipped");
  const store = createInviteStore(sql);
  const tag = randomBytes(4).toString("hex");
  const slug = `invites-db-test-${tag}`;
  const guestKey = `invites-db-test-${tag}`;

  /** Throwaway players. `pub` is filled in from the database. */
  const people = {
    sender: { id: `zz-inv-${tag}-a-sender`, handle: "Sendy", username: null as string | null },
    friend: { id: `zz-inv-${tag}-b-friend`, handle: null, username: `inv${tag}f` },
    tester: { id: `zz-inv-${tag}-c-tester`, handle: "Testy", username: null },
    pending: { id: `zz-inv-${tag}-d-pending`, handle: "Pend", username: null },
    blocker: { id: `zz-inv-${tag}-e-blocker`, handle: "Blocky", username: null },
    blocked: { id: `zz-inv-${tag}-0-blocked`, handle: "Blocked", username: null },
    stranger: { id: `zz-inv-${tag}-f-stranger`, handle: "Strange", username: null },
  };
  type Key = keyof typeof people;
  const pub: Record<Key, string> = {} as Record<Key, string>;
  const email = (k: Key) => `${people[k].id}@invites-db-test.invalid`;

  /** Store the pair the way `friendships_ordered_chk` demands (byte order). */
  async function befriend(a: string, b: string, status: "pending" | "accepted") {
    const [lo, hi] = a < b ? [a, b] : [b, a];
    await sql`
      INSERT INTO friendships (player_a, player_b, status, requested_by, responded_at)
      VALUES (${lo}, ${hi}, ${status}, ${a}, ${status === "accepted" ? new Date().toISOString() : null})
    `;
  }

  const base = { senderId: people.sender.id, json: '{"room":"ABCD"}', ttlSeconds: 1800, adminEmails: [] as string[] };
  const codesFor = (n: number) => Array.from({ length: n }, generateInviteCode);

  beforeAll(async () => {
    for (const key of Object.keys(people) as Key[]) {
      const p = people[key];
      const rows = await sql`
        INSERT INTO players (id, email, handle, username)
        VALUES (${p.id}, ${email(key)}, ${p.handle}, ${p.username})
        RETURNING public_id
      `;
      pub[key] = String(rows[0].public_id);
    }
    await befriend(people.sender.id, people.friend.id, "accepted");
    await befriend(people.sender.id, people.tester.id, "accepted");
    await befriend(people.sender.id, people.pending.id, "pending");
    await befriend(people.sender.id, people.blocker.id, "accepted");
    await befriend(people.sender.id, people.blocked.id, "accepted");
    // A block deletes the friendship in the app; keep the row here to prove the
    // block is checked on its own, in both directions.
    await sql`INSERT INTO player_blocks (blocker_id, blocked_id) VALUES (${people.blocker.id}, ${people.sender.id})`;
    await sql`INSERT INTO player_blocks (blocker_id, blocked_id) VALUES (${people.sender.id}, ${people.blocked.id})`;
    await sql`INSERT INTO beta_testers (player_id) VALUES (${people.tester.id})`;
  });

  afterAll(async () => {
    const ids = Object.values(people).map((p) => p.id);
    await sql`DELETE FROM game_invites WHERE sender_key = ${guestKey} OR slug LIKE ${`${slug}%`}`;
    await sql`DELETE FROM player_blocks WHERE blocker_id = ANY(${ids}::text[]) OR blocked_id = ANY(${ids}::text[])`;
    await sql`DELETE FROM players WHERE id = ANY(${ids}::text[])`;
  });

  it("lists accepted, unblocked friends — and only staged viewers for a staged game", async () => {
    const all = await store.listInvitableFriends({ me: people.sender.id, slug, stagedOnly: false, adminEmails: [] });
    expect(all.map((f) => f.id).sort()).toEqual([pub.friend, pub.tester].sort());
    expect(all.find((f) => f.id === pub.friend)).toMatchObject({ displayName: `@${people.friend.username}`, invitedRecently: false });

    const staged = await store.listInvitableFriends({ me: people.sender.id, slug, stagedOnly: true, adminEmails: [] });
    expect(staged.map((f) => f.id)).toEqual([pub.tester]);

    const withAdmin = await store.listInvitableFriends({
      me: people.sender.id,
      slug,
      stagedOnly: true,
      adminEmails: [email("friend")],
    });
    expect(withAdmin.map((f) => f.id).sort()).toEqual([pub.friend, pub.tester].sort());
  });

  it("invites only eligible friends, in one statement, and names the sender publicly", async () => {
    const targets = [pub.friend, pub.tester, pub.pending, pub.blocker, pub.blocked, pub.stranger, pub.sender, randomUUID()];
    const outcome = await store.createFriendInvites({
      ...base,
      slug,
      toPublicIds: targets,
      codes: codesFor(targets.length),
      stagedOnly: false,
    });
    expect(outcome.eligible).toBe(2);
    expect(outcome.rateLimited).toBe(false);
    expect(outcome.fromDisplayName).toBe("Sendy");
    expect(outcome.sent.map((s) => s.toId).sort()).toEqual([people.friend.id, people.tester.id].sort());

    const invite = await store.getByCode(outcome.sent[0].code);
    expect(invite).toMatchObject({ slug, kind: "friend", data: { room: "ABCD" }, from: "Sendy", expired: false });
    const minutes = (Date.parse(invite!.expiresAt) - Date.now()) / 60000;
    expect(minutes).toBeGreaterThan(28);
    expect(minutes).toBeLessThanOrEqual(30.5);
    expect(invite!.secondsLeft).toBeGreaterThan(28 * 60);
    expect(invite!.secondsLeft).toBeLessThanOrEqual(30 * 60);
  });

  it("skips a friend already invited to this game inside the cooldown", async () => {
    const again = await store.createFriendInvites({
      ...base,
      slug,
      toPublicIds: [pub.friend],
      codes: codesFor(1),
      stagedOnly: false,
    });
    expect(again).toMatchObject({ sent: [], eligible: 0, rateLimited: false });
    const list = await store.listInvitableFriends({ me: people.sender.id, slug, stagedOnly: false, adminEmails: [] });
    expect(list.find((f) => f.id === pub.friend)?.invitedRecently).toBe(true);
  });

  it("filters recipients who cannot see a staged game", async () => {
    const outcome = await store.createFriendInvites({
      ...base,
      slug: `${slug}-staged`,
      toPublicIds: [pub.friend, pub.tester],
      codes: codesFor(2),
      stagedOnly: true,
    });
    expect(outcome.sent.map((s) => s.toId)).toEqual([people.tester.id]);
  });

  it("refuses a whole batch that would cross the hourly limit", async () => {
    // Fill the sender's hour up to exactly the limit with throwaway rows.
    const sentSoFar = await sql`
      SELECT count(*)::int AS n FROM game_invites WHERE from_player = ${people.sender.id} AND kind = 'friend'
    `;
    const fill = FRIEND_INVITE_RATE_LIMIT.maxPerWindow - Number(sentSoFar[0].n);
    expect(fill).toBeGreaterThan(0);
    for (let i = 0; i < fill; i += 1) {
      await sql`
        INSERT INTO game_invites (code, slug, kind, data, from_player, to_player, expires_at)
        VALUES (${generateInviteCode()}, ${`${slug}-fill`}, 'friend', '{}'::jsonb,
                ${people.sender.id}, ${people.friend.id}, now() + interval '5 minutes')
      `;
    }
    const outcome = await store.createFriendInvites({
      ...base,
      slug: `${slug}-limit`,
      toPublicIds: [pub.friend, pub.tester],
      codes: codesFor(2),
      stagedOnly: false,
    });
    expect(outcome).toMatchObject({ sent: [], eligible: 2, rateLimited: true });
    const rows = await sql`SELECT count(*)::int AS n FROM game_invites WHERE slug = ${`${slug}-limit`}`;
    expect(rows[0].n).toBe(0);
  });

  it("makes guest links up to the limit, with no sender name", async () => {
    const limit = { maxPerWindow: 2, windowSeconds: 3600 };
    const link = (code: string) =>
      store.createLink({ senderId: null, senderKey: guestKey, slug, json: "{}", code, ttlSeconds: 600, limit });
    const first = await link(generateInviteCode());
    expect(first).toEqual({ code: expect.any(String), rateLimited: false });
    expect((await link(generateInviteCode())).rateLimited).toBe(false);
    expect(await link(generateInviteCode())).toEqual({ code: null, rateLimited: true });

    const invite = await store.getByCode(first.code!);
    expect(invite).toMatchObject({ kind: "link", from: null, data: {}, expired: false });
  });

  it("counts a signed-in player's links by player, not by guest key", async () => {
    const limit = { maxPerWindow: 1, windowSeconds: 3600 };
    const mine = await store.createLink({
      senderId: people.sender.id, senderKey: null, slug, json: '{"room":"WXYZ"}', code: generateInviteCode(), ttlSeconds: 600, limit,
    });
    expect(mine.rateLimited).toBe(false);
    expect((await store.getByCode(mine.code!))?.from).toBe("Sendy");
    const second = await store.createLink({
      senderId: people.sender.id, senderKey: null, slug, json: "{}", code: generateInviteCode(), ttlSeconds: 600, limit,
    });
    expect(second).toEqual({ code: null, rateLimited: true });
  });

  it("reports an expired invite as expired, and collects it after the grace", async () => {
    const recent = generateInviteCode();
    const old = generateInviteCode();
    await sql`
      INSERT INTO game_invites (code, slug, kind, data, sender_key, created_at, expires_at)
      VALUES (${recent}, ${slug}, 'link', '{}'::jsonb, ${guestKey}, now() - interval '31 minutes', now() - interval '1 minute'),
             (${old},    ${slug}, 'link', '{}'::jsonb, ${guestKey}, now() - interval '3 hours',    now() - interval '2 hours')
    `;
    expect(await store.getByCode(recent)).toMatchObject({ expired: true, secondsLeft: 0 });
    expect((await store.getByCode(old))?.expired).toBe(true);
    // Any write collects.
    await store.createLink({
      senderId: people.sender.id, senderKey: null, slug, json: "{}", code: generateInviteCode(), ttlSeconds: 600,
      limit: { maxPerWindow: 100, windowSeconds: 3600 },
    });
    expect(await store.getByCode(old)).toBeNull();
    expect((await store.getByCode(recent))?.expired).toBe(true);
  });

  it("enforces the table's own rules", async () => {
    const bad = [
      sql`INSERT INTO game_invites (code, slug, kind, data, sender_key, expires_at) VALUES ('short', ${slug}, 'link', '{}', ${guestKey}, now() + interval '1 minute')`,
      sql`INSERT INTO game_invites (code, slug, kind, data, sender_key, expires_at) VALUES (${generateInviteCode()}, ${slug}, 'link', '[1]', ${guestKey}, now() + interval '1 minute')`,
      sql`INSERT INTO game_invites (code, slug, kind, data, expires_at) VALUES (${generateInviteCode()}, ${slug}, 'link', '{}', now() + interval '1 minute')`,
      sql`INSERT INTO game_invites (code, slug, kind, data, from_player, expires_at) VALUES (${generateInviteCode()}, ${slug}, 'friend', '{}', ${people.sender.id}, now() + interval '1 minute')`,
      sql`INSERT INTO game_invites (code, slug, kind, data, sender_key, expires_at) VALUES (${generateInviteCode()}, ${slug}, 'link', '{}', ${guestKey}, now() - interval '1 minute')`,
      sql`INSERT INTO game_invites (code, slug, kind, data, sender_key, expires_at) VALUES (${generateInviteCode()}, 'Bad Slug', 'link', '{}', ${guestKey}, now() + interval '1 minute')`,
    ];
    for (const attempt of bad) await expect(attempt).rejects.toThrow();
  });
});
