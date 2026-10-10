import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Tests for the `/game-html/` strategy in `public/sw.js` —
 * `networkFirstWithStaticFallback`, which every game iframe request goes through.
 *
 * Unlike the other `sw-*.test.ts` files this runs a whole STRATEGY, not one pure
 * decision, because the bug it pins lived in how two correct pieces were joined:
 * `isCacheable` rightly refuses `private, no-store` (a staged game must never be
 * kept on a device), and the strategy then used that same answer to decide
 * whether to RETURN the response. So a staged game's good 200 was thrown away,
 * the worker fell back to the public twin `/games/<slug>/index.html` — which a
 * staged game never has — and testers saw a 404 in the beta session's game area.
 *
 * The strategy and its helper are extracted from the real file by their
 * `@strategy-start gameHtml` markers, with `isCacheable` / `isUsableResponse`
 * taken from their own `@pure-start` blocks, and run against stub `fetch` and
 * `caches` — the same "no hand-copied decision" rule the other tests follow.
 */
const source = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");

function extract(re: RegExp, what: string): string {
  const block = source.match(re);
  if (!block) throw new Error(`${what} markers not found in public/sw.js — did the fixture move?`);
  return block[1];
}

const pure = (name: string) =>
  extract(
    new RegExp(`/\\* @pure-start ${name} \\*/([\\s\\S]*?)/\\* @pure-end \\*/`),
    name,
  );
const strategy = extract(
  /\/\* @strategy-start gameHtml \*\/([\s\S]*?)\/\* @strategy-end \*\//,
  "gameHtml strategy",
);
const helpers = ["isCacheable", "isUsableResponse"].map(pure).join("\n");

type StubResponse = {
  ok: boolean;
  status: number;
  redirected: boolean;
  type: string;
  headers: Headers;
  body: string;
  clone(): StubResponse;
};

function response(
  status: number,
  body: string,
  cacheControl?: string,
  over: Partial<StubResponse> = {},
): StubResponse {
  const headers = new Headers();
  if (cacheControl) headers.set("cache-control", cacheControl);
  const r: StubResponse = {
    ok: status >= 200 && status < 300,
    status,
    redirected: false,
    type: "basic",
    headers,
    body,
    clone: () => r,
    ...over,
  };
  return r;
}

/** The games the stub install precached, unless a test says otherwise. */
const PRECACHED = ["/games/duskfall/index.html", "/games/duskfall/cover.png"];

/**
 * Run the real strategy for `url`. `network` answers each fetch (or throws for
 * "offline"), and sees the request's `If-None-Match`; `cached` pre-seeds the
 * cache and `precached` stands in for the install's manifest. Returns the
 * response the iframe would get, what the worker wrote to its cache, and every
 * URL it fetched.
 */
async function run(
  url: string,
  network: (u: string, ifNoneMatch: string | null) => StubResponse | "offline",
  cached: Record<string, StubResponse> = {},
  precached: string[] = PRECACHED,
) {
  const store = new Map<string, StubResponse>(Object.entries(cached));
  const fetched: string[] = [];
  const keyOf = (r: unknown) =>
    (typeof r === "string" ? r : (r as { url: string }).url).replace(/^https?:\/\/[^/]+/, "");
  const cache = {
    put: async (r: unknown, v: StubResponse) => void store.set(keyOf(r), v),
    delete: async (r: unknown) => store.delete(keyOf(r)),
    match: async (r: unknown) => store.get(keyOf(r)),
  };
  const caches = {
    open: async () => cache,
    match: async (r: unknown) => store.get(keyOf(r)),
  };
  const fetch = async (r: unknown, init?: { headers?: Record<string, string> }) => {
    fetched.push(keyOf(r));
    const answer = network(keyOf(r), init?.headers?.["if-none-match"] ?? null);
    if (answer === "offline") throw new TypeError("Failed to fetch");
    return answer;
  };
  const RUNTIME_CACHE = "hp-runtime";
  const fn = new Function(
    "fetch",
    "caches",
    "RUNTIME_CACHE",
    "PRECACHED_PATHS",
    "Response",
    `${helpers}\n${strategy}\nreturn networkFirstWithStaticFallback;`,
  )(fetch, caches, RUNTIME_CACHE, new Set(precached), StubOffline) as (req: {
    url: string;
  }) => Promise<StubResponse>;

  const res = await fn({ url: `https://hallpass.example${url}` });
  return { res, cachedKeys: [...store.keys()], fetched };
}

/** Stands in for `Response` in the strategy's own offline page. */
class StubOffline {
  ok = false;
  type = "basic";
  redirected = false;
  headers = new Headers();
  constructor(
    public body: string,
    init: { status: number },
  ) {
    this.status = init.status;
  }
  status: number;
}

const REDIRECT_TO_TWIN = response(0, "", undefined, { ok: false, type: "opaqueredirect" });

function withEtag(res: StubResponse, etag: string): StubResponse {
  res.headers.set("etag", etag);
  return res;
}

const STAGED_DOC = "/game-html/living-flesh/?hp-rec=1";

