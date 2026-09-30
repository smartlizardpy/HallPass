/** A staged game's title must never reach a notification: titles come from the public resolver. */

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ notifyPlayer: vi.fn(), resolveGame: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/app/lib/notifications/deliver", () => ({ notifyPlayer: h.notifyPlayer }));
vi.mock("@/app/lib/games-store", () => ({ resolveGame: h.resolveGame }));
vi.mock("@/app/lib/notifications/copy", () => ({
  challengeBeatenCopy: (args: { game: string | null }) => ({ game: args.game }),
}));

import { notifyChallengesBeaten } from "./notify";

const challenge = (gameSlug: string) =>
  ({
    id: 1,
    challengerId: "p1",
    gameSlug,
    boardTitle: "Board",
    targetScore: 5,
  }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  h.resolveGame.mockImplementation(async (s: string) =>
    s === "live" ? { title: "Live Game" } : undefined,
  );
});

describe("notifyChallengesBeaten titles", () => {
  it("uses the public title for a live game", async () => {
    await notifyChallengesBeaten([challenge("live")], "Sam");
    expect(h.notifyPlayer.mock.calls[0][1].copy).toEqual({ game: "Live Game" });
  });

  it("drops the game title for a staged (publicly unresolvable) game", async () => {
    await notifyChallengesBeaten([challenge("beta")], "Sam");
    expect(h.notifyPlayer.mock.calls[0][1].copy).toEqual({ game: null });
  });
});
