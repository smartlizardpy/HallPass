/**
 * BoardPass against a REAL Postgres: opt-in (see `app/lib/db-test-support.ts`).
 * Needs migration 051. Run with
 *   HALLPASS_DB_TEST=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run app/lib/boardpass
 *
 * These are the rules a mocked `sql` cannot prove, because they are properties of
 * the statements themselves: that parallel guesses cannot beat the lock, that the
 * 8-seat cap and no-duplicate rule hold under concurrency, that an expired or
 * revoked or re-keyed seat stops resolving, and that credit is bound to the game.
 */

import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { neon } from "@neondatabase/serverless";
import { dbTestConnection, dbTestEnabled } from "@/app/lib/db-test-support";

vi.mock("server-only", () => ({}));

const cookieJar = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "hp_boardpass" && cookieJar.token ? { value: cookieJar.token } : undefined,
  }),
}));
vi.mock("./flag", () => ({ getBoardPassMode: async () => "on" }));

describe.skipIf(!dbTestEnabled)("BoardPass against Postgres", () => {
  const tag = randomBytes(4).toString("hex");
  const sql = neon(dbTestConnection);
  const pid = (n: number) => `zz-bp-${tag}-p${n}`;
  const sessions: string[] = [];
  let credentials: typeof import("./credentials");
  let attempts: typeof import("./attempts");
  let store: typeof import("./sessions");
  let resolve: typeof import("./resolve");
  let tokenLib: typeof import("./token");

  async function player(n: number, username = true) {
    await sql`
      INSERT INTO players (id, email, name, username)
      VALUES (${pid(n)}, ${`zz-bp-${tag}-${n}@invalid.test`}, 'Real Name', ${
        username ? `bp${tag}${n}` : null
      })`;
    await sql`INSERT INTO boardpass_credentials (player_id, pin_hash) VALUES (${pid(n)}, 'x')`;
  }

  async function newSession(n: number) {
    const token = tokenLib.newSessionToken();
    const tokenHash = tokenLib.hashSessionToken(token);
    sessions.push(tokenHash);
    const made = await store.createSession({ tokenHash, playerId: pid(n), pinVersion: 1 });
    return { token, tokenHash, ...made };
  }

  beforeAll(async () => {
    credentials = await import("./credentials");
    attempts = await import("./attempts");
    store = await import("./sessions");
    resolve = await import("./resolve");
    tokenLib = await import("./token");
    for (let n = 0; n < 14; n++) await player(n);
  });

  afterAll(async () => {
    if (!dbTestEnabled) return;
    for (const h of sessions) await sql`DELETE FROM boardpass_sessions WHERE token_hash = ${h}`;
    await sql`DELETE FROM players WHERE id LIKE ${`zz-bp-${tag}-%`}`;
    await sql`DELETE FROM boardpass_attempts WHERE bucket_key LIKE ${`zz-bp-${tag}%`}`;
  });

  describe("guess counter", () => {
    it("parallel guesses get at most five tries before the lock", async () => {
      const results = await Promise.all(
        Array.from({ length: 25 }, () => credentials.reserveAccountAttempt(`bp${tag}0`)),
      );
      expect(results.filter(Boolean).length).toBe(5);
      const row = (await sql`
        SELECT failed_count, locked_until FROM boardpass_credentials WHERE player_id = ${pid(0)}`)[0];
      expect(row.failed_count).toBe(5);
      expect(row.locked_until).not.toBeNull();
    });

    it("a locked account yields nothing to verify", async () => {
      expect(await credentials.reserveAccountAttempt(`bp${tag}0`)).toBeNull();
    });

    it("success clears the failures and the lock", async () => {
      await credentials.recordSuccess(pid(0));
      const first = await credentials.reserveAccountAttempt(`bp${tag}0`);
      expect(first?.playerId).toBe(pid(0));
    });

    it("an unknown username and a player with no credential both give null", async () => {
      expect(await credentials.reserveAccountAttempt("zz-nobody-here")).toBeNull();
      await sql`INSERT INTO players (id, email, username) VALUES (${`zz-bp-${tag}-nocred`}, ${`zz-bp-${tag}-nc@invalid.test`}, ${`nc${tag}`})`;
      expect(await credentials.reserveAccountAttempt(`nc${tag}`)).toBeNull();
    });

    it("failures are forgotten after a quiet day", async () => {
      await sql`UPDATE boardpass_credentials SET failed_count = 4, last_failed_at = now() - interval '25 hours', locked_until = NULL WHERE player_id = ${pid(1)}`;
      await credentials.reserveAccountAttempt(`bp${tag}1`);
      const row = (await sql`SELECT failed_count FROM boardpass_credentials WHERE player_id = ${pid(1)}`)[0];
      expect(row.failed_count).toBe(1);
    });
  });

  describe("network buckets", () => {
    it("allow exactly the cap, even in parallel", async () => {
      const key = `zz-bp-${tag}-bucket`;
      const results = await Promise.all(
        Array.from({ length: 12 }, () => attempts.reserveBucket(key, 3)),
      );
      expect(results.filter(Boolean).length).toBe(3);
    });
  });

  describe("credential changes", () => {
    it("setting a PIN again bumps pin_version and revokes board seats", async () => {
      const s = await newSession(2);
      await credentials.setCredential(pid(2), "newhash");
      const cred = (await sql`SELECT pin_version, pin_hash FROM boardpass_credentials WHERE player_id = ${pid(2)}`)[0];
      expect(cred.pin_version).toBe(2);
      expect(cred.pin_hash).toBe("newhash");
      const live = await store.getLiveSession(s.tokenHash);
      expect(live?.participants).toHaveLength(0);
      const count = (await sql`SELECT participant_count FROM boardpass_sessions WHERE token_hash = ${s.tokenHash}`)[0];
      expect(count.participant_count).toBe(0);
    });

    it("disabling deletes the credential and the seat", async () => {
      const s = await newSession(3);
      expect(await credentials.countActiveBoards(pid(3))).toBe(1);
      await credentials.deleteCredential(pid(3));
      expect((await credentials.getCredentialStatus(pid(3))).enabled).toBe(false);
      expect(await credentials.countActiveBoards(pid(3))).toBe(0);
      expect((await store.getLiveSession(s.tokenHash))?.participants).toHaveLength(0);
    });
  });

  describe("sessions", () => {
    it("holds eight seats, refuses the ninth, under concurrency", async () => {
      const s = await newSession(4);
      const joins = await Promise.all(
        [5, 6, 7, 8, 9, 10, 11, 12, 13].map((n) =>
          store.joinSession({ tokenHash: s.tokenHash, playerId: pid(n), pinVersion: 1 }),
        ),
      );
      expect(joins.filter((j) => j.ok).length).toBe(7);
      expect(joins.filter((j) => !j.ok && j.reason === "full").length).toBe(2);
      const live = await store.getLiveSession(s.tokenHash);
      expect(live?.participants).toHaveLength(8);
      const row = (await sql`SELECT participant_count FROM boardpass_sessions WHERE token_hash = ${s.tokenHash}`)[0];
      expect(row.participant_count).toBe(8);
    });

    it("rejects the same player twice, even at once, without leaking a seat", async () => {
      await player(20);
      await player(21);
      const s = await newSession(20);
      const joins = await Promise.all([
        store.joinSession({ tokenHash: s.tokenHash, playerId: pid(21), pinVersion: 1 }),
        store.joinSession({ tokenHash: s.tokenHash, playerId: pid(21), pinVersion: 1 }),
        store.joinSession({ tokenHash: s.tokenHash, playerId: pid(20), pinVersion: 1 }),
      ]);
      expect(joins.filter((j) => j.ok).length).toBe(1);
      expect(joins.every((j) => j.ok || j.reason === "duplicate")).toBe(true);
      const row = (await sql`SELECT participant_count FROM boardpass_sessions WHERE token_hash = ${s.tokenHash}`)[0];
      expect(row.participant_count).toBe(2);
    });

    it("lists public names only: handle, then @username, never the Google name", async () => {
      await sql`UPDATE players SET handle = 'Cool Kid' WHERE id = ${pid(20)}`;
      const s = await newSession(20).catch(() => null);
      expect(s).not.toBeNull();
      const live = await store.getLiveSession(s!.tokenHash);
      expect(live?.participants[0].name).toBe("Cool Kid");
      const json = JSON.stringify(live);
      expect(json).not.toContain("Real Name");
      expect(json).not.toContain("invalid.test");
      expect(json).not.toContain(pid(20));
    });

    it("removing a player frees the seat and keeps others", async () => {
      await player(30);
      await player(31);
      const s = await newSession(30);
      const j = await store.joinSession({ tokenHash: s.tokenHash, playerId: pid(31), pinVersion: 1 });
      expect(j.ok).toBe(true);
      if (!j.ok) return;
      expect(await store.removeParticipant(s.tokenHash, j.participantId)).toBe(true);
      expect(await store.removeParticipant(s.tokenHash, j.participantId)).toBe(false);
      const live = await store.getLiveSession(s.tokenHash);
      expect(live?.participants.map((p) => p.id)).toEqual([s.participantId]);
    });

    it("cannot remove a seat that belongs to a different session", async () => {
      await player(32);
      await player(33);
      const a = await newSession(32);
      const b = await newSession(33);
      expect(await store.removeParticipant(a.tokenHash, b.participantId)).toBe(false);
      expect((await store.getLiveSession(b.tokenHash))?.participants).toHaveLength(1);
    });

    it("End Session revokes everyone and the session stops resolving", async () => {
      await player(34);
      const s = await newSession(34);
      await store.endSession(s.tokenHash);
      expect(await store.getLiveSession(s.tokenHash)).toBeNull();
      expect(await store.touchSession(s.tokenHash)).toBeNull();
      expect(await credentials.countActiveBoards(pid(34))).toBe(0);
      await store.endSession(s.tokenHash); // idempotent
    });

    it("an idle-expired session is gone before any cleanup runs", async () => {
      await player(35);
      const s = await newSession(35);
      await sql`UPDATE boardpass_sessions SET idle_expires_at = now() - interval '1 second' WHERE token_hash = ${s.tokenHash}`;
      expect(await store.getLiveSession(s.tokenHash)).toBeNull();
      expect(await store.touchSession(s.tokenHash)).toBeNull();
      const j = await store.joinSession({ tokenHash: s.tokenHash, playerId: pid(5), pinVersion: 1 });
      expect(j).toEqual({ ok: false, reason: "gone" });
    });

    it("Keep Playing extends idle but never past the absolute limit", async () => {
      await player(36);
      const s = await newSession(36);
      await sql`UPDATE boardpass_sessions SET absolute_expires_at = now() + interval '30 seconds' WHERE token_hash = ${s.tokenHash}`;
      const t = await store.touchSession(s.tokenHash);
      expect(t).not.toBeNull();
      expect(new Date(t!.idleExpiresAt).getTime()).toBeLessThanOrEqual(
        new Date(t!.absoluteExpiresAt).getTime(),
      );
      await sql`UPDATE boardpass_sessions SET absolute_expires_at = now() - interval '1 second' WHERE token_hash = ${s.tokenHash}`;
      expect(await store.touchSession(s.tokenHash)).toBeNull();
    });
  });

  describe("who is playing, and the resolver", () => {
    async function boundSession(n: number, slug = "duskfall") {
      await player(n);
      const s = await newSession(n);
      const bound = await store.bindActive({
        tokenHash: s.tokenHash,
        participantId: s.participantId,
        slug,
      });
      expect(bound).toEqual({ ok: true, playerId: pid(n) });
      cookieJar.token = s.token;
      return s;
    }

    it("credits the chosen player for that game only", async () => {
      await boundSession(40);
      expect(await resolve.gameplayPlayerId("duskfall")).toBe(pid(40));
      expect(await resolve.gameplayPlayerId("other-game")).toBeNull();
    });

    it("nothing resolves with no cookie, or with nobody chosen", async () => {
      cookieJar.token = undefined;
      expect(await resolve.gameplayPlayerId("duskfall")).toBeNull();
      await player(41);
      const s = await newSession(41);
      cookieJar.token = s.token;
      expect(await resolve.gameplayPlayerId("duskfall")).toBeNull();
    });

    it("refuses to switch the player mid-game, allows after a clear", async () => {
      await player(42);
      const s = await boundSession(43);
      const j = await store.joinSession({ tokenHash: s.tokenHash, playerId: pid(42), pinVersion: 1 });
      if (!j.ok) throw new Error("join failed");
      expect(
        await store.bindActive({ tokenHash: s.tokenHash, participantId: j.participantId, slug: "duskfall" }),
      ).toEqual({ ok: false, reason: "busy" });
      expect(await resolve.gameplayPlayerId("duskfall")).toBe(pid(43));
      // the SAME player and game may re-bind (idempotent)
      expect(
        (await store.bindActive({ tokenHash: s.tokenHash, participantId: s.participantId, slug: "duskfall" })).ok,
      ).toBe(true);
      await store.clearActive(s.tokenHash);
      expect(await resolve.gameplayPlayerId("duskfall")).toBeNull();
      const rebound = await store.bindActive({
        tokenHash: s.tokenHash,
        participantId: j.participantId,
        slug: "duskfall",
      });
      expect(rebound).toEqual({ ok: true, playerId: pid(42) });
      expect(await resolve.gameplayPlayerId("duskfall")).toBe(pid(42));
    });

    it("stops resolving once the PIN changes", async () => {
      await boundSession(44);
      await credentials.setCredential(pid(44), "other");
      expect(await resolve.gameplayPlayerId("duskfall")).toBeNull();
      expect((await resolve.peekBoard()).active).toBeNull();
    });

    it("stops resolving once the seat is removed", async () => {
      const s = await boundSession(45);
      await store.removeParticipant(s.tokenHash, s.participantId);
      expect(await resolve.gameplayPlayerId("duskfall")).toBeNull();
    });

    it("allows a final score in the grace window, refuses after it", async () => {
      const s = await boundSession(46);
      await sql`UPDATE boardpass_sessions SET idle_expires_at = now() - interval '60 seconds' WHERE token_hash = ${s.tokenHash}`;
      expect(await resolve.gameplayPlayerId("duskfall")).toBe(pid(46));
      await sql`UPDATE boardpass_sessions SET idle_expires_at = now() - interval '5 minutes' WHERE token_hash = ${s.tokenHash}`;
      expect(await resolve.gameplayPlayerId("duskfall")).toBeNull();
    });

    it("a grace-window write does not resurrect an idled-out session", async () => {
      const s = await boundSession(47);
      await sql`UPDATE boardpass_sessions SET idle_expires_at = now() - interval '30 seconds' WHERE token_hash = ${s.tokenHash}`;
      await resolve.gameplayPlayerId("duskfall");
      expect(await store.getLiveSession(s.tokenHash)).toBeNull();
    });

    it("absolute expiry has no grace", async () => {
      const s = await boundSession(48);
      await sql`UPDATE boardpass_sessions SET absolute_expires_at = now() - interval '1 second' WHERE token_hash = ${s.tokenHash}`;
      expect(await resolve.gameplayPlayerId("duskfall")).toBeNull();
    });

    it("a credited write extends idle, bounded by the absolute limit", async () => {
      const s = await boundSession(49);
      await sql`UPDATE boardpass_sessions SET idle_expires_at = now() + interval '10 seconds', absolute_expires_at = now() + interval '30 seconds' WHERE token_hash = ${s.tokenHash}`;
      await resolve.gameplayPlayerId("duskfall");
      const row = (await sql`SELECT idle_expires_at, absolute_expires_at FROM boardpass_sessions WHERE token_hash = ${s.tokenHash}`)[0];
      expect(new Date(row.idle_expires_at).getTime()).toBeLessThanOrEqual(
        new Date(row.absolute_expires_at).getTime(),
      );
    });

    it("peekBoard reports a session without extending it", async () => {
      const s = await boundSession(50);
      await sql`UPDATE boardpass_sessions SET idle_expires_at = now() + interval '20 seconds' WHERE token_hash = ${s.tokenHash}`;
      const before = (await sql`SELECT idle_expires_at FROM boardpass_sessions WHERE token_hash = ${s.tokenHash}`)[0].idle_expires_at;
      const peek = await resolve.peekBoard();
      expect(peek).toEqual({ board: true, active: { playerId: pid(50), slug: "duskfall" } });
      const after = (await sql`SELECT idle_expires_at FROM boardpass_sessions WHERE token_hash = ${s.tokenHash}`)[0].idle_expires_at;
      expect(new Date(after).getTime()).toBe(new Date(before).getTime());
    });
  });

  describe("account deletion", () => {
    it("takes the credential and every seat with it", async () => {
      await player(60);
      const s = await newSession(60);
      await sql`DELETE FROM players WHERE id = ${pid(60)}`;
      const cred = await sql`SELECT 1 FROM boardpass_credentials WHERE player_id = ${pid(60)}`;
      const part = await sql`SELECT 1 FROM boardpass_participants WHERE player_id = ${pid(60)}`;
      expect(cred).toHaveLength(0);
      expect(part).toHaveLength(0);
      expect(s.sessionId).toBeTruthy();
    });
  });
});
