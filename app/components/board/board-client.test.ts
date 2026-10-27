import { afterEach, describe, expect, it, vi } from "vitest";
import { bindGame, endSession, removeParticipant, unbindGame, unbindOnExit } from "./board-client";

afterEach(() => vi.unstubAllGlobals());

function stub(status = 200, body: unknown = { ok: true }) {
  const f = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", f);
  return f;
}
const contentType = (f: ReturnType<typeof stub>) =>
  new Headers((f.mock.calls[0][1] as RequestInit).headers).get("content-type");

describe("every board call is JSON, including bodiless DELETEs", () => {
  it.each([
    ["unbind", () => unbindGame()],
    ["end session", () => endSession()],
    ["remove player", () => removeParticipant("abc")],
  ])("%s sends Content-Type: application/json", async (_n, call) => {
    const f = stub();
    await call();
    expect(contentType(f)).toBe("application/json");
  });

  it("the page-exit unbind does too", () => {
    const f = stub();
    unbindOnExit();
    expect(contentType(f)).toBe("application/json");
  });
});

describe("bindGame outcomes", () => {
  it("maps ok, busy, expired, other failures and a dead network", async () => {
    stub(200); expect(await bindGame("p", "g")).toBe("ok");
    stub(409, { ok: false }); expect(await bindGame("p", "g")).toBe("busy");
    stub(401, { ok: false }); expect(await bindGame("p", "g")).toBe("gone");
    stub(404, { ok: false }); expect(await bindGame("p", "g")).toBe("error");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    expect(await bindGame("p", "g")).toBe("network");
  });
});