describe("networkFirstWithStaticFallback", () => {
  it("serves a staged game's private, no-store 200 instead of discarding it", async () => {
    const { res } = await run(STAGED_DOC, (u) =>
      u.startsWith("/game-html/")
        ? response(200, "<html>living flesh</html>", "private, no-store")
        : response(404, "Not found"), // a staged game has no /games/<slug>/ twin
    );
    expect(res.status).toBe(200);
    expect(res.body).toBe("<html>living flesh</html>");
  });

  it("never writes the staged game to a device cache", async () => {
    const { cachedKeys } = await run(STAGED_DOC, () =>
      response(200, "<html>living flesh</html>", "private, no-store"),
    );
    expect(cachedKeys).toEqual([]);
  });

  it("still serves AND caches a public game", async () => {
    const { res, cachedKeys } = await run("/game-html/duskfall/", () =>
      response(200, "<html>duskfall</html>", "public, max-age=60, s-maxage=60"),
    );
    expect(res.body).toBe("<html>duskfall</html>");
    expect(cachedKeys).toEqual(["/game-html/duskfall/"]);
  });

  it("still follows the route's 307 to the static twin", async () => {
    const { res } = await run("/game-html/duskfall/", (u) =>
      u.startsWith("/game-html/")
        ? response(0, "", undefined, { ok: false, type: "opaqueredirect" })
        : response(200, "<html>static duskfall</html>"),
    );
    expect(res.body).toBe("<html>static duskfall</html>");
  });

  it("still falls back to the cached copy when offline", async () => {
    const { res } = await run("/game-html/duskfall/", () => "offline", {
      "/game-html/duskfall/": response(200, "<html>cached duskfall</html>"),
    });
    expect(res.body).toBe("<html>cached duskfall</html>");
  });
});

/**
 * A game over the precache budget (`scripts/lib/precache-budget.mjs`): the
 * install never downloaded its static twin, so the route's 307 must neither be
 * answered from a copy saved on an earlier play without asking (it would never
 * be replaced) nor download the whole file again every time.
 */
describe("a game over the precache budget", () => {
  const BIG_DOC = "/game-html/big/";
  const BIG_TWIN = "/games/big/index.html";

  it("fetches its static twin on first play and saves it", async () => {
    const { res, cachedKeys } = await run(BIG_DOC, (u) =>
      u === BIG_DOC ? REDIRECT_TO_TWIN : withEtag(response(200, "<html>big v1</html>"), '"v1"'),
    );
    expect(res.body).toBe("<html>big v1</html>");
    expect(cachedKeys).toEqual([BIG_TWIN]);
  });

  it("revalidates the saved copy and serves it on a 304", async () => {
    const seen: (string | null)[] = [];
    const { res } = await run(
      BIG_DOC,
      (u, ifNoneMatch) => {
        if (u === BIG_DOC) return REDIRECT_TO_TWIN;
        seen.push(ifNoneMatch);
        return response(304, "");
      },
      { [BIG_TWIN]: withEtag(response(200, "<html>big v1</html>"), 'W/"v1"') },
    );
    expect(seen).toEqual(['W/"v1"']);
    expect(res.status).toBe(200);
    expect(res.body).toBe("<html>big v1</html>");
  });

  it("replaces the saved copy when the game has changed", async () => {
    const { res, cachedKeys } = await run(
      BIG_DOC,
      (u) =>
        u === BIG_DOC ? REDIRECT_TO_TWIN : withEtag(response(200, "<html>big v2</html>"), '"v2"'),
      { [BIG_TWIN]: withEtag(response(200, "<html>big v1</html>"), '"v1"') },
    );
    expect(res.body).toBe("<html>big v2</html>");
    expect(cachedKeys).toEqual([BIG_TWIN]);
  });

  it("serves the saved copy when the twin cannot be reached", async () => {
    const { res } = await run(
      BIG_DOC,
      (u) => (u === BIG_DOC ? REDIRECT_TO_TWIN : "offline"),
      { [BIG_TWIN]: withEtag(response(200, "<html>big v1</html>"), '"v1"') },
    );
    expect(res.body).toBe("<html>big v1</html>");
  });

  it("plays the saved copy fully offline", async () => {
    const { res } = await run(BIG_DOC, () => "offline", {
      [BIG_TWIN]: response(200, "<html>big v1</html>"),
    });
    expect(res.body).toBe("<html>big v1</html>");
  });

  it("explains, rather than failing blank, when it was never played", async () => {
    const { res } = await run(BIG_DOC, (u) => (u === BIG_DOC ? REDIRECT_TO_TWIN : "offline"));
    expect(res.status).toBe(503);
    expect(res.body).toContain("Game unavailable offline");
  });

  it("leaves a precached game answering from its install-time copy", async () => {
    const { res, fetched } = await run(
      "/game-html/duskfall/",
      (u) => (u === "/game-html/duskfall/" ? REDIRECT_TO_TWIN : response(200, "<html>network</html>")),
      { "/games/duskfall/index.html": response(200, "<html>precached duskfall</html>") },
    );
    expect(res.body).toBe("<html>precached duskfall</html>");
    expect(fetched).toEqual(["/game-html/duskfall/"]);
  });
});
