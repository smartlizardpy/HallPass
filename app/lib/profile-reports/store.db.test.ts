/**
 * The profile-reports store's SQL against a REAL Postgres: opt-in, because it
 * needs a database with migration 043 applied. The fake-`sql` tests in
 * store.test.ts check statement shape; this checks the statements run and mean
 * what they say (see `app/lib/db-test-support.ts` for how to run it and for the
 * production guard).
 *
 * Covers: insert, the duplicate-open partial unique index, re-report after
 * resolution, self-report, both rate limits (duplicates do not count), the
 * queue, resolve, the one-statement account action, retention deletion, both
 * ON DELETE rules, and what a player with no username looks like to the rest of
 * the app afterwards.
 */

import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { neon } from "@neondatabase/serverless";
import { createProfileReportStore } from "./store";
import { REPORT_DAILY_LIMIT, REPORT_HOURLY_LIMIT } from "./config";
import { dbTestConnection, dbTestEnabled } from "@/app/lib/db-test-support";
import { createSocialStore } from "@/app/lib/social/store";
import { createProfileReader } from "@/app/lib/profile";
import { createStore as createScoreboardStore } from "@/app/lib/scoreboard/store";
import { createChallengeStore } from "@/app/lib/challenges/store";
import { createInviteStore } from "@/app/lib/invites/store";
import { generateInviteCode } from "@/app/lib/invites/code";
import { placeholderName } from "@/app/lib/scoreboard/display-name";

// `profile.ts` (the /u/<username> reader) is `server-only`; the marker is a
// build-time guard, irrelevant here.
vi.mock("server-only", () => ({}));

