/**
 * Tests for the notifications store.
 *
 * Same fake-`sql` seam as the other stores. The properties pinned hardest are
 * the two that fail SILENTLY:
 *
 *   * inserting and capping are ONE statement, with the cap reserving a slot for
 *     the row being written — a sibling CTE cannot see it;
 *   * a DEDUPED insert prunes nothing, so a producer that re-fires an event
 *     cannot quietly eat the oldest notification a player had not read yet.
 */

import { describe, expect, it } from "vitest";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import {
  NOTIFICATIONS_KEEP_BROADCASTS,
  NOTIFICATIONS_KEEP_PER_PLAYER,
} from "./config";
import { createNotificationStore } from "./store";

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

const PERSONAL = {
  playerId: "p1",
  kind: "challenge_received",
  title: "Ozan challenged you",
  body: "Beat their score on Duskfall.",
  url: "/play/you/friends",
  dedupeKey: null,
};

describe("insertPersonal", () => {
  it("inserts and caps in ONE statement", async () => {
    const { sql, calls } = makeFakeSql([{ inserted: 1 }]);
    await createNotificationStore(sql).insertPersonal(PERSONAL);

    expect(calls).toHaveLength(1);
    const { text } = calls[0];
    expect(text).toContain("INSERT INTO notifications");
    expect(text).toContain("DELETE FROM notifications");
  });

  it("reserves a slot for the new row by offsetting KEEP - 1", async () => {
    // A data-modifying CTE is invisible to its siblings, so `excess` cannot see
    // the row being inserted. Keeping KEEP-1 older rows plus the new one is
    // exactly KEEP.
    const { sql, calls } = makeFakeSql([{ inserted: 1 }]);
    await createNotificationStore(sql).insertPersonal(PERSONAL);

    expect(calls[0].values).toContain(NOTIFICATIONS_KEEP_PER_PLAYER - 1);
  });

  it("prunes nothing when the insert was deduped", async () => {
    // Without the guard, a producer re-firing a deduped event would delete this
    // player's oldest notification each time — trading a row they may not have
    // read for one that was never written.
    const { sql, calls } = makeFakeSql([{ inserted: 0 }]);
    await createNotificationStore(sql).insertPersonal(PERSONAL);

    expect(calls[0].text).toContain("EXISTS (SELECT 1 FROM ins)");
  });

  it("infers the PARTIAL unique index so keyless rows never conflict", async () => {
    // The index is partial; without the matching predicate Postgres cannot infer
    // an arbiter and the statement is a syntax error rather than a dedupe.
    const { sql, calls } = makeFakeSql([{ inserted: 1 }]);
    await createNotificationStore(sql).insertPersonal(PERSONAL);

    expect(calls[0].text).toContain(
      "ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING",
    );
  });

  it("evicts the oldest, never the read", async () => {
    // An old notification you never opened is still old. Read state must not
    // decide retention, or an ignored inbox would never shrink.
    const { sql, calls } = makeFakeSql([{ inserted: 1 }]);
    await createNotificationStore(sql).insertPersonal(PERSONAL);

    expect(calls[0].text).toContain("ORDER BY created_at DESC");
    expect(calls[0].text).not.toContain("seen_at IS");
  });

  it("reports whether a row was actually written", async () => {
    const { sql } = makeFakeSql([{ inserted: 1 }]);
    expect(await createNotificationStore(sql).insertPersonal(PERSONAL)).toBe(true);

    const deduped = makeFakeSql([{ inserted: 0 }]);
    expect(
      await createNotificationStore(deduped.sql).insertPersonal(PERSONAL),
    ).toBe(false);
  });

  it("never offsets below zero", async () => {
    // Guards a future KEEP of 0 or 1 from emitting `OFFSET -1`, which is a
    // syntax error rather than a smaller cap.
    const { sql, calls } = makeFakeSql([{ inserted: 1 }]);
    await createNotificationStore(sql).insertPersonal(PERSONAL);

    const offsets = calls[0].values.filter((v) => typeof v === "number");
    for (const offset of offsets) expect(offset as number).toBeGreaterThanOrEqual(0);
  });
});

describe("insertBroadcast", () => {
  it("writes a row with no owner", async () => {
    const { sql, calls } = makeFakeSql([{ inserted: 1 }]);
    await createNotificationStore(sql).insertBroadcast({
      kind: "game_drop",
      title: "New game",
      body: "Duskfall just landed.",
      url: "/game/duskfall",
      dedupeKey: "game_drop:duskfall",
    });

    expect(calls[0].text).toContain("VALUES (NULL");
    expect(calls[0].values).toContain("game_drop:duskfall");
  });

  it("caps broadcasts against their own, smaller population", async () => {
    // Every signed-in player reads every broadcast on every bell poll, so the
    // site-wide backlog is the one length that costs everybody.
    const { sql, calls } = makeFakeSql([{ inserted: 1 }]);
    await createNotificationStore(sql).insertBroadcast({
      kind: "game_drop",
      title: "t",
      body: "b",
      url: "/",
      dedupeKey: null,
    });

    expect(calls[0].text).toContain("WHERE player_id IS NULL");
    expect(calls[0].values).toContain(NOTIFICATIONS_KEEP_BROADCASTS - 1);
  });
});

