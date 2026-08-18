import { describe, expect, it } from "vitest";
import type { Game, GamePlatform } from "@/app/lib/games";
import { gameFaq } from "@/app/lib/faq";

const game = (partial: Partial<Game> = {}): Game =>
  ({ slug: "g", title: "Neon Velocity", tags: [], category: "Action", ...partial }) as Game;

const questions = (g: Game) => gameFaq(g).map((e) => e.question);
const answerTo = (g: Game, match: string) =>
  gameFaq(g).find((e) => e.question.includes(match))?.answer ?? "";

describe("gameFaq", () => {
  it("always answers price, download and school", () => {
    expect(questions(game())).toEqual([
      "Is Neon Velocity free to play?",
      "Do I need to download anything to play Neon Velocity?",
      "Can I play Neon Velocity at school?",
    ]);
  });

  it("names the game in every question, since each is read on its own", () => {
    for (const entry of gameFaq(game({ platform: "both" }))) {
      expect(entry.question).toContain("Neon Velocity");
    }
  });

  it("answers the phone question from the recorded platform", () => {
    const cases: [GamePlatform, string][] = [
      ["both", "works on a phone or tablet"],
      ["mobile", "made for touch"],
      ["desktop", "needs a keyboard and mouse"],
    ];
    for (const [platform, expected] of cases) {
      expect(answerTo(game({ platform }), "work on a phone")).toContain(expected);
    }
  });

  it("asks NOTHING about phones when the platform was never checked", () => {
    expect(questions(game())).not.toContain("Does Neon Velocity work on a phone?");
    // A row read back off the wire can carry null rather than undefined —
    // `toGamePlatform` returns null for anything unrecognised — so the absent
    // case has to survive both spellings.
    expect(
      questions(game({ platform: null as unknown as undefined })),
    ).not.toContain("Does Neon Velocity work on a phone?");
  });

  it("promises offline play for a local game", () => {
    expect(answerTo(game(), "at school")).toContain("keeps working even when the network drops");
  });

  it("does NOT promise offline play for an externally hosted game", () => {
    const external = game({ externalUrl: "https://example.com/play" });
    const answer = answerTo(external, "at school");
    expect(answer).not.toContain("keeps working even when the network drops");
    expect(answer).toContain("needs a working connection");
  });

  it("never returns an empty FAQ, whatever the game is missing", () => {
    expect(
      gameFaq(game({ platform: undefined, externalUrl: "https://x.test" })).length,
    ).toBeGreaterThan(0);
  });
});
