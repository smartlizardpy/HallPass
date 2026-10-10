/**
 * Tests for the co-op agent prompt. The prompt is plain text an AI agent copies
 * into a game, so the failure worth catching is a silent one: teaching a method
 * the co-op SDK does not have, or pointing at a file HallPass does not serve.
 * Every `room.x(`, `room.voice.x(`, `client.x(` and `HallPassP2P.x(` call it
 * names is checked against the published `.d.ts`.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildCoopPrompt, COOP_SDK_PATH } from "./coop-prompt";

const ROOT = path.resolve(__dirname, "../..");
const DTS = readFileSync(path.join(ROOT, "public/sdk/p2p/v1/hallpass-p2p.d.ts"), "utf8");

const prompt = buildCoopPrompt({
  gameId: "last-bell",
  title: "Last Bell",
  baseUrl: "https://hallpass.example/",
});

/** The body of `interface <name> { … }` in the `.d.ts`. */
function members(name: string): Set<string> {
  const start = DTS.indexOf(`interface ${name} {`);
  expect(start, `interface ${name} in the .d.ts`).toBeGreaterThanOrEqual(0);
  const body = DTS.slice(start, DTS.indexOf("\n}", start));
  return new Set([...body.matchAll(/^ {4}(?:readonly )?(\w+)[(<?:]/gm)].map((m) => m[1]));
}

/** Every `<prefix>.<name>(` call in the prompt. */
function calls(prefix: string): string[] {
  const re = new RegExp(`(?<![\\w.])${prefix.replace(/\./g, "\\.")}\\.(\\w+)\\(`, "g");
  return [...new Set([...prompt.matchAll(re)].map((m) => m[1]))];
}

describe("buildCoopPrompt", () => {
  it("uses the game's slug and the SDK HallPass serves", () => {
    expect(prompt).toContain('gameId: "last-bell"');
    expect(prompt).toContain('await import("https://hallpass.example/sdk/p2p/v1/hallpass-p2p.js")');
    expect(prompt).not.toContain("hallpass.example//");
    expect(existsSync(path.join(ROOT, "public", COOP_SDK_PATH))).toBe(true);
  });

  it("loads the SDK so a failed import cannot break the game", () => {
    const load = prompt.slice(prompt.indexOf("let HallPassP2P = null;"));
    expect(load.indexOf("try {")).toBeGreaterThanOrEqual(0);
    expect(load.indexOf("try {")).toBeLessThan(load.indexOf("await import("));
  });

  it("only teaches room methods the SDK has", () => {
    const room = members("Room");
    const used = calls("room");
    expect(used).toEqual(expect.arrayContaining(["send", "on", "start", "handle", "request", "leave", "now"]));
    for (const m of used) expect(room, `room.${m}()`).toContain(m);
  });

  it("only teaches voice, client and connect calls the SDK has", () => {
    const voice = members("Voice");
    for (const m of calls("room.voice")) expect(voice, `room.voice.${m}()`).toContain(m);
    const client = members("Client");
    for (const m of calls("client")) expect(client, `client.${m}()`).toContain(m);
    expect(calls("HallPassP2P")).toEqual(["connect"]);
    const options = members("ConnectOptions");
    for (const key of ["gameId", "gameVersion", "name"]) expect(options).toContain(key);
  });

  it("only names events the room emits", () => {
    const events = [...prompt.matchAll(/room\.on\("([\w-]+)"/g)].map((m) => m[1]);
    const custom = new Set(["pos"]); // the game's own message, sent with room.send
    for (const e of events) {
      if (!custom.has(e)) expect(DTS, `room event "${e}"`).toContain(`on(event: "${e}"`);
    }
    for (const reason of ["host-left", "kicked", "timeout", "error"]) {
      expect(DTS).toMatch(new RegExp(`type CloseReason = [^;]*"${reason}"`));
    }
  });

  it("says co-op stays off in a preview and how to test it", () => {
    expect(prompt).toContain("THIS SDK THROWS");
    expect(prompt).toContain("Inside this Canvas preview, co-op cannot connect");
    expect(prompt).toContain("TWO tabs of the same browser");
  });
});
