/**
 * The invites store, against the fake-`sql` seam `challenges/store.test.ts`
 * uses: every operation must be ONE statement (the `neon()` HTTP driver cannot
 * make two calls atomic), caller input must only ever be a bound value, and
 * every row must map to public names only. `store.db.test.ts` runs the same
 * statements against a real Postgres.
 */

import { describe, expect, it } from "vitest";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { createInviteStore } from "./store";
import {
  FRIEND_INVITE_RATE_LIMIT,
  GC_GRACE_SECONDS,
  GUEST_LINK_RATE_LIMIT,
  INVITE_PAIR_COOLDOWN_SECONDS,
} from "./config";

interface RecordedCall {
  text: string;
  values: unknown[];
}

function makeFakeSql(rows: Record<string, unknown>[] = []) {
  const calls: RecordedCall[] = [];
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("?"), values });
    return Promise.resolve(rows);
  };
  return { sql: fn as unknown as NeonQueryFunction<false, false>, calls };
}

const FRIEND_INPUT = {
  senderId: "google-sender",
  slug: "last-bell",
  json: '{"room":"ABCD"}',
  toPublicIds: ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"],
  codes: ["CDFGHJKMNPQR", "TVWXY0123456"],
  ttlSeconds: 1800,
  stagedOnly: false,
  adminEmails: [],
};

describe("listInvitableFriends", () => {
  it("is one statement that gates on friendship, blocks and staged access, and never selects a real name", async () => {
    const { sql, calls } = makeFakeSql([
      { public_id: "pub-1", username: "ada", handle: null, image: null, invited_recently: true },
      { public_id: "pub-2", username: null, handle: "  Grace  ", image: "https://x/y.png", invited_recently: false },
      { public_id: "pub-3", username: null, handle: null, image: null, invited_recently: null },
    ]);
    const list = await createInviteStore(sql).listInvitableFriends({
      me: "me",
      slug: "last-bell",
      stagedOnly: true,
      adminEmails: ["boss@example.com"],
    });
    expect(calls).toHaveLength(1);
    const { text, values } = calls[0];
    expect(text).toContain("f.status = 'accepted'");
    expect(text).toContain("player_blocks");
    expect(text).toContain("beta_testers");
    expect(text).toContain("dashboard_users");
    expect(text).not.toMatch(/\bp\.name\b/);
    expect(values).toContain(true);
    expect(values).toContainEqual(["boss@example.com"]);
    expect(values).toContain(INVITE_PAIR_COOLDOWN_SECONDS);
    expect(list).toEqual([
      { id: "pub-1", username: "ada", displayName: "@ada", image: null, invitedRecently: true },
      { id: "pub-2", username: null, displayName: "Grace", image: "https://x/y.png", invitedRecently: false },
      { id: "pub-3", username: null, displayName: "Player", image: null, invitedRecently: false },
    ]);
  });
});

describe("createFriendInvites", () => {
  it("gates, counts, inserts and collects in ONE statement with bound values only", async () => {
    const { sql, calls } = makeFakeSql([
      {
        sent: [{ to: "google-friend", code: "CDFGHJKMNPQR" }],
        eligible_n: "1",
        recent_n: "3",
        from_handle: null,
        from_username: "ozan",
      },
    ]);
    const outcome = await createInviteStore(sql).createFriendInvites(FRIEND_INPUT);
    expect(calls).toHaveLength(1);
    const { text, values } = calls[0];
    expect(text).toContain("DELETE FROM game_invites");
    expect(text).toContain("INSERT INTO game_invites");
    expect(text).toContain("ON CONFLICT (code) DO NOTHING");
    expect(text).toContain("player_blocks");
    expect(text).toContain("f.status = 'accepted'");
    // Caller input never reaches the statement text.
    expect(text).not.toContain("last-bell");
    expect(text).not.toContain("ABCD");
    expect(values).toContain("last-bell");
    expect(values).toContain('{"room":"ABCD"}');
    expect(values).toContainEqual(FRIEND_INPUT.toPublicIds);
    expect(values).toContainEqual(FRIEND_INPUT.codes);
    expect(values).toContain(FRIEND_INVITE_RATE_LIMIT.maxPerWindow);
    expect(values).toContain(GC_GRACE_SECONDS);
    expect(outcome).toEqual({
      sent: [{ toId: "google-friend", code: "CDFGHJKMNPQR" }],
      eligible: 1,
      recent: 3,
      rateLimited: false,
      fromDisplayName: "@ozan",
    });
  });

  it("reports the hourly limit when the batch would cross it", async () => {
    const { sql } = makeFakeSql([
      { sent: [], eligible_n: "2", recent_n: "19", from_handle: "Oz", from_username: "ozan" },
    ]);
    const outcome = await createInviteStore(sql).createFriendInvites(FRIEND_INPUT);
    expect(outcome.rateLimited).toBe(true);
    expect(outcome.sent).toEqual([]);
    expect(outcome.fromDisplayName).toBe("Oz");
  });

  it("is not 'rate limited' when nobody was eligible", async () => {
    const { sql } = makeFakeSql([{ sent: null, eligible_n: "0", recent_n: "25" }]);
    const outcome = await createInviteStore(sql).createFriendInvites(FRIEND_INPUT);
    expect(outcome).toMatchObject({ sent: [], eligible: 0, rateLimited: false, fromDisplayName: "Player" });
  });
});

