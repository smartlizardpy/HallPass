/**
 * Tests for Client ID Metadata Documents.
 *
 * Two properties carry the weight, and both are refusals:
 *
 *   1. A document whose `client_id` does not equal the URL it came from is
 *      rejected. Without that, anybody could host a document claiming to be
 *      somebody else's client and a client id would stop meaning anything.
 *   2. The fetch will not be pointed at a loopback or private host. The
 *      `client_id` arrives in an unauthenticated query string, so this module
 *      turns a stranger's string into an outbound request from the server.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CIMD_MAX_BYTES,
  clearCimdCache,
  fetchClientMetadata,
  isBlockedHost,
  isClientIdUrl,
  isFetchableMetadataUrl,
  validateClientMetadata,
} from "./cimd";

const URL_ID = "https://app.example.com/oauth/client-metadata.json";

const validDoc = (overrides: Record<string, unknown> = {}) => ({
  client_id: URL_ID,
  client_name: "Example MCP Client",
  redirect_uris: ["https://app.example.com/callback"],
  grant_types: ["authorization_code"],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
  ...overrides,
});

afterEach(() => {
  clearCimdCache();
  vi.unstubAllGlobals();
});

describe("isClientIdUrl", () => {
  it("recognises an https URL", () => {
    expect(isClientIdUrl(URL_ID)).toBe(true);
  });

  it("does not mistake an opaque registered id for one", () => {
    // Opaque ids are base64url from mintSecret and can never parse as a URL, so
    // the two namespaces cannot collide.
    expect(isClientIdUrl("zrbs2x-H8pUdxLix6cbDGMs3ZytSNSZ2dTLbDXQp5UI")).toBe(false);
    expect(isClientIdUrl("")).toBe(false);
  });

  it("does not accept http", () => {
    expect(isClientIdUrl("http://app.example.com/meta.json")).toBe(false);
  });
});

describe("isBlockedHost", () => {
  it("blocks loopback", () => {
    for (const host of ["localhost", "app.localhost", "127.0.0.1", "127.1.2.3", "::1", "[::1]"]) {
      expect(isBlockedHost(host)).toBe(true);
    }
  });

  it("blocks the private ranges and link-local", () => {
    for (const host of ["10.0.0.5", "192.168.1.1", "172.16.0.1", "172.31.255.255", "169.254.169.254"]) {
      expect(isBlockedHost(host)).toBe(true);
    }
  });

  it("blocks IPv6 unique-local and link-local", () => {
    expect(isBlockedHost("fd00::1")).toBe(true);
    expect(isBlockedHost("fe80::1")).toBe(true);
  });

  it("allows ordinary public hosts, including 172.32 which is not private", () => {
    for (const host of ["app.example.com", "claude.ai", "8.8.8.8", "172.32.0.1"]) {
      expect(isBlockedHost(host)).toBe(false);
    }
  });
});

describe("isFetchableMetadataUrl", () => {
  it("accepts a public https URL", () => {
    expect(isFetchableMetadataUrl(URL_ID)).toBe(true);
  });

  it("refuses the SSRF shapes", () => {
    expect(isFetchableMetadataUrl("http://app.example.com/m.json")).toBe(false);
    expect(isFetchableMetadataUrl("https://127.0.0.1/m.json")).toBe(false);
    expect(isFetchableMetadataUrl("https://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(isFetchableMetadataUrl("file:///etc/passwd")).toBe(false);
    expect(isFetchableMetadataUrl("https://user:pw@app.example.com/m.json")).toBe(false);
    expect(isFetchableMetadataUrl("not a url")).toBe(false);
  });
});

describe("validateClientMetadata", () => {
  it("accepts a well-formed document", () => {
    const result = validateClientMetadata(URL_ID, validDoc());
    expect(result).toEqual({
      ok: true,
      client: {
        clientId: URL_ID,
        clientName: "Example MCP Client",
        redirectUris: ["https://app.example.com/callback"],
      },
    });
  });

  it("REFUSES a document claiming somebody else's client_id", () => {
    const result = validateClientMetadata(URL_ID, validDoc({ client_id: "https://evil.example/m.json" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/does not match the URL/);
  });

  it("refuses a document with no client_id at all", () => {
    expect(validateClientMetadata(URL_ID, validDoc({ client_id: undefined })).ok).toBe(false);
  });

  it("applies the same redirect-URI rules as registration", () => {
    expect(validateClientMetadata(URL_ID, validDoc({ redirect_uris: [] })).ok).toBe(false);
    expect(
      validateClientMetadata(URL_ID, validDoc({ redirect_uris: ["http://evil.example/cb"] })).ok,
    ).toBe(false);
    // Loopback http is still fine — it is the native-client case.
    expect(
      validateClientMetadata(URL_ID, validDoc({ redirect_uris: ["http://127.0.0.1:9/cb"] })).ok,
    ).toBe(true);
  });

  it("refuses a client asking to hold a secret", () => {
    expect(
      validateClientMetadata(URL_ID, validDoc({ token_endpoint_auth_method: "client_secret_post" })).ok,
    ).toBe(false);
  });

  it("names the absence when a document has no client_name", () => {
    const result = validateClientMetadata(URL_ID, validDoc({ client_name: undefined }));
    expect(result.ok && result.client.clientName).toBe("An unnamed MCP client");
  });

  it("refuses a non-object body", () => {
    expect(validateClientMetadata(URL_ID, "nope").ok).toBe(false);
    expect(validateClientMetadata(URL_ID, [validDoc()]).ok).toBe(false);
    expect(validateClientMetadata(URL_ID, null).ok).toBe(false);
  });
});

describe("fetchClientMetadata", () => {
  const stub = (impl: (url: string) => Promise<Response> | Response) =>
    vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve(impl(String(url)))));

  it("fetches, validates and returns the client", async () => {
    stub(() => new Response(JSON.stringify(validDoc()), { status: 200 }));
    const result = await fetchClientMetadata(URL_ID);
    expect(result.ok && result.client.clientName).toBe("Example MCP Client");
  });

  it("never fetches a blocked host at all", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const result = await fetchClientMetadata("https://169.254.169.254/meta.json");
    expect(result.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not follow redirects", async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        calls.push(init);
        return Promise.resolve(new Response(JSON.stringify(validDoc()), { status: 200 }));
      }),
    );
    await fetchClientMetadata(URL_ID);
    expect(calls[0]?.redirect).toBe("manual");
  });

  it("refuses a document larger than the ceiling", async () => {
    stub(() => new Response("x".repeat(CIMD_MAX_BYTES + 1), { status: 200 }));
    const result = await fetchClientMetadata(URL_ID);
    expect(result.ok).toBe(false);
  });

  it("refuses invalid JSON", async () => {
    stub(() => new Response("<html>nope</html>", { status: 200 }));
    expect((await fetchClientMetadata(URL_ID)).ok).toBe(false);
  });

  it("does not leak the upstream status into the reason", async () => {
    stub(() => new Response("secret internal page", { status: 403 }));
    const result = await fetchClientMetadata(URL_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).not.toMatch(/403|secret internal/);
    }
  });

  it("caches, including failures, so a retry is not another outbound request", async () => {
    const spy = vi.fn(() => Promise.resolve(new Response("nope", { status: 500 })));
    vi.stubGlobal("fetch", spy);
    await fetchClientMetadata(URL_ID, 1000);
    await fetchClientMetadata(URL_ID, 1000);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("re-fetches once the cache has expired", async () => {
    const spy = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(validDoc()), { status: 200 })),
    );
    vi.stubGlobal("fetch", spy);
    await fetchClientMetadata(URL_ID, 0);
    await fetchClientMetadata(URL_ID, 60 * 60 * 1000);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
