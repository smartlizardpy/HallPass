/**
 * ICE configuration: STUN always, TURN only when configured, credentials that
 * follow the shared-secret REST scheme, and a provider failure that degrades to
 * STUN instead of throwing.
 */

import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildIceConfig, normalizeCloudflare, sharedSecretCredential, turnProvider } from "./ice";

const KEYS = [
  "P2P_STUN_URLS",
  "P2P_TURN_URLS",
  "P2P_TURN_SECRET",
  "P2P_TURN_CLOUDFLARE_KEY_ID",
  "P2P_TURN_CLOUDFLARE_API_TOKEN",
  "P2P_TURN_TTL_SECONDS",
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

describe("buildIceConfig", () => {
  it("is STUN-only with no TURN configured", async () => {
    const ice = await buildIceConfig({ withTurn: true });
    expect(ice.turn).toBe(false);
    expect(ice.expiresAt).toBeNull();
    expect(JSON.stringify(ice.iceServers)).toContain("stun:");
    expect(JSON.stringify(ice.iceServers)).not.toContain("turn:");
    expect(turnProvider()).toBeNull();
  });

  it("mints shared-secret TURN credentials that a TURN server can verify", async () => {
    process.env.P2P_TURN_URLS = "turn:turn.example.org:3478, turns:turn.example.org:443";
    process.env.P2P_TURN_SECRET = "s3cret";
    const now = 1_700_000_000_000;
    const ice = await buildIceConfig({ withTurn: true, nowMs: now });
    expect(ice.turn).toBe(true);
    const turn = ice.iceServers.find((s) => s.username)!;
    expect(turn.urls).toEqual(["turn:turn.example.org:3478", "turns:turn.example.org:443"]);
    const expected = createHmac("sha1", "s3cret").update(turn.username!).digest("base64");
    expect(turn.credential).toBe(expected);
    expect(Number(turn.username!.split(":")[0]) * 1000).toBe(ice.expiresAt);
    expect(ice.expiresAt).toBe(now + 4 * 3600 * 1000);
  });

  it("skips TURN when the caller is over its limit", async () => {
    process.env.P2P_TURN_URLS = "turn:t.example:3478";
    process.env.P2P_TURN_SECRET = "s";
    const ice = await buildIceConfig({ withTurn: false });
    expect(ice.turn).toBe(false);
  });

  it("uses Cloudflare when configured and drops port-53 URLs", async () => {
    process.env.P2P_TURN_CLOUDFLARE_KEY_ID = "key";
    process.env.P2P_TURN_CLOUDFLARE_API_TOKEN = "tok";
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          iceServers: [
            { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] },
            {
              urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turn:turn.cloudflare.com:53?transport=udp"],
              username: "u",
              credential: "c",
            },
          ],
        }),
        { status: 201 },
      ),
    );
    const ice = await buildIceConfig({ withTurn: true, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(String(fetchImpl.mock.calls[0][0])).toContain("/turn/keys/key/credentials/generate-ice-servers");
    expect(ice.turn).toBe(true);
    expect(JSON.stringify(ice.iceServers)).not.toContain(":53");
  });

  it("degrades to STUN when Cloudflare fails", async () => {
    process.env.P2P_TURN_CLOUDFLARE_KEY_ID = "key";
    process.env.P2P_TURN_CLOUDFLARE_API_TOKEN = "tok";
    vi.spyOn(console, "error").mockImplementation(() => {});
    const ice = await buildIceConfig({ withTurn: true, fetchImpl: vi.fn().mockRejectedValue(new Error("down")) });
    expect(ice.turn).toBe(false);
  });
});

describe("normalizeCloudflare", () => {
  it("accepts the legacy single-object shape", () => {
    expect(normalizeCloudflare({ iceServers: { urls: "turn:x:3478", username: "u", credential: "c" } })).toEqual([
      { urls: ["turn:x:3478"], username: "u", credential: "c" },
    ]);
    expect(normalizeCloudflare(null)).toEqual([]);
  });
});

describe("sharedSecretCredential", () => {
  it("puts the expiry first in the username", () => {
    const c = sharedSecretCredential("k", 60, 1000_000);
    expect(c.username).toBe("1060:hallpass");
  });
});
