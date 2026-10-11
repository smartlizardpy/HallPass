// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./notice", () => ({ confirmIpNotice: vi.fn() }));

import { connect } from "./client";
import { env } from "./env";
import { confirmIpNotice } from "./notice";
import { installFakeRTC } from "../test/fake-rtc";

const confirm = vi.mocked(confirmIpNotice);

beforeAll(() => installFakeRTC(env));
beforeEach(() => {
  confirm.mockReset();
  // The hallpass transport fetches /config; there is no server here.
  vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
});

describe("IP notice gating", () => {
  it("Cancel rejects createRoom with a cancelled error and never hangs", async () => {
    confirm.mockResolvedValue(false);
    const client = await connect({ gameId: "notice-game", transport: "hallpass", api: "http://x.invalid" });
    const err = await client.createRoom().catch((e) => e);
    expect(err.name).toBe("P2PError");
    expect(err.code).toBe("cancelled");
    expect(confirm).toHaveBeenCalledTimes(1);
    // The client is usable again afterwards (not stuck "already-in-room").
    expect((await client.createRoom().catch((e) => e)).code).toBe("cancelled");
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("is not shown for the local transport", async () => {
    const client = await connect({ gameId: "notice-local", transport: "local" });
    const room = await client.createRoom();
    expect(confirm).not.toHaveBeenCalled();
    await room.leave();
    await client.close();
  });

  it("is not shown for relay-only (which fails here: no relay server)", async () => {
    const client = await connect({ gameId: "notice-relay", transport: "hallpass", relayOnly: true, api: "http://x.invalid" });
    const err = await client.createRoom().catch((e) => e);
    expect(err.reason).toBe("relay-unavailable");
    expect(confirm).not.toHaveBeenCalled();
  });

  it("ipNotice: 'custom' skips the SDK's notice", async () => {
    const client = await connect({ gameId: "notice-custom", transport: "hallpass", ipNotice: "custom", api: "http://x.invalid" });
    const err = await client.createRoom().catch((e) => e);
    expect(err.code).not.toBe("cancelled");
    expect(confirm).not.toHaveBeenCalled();
  });
});
