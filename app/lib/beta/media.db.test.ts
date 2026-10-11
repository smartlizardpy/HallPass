/**
 * Beta clip/screenshot retention against a REAL Postgres: opt-in, needs
 * migrations through 044 (see `app/lib/db-test-support.ts` for how to run it and
 * for the production guard).
 *
 * Covers the store's media queries (`expiredMedia`, `markMediaExpired`,
 * `mediaOwnedBy`, `deleteShots` with its `= ANY($array)`), the sweep and the
 * account-deletion clean-up with a FAKE blob deleter over REAL SQL, and
 * `deletePlayer`'s media step end to end.
 *
 * The dev database holds real beta reports, so the sweep is handed a store whose
 * `expiredMedia` is narrowed to this test's own rows; the sweep never touches
 * anything it did not create.
 */

import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { neon } from "@neondatabase/serverless";
import { createBetaStore } from "./store";
import { removeOwnedMedia, sweepExpiredMedia } from "./media-cleanup";
import { dbTestConnection, dbTestEnabled } from "@/app/lib/db-test-support";

const h = vi.hoisted(() => ({ deleted: [] as string[], failOn: new Set<string>() }));

// `deletePlayer` (players.ts) is `server-only`, uses the shared `sql` and the
// real Blob `del`. Bind the first to the test connection and fake the last.
vi.mock("server-only", () => ({}));
vi.mock("@vercel/blob", () => ({
  del: async (path: string) => {
    if (h.failOn.has(path)) throw new Error("blob down");
    h.deleted.push(path);
  },
}));
vi.mock("@/app/lib/db", async (importActual) => {
  const actual = await importActual<typeof import("@/app/lib/db")>();
  const { neon: connect } = await import("@neondatabase/serverless");
  const { dbTestConnection: conn } = await import("@/app/lib/db-test-support");
  return { ...actual, sql: connect(conn) };
});

