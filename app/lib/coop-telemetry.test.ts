import { describe, expect, it } from "vitest";
import { COOP_MESSAGE_SOURCE, parseCoopMessage } from "./coop-telemetry";

const msg = (event: string, props: Record<string, unknown>, gameId: unknown = "last-bell", source: unknown = COOP_MESSAGE_SOURCE) => ({
  source,
  event,
  gameId,
  props,
});

describe("parseCoopMessage", () => {
  it("maps each event to its PostHog name and adds the game slug", () => {
    expect(parseCoopMessage(msg("room_created", { max_players: 4 }))).toEqual({
      event: "coop_room_created",
      props: { game_slug: "last-bell", max_players: 4 },
    });
    expect(parseCoopMessage(msg("session_started", { players: 2 }))?.event).toBe("coop_session_started");
    expect(parseCoopMessage(msg("player_joined", { players: 3 }))?.event).toBe("coop_player_joined");
    expect(parseCoopMessage(msg("session_ended", { duration_s: 600, peak_players: 3, reason: "left" }))).toEqual({
      event: "coop_session_ended",
      props: { game_slug: "last-bell", duration_s: 600, peak_players: 3, reason: "left" },
    });
  });

  it("drops messages that are not ours", () => {
    expect(parseCoopMessage(null)).toBeNull();
    expect(parseCoopMessage("hi")).toBeNull();
    expect(parseCoopMessage([])).toBeNull();
    expect(parseCoopMessage(msg("room_created", { max_players: 4 }, "last-bell", "other"))).toBeNull();
  });

  it("drops unknown events, including inherited object keys", () => {
    expect(parseCoopMessage(msg("game_started", {}))).toBeNull();
    expect(parseCoopMessage(msg("toString", {}))).toBeNull();
    expect(parseCoopMessage(msg("__proto__", {}))).toBeNull();
  });

  it("drops bad game ids", () => {
    for (const id of ["", "Last Bell", "../x", "a".repeat(65), 5, null]) {
      expect(parseCoopMessage(msg("room_created", { max_players: 4 }, id))).toBeNull();
    }
  });

  it("drops out-of-range, non-integer, missing or wrongly typed properties", () => {
    expect(parseCoopMessage(msg("room_created", { max_players: 0 }))).toBeNull();
    expect(parseCoopMessage(msg("room_created", { max_players: 9 }))).toBeNull();
    expect(parseCoopMessage(msg("session_started", { players: 1 }))).toBeNull();
    expect(parseCoopMessage(msg("session_started", { players: 2.5 }))).toBeNull();
    expect(parseCoopMessage(msg("session_started", { players: "2" }))).toBeNull();
    expect(parseCoopMessage(msg("session_started", {}))).toBeNull();
    expect(parseCoopMessage(msg("session_ended", { duration_s: -1, peak_players: 2, reason: "left" }))).toBeNull();
    expect(parseCoopMessage(msg("session_ended", { duration_s: 90_000, peak_players: 2, reason: "left" }))).toBeNull();
    expect(parseCoopMessage(msg("session_ended", { duration_s: 5, peak_players: 2, reason: "because" }))).toBeNull();
  });

  it("never passes extra properties through", () => {
    const out = parseCoopMessage(msg("session_started", { players: 2, name: "Sam", $set: { a: 1 } }));
    expect(out?.props).toEqual({ game_slug: "last-bell", players: 2 });
  });
});