describe("createLink", () => {
  it("is one statement keyed by the guest hash when there is no player", async () => {
    const { sql, calls } = makeFakeSql([{ code: "CDFGHJKMNPQR", recent_n: "4" }]);
    const outcome = await createInviteStore(sql).createLink({
      senderId: null,
      senderKey: "hash",
      slug: "last-bell",
      json: "{}",
      code: "CDFGHJKMNPQR",
      ttlSeconds: 600,
      limit: GUEST_LINK_RATE_LIMIT,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain("'link'");
    expect(calls[0].text).toContain("DELETE FROM game_invites");
    expect(calls[0].values).toContain("hash");
    expect(calls[0].values).toContain(GUEST_LINK_RATE_LIMIT.maxPerWindow);
    expect(outcome).toEqual({ code: "CDFGHJKMNPQR", rateLimited: false });
  });

  it("reports the limit when nothing was written", async () => {
    const { sql } = makeFakeSql([{ code: null, recent_n: String(GUEST_LINK_RATE_LIMIT.maxPerWindow) }]);
    const outcome = await createInviteStore(sql).createLink({
      senderId: "p",
      senderKey: null,
      slug: "s",
      json: "{}",
      code: "CDFGHJKMNPQR",
      ttlSeconds: 600,
      limit: GUEST_LINK_RATE_LIMIT,
    });
    expect(outcome).toEqual({ code: null, rateLimited: true });
  });
});

describe("getByCode", () => {
  it("maps a friend invite to public fields only", async () => {
    const { sql, calls } = makeFakeSql([
      {
        code: "CDFGHJKMNPQR",
        slug: "last-bell",
        kind: "friend",
        data: { room: "ABCD" },
        expires_at: "2026-10-10T12:00:00Z",
        expired: false,
        seconds_left: 1500,
        has_sender: true,
        from_handle: null,
        from_username: "ozan",
      },
    ]);
    const invite = await createInviteStore(sql).getByCode("CDFGHJKMNPQR");
    expect(calls).toHaveLength(1);
    expect(calls[0].text).not.toMatch(/\bp\.name\b/);
    expect(calls[0].text).not.toContain("image");
    expect(invite).toEqual({
      code: "CDFGHJKMNPQR",
      slug: "last-bell",
      kind: "friend",
      data: { room: "ABCD" },
      from: "@ozan",
      expiresAt: "2026-10-10T12:00:00.000Z",
      expired: false,
      secondsLeft: 1500,
    });
  });

  it("has no sender for a guest link and tolerates string JSON", async () => {
    const { sql } = makeFakeSql([
      {
        code: "CDFGHJKMNPQR",
        slug: "s",
        kind: "link",
        data: '{"a":1}',
        expires_at: "2026-10-10T12:00:00Z",
        expired: true,
        has_sender: false,
      },
    ]);
    const invite = await createInviteStore(sql).getByCode("CDFGHJKMNPQR");
    expect(invite).toMatchObject({ kind: "link", from: null, data: { a: 1 }, expired: true });
  });

  it("is null for an unknown code", async () => {
    const { sql } = makeFakeSql([]);
    expect(await createInviteStore(sql).getByCode("CDFGHJKMNPQR")).toBeNull();
  });
});
