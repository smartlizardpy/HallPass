import { afterEach, describe, expect, it, vi } from "vitest";
import { SITE_URL, trustedSelfOrigin } from "./site";

afterEach(() => vi.unstubAllEnvs());

const REQ = "https://evil.example/game-html/snag/";

describe("trustedSelfOrigin", () => {
  it("never trusts the request's host in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_URL", "");
    vi.stubEnv("SELF_ORIGIN", "");
    expect(trustedSelfOrigin(REQ)).toBe(SITE_URL);
  });

  it("uses the platform's own deployment host when present", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SELF_ORIGIN", "");
    vi.stubEnv("VERCEL_URL", "hallpass-abc123.vercel.app");
    expect(trustedSelfOrigin(REQ)).toBe("https://hallpass-abc123.vercel.app");
  });

  it("prefers explicit configuration, trailing slash removed", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_URL", "hallpass-abc123.vercel.app");
    vi.stubEnv("SELF_ORIGIN", "http://localhost:3999/");
    expect(trustedSelfOrigin(REQ)).toBe("http://localhost:3999");
  });

  it("falls back to the request origin outside production (localhost dev)", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL_URL", "");
    vi.stubEnv("SELF_ORIGIN", "");
    expect(trustedSelfOrigin("http://localhost:3000/game-html/snag/")).toBe("http://localhost:3000");
  });
});
