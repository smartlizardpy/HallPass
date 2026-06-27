// @vitest-environment jsdom
/**
 * Transport guarantees: never throw, always resolve to a uniform shape, and cap
 * every request with a timeout. fetch is stubbed per case.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { getJSON, postJSON } from "./transport";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("transport", () => {
  it("getJSON resolves { ok:false, status:0 } when fetch rejects, never throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));

    const result = await getJSON("https://x.example/a");

    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
  });

  it("postJSON resolves { ok:false, status:0 } when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));

    const result = await postJSON("https://x.example/a", { score: 1 });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
  });

  it("getJSON returns parsed data on a 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ hello: "world" }, 200)),
    );

    const result = await getJSON("https://x.example/a");

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ hello: "world" });
  });

  it("maps a non-2xx body's error message through", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: "slow down" }, 429)),
    );

    const result = await postJSON("https://x.example/a", {});

    expect(result.ok).toBe(false);
    expect(result.status).toBe(429);
    expect(result.error).toBe("slow down");
  });

  it("times out and resolves { ok:false, status:0 } via AbortController", async () => {
    vi.stubGlobal(
      "fetch",
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init.signal;
          if (signal) {
            signal.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }
        }),
    );
    vi.useFakeTimers();

    const pending = getJSON("https://x.example/slow");
    await vi.advanceTimersByTimeAsync(6000);
    const result = await pending;

    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
  });
});
