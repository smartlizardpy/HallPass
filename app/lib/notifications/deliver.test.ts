/**
 * Tests for the delivery path.
 *
 * This is the module where a mistake is expensive in both directions — a
 * notification that should have been silent buzzes a phone in a lesson, and one
 * that should have been sent is simply never missed by anybody who could report
 * it. So the branches are pinned individually:
 *
 *   * a kind switched OFF writes nothing at all;
 *   * `bell` writes the row and does NOT push;
 *   * a DEDUPED write does not push, which is the link that stops a re-fired
 *     event buzzing every time;
 *   * an admin fan-out scopes its dedupe key per recipient, without which it
 *     would deliver to whichever admin came first and drop the rest;
 *   * the scope guards hold, so an admin kind can never become a broadcast row
 *     that every signed-in player can read.
 *
 * The store and the transport are mocked; what is under test is the DECISIONS,
 * not the SQL — `store.test.ts` owns the statements.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const insertPersonal = vi.fn();
const insertBroadcast = vi.fn();
const prefsFor = vi.fn();
const channelsForKind = vi.fn();
const broadcastPushPlayerIds = vi.fn();
const sendPushToPlayers = vi.fn();
const adminPlayerIds = vi.fn();

vi.mock("./index", () => ({
  notifications: {
    insertPersonal: (...args: unknown[]) => insertPersonal(...args),
    insertBroadcast: (...args: unknown[]) => insertBroadcast(...args),
    prefsFor: (...args: unknown[]) => prefsFor(...args),
    channelsForKind: (...args: unknown[]) => channelsForKind(...args),
    broadcastPushPlayerIds: (...args: unknown[]) => broadcastPushPlayerIds(...args),
  },
}));

vi.mock("./admins", () => ({
  adminPlayerIds: () => adminPlayerIds(),
}));

vi.mock("@/app/lib/push/send", () => ({
  sendPushToPlayers: (...args: unknown[]) => sendPushToPlayers(...args),
}));

import { notifyAdmins, notifyEveryone, notifyPlayer } from "./deliver";

const COPY = {
  title: "Ozan challenged you",
  body: "Beat their score on Duskfall.",
  url: "/play/you/friends",
};

beforeEach(() => {
  vi.clearAllMocks();
  prefsFor.mockResolvedValue({});
  channelsForKind.mockResolvedValue({});
  insertPersonal.mockResolvedValue(true);
  insertBroadcast.mockResolvedValue(true);
  broadcastPushPlayerIds.mockResolvedValue([]);
  adminPlayerIds.mockResolvedValue(["a1", "a2"]);
  sendPushToPlayers.mockResolvedValue(undefined);
});

describe("notifyPlayer", () => {
  it("writes the row and pushes at the kind's push default", async () => {
    // `challenge_received` defaults to push.
    await notifyPlayer("p1", { kind: "challenge_received", copy: COPY });

    expect(insertPersonal).toHaveBeenCalledTimes(1);
    expect(sendPushToPlayers).toHaveBeenCalledTimes(1);
    expect(sendPushToPlayers.mock.calls[0][0]).toEqual(["p1"]);
  });

  it("writes the row but does NOT push at the bell default", async () => {
    // `achievement_unlocked` defaults to bell — you were looking at the screen
    // when it happened.
    await notifyPlayer("p1", { kind: "achievement_unlocked", copy: COPY });

    expect(insertPersonal).toHaveBeenCalledTimes(1);
    expect(sendPushToPlayers).not.toHaveBeenCalled();
  });

  it("writes NOTHING AT ALL for a kind switched off", async () => {
    // Not a hidden row, not a filtered one. "Off" must not accrue rows nobody
    // will ever be shown.
    prefsFor.mockResolvedValue({ challenge_received: "off" });
    await notifyPlayer("p1", { kind: "challenge_received", copy: COPY });

    expect(insertPersonal).not.toHaveBeenCalled();
    expect(sendPushToPlayers).not.toHaveBeenCalled();
  });

  it("honours a stored deviation that turns push ON", async () => {
    prefsFor.mockResolvedValue({ achievement_unlocked: "push" });
    await notifyPlayer("p1", { kind: "achievement_unlocked", copy: COPY });

    expect(sendPushToPlayers).toHaveBeenCalledTimes(1);
  });

  it("does not push when the write was deduped", async () => {
    // The link that matters. Without it a producer re-firing a deduped event
    // would file nothing and buzz the phone every single time.
    insertPersonal.mockResolvedValue(false);
    await notifyPlayer("p1", { kind: "challenge_received", copy: COPY });

    expect(insertPersonal).toHaveBeenCalledTimes(1);
    expect(sendPushToPlayers).not.toHaveBeenCalled();
  });

  it("scopes the dedupe key to the recipient", async () => {
    await notifyPlayer("p1", {
      kind: "challenge_received",
      copy: COPY,
      dedupeKey: "event:7",
    });
    expect(insertPersonal.mock.calls[0][0].dedupeKey).toBe("event:7:p1");
  });

  it("passes no key through when the producer supplied none", async () => {
    await notifyPlayer("p1", { kind: "challenge_received", copy: COPY });
    expect(insertPersonal.mock.calls[0][0].dedupeKey).toBe(null);
  });

  it("sends the SAME copy to the row and to the device", async () => {
    // Deriving them separately is how a notification comes to say one thing in
    // the inbox and another on a lock screen.
    await notifyPlayer("p1", { kind: "challenge_received", copy: COPY });

    const row = insertPersonal.mock.calls[0][0];
    const push = sendPushToPlayers.mock.calls[0][1];
    expect(row.title).toBe(COPY.title);
    expect(push.full.title).toBe(COPY.title);
    expect(push.full.body).toBe(row.body);
  });

  it("carries the kind's discreet copy, never the full wording", async () => {
    await notifyPlayer("p1", { kind: "challenge_received", copy: COPY });
    const push = sendPushToPlayers.mock.calls[0][1];
    expect(push.discreet.body).toBe("You have a new challenge.");
    expect(push.discreet.body).not.toContain("Duskfall");
  });

  it("does nothing for a kind this deploy does not know", async () => {
    await notifyPlayer("p1", {
      // Deliberately outside the catalogue.
      kind: "from_the_future" as never,
      copy: COPY,
    });
    expect(insertPersonal).not.toHaveBeenCalled();
  });

  it("never rejects when the store throws", async () => {
    // Every caller has already committed the thing being announced. A throw
    // here would turn a successful action into an apparent failure.
    insertPersonal.mockRejectedValue(new Error("neon is down"));
    await expect(
      notifyPlayer("p1", { kind: "challenge_received", copy: COPY }),
    ).resolves.toBeUndefined();
  });

  it("still files the row when preferences cannot be read", async () => {
    // Falling back to the catalogue default, not to silence: an unreadable
    // preference must not be able to mute somebody.
    prefsFor.mockRejectedValue(new Error("neon is down"));
    await notifyPlayer("p1", { kind: "challenge_received", copy: COPY });
    expect(insertPersonal).toHaveBeenCalledTimes(1);
  });
});

describe("notifyAdmins", () => {
  it("files one row per admin", async () => {
    await notifyAdmins({ kind: "review_posted", copy: COPY });
    expect(insertPersonal).toHaveBeenCalledTimes(2);
    expect(insertPersonal.mock.calls.map((c) => c[0].playerId)).toEqual(["a1", "a2"]);
  });

  it("scopes the dedupe key PER ADMIN", async () => {
    // `dedupe_key` is unique across the whole table. Without the suffix the
    // first admin's insert would win and every other admin would be dropped.
    await notifyAdmins({
      kind: "review_posted",
      copy: COPY,
      dedupeKey: "review_posted:duskfall:p9",
    });
    expect(insertPersonal.mock.calls.map((c) => c[0].dedupeKey)).toEqual([
      "review_posted:duskfall:p9:a1",
      "review_posted:duskfall:p9:a2",
    ]);
  });

  it("reads the whole roster's preferences in one call", async () => {
    await notifyAdmins({ kind: "review_posted", copy: COPY });
    expect(channelsForKind).toHaveBeenCalledTimes(1);
    expect(prefsFor).not.toHaveBeenCalled();
  });

  it("respects each admin's own choice independently", async () => {
    // `review_reported` defaults to push; a2 has turned it down to bell and a3
    // has turned it off entirely.
    adminPlayerIds.mockResolvedValue(["a1", "a2", "a3"]);
    channelsForKind.mockResolvedValue({ a2: "bell", a3: "off" });

    await notifyAdmins({ kind: "review_reported", copy: COPY });

    expect(insertPersonal.mock.calls.map((c) => c[0].playerId)).toEqual(["a1", "a2"]);
    expect(sendPushToPlayers.mock.calls[0][0]).toEqual(["a1"]);
  });

  it("pushes ONCE for the whole roster, not once per admin", async () => {
    channelsForKind.mockResolvedValue({ a1: "push", a2: "push" });
    await notifyAdmins({ kind: "review_posted", copy: COPY });

    expect(sendPushToPlayers).toHaveBeenCalledTimes(1);
    expect(sendPushToPlayers.mock.calls[0][0]).toEqual(["a1", "a2"]);
  });

  it("does nothing when there are no admins with an arcade account", async () => {
    // Expected, not an error: the dashboard and the arcade are separate
    // sign-ins, so an admin may have no player row to file against.
    adminPlayerIds.mockResolvedValue([]);
    await notifyAdmins({ kind: "review_posted", copy: COPY });
    expect(insertPersonal).not.toHaveBeenCalled();
  });

  it("refuses a broadcast kind", async () => {
    // A broadcast row has no owner and is readable by every signed-in player.
    await notifyAdmins({ kind: "game_drop", copy: COPY });
    expect(insertPersonal).not.toHaveBeenCalled();
    expect(insertBroadcast).not.toHaveBeenCalled();
  });

  it("never rejects when the roster read throws", async () => {
    adminPlayerIds.mockRejectedValue(new Error("neon is down"));
    await expect(
      notifyAdmins({ kind: "review_posted", copy: COPY }),
    ).resolves.toBeUndefined();
  });
});

describe("notifyEveryone", () => {
  it("writes ONE row with no owner", async () => {
    await notifyEveryone({ kind: "game_drop", copy: COPY });
    expect(insertBroadcast).toHaveBeenCalledTimes(1);
    expect(insertPersonal).not.toHaveBeenCalled();
  });

  it("writes the row whatever anybody's preferences say", async () => {
    // One row, thousands of readers: there is no per-player decision to make at
    // write time. Whether a given player SEES it is decided on read.
    prefsFor.mockResolvedValue({ game_drop: "off" });
    await notifyEveryone({ kind: "game_drop", copy: COPY });
    expect(insertBroadcast).toHaveBeenCalledTimes(1);
  });

  it("passes the producer's key through UNSCOPED", async () => {
    // There is one row, so there is nobody to scope it to — and scoping would
    // break the once-per-game guarantee the game drop depends on.
    await notifyEveryone({
      kind: "game_drop",
      copy: COPY,
      dedupeKey: "game_drop:duskfall",
    });
    expect(insertBroadcast.mock.calls[0][0].dedupeKey).toBe("game_drop:duskfall");
  });

  it("does not push when the broadcast was already announced", async () => {
    // Marking a game New, un-marking it and marking it again is one drop, and
    // must be one buzz.
    insertBroadcast.mockResolvedValue(false);
    await notifyEveryone({
      kind: "game_drop",
      copy: COPY,
      dedupeKey: "game_drop:duskfall",
    });
    expect(broadcastPushPlayerIds).not.toHaveBeenCalled();
    expect(sendPushToPlayers).not.toHaveBeenCalled();
  });

  it("narrows to the opted-in few before touching the transport", async () => {
    // Handing the whole player table to the transport would be a device lookup
    // per account on the site for a single game drop.
    broadcastPushPlayerIds.mockResolvedValue(["p1", "p2"]);
    await notifyEveryone({ kind: "game_drop", copy: COPY });

    // `game_drop` defaults to bell, so the opt-in must be explicit.
    expect(broadcastPushPlayerIds).toHaveBeenCalledWith("game_drop", false);
    expect(sendPushToPlayers.mock.calls[0][0]).toEqual(["p1", "p2"]);
  });

  it("refuses a personal kind", async () => {
    // It would be written with no owner and shown to the whole site.
    await notifyEveryone({ kind: "challenge_received", copy: COPY });
    expect(insertBroadcast).not.toHaveBeenCalled();
  });

  it("still files the row when the push targeting throws", async () => {
    broadcastPushPlayerIds.mockRejectedValue(new Error("neon is down"));
    await expect(
      notifyEveryone({ kind: "game_drop", copy: COPY }),
    ).resolves.toBeUndefined();
    expect(insertBroadcast).toHaveBeenCalledTimes(1);
  });
});
