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
  CIMD_MAX_REDIRECTS,
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
    // The three the CIMD draft forbids by name: each needs a secret agreed in
    // advance, and nothing was ever agreed with a client identified by a URL.
    for (const method of ["client_secret_post", "client_secret_basic", "client_secret_jwt"]) {
      const result = validateClientMetadata(URL_ID, validDoc({ token_endpoint_auth_method: method }));
      expect(result.ok).toBe(false);
      // The refusal names the method, so the operator is not left comparing
      // their document against a rule restated at them.
      if (!result.ok) expect(result.reason).toContain(method);
    }
  });

  it("reads an absent token_endpoint_auth_method as a public client", () => {
    // RFC 7591's default is client_secret_basic, which is meaningless for a
    // client that cannot have a secret. Absence means "none" here.
    expect(validateClientMetadata(URL_ID, validDoc({ token_endpoint_auth_method: undefined })).ok).toBe(
      true,
    );
  });

  it("refuses a token_endpoint_auth_method that is not a string", () => {
    expect(validateClientMetadata(URL_ID, validDoc({ token_endpoint_auth_method: 7 })).ok).toBe(false);
    expect(validateClientMetadata(URL_ID, validDoc({ token_endpoint_auth_method: ["none"] })).ok).toBe(
      false,
    );
  });

  it("ACCEPTS private_key_jwt when the client publishes that it can also do none", () => {
    // The case this whole branch exists for. private_key_jwt is not a client
    // overreaching -- the draft recommends it -- and HallPass simply does not
    // implement it, so the client's own published fallback is what makes the
    // two agree on "none".
    const result = validateClientMetadata(
      URL_ID,
      validDoc({
        token_endpoint_auth_method: "private_key_jwt",
        token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
        jwks_uri: "https://app.example.com/jwks.json",
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("refuses private_key_jwt with no published fallback, rather than silently downgrading it", () => {
    // Accepting this would mean issuing tokens to a client that believes it
    // authenticated with a key nothing here ever checked.
    const result = validateClientMetadata(
      URL_ID,
      validDoc({ token_endpoint_auth_method: "private_key_jwt" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("private_key_jwt");
  });

  it("does not take a shared-secret method as negotiable, fallback or not", () => {
    // token_endpoint_auth_methods_supported may only narrow the outcome. It
    // must never rescue a method the draft forbids outright.
    expect(
      validateClientMetadata(
        URL_ID,
        validDoc({
          token_endpoint_auth_method: "client_secret_post",
          token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
        }),
      ).ok,
    ).toBe(false);
  });

  it("accepts ChatGPT's real connector document", () => {
    // Copied verbatim from https://chatgpt.com/oauth/<id>/client.json on
    // 2026-09-13, the document that was being refused. Kept whole rather than
    // reduced to the one field, because the point is that a real connector's
    // document passes end to end, not that one branch returns true.
    const chatgpt = "https://chatgpt.com/oauth/09QNletoUsmb/client.json";
    const result = validateClientMetadata(chatgpt, {
      client_id: chatgpt,
      client_uri: "https://chatgpt.com/",
      redirect_uris: ["https://chatgpt.com/connector/oauth/09QNletoUsmb"],
      token_endpoint_auth_method: "private_key_jwt",
      token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: "ChatGPT",
      logo_uri: "https://persistent.oaistatic.com/sonic/misc/openai-logo.png",
      token_endpoint_auth_signing_alg: "RS256",
      jwks_uri: "https://chatgpt.com/oauth/jwks.json",
    });
    expect(result).toEqual({
      ok: true,
      client: {
        clientId: chatgpt,
        clientName: "ChatGPT",
        redirectUris: ["https://chatgpt.com/connector/oauth/09QNletoUsmb"],
      },
    });
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

  it("never lets fetch follow redirects itself", async () => {
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

  it("follows an ordinary redirect by hand — apex to www is not an attack", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        seen.push(String(url));
        if (seen.length === 1) {
          return Promise.resolve(
            new Response(null, {
              status: 301,
              headers: { location: "https://www.app.example.com/oauth/client-metadata.json" },
            }),
          );
        }
        return Promise.resolve(new Response(JSON.stringify(validDoc()), { status: 200 }));
      }),
    );
    const result = await fetchClientMetadata(URL_ID);
    expect(result.ok).toBe(true);
    expect(seen).toHaveLength(2);
  });

  it("resolves a RELATIVE Location against the current URL", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        seen.push(String(url));
        if (seen.length === 1) {
          return Promise.resolve(
            new Response(null, { status: 302, headers: { location: "/oauth/meta-v2.json" } }),
          );
        }
        return Promise.resolve(new Response(JSON.stringify(validDoc()), { status: 200 }));
      }),
    );
    await fetchClientMetadata(URL_ID);
    expect(seen[1]).toBe("https://app.example.com/oauth/meta-v2.json");
  });

  it("REFUSES a redirect to a private host — the SSRF hop", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        seen.push(String(url));
        return Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: "http://169.254.169.254/latest/meta-data/" },
          }),
        );
      }),
    );
    const result = await fetchClientMetadata(URL_ID);
    expect(result.ok).toBe(false);
    // The second request must never have been made.
    expect(seen).toHaveLength(1);
  });

  it("refuses a redirect chain longer than the cap", async () => {
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        n += 1;
        return Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: `https://app.example.com/hop${n}.json` },
          }),
        );
      }),
    );
    const result = await fetchClientMetadata(URL_ID);
    expect(result.ok).toBe(false);
    expect(n).toBe(CIMD_MAX_REDIRECTS + 1);
  });

  it("refuses a redirect with no Location header", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(null, { status: 302 }))));
    expect((await fetchClientMetadata(URL_ID)).ok).toBe(false);
  });

  it("validates the document against the ORIGINAL id, not the redirected URL", async () => {
    // Otherwise a redirect could change which identity a document may claim.
    let first = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        if (first) {
          first = false;
          return Promise.resolve(
            new Response(null, {
              status: 301,
              headers: { location: "https://www.app.example.com/m.json" },
            }),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify(validDoc({ client_id: "https://www.app.example.com/m.json" })),
            { status: 200 },
          ),
        );
      }),
    );
    const result = await fetchClientMetadata(URL_ID);
    expect(result.ok).toBe(false);
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
