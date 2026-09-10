/**
 * Tests for the bug MCP gate.
 *
 * Every function reads `process.env` at CALL time, so each case sets its own
 * environment — the same convention as `alerts/guard.test.ts` and
 * `scoreboard/guard.test.ts`.
 *
 * The property worth pinning hardest is the ABSENCE of a fallback. The alerts
 * gate deliberately accepts two older secrets so a feature can be switched on
 * with what an operator already has; this gate deliberately does not, because
 * the capability behind it deletes reports and pays XP. A regression that added
 * a fallback here would be invisible — the endpoint would simply start
 * accepting a credential nobody issued it — so the refusals are asserted by
 * name.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MCP_SECRET_HEADER, isMcpConfigured, verifyMcpSecret } from "./guard";

const ENV_KEYS = [
  "MCP_SECRET",
  "ALERTS_SECRET",
  "SCOREBOARD_ADMIN_SECRET",
  "ADMIN_HTML_PASSWORD",
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

const bearer = (secret: string) => new Headers({ authorization: `Bearer ${secret}` });

describe("isMcpConfigured", () => {
  it("is false on a deploy with nothing set", () => {
    expect(isMcpConfigured()).toBe(false);
  });

  it("is true once MCP_SECRET is set", () => {
    process.env.MCP_SECRET = "agent-key";
    expect(isMcpConfigured()).toBe(true);
  });

  it("treats a blank var as unset", () => {
    process.env.MCP_SECRET = "   ";
    expect(isMcpConfigured()).toBe(false);
  });

  /**
   * The whole argument in `guard.ts`, as a test. A site that has an admin
   * password and an alerts secret — which every real deploy does — must still
   * report this endpoint as unprovisioned.
   */
  it("is NOT turned on by the other secrets this site already holds", () => {
    process.env.ALERTS_SECRET = "cron-secret";
    process.env.SCOREBOARD_ADMIN_SECRET = "board-secret";
    process.env.ADMIN_HTML_PASSWORD = "site-admin-pw";
    expect(isMcpConfigured()).toBe(false);
  });
});

describe("verifyMcpSecret", () => {
  it("is unconfigured — not unauthorized — when no secret is set", () => {
    expect(verifyMcpSecret(bearer("anything"))).toBe("unconfigured");
  });

  /**
   * The ordering that matters most: a deploy with no secret must refuse
   * everybody rather than accept anybody, and an empty-string secret is the
   * shape that mistake takes in practice.
   */
  it("refuses an empty presented secret against an unset expectation", () => {
    expect(verifyMcpSecret(bearer(""))).toBe("unconfigured");
    expect(verifyMcpSecret(new Headers())).toBe("unconfigured");
  });

  it("accepts the right secret as a bearer token", () => {
    process.env.MCP_SECRET = "agent-key";
    expect(verifyMcpSecret(bearer("agent-key"))).toBe("ok");
  });

  it("accepts the right secret in this surface's own header", () => {
    process.env.MCP_SECRET = "agent-key";
    expect(verifyMcpSecret(new Headers({ [MCP_SECRET_HEADER]: "agent-key" }))).toBe("ok");
  });

  it("rejects the wrong secret", () => {
    process.env.MCP_SECRET = "agent-key";
    expect(verifyMcpSecret(bearer("not-the-key"))).toBe("unauthorized");
  });

  /**
   * `timingSafeEqual` throws on buffers of unequal length, which is why
   * `admin-secret.ts` hashes both sides first. A secret of a wildly different
   * length must come back as a plain refusal, not a 500.
   */
  it("rejects a secret of a different length without throwing", () => {
    process.env.MCP_SECRET = "agent-key";
    expect(verifyMcpSecret(bearer("x"))).toBe("unauthorized");
    expect(verifyMcpSecret(bearer("y".repeat(4096)))).toBe("unauthorized");
  });

  it("rejects a request presenting no secret at all", () => {
    process.env.MCP_SECRET = "agent-key";
    expect(verifyMcpSecret(new Headers())).toBe("unauthorized");
  });

  /** The fallback refusal again, this time on the comparison path. */
  it("does not accept the alerts or admin secrets", () => {
    process.env.MCP_SECRET = "agent-key";
    process.env.ALERTS_SECRET = "cron-secret";
    process.env.ADMIN_HTML_PASSWORD = "site-admin-pw";
    expect(verifyMcpSecret(bearer("cron-secret"))).toBe("unauthorized");
    expect(verifyMcpSecret(bearer("site-admin-pw"))).toBe("unauthorized");
  });
});