describe("listFor", () => {
  it("returns the player's own rows and every broadcast", async () => {
    const { sql, calls } = makeFakeSql([
      {
        id: 2,
        kind: "game_drop",
        title: "New game",
        body: "b",
        url: "/game/x",
        created_at: "2026-01-02T00:00:00Z",
        is_broadcast: true,
        seen_at: "2026-01-01T00:00:00Z",
      },
    ]);
    const page = await createNotificationStore(sql).listFor("p1", 12);

    expect(calls[0].text).toContain("n.player_id = ?");
    expect(calls[0].text).toContain("n.player_id IS NULL");
    expect(calls[0].text).toContain("ORDER BY n.created_at DESC");
    expect(page.items[0].isBroadcast).toBe(true);
    expect(page.seenAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("reads the watermark in the same round trip", async () => {
    // A scalar subquery, so the page costs one statement rather than two.
    const { sql, calls } = makeFakeSql([]);
    await createNotificationStore(sql).listFor("p1", 12);
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain("SELECT seen_at FROM notification_state");
  });

  it("treats a player who has never opened the bell as having read nothing", async () => {
    // `null` must mean everything is unread — not an inbox that silently marked
    // itself read before it was ever looked at.
    const { sql } = makeFakeSql([
      {
        id: 1,
        kind: "challenge_received",
        title: "t",
        body: "b",
        url: "/",
        created_at: "2026-01-02T00:00:00Z",
        is_broadcast: false,
        seen_at: null,
      },
    ]);
    expect((await createNotificationStore(sql).listFor("p1", 12)).seenAt).toBe(null);
  });

  it("returns an empty page for a player with nothing", async () => {
    const { sql } = makeFakeSql([]);
    expect(await createNotificationStore(sql).listFor("p1", 12)).toEqual({
      items: [],
      seenAt: null,
    });
  });

  it("does not filter by preference — the barrel does that", async () => {
    // A broadcast row is shared, so whether this player wants it depends on the
    // defaults in `config.ts`, which are code and not in scope here.
    const { sql, calls } = makeFakeSql([]);
    await createNotificationStore(sql).listFor("p1", 12);
    expect(calls[0].text).not.toContain("notification_prefs");
  });
});

describe("markSeen", () => {
  it("stamps now(), not the newest row", async () => {
    // A notification written between the read that rendered the bell and this
    // write has still been on screen; stamping the older value would leave a
    // permanently unread row nobody can clear.
    const { sql, calls } = makeFakeSql();
    await createNotificationStore(sql).markSeen("p1");

    expect(calls[0].text).toContain("INSERT INTO notification_state");
    expect(calls[0].text).toContain("ON CONFLICT (player_id) DO UPDATE SET seen_at = now()");
  });
});

describe("prefsFor", () => {
  it("returns only what was stored", async () => {
    // Sparse: an absent kind has no opinion and takes the catalogue default. A
    // caller treating a missing key as "off" would mute the whole site.
    const { sql } = makeFakeSql([
      { kind: "game_drop", channel: "push" },
      { kind: "challenge_received", channel: "off" },
    ]);
    expect(await createNotificationStore(sql).prefsFor("p1")).toEqual({
      game_drop: "push",
      challenge_received: "off",
    });
  });
});

describe("setPref", () => {
  it("upserts the explicit choice", async () => {
    const { sql, calls } = makeFakeSql();
    await createNotificationStore(sql).setPref("p1", "game_drop", "push");

    expect(calls[0].text).toContain("INSERT INTO notification_prefs");
    expect(calls[0].text).toContain("ON CONFLICT (player_id, kind) DO UPDATE");
    expect(calls[0].values).toContain("push");
  });

  it("stores the row even when it matches today's default", async () => {
    // Deleting it to stay tidy would silently re-opt the player in the day
    // somebody changes that default.
    const { sql, calls } = makeFakeSql();
    await createNotificationStore(sql).setPref("p1", "game_drop", "bell");
    expect(calls[0].text).toContain("INSERT INTO notification_prefs");
    expect(calls[0].text).not.toContain("DELETE");
  });
});

describe("broadcastPushPlayerIds", () => {
  it("requires an explicit opt-in when the default is quieter", async () => {
    // `game_drop` today. The whole point of its quiet default is that a
    // site-wide push is something you ask for.
    const { sql, calls } = makeFakeSql([{ player_id: "p1" }]);
    const ids = await createNotificationStore(sql).broadcastPushPlayerIds(
      "game_drop",
      false,
    );

    expect(ids).toEqual(["p1"]);
    expect(calls[0].text).toContain("JOIN notification_prefs");
    expect(calls[0].text).not.toContain("LEFT JOIN");
    expect(calls[0].text).toContain("p.channel = 'push'");
  });

  it("treats a missing row as opted IN when the default is push", async () => {
    // Sparse means no opinion. Reading absence as opting out would silence
    // everybody who never visited their settings.
    const { sql, calls } = makeFakeSql([]);
    await createNotificationStore(sql).broadcastPushPlayerIds("some_kind", true);

    expect(calls[0].text).toContain("LEFT JOIN notification_prefs");
    expect(calls[0].text).toContain("p.channel IS NULL OR p.channel = 'push'");
  });

  it("only ever returns players with a subscribed device", async () => {
    // The unrestricted list is "everybody who ever set a preference", and
    // pushing is the only thing this result is used for.
    const { sql, calls } = makeFakeSql([]);
    await createNotificationStore(sql).broadcastPushPlayerIds("game_drop", false);
    expect(calls[0].text).toContain("FROM push_subscriptions s");
  });
});
