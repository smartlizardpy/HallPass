/**
 * Tests for the alerts gate.
 *
 * Every function reads `process.env` at CALL time, so each case sets its own
 * environment — the same convention as `scoreboard/guard.test.ts`.
 *
 * The property worth pinning hardest is the precedence: `ALERTS_SECRET` must
 * REPLACE the fallbacks rather than join them, or rotating the CI credential
 * would leave the old admin password working and revoke nothing.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ALERTS_SECRET_HEADER, isAlertsConfigured, verifyAlertsSecret } from "./guard";

const ENV_KEYS = [
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

describe("isAlertsConfigured", () => {
  it("is false on a deploy with nothing set", () => {
    expect(isAlertsConfigured()).toBe(false);
  });

  it("is true for any of the three accepted vars", () => {
    process.env.ADMIN_HTML_PASSWORD = "site-admin-pw";
    expect(isAlertsConfigured()).toBe(true);
    delete process.env.ADMIN_HTML_PASSWORD;
    process.env.SCOREBOARD_ADMIN_SECRET = "board-secret";
    expect(isAlertsConfigured()).toBe(true);
    delete process.env.SCOREBOARD_ADMIN_SECRET;
    process.env.ALERTS_SECRET = "cron-secret";
    expect(isAlertsConfigured()).toBe(true);
  });

  it("treats a blank var as unset", () => {
    process.env.ALERTS_SECRET = "   ";
    expect(isAlertsConfigured()).toBe(false);
  });
});

describe("verifyAlertsSecret", () => {
  it("answers 'unconfigured' when nothing is set, even with a secret presented", () => {
    // 503, not 401: the operator reading the cron log needs to tell "I never set
    // this up" from "my key is wrong".
    expect(verifyAlertsSecret(bearer("anything"))).toBe("unconfigured");
  });

  it("answers 'unauthorized' for a missing or wrong secret", () => {
    process.env.ALERTS_SECRET = "cron-secret";
    expect(verifyAlertsSecret(new Headers())).toBe("unauthorized");
    expect(verifyAlertsSecret(bearer("nope"))).toBe("unauthorized");
  });

  it("accepts the secret through Bearer or its own header", () => {
    process.env.ALERTS_SECRET = "cron-secret";
    expect(verifyAlertsSecret(bearer("cron-secret"))).toBe("ok");
    expect(
      verifyAlertsSecret(new Headers({ [ALERTS_SECRET_HEADER]: "cron-secret" })),
    ).toBe("ok");
  });

  it("does not accept the scoreboard's header on this surface", () => {
    // Each surface names its own header, so a leaked credential is traceable to
    // the thing it was issued for.
    process.env.ALERTS_SECRET = "cron-secret";
    expect(
      verifyAlertsSecret(new Headers({ "x-scoreboard-secret": "cron-secret" })),
    ).toBe("unauthorized");
  });

  it("falls back so the feature works with what an operator already has", () => {
    process.env.ADMIN_HTML_PASSWORD = "site-admin-pw";
    expect(verifyAlertsSecret(bearer("site-admin-pw"))).toBe("ok");

    process.env.SCOREBOARD_ADMIN_SECRET = "board-secret";
    expect(verifyAlertsSecret(bearer("board-secret"))).toBe("ok");
  });

  it("REPLACES the fallbacks once a dedicated secret is set", () => {
    // The whole point of having a dedicated one: rotating it must revoke the
    // old credential rather than adding a second working key.
    process.env.ALERTS_SECRET = "cron-secret";
    process.env.SCOREBOARD_ADMIN_SECRET = "board-secret";
    process.env.ADMIN_HTML_PASSWORD = "site-admin-pw";
    expect(verifyAlertsSecret(bearer("cron-secret"))).toBe("ok");
    expect(verifyAlertsSecret(bearer("board-secret"))).toBe("unauthorized");
    expect(verifyAlertsSecret(bearer("site-admin-pw"))).toBe("unauthorized");
  });

  it("tolerates surrounding whitespace in the configured secret", () => {
    process.env.ALERTS_SECRET = "  cron-secret  ";
    expect(verifyAlertsSecret(bearer("cron-secret"))).toBe("ok");
  });
});