describe.skipIf(!dbTestEnabled)("profile reports against Postgres", () => {
  // The describe body runs even when skipped; never hand neon() an empty URL.
  const sql = neon(dbTestConnection);
  const store = createProfileReportStore(sql);
  const tag = randomBytes(4).toString("hex");
  const board = `pr-db-test-${tag}`;

  const people = {
    reporterA: { id: `zz-pr-${tag}-a`, handle: "Rae", username: null as string | null },
    reporterB: { id: `zz-pr-${tag}-b`, handle: "Bee", username: null },
    target: { id: `zz-pr-${tag}-t`, handle: "Targ", username: `prt${tag}` },
    other: { id: `zz-pr-${tag}-o`, handle: "Oth", username: null },
    friend: { id: `zz-pr-${tag}-f`, handle: "Fren", username: `prf${tag}` },
    limiter: { id: `zz-pr-${tag}-l`, handle: "Lim", username: null },
    gone: { id: `zz-pr-${tag}-g`, handle: "Gone", username: null },
    reporterGone: { id: `zz-pr-${tag}-r`, handle: "Rg", username: null },
    victim: { id: `zz-pr-${tag}-v`, handle: "Vic", username: null },
  };
  type Key = keyof typeof people;
  const pub = {} as Record<Key, string>;
  const email = (k: Key) => `${people[k].id}@pr-db-test.invalid`;
  const fillers: string[] = [];

  const report = (
    reporter: Key,
    reported: Key,
    reason: "bullying" | "other" = "bullying",
    note: string | null = null,
  ) =>
    store.create({ reporterId: people[reporter].id, reportedPublicId: pub[reported], reason, note });
  const row = async (id: string) =>
    (await sql`SELECT handle, username, use_google_photo FROM players WHERE id = ${id}`)[0];
  const reportsAgainst = (reported: string) =>
    sql`SELECT id, status, resolved_at, resolved_by, reporter_id FROM profile_reports
         WHERE reported_id = ${reported} ORDER BY id`;
  const reportsBy = (reporter: string, reported: string) =>
    sql`SELECT id, status, resolved_at, resolved_by, reporter_id FROM profile_reports
         WHERE reported_id = ${reported} AND reporter_id = ${reporter} ORDER BY id`;
  const befriend = async (a: string, b: string) => {
    const [lo, hi] = a < b ? [a, b] : [b, a];
    await sql`INSERT INTO friendships (player_a, player_b, status, requested_by, responded_at)
              VALUES (${lo}, ${hi}, 'accepted', ${a}, now())`;
  };

  beforeAll(async () => {
    for (const key of Object.keys(people) as Key[]) {
      const p = people[key];
      const rows = await sql`
        INSERT INTO players (id, email, handle, username, image, use_google_photo)
        VALUES (${p.id}, ${email(key)}, ${p.handle}, ${p.username}, ${`https://img.invalid/${p.id}`}, true)
        RETURNING public_id`;
      pub[key] = String(rows[0].public_id);
    }
    // One extra target per rate-limit slot, plus one to be refused.
    for (let i = 0; i < REPORT_HOURLY_LIMIT.maxPerWindow + 1; i += 1) {
      const id = `zz-pr-${tag}-fill${i}`;
      await sql`INSERT INTO players (id, email) VALUES (${id}, ${`${id}@pr-db-test.invalid`})`;
      fillers.push(id);
    }
    await sql`INSERT INTO boards (id, game_slug, title) VALUES (${board}, ${board}, 'PR db test')`;
  });

  afterAll(async () => {
    const ids = [...Object.values(people).map((p) => p.id), ...fillers];
    const names = [people.target.username, people.friend.username, `pr_${tag}n`].filter(
      (n): n is string => !!n,
    );
    await sql`DELETE FROM boards WHERE id = ${board}`;
    await sql`DELETE FROM game_invites WHERE from_player = ANY(${ids}::text[]) OR to_player = ANY(${ids}::text[])`;
    await sql`DELETE FROM profile_reports WHERE reported_id = ANY(${ids}::text[]) OR reporter_id = ANY(${ids}::text[])`;
    await sql`DELETE FROM username_history WHERE username = ANY(${names}::text[])`;
    await sql`DELETE FROM players WHERE id = ANY(${ids}::text[])`;
  });

  it("files a report, then treats a second open one from the same player as a duplicate", async () => {
    expect(await report("reporterA", "target", "bullying", "mean")).toEqual({ result: "created" });
    expect(await report("reporterA", "target", "other")).toEqual({ result: "duplicate" });
    const rows = await reportsBy(people.reporterA.id, people.target.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("open");
    // The partial unique index is what makes the duplicate a no-op.
    await expect(
      sql`INSERT INTO profile_reports (reporter_id, reported_id, reason) VALUES (${people.reporterA.id}, ${people.target.id}, 'other')`,
    ).rejects.toThrow();
  });

  it("refuses self-reports and unknown players, and the table's own CHECKs hold", async () => {
    expect(await report("reporterA", "reporterA")).toEqual({ result: "self" });
    expect(
      await store.create({
        reporterId: people.reporterA.id,
        reportedPublicId: "00000000-0000-4000-8000-00000000dead",
        reason: "other",
        note: null,
      }),
    ).toEqual({ result: "unknown" });
    await expect(
      sql`INSERT INTO profile_reports (reporter_id, reported_id, reason) VALUES (${people.reporterA.id}, ${people.reporterA.id}, 'other')`,
    ).rejects.toThrow();
    await expect(
      sql`INSERT INTO profile_reports (reporter_id, reported_id, reason) VALUES (${people.reporterA.id}, ${people.other.id}, 'hate')`,
    ).rejects.toThrow();
  });

  it("lists the queue newest first with the open count per player and no reporter", async () => {
    expect(await report("reporterB", "target", "other")).toEqual({ result: "created" });
    expect(await report("reporterB", "other", "bullying")).toEqual({ result: "created" });
    const queue = await store.queue({ limit: 200 });
    const mine = queue.filter((q) => [pub.target, pub.other].includes(q.reported.publicId));
    expect(mine).toHaveLength(3);
    expect(mine[0].reported.publicId).toBe(pub.other); // newest first
    const forTarget = mine.filter((q) => q.reported.publicId === pub.target);
    expect(forTarget.every((q) => q.openAgainstPlayer === 2)).toBe(true);
    expect(forTarget[0].reported.displayName).toBe("Targ");
    expect(JSON.stringify(mine)).not.toMatch(/reporter|zz-pr-|invalid/);
    expect(await store.openCount()).toBeGreaterThanOrEqual(3);
  });

  it("resolves one open report once, and lets the same player re-report afterwards", async () => {
    const [mine] = await reportsBy(people.reporterB.id, people.other.id);
    const id = Number(mine.id);
    expect(await store.resolve({ id, status: "dismissed", actorEmail: "admin@x.test" })).toEqual({ found: true, changed: true });
    expect(await store.resolve({ id, status: "actioned", actorEmail: "admin@x.test" })).toEqual({ found: true, changed: false });
    expect(await store.resolve({ id: 2_000_000_000, status: "actioned", actorEmail: "a" })).toEqual({ found: false, changed: false });
    const [after] = await reportsBy(people.reporterB.id, people.other.id);
    expect(after).toMatchObject({ status: "dismissed", resolved_by: "admin@x.test" });
    expect(after.resolved_at).not.toBeNull();
    // The partial index only covers open rows, so a new report is allowed.
    expect(await report("reporterB", "other")).toEqual({ result: "created" });
    expect(await reportsBy(people.reporterB.id, people.other.id)).toHaveLength(2);
  });

  it("applies the hourly limit, and duplicates do not count towards it", async () => {
    const pubOf = async (id: string) =>
      String((await sql`SELECT public_id FROM players WHERE id = ${id}`)[0].public_id);
    const create = async (i: number) =>
      store.create({ reporterId: people.limiter.id, reportedPublicId: await pubOf(fillers[i]), reason: "other", note: null });
    const max = REPORT_HOURLY_LIMIT.maxPerWindow;
    for (let i = 0; i < max - 1; i += 1) expect(await create(i)).toEqual({ result: "created" });
    // Repeating an open pair writes nothing and is not counted.
    for (let n = 0; n < 3; n += 1) expect(await create(0)).toEqual({ result: "duplicate" });
    const count = await sql`SELECT count(*)::int AS n FROM profile_reports WHERE reporter_id = ${people.limiter.id}`;
    expect(count[0].n).toBe(max - 1);
    // So the last allowed report still goes through, and the next is refused.
    expect(await create(max - 1)).toEqual({ result: "created" });
    expect(await create(max)).toEqual({ result: "rate-limited" });
    const after = await sql`SELECT count(*)::int AS n FROM profile_reports WHERE reporter_id = ${people.limiter.id}`;
    expect(after[0].n).toBe(max);
  });

  it("applies the daily limit to reports older than the hour window", async () => {
    // Resolved reports made two hours ago: outside the hourly window, inside the daily one.
    for (let i = 0; i < REPORT_DAILY_LIMIT.maxPerWindow; i += 1) {
      await sql`INSERT INTO profile_reports (reporter_id, reported_id, reason, status, created_at, resolved_at)
                VALUES (${people.victim.id}, ${people.friend.id}, 'other', 'dismissed', now() - interval '2 hours', now() - interval '2 hours')`;
    }
    expect(await report("victim", "other")).toEqual({ result: "rate-limited" });
    expect(await reportsBy(people.victim.id, people.other.id)).toHaveLength(0);
    await sql`DELETE FROM profile_reports WHERE reporter_id = ${people.victim.id}`;
    expect(await report("victim", "other")).toEqual({ result: "created" });
  });

  it("the account action clears the identity, tombstones the username and closes every open report", async () => {
    // Two open reports (reporters A and B) already exist against `target`.
    await befriend(people.target.id, people.friend.id);
    const first = Number((await reportsAgainst(people.target.id))[0].id);
    expect(await row(people.target.id)).toMatchObject({
      handle: "Targ",
      username: people.target.username,
      use_google_photo: true,
    });

    const out = await store.actionAccount({ id: first, actorEmail: "admin@x.test" });
    expect(out).toEqual({ found: true, changed: true, reportsClosed: 2, publicId: pub.target });

    expect(await row(people.target.id)).toMatchObject({ handle: null, username: null, use_google_photo: false });
    const closed = await reportsAgainst(people.target.id);
    expect(closed.map((r) => r.status)).toEqual(["actioned", "actioned"]);
    expect(closed.every((r) => r.resolved_at && r.resolved_by === "admin@x.test")).toBe(true);
    const tomb = await sql`SELECT player_id FROM username_history WHERE username = ${people.target.username}`;
    expect(tomb).toHaveLength(1);
    expect(tomb[0].player_id).toBeNull();

    // A second click (stale queue) touches nothing, so it cannot reset a profile
    // the player has since rebuilt.
    await sql`UPDATE players SET handle = 'Rebuilt' WHERE id = ${people.target.id}`;
    expect(await store.actionAccount({ id: first, actorEmail: "admin@x.test" })).toMatchObject({ found: true, changed: false });
    expect((await row(people.target.id)).handle).toBe("Rebuilt");
    expect(await store.actionAccount({ id: 2_000_000_000, actorEmail: "a" })).toMatchObject({ found: false, changed: false });
    await sql`UPDATE players SET handle = NULL WHERE id = ${people.target.id}`;
  });

  it("afterwards the nameless player breaks nothing, and can choose a new name", async () => {
    const social = createSocialStore(sql);

    // /u/<old-username> no longer resolves; a friend who still has one does.
    const reader = createProfileReader(sql);
    expect(await reader.getPublicProfileByUsername(`prt${tag}`, null)).toEqual({ found: false });
    expect(await reader.getPublicProfileByUsername(`prt${tag}`, people.friend.id)).toEqual({ found: false });
    expect(await reader.getPublicProfileByUsername(`prf${tag}`, people.target.id)).toMatchObject({ found: true });

    // The friendship row survives and renders the generic fallback, no photo.
    const friends = await social.listFriends(people.friend.id);
    const them = friends.find((f) => f.id === pub.target);
    expect(them).toBeDefined();
    expect(them!.username).toBeNull();
    expect(them!.displayName).toBe("Player");
    expect(them!.image).toBeNull();

    // Leaderboard rows show the generated name, not the stored snapshot.
    await sql`INSERT INTO scores (board_id, handle, score, player_id) VALUES (${board}, 'OldSnapshotName', 99, ${people.target.id})`;
    const top = await createScoreboardStore(sql).getTopScores(board, { limit: 5, period: "all", sort: "desc" });
    expect(top[0].handle).toBe(placeholderName(pub.target));

    // A challenge from the nameless player reads as "Player", no crash.
    await sql`INSERT INTO challenges (kind, board_id, challenger_id, target_id, target_score)
              VALUES ('friend', ${board}, ${people.target.id}, ${people.friend.id}, 99)`;
    const incoming = await createChallengeStore(sql).listIncoming(people.friend.id);
    expect(incoming.find((c) => c.boardId === board)?.from).toMatchObject({
      username: null,
      displayName: "Player",
      image: null,
    });

    // An invite from them still goes out.
    const made = await createInviteStore(sql).createFriendInvites({
      senderId: people.target.id,
      slug: board,
      json: "{}",
      ttlSeconds: 600,
      adminEmails: [],
      toPublicIds: [pub.friend],
      codes: [generateInviteCode()],
      stagedOnly: false,
    });
    expect(made.sent).toHaveLength(1);

    // A new name can be claimed straight away (no cooldown or play requirement
    // while username is NULL), but the moderated one is held back for everyone,
    // including its previous owner.
    expect(await social.claimUsername(people.target.id, people.target.username!)).toMatchObject({
      claimed: false,
      tombstoned: true,
    });
    expect((await social.claimUsername(people.target.id, `pr_${tag}n`)).claimed).toBe(true);
    expect((await row(people.target.id)).username).toBe(`pr_${tag}n`);
  });

  it("retention deletes resolved reports 90 days after resolution and never an open one", async () => {
    const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
    const add = (status: string, resolvedAt: string | null, reporter: string) =>
      sql`INSERT INTO profile_reports (reporter_id, reported_id, reason, status, resolved_at)
          VALUES (${reporter}, ${people.gone.id}, 'other', ${status}, ${resolvedAt}::timestamptz)`;
    await add("dismissed", ago(91), people.reporterA.id);
    await add("actioned", ago(120), people.reporterB.id);
    await add("dismissed", ago(89), people.other.id);
    await add("open", null, people.friend.id);
    // Filed long ago but still open: kept until it is resolved.
    await sql`UPDATE profile_reports SET created_at = now() - interval '400 days'
               WHERE reported_id = ${people.gone.id} AND status = 'open'`;

    expect(await store.countPurgeable(90)).toBeGreaterThanOrEqual(2);
    const { deleted } = await store.purgeResolved(90);
    expect(deleted).toBeGreaterThanOrEqual(2);
    const left = await sql`SELECT status FROM profile_reports WHERE reported_id = ${people.gone.id} ORDER BY id`;
    expect(left.map((r) => r.status)).toEqual(["dismissed", "open"]);
    expect((await store.purgeResolved(90)).deleted).toBe(0); // idempotent
  });

  it("ON DELETE: a deleted reporter leaves the report with a NULL reporter; a deleted reported player takes it", async () => {
    await sql`DELETE FROM profile_reports WHERE reported_id = ${people.gone.id}`;
    expect(await report("reporterGone", "gone")).toEqual({ result: "created" });
    await sql`DELETE FROM players WHERE id = ${people.reporterGone.id}`;
    const kept = await reportsAgainst(people.gone.id);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ reporter_id: null, status: "open" });
    // Still in the queue, with the NULL reporter tripping nothing.
    const queue = await store.queue({ limit: 200 });
    expect(queue.some((q) => q.reported.publicId === pub.gone)).toBe(true);

    await sql`DELETE FROM players WHERE id = ${people.gone.id}`;
    expect(await reportsAgainst(people.gone.id)).toHaveLength(0);
  });
});