describe.skipIf(!dbTestEnabled)("beta media retention against Postgres", () => {
  const sql = neon(dbTestConnection);
  const store = createBetaStore(sql);
  const tag = randomBytes(4).toString("hex");
  const slug = `zz-media-${tag}`;
  const owner = `zz-bm-${tag}-owner`;
  const other = `zz-bm-${tag}-other`;
  const path = (n: string) => `beta/zz-${tag}/${n}`;
  const removed = () => h.deleted.filter((p) => p.includes(`zz-${tag}`));

  const ids: Record<string, number> = {};

  async function report(
    key: string,
    opts: { player: string | null; days: number; clip?: string; shot?: string },
  ) {
    const created = new Date(Date.now() - opts.days * 86_400_000).toISOString();
    const rows = await sql`
      INSERT INTO beta_reports (player_id, slug, kind, severity, title, body, clip_blob_path, clip_url, clip_bytes, clip_ms, shot_blob_path, shot_url, created_at)
      VALUES (${opts.player}, ${slug}, 'bug', 'minor', ${`media test ${key}`}, 'a body that is long enough',
              ${opts.clip ?? null}, ${opts.clip ? `https://blob.invalid/${opts.clip}` : null}, ${opts.clip ? 1234 : 0}, ${opts.clip ? 5000 : 0},
              ${opts.shot ?? null}, ${opts.shot ? `https://blob.invalid/${opts.shot}` : null}, ${created}::timestamptz)
      RETURNING id`;
    ids[key] = Number(rows[0].id);
  }
  const mine = <T extends { id: number }>(rows: T[]) => rows.filter((r) => Object.values(ids).includes(r.id));
  const state = async (key: string) =>
    (await sql`SELECT clip_blob_path, clip_url, clip_bytes, clip_ms, shot_blob_path, shot_url, media_expired_at, title
                 FROM beta_reports WHERE id = ${ids[key]}`)[0];
  const shot = (id: string, player: string | null, status: string) =>
    sql`INSERT INTO beta_shots (id, player_id, slug, blob_path, content_type, status)
        VALUES (${id}, ${player}, ${slug}, ${path(id)}, 'image/png', ${status})`;
  /** The sweep sees only this test's rows. */
  const scoped = {
    expiredMedia: async (days: number, limit: number) => mine(await store.expiredMedia(days, 500)).slice(0, limit),
    markMediaExpired: store.markMediaExpired,
  };

  beforeAll(async () => {
    for (const id of [owner, other]) {
      await sql`INSERT INTO players (id, email) VALUES (${id}, ${`${id}@bm-db-test.invalid`})`;
    }
    // Oldest first: old-both < old-clip < old-shot; recent and bare are never due.
    await report("oldBoth", { player: other, days: 60, clip: path("ob.webm"), shot: path("ob.png") });
    await report("oldClip", { player: other, days: 45, clip: path("oc.webm") });
    await report("oldShot", { player: other, days: 40, shot: path("os.png") });
    await report("recent", { player: other, days: 5, clip: path("r.webm"), shot: path("r.png") });
    await report("bare", { player: other, days: 90 });
  });

  afterAll(async () => {
    await sql`DELETE FROM beta_shots WHERE slug = ${slug}`;
    await sql`DELETE FROM beta_reports WHERE slug = ${slug}`;
    await sql`DELETE FROM scores WHERE handle = ${`Deleted`} AND player_id IS NULL AND board_id = ${`zz-bm-${tag}`}`;
    await sql`DELETE FROM boards WHERE id = ${`zz-bm-${tag}`}`;
    await sql`DELETE FROM players WHERE id = ANY(${[owner, other]}::text[])`;
  });

  it("expiredMedia returns only old reports that still point at media, oldest first", async () => {
    const due = mine(await store.expiredMedia(30, 500));
    expect(due.map((d) => d.id)).toEqual([ids.oldBoth, ids.oldClip, ids.oldShot]);
    expect(due[0]).toEqual({ id: ids.oldBoth, clipBlobPath: path("ob.webm"), shotBlobPath: path("ob.png") });
    expect(due[1]).toMatchObject({ clipBlobPath: path("oc.webm"), shotBlobPath: null });
    // `days` is clamped to at least one, `limit` honoured.
    expect(await store.expiredMedia(0, 1)).toHaveLength(1);
  });

  it("markMediaExpired clears only what was removed and stamps media_expired_at", async () => {
    await store.markMediaExpired(ids.oldBoth, { clip: true, shot: false });
    expect(await state("oldBoth")).toMatchObject({
      clip_blob_path: null,
      clip_url: null,
      clip_bytes: 0,
      clip_ms: 0,
      shot_blob_path: path("ob.png"),
      title: "media test oldBoth",
    });
    expect((await state("oldBoth")).media_expired_at).not.toBeNull();
    // Still due, because the screenshot pointer remains.
    expect(mine(await store.expiredMedia(30, 500)).map((d) => d.id)).toContain(ids.oldBoth);
    await store.markMediaExpired(ids.oldBoth, { clip: false, shot: false }); // no-op
    await store.markMediaExpired(ids.oldBoth, { clip: false, shot: true });
    expect(await state("oldBoth")).toMatchObject({ shot_blob_path: null, shot_url: null });
    expect(mine(await store.expiredMedia(30, 500)).map((d) => d.id)).not.toContain(ids.oldBoth);
  });

  it("the sweep deletes blobs then clears pointers, keeps a failed half, and converges on retry", async () => {
    // Put oldBoth back so the sweep has three due reports.
    await sql`UPDATE beta_reports SET clip_blob_path = ${path("ob.webm")}, shot_blob_path = ${path("ob.png")} WHERE id = ${ids.oldBoth}`;
    h.deleted.length = 0;
    h.failOn.add(path("os.png"));
    const remove = async (p: string) => {
      if (h.failOn.has(p)) throw new Error("blob down");
      h.deleted.push(p);
    };
    const logs: string[] = [];

    const first = await sweepExpiredMedia({ store: scoped, remove, days: 30, limit: 50, log: (w) => logs.push(w) });
    expect(first).toMatchObject({ considered: 3, cleared: 2, blobsRemoved: 3, failed: 1, more: false });
    expect(removed().sort()).toEqual([path("ob.png"), path("ob.webm"), path("oc.webm")].sort());
    expect((await state("oldBoth")).clip_blob_path).toBeNull();
    expect((await state("oldClip")).clip_blob_path).toBeNull();
    // The failed object keeps its pointer, so it is retried.
    expect((await state("oldShot")).shot_blob_path).toBe(path("os.png"));
    expect((await state("oldShot")).media_expired_at).toBeNull();
    expect(logs.length).toBeGreaterThan(0);

    h.failOn.clear();
    const second = await sweepExpiredMedia({ store: scoped, remove, days: 30, limit: 50 });
    expect(second).toMatchObject({ considered: 1, cleared: 1, blobsRemoved: 1, failed: 0 });
    expect((await state("oldShot")).shot_blob_path).toBeNull();
    // Nothing of ours is left, the recent report was never touched, the text stays.
    expect(await sweepExpiredMedia({ store: scoped, remove, days: 30, limit: 50 })).toMatchObject({ considered: 0 });
    expect((await state("recent")).clip_blob_path).toBe(path("r.webm"));
    expect((await state("oldClip")).title).toBe("media test oldClip");
  });

  it("the sweep honours its batch limit oldest-first and reports more", async () => {
    await sql`UPDATE beta_reports SET clip_blob_path = ${path("oc.webm")} WHERE id = ${ids.oldClip}`;
    await sql`UPDATE beta_reports SET clip_blob_path = ${path("ob.webm")} WHERE id = ${ids.oldBoth}`;
    const gone: string[] = [];
    const out = await sweepExpiredMedia({ store: scoped, remove: async (p) => void gone.push(p), days: 30, limit: 1 });
    expect(out).toMatchObject({ considered: 1, more: true });
    expect(gone).toEqual([path("ob.webm")]);
    await sql`UPDATE beta_reports SET clip_blob_path = NULL WHERE id = ${ids.oldClip}`;
  });

  it("mediaOwnedBy and deleteShots (= ANY(array)) find and remove an owner's evidence", async () => {
    await report("ownedClip", { player: owner, days: 1, clip: path("own.webm") });
    await report("ownedBare", { player: owner, days: 1 });
    await shot(`zz-${tag}-pend`, owner, "pending");
    await shot(`zz-${tag}-rej`, owner, "rejected");
    await shot(`zz-${tag}-acc`, owner, "accepted");
    await shot(`zz-${tag}-oth`, other, "pending");

    const owned = await store.mediaOwnedBy(owner);
    expect(owned.reports).toEqual([{ id: ids.ownedClip, clipBlobPath: path("own.webm"), shotBlobPath: null }]);
    expect(owned.shots.map((s) => s.id).sort()).toEqual([`zz-${tag}-pend`, `zz-${tag}-rej`]);

    await store.deleteShots([]); // no-op, no statement
    await store.deleteShots([`zz-${tag}-pend`, `zz-${tag}-oth`]);
    const left = await sql`SELECT id FROM beta_shots WHERE slug = ${slug} ORDER BY id`;
    expect(left.map((r) => r.id)).toEqual([`zz-${tag}-acc`, `zz-${tag}-rej`]);
    // A single-element array works too.
    await store.deleteShots([`zz-${tag}-rej`]);
    expect((await sql`SELECT id FROM beta_shots WHERE slug = ${slug}`).map((r) => r.id)).toEqual([`zz-${tag}-acc`]);
  });

  it("removeOwnedMedia deletes blobs, clears report pointers and drops staged shot rows", async () => {
    await shot(`zz-${tag}-p2`, owner, "pending");
    const owned = await store.mediaOwnedBy(owner);
    const gone: string[] = [];
    const out = await removeOwnedMedia({ store, remove: async (p) => void gone.push(p), owned });
    expect(out).toEqual({ removed: 2, failed: 0 });
    expect(gone.sort()).toEqual([path("own.webm"), path(`zz-${tag}-p2`)].sort());
    expect((await state("ownedClip")).clip_blob_path).toBeNull();
    expect((await sql`SELECT id FROM beta_shots WHERE id = ${`zz-${tag}-p2`}`)).toHaveLength(0);
    // A failed blob delete keeps the staged row so it can be retried.
    await shot(`zz-${tag}-p3`, owner, "pending");
    const retry = await removeOwnedMedia({
      store,
      remove: async () => {
        throw new Error("blob down");
      },
      owned: await store.mediaOwnedBy(owner),
      log: () => {},
    });
    expect(retry.failed).toBe(1);
    expect((await sql`SELECT id FROM beta_shots WHERE id = ${`zz-${tag}-p3`}`)).toHaveLength(1);
    await sql`DELETE FROM beta_shots WHERE id = ${`zz-${tag}-p3`}`;
  });

  it("deletePlayer erases the account, anonymises scores and removes the media files afterwards", async () => {
    const { deletePlayer } = await import("@/app/lib/players");
    const doomed = `zz-bm-${tag}-doomed`;
    await sql`INSERT INTO players (id, email, name) VALUES (${doomed}, ${`${doomed}@bm-db-test.invalid`}, 'Real Name')`;
    await sql`INSERT INTO boards (id, game_slug, title) VALUES (${`zz-bm-${tag}`}, ${slug}, 'bm test')`;
    await sql`INSERT INTO scores (board_id, handle, score, player_id) VALUES (${`zz-bm-${tag}`}, 'Real Name', 5, ${doomed})`;
    await report("doomedReport", { player: doomed, days: 2, clip: path("d.webm"), shot: path("d.png") });
    await shot(`zz-${tag}-dp`, doomed, "pending");
    await shot(`zz-${tag}-da`, doomed, "accepted");
    h.deleted.length = 0;

    expect(await deletePlayer(doomed)).toBe(true);

    expect(removed().sort()).toEqual([path("d.png"), path("d.webm"), path(`zz-${tag}-dp`)].sort());
    expect(await sql`SELECT 1 FROM players WHERE id = ${doomed}`).toHaveLength(0);
    const s = await state("doomedReport");
    expect(s).toMatchObject({ clip_blob_path: null, shot_blob_path: null, title: "media test doomedReport" });
    expect(s.media_expired_at).not.toBeNull();
    const owner0 = await sql`SELECT player_id FROM beta_reports WHERE id = ${ids.doomedReport}`;
    expect(owner0[0].player_id).toBeNull();
    // The accepted shot stays (it may back a gallery copy), de-tagged.
    const shots = await sql`SELECT id, player_id FROM beta_shots WHERE slug = ${slug} AND id LIKE ${`zz-${tag}-d%`}`;
    expect(shots).toEqual([{ id: `zz-${tag}-da`, player_id: null }]);
    const sc = await sql`SELECT handle, player_id FROM scores WHERE board_id = ${`zz-bm-${tag}`}`;
    expect(sc).toEqual([{ handle: "Deleted", player_id: null }]);
    // An unknown id deletes nothing.
    expect(await deletePlayer(`zz-bm-${tag}-nobody`)).toBe(false);
  });

  it("deletePlayer still deletes the account when a blob delete fails, and leaves the pointer for the sweep", async () => {
    const { deletePlayer } = await import("@/app/lib/players");
    const doomed = `zz-bm-${tag}-doomed2`;
    await sql`INSERT INTO players (id, email) VALUES (${doomed}, ${`${doomed}@bm-db-test.invalid`})`;
    await report("doomed2", { player: doomed, days: 2, clip: path("d2.webm") });
    h.failOn.add(path("d2.webm"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await deletePlayer(doomed)).toBe(true);
    } finally {
      errors.mockRestore();
      h.failOn.clear();
    }
    expect(await sql`SELECT 1 FROM players WHERE id = ${doomed}`).toHaveLength(0);
    expect((await state("doomed2")).clip_blob_path).toBe(path("d2.webm"));
  });
});
