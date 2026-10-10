// @vitest-environment jsdom
/**
 * The inline stub games paste before the SDK script.
 *
 * It exists in three places that must stay byte-identical — `sdk/README.md`, the
 * integration prompt (`app/lib/integration-prompt.ts`) and `/llms-full.txt` —
 * because developers and their AI assistants copy whichever one they found. And
 * its 2 s inert fallback must resolve the same shapes as the SDK's own
 * `safeDefault`, since a game cannot tell which of the two settled its call.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const COPIES = ["sdk/README.md", "app/lib/integration-prompt.ts", "app/llms-full.txt/route.ts"];

function stubFrom(file: string): string {
  const text = readFileSync(path.join(ROOT, file), "utf8");
  const match = text.match(/\(function\(w\)\{if\(w\.HallPass[\s\S]*?\}\)\(window\);/);
  if (!match) throw new Error(`no stub in ${file}`);
  return match[0];
}

type Stubbed = {
  version: string;
  mode: string;
  invite: (opts: unknown) => Promise<unknown>;
  getLaunch: () => unknown;
  challenge: () => Promise<unknown>;
  getScores: () => Promise<unknown>;
};

afterEach(() => {
  vi.useRealTimers();
  delete (window as unknown as { HallPass?: unknown }).HallPass;
  delete (window as unknown as { HP?: unknown }).HP;
});

describe("the inline stub", () => {
  it("is byte-identical in all three places it is published", () => {
    const [first, ...rest] = COPIES.map(stubFrom);
    for (const other of rest) expect(other).toBe(first);
  });

  it("knows invite and getLaunch, and settles them safely when no SDK arrives", async () => {
    vi.useFakeTimers();
    new Function("window", stubFrom("sdk/README.md"))(window);
    const hp = (window as unknown as { HallPass: Stubbed }).HallPass;
    expect(hp.version).toBe("0");

    // Synchronous, and null before the real SDK can know.
    expect(hp.getLaunch()).toBeNull();

    const invite = hp.invite({ data: { room: "ABCD" } });
    const challenge = hp.challenge();
    const scores = hp.getScores();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(hp.mode).toBe("inert");
    await expect(invite).resolves.toEqual({ sent: 0, link: null, cancelled: true });
    await expect(challenge).resolves.toEqual({ ok: false, sent: false, reason: "inert" });
    await expect(scores).resolves.toEqual([]);
  });
});
