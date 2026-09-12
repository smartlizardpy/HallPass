/**
 * Tests for the two OAuth discovery documents.
 *
 * The properties worth pinning are the ones whose breakage is SILENT — a client
 * that cannot connect reports "unauthorized" and says nothing about which field
 * was wrong:
 *
 *   * every endpoint sits on the origin it was asked from, never on `SITE_URL`;
 *   * what the metadata advertises matches what `oauth/config.ts` accepts.
 */

import { describe, expect, it } from "vitest";
import { OAUTH_SCOPE } from "./config";
import {
  MCP_RESOURCE_PATH,
  PROTECTED_RESOURCE_METADATA_PATH,
  authorizationServerMetadata,
  mcpResource,
  originOf,
  protectedResourceMetadata,
  protectedResourceMetadataUrl,
} from "./metadata";

const PROD = "https://hallpass-rouge.vercel.app";
const LOCAL = "http://localhost:3000";

describe("originOf", () => {
  it("keeps only the origin, with no trailing slash", () => {
    expect(originOf(`${PROD}/api/mcp`)).toBe(PROD);
    expect(originOf(`${LOCAL}/.well-known/oauth-authorization-server?x=1`)).toBe(LOCAL);
  });

  it("keeps a non-default port, which is the whole of local development", () => {
    expect(originOf("http://127.0.0.1:51234/cb")).toBe("http://127.0.0.1:51234");
  });
});

describe("protectedResourceMetadata", () => {
  it("names the resource and this same origin as its authorization server", () => {
    const doc = protectedResourceMetadata(PROD);
    expect(doc.resource).toBe(`${PROD}${MCP_RESOURCE_PATH}`);
    expect(doc.authorization_servers).toEqual([PROD]);
  });

  it("advertises exactly the scope the server grants", () => {
    expect(protectedResourceMetadata(PROD).scopes_supported).toEqual([OAUTH_SCOPE]);
  });

  it("follows the request origin rather than hard-coding production", () => {
    const doc = protectedResourceMetadata(LOCAL);
    expect(doc.resource).toBe(`${LOCAL}/api/mcp`);
    expect(JSON.stringify(doc)).not.toContain("hallpass-rouge");
  });
});

describe("protectedResourceMetadataUrl", () => {
  it("is the RFC 9728 path — the well-known prefix plus the resource path", () => {
    expect(protectedResourceMetadataUrl(PROD)).toBe(
      `${PROD}/.well-known/oauth-protected-resource/api/mcp`,
    );
    expect(PROTECTED_RESOURCE_METADATA_PATH).toBe(
      "/.well-known/oauth-protected-resource/api/mcp",
    );
  });

  it("is the value the 401's WWW-Authenticate must carry, verbatim", () => {
    const header = `Bearer resource_metadata="${protectedResourceMetadataUrl(PROD)}"`;
    expect(header).toContain(PROD);
    expect(header).not.toContain('""');
  });
});

describe("authorizationServerMetadata", () => {
  const doc = authorizationServerMetadata(PROD);

  it("puts every endpoint on the issuer's own origin", () => {
    expect(doc.issuer).toBe(PROD);
    for (const endpoint of [
      doc.authorization_endpoint,
      doc.token_endpoint,
      doc.registration_endpoint,
      doc.revocation_endpoint,
    ]) {
      expect(endpoint.startsWith(`${PROD}/`)).toBe(true);
    }
  });

  it("advertises S256 ONLY — advertising plain would invite a refused flow", () => {
    expect(doc.code_challenge_methods_supported).toEqual(["S256"]);
  });

  it("advertises exactly the three auth methods the token endpoint implements", () => {
    // `none` for self-registered public clients, and the two secret-bearing
    // methods for a connector an admin created by hand. Advertising a method
    // the token endpoint does not implement is worse than omitting it: a client
    // will pick it and fail with invalid_client.
    expect(doc.token_endpoint_auth_methods_supported).toEqual([
      "none",
      "client_secret_post",
      "client_secret_basic",
    ]);
  });

  it("still offers `none`, so a public client is never forced to hold a secret", () => {
    expect(doc.token_endpoint_auth_methods_supported).toContain("none");
  });

  it("advertises Client ID Metadata Documents alongside dynamic registration", () => {
    // Both, because a client picks whichever it implements: the 2026-07-28 spec
    // prefers CIMD and ChatGPT looks for it, while every client already using
    // DCR must keep working.
    expect(doc.client_id_metadata_document_supported).toBe(true);
    expect(doc.registration_endpoint).toBeTruthy();
  });

  it("advertises a registration endpoint — without it Claude cannot connect", () => {
    expect(doc.registration_endpoint).toBe(`${PROD}/api/oauth/register`);
  });

  it("advertises only the two grants the token endpoint implements", () => {
    expect(doc.grant_types_supported).toEqual(["authorization_code", "refresh_token"]);
    expect(doc.response_types_supported).toEqual(["code"]);
  });

  it("agrees with the protected-resource document about the scope", () => {
    expect(doc.scopes_supported).toEqual(protectedResourceMetadata(PROD).scopes_supported);
  });
});

describe("mcpResource", () => {
  it("is what a token's audience must name, and is origin-relative", () => {
    expect(mcpResource(LOCAL)).toBe("http://localhost:3000/api/mcp");
  });
});
