// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The cache lives at module scope, so each test re-imports the module through
 * `vi.resetModules()` instead of reaching for a test-only reset export.
 */
type Mod = typeof import("./social-cache");

/** Minimal stand-in for `HTMLImageElement` — jsdom never fetches. */
class FakeImage {
  static instances: FakeImage[] = [];

  decoding = "";
  referrerPolicy = "";
  private value = "";

  constructor() {
    FakeImage.instances.push(this);
  }

  get src(): string {
    return this.value;
  }

  set src(next: string) {
    this.value = next;
  }

  addEventListener() {}
  decode(): Promise<void> {
    return Promise.resolve();
  }
}

const friendsPayload = (over: Partial<Record<string, unknown>> = {}) => ({
  signedIn: true,
  enabled: true,
  friends: [{ id: "1", displayName: "Ada", username: "ada", image: "https://g/ada.png" }],
  incoming: [{ id: "2", displayName: "Rae", username: "rae", image: "https://g/rae.png" }],
  outgoing: [],
  ...over,
});

const challengesPayload = { signedIn: true, incoming: [], outgoing: [] };

/** A `fetch` that answers each endpoint from a table, recording every call. */
function stubFetch(table: Record<string, unknown>, ok = true) {
  const fetchMock = vi.fn(async (url: string) => {
    const path = url.split("?")[0];
    return {
      ok,
      json: async () => table[path],
    } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

let mod: Mod;

beforeEach(async () => {
  FakeImage.instances = [];
  vi.stubGlobal("Image", FakeImage);
  vi.resetModules();
  mod = await import("./social-cache");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("refreshFriends", () => {
  it("stores the response", async () => {
    stubFetch({ "/api/v1/me/friends": friendsPayload() });

    expect(mod.readCachedFriends()).toBeNull();
    await mod.refreshFriends();

    expect(mod.readCachedFriends()?.friends).toHaveLength(1);
  });

  it("shares one round trip between concurrent callers", async () => {
    // The splash warms these, and the island mounts a beat later and asks again.
    // Two requests for the same thing is the bug this dedupe exists to stop.
    const fetchMock = stubFetch({ "/api/v1/me/friends": friendsPayload() });

    await Promise.all([mod.refreshFriends(), mod.refreshFriends()]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps what it had when the network fails", async () => {
    stubFetch({ "/api/v1/me/friends": friendsPayload() });
    await mod.refreshFriends();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    await mod.refreshFriends();

    expect(mod.readCachedFriends()?.friends).toHaveLength(1);
  });

  it("keeps what it had when the server answers with an error", async () => {
    stubFetch({ "/api/v1/me/friends": friendsPayload() });
    await mod.refreshFriends();

    stubFetch({ "/api/v1/me/friends": { signedIn: false } }, false);
    await mod.refreshFriends();

    expect(mod.readCachedFriends()?.friends).toHaveLength(1);
  });
});

describe("signing out", () => {
  it("drops the other endpoint's payload when a response says signed out", async () => {
    stubFetch({
      "/api/v1/me/friends": friendsPayload(),
      "/api/v1/me/challenges": challengesPayload,
    });
    await Promise.all([mod.refreshFriends(), mod.refreshChallenges()]);
    expect(mod.readCachedChallenges()).not.toBeNull();

    stubFetch({
      "/api/v1/me/friends": friendsPayload({ signedIn: false, friends: [], incoming: [] }),
    });
    await mod.refreshFriends();

    // The signed-out body itself is kept — it is what draws the "Sign in" panel
    // — but nothing personal from the other endpoint survives alongside it.
    expect(mod.readCachedFriends()?.signedIn).toBe(false);
    expect(mod.readCachedChallenges()).toBeNull();
  });

  it("clears both on demand", async () => {
    stubFetch({
      "/api/v1/me/friends": friendsPayload(),
      "/api/v1/me/challenges": challengesPayload,
    });
    await Promise.all([mod.refreshFriends(), mod.refreshChallenges()]);

    mod.clearSocialCache();

    expect(mod.readCachedFriends()).toBeNull();
    expect(mod.readCachedChallenges()).toBeNull();
  });
});

describe("warmSocial", () => {
  it("fetches both endpoints and preloads the faces with no-referrer", async () => {
    const fetchMock = stubFetch({
      "/api/v1/me/friends": friendsPayload(),
      "/api/v1/me/challenges": challengesPayload,
    });

    await mod.warmSocial();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(FakeImage.instances).toHaveLength(2);
    // Friends AND incoming requests — a pending request renders a face too.
    expect(FakeImage.instances.map((i) => i.src)).toEqual([
      "https://g/ada.png",
      "https://g/rae.png",
    ]);
    // `Avatar.tsx` forbids fetching a Google-hosted avatar without this.
    expect(FakeImage.instances.every((i) => i.referrerPolicy === "no-referrer")).toBe(true);
  });

  it("does not refetch what is still fresh", async () => {
    const fetchMock = stubFetch({
      "/api/v1/me/friends": friendsPayload(),
      "/api/v1/me/challenges": challengesPayload,
    });

    // Awaited, not polled on the call count: `fetch` is invoked synchronously
    // and the response is stored two microtasks later, so a `waitFor` on the
    // count would let the second warm-up hit the in-flight dedupe and this test
    // would pass without the freshness rule existing at all.
    await mod.warmSocial();
    await mod.warmSocial();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refetches once the entry has aged past the TTL", async () => {
    const fetchMock = stubFetch({
      "/api/v1/me/friends": friendsPayload(),
      "/api/v1/me/challenges": challengesPayload,
    });
    const start = Date.now();

    await mod.warmSocial();

    vi.spyOn(Date, "now").mockReturnValue(start + 61_000);
    await mod.warmSocial();

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
