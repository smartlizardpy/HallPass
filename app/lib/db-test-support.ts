/**
 * Shared guard for the opt-in `*.db.test.ts` files that run SQL against a REAL
 * Postgres (the fake-`sql` tests only check statement shape). The pattern is
 * `invites/store.db.test.ts`'s, pulled out so every such file refuses the same
 * things:
 *
 *   * it is OFF unless `HALLPASS_DB_TEST=1`, so `npm test` stays green with no
 *     database;
 *   * it refuses to run when `DATABASE_URL` is the same Neon endpoint as
 *     `PROD_DATABASE_URL` (compared by endpoint id, ignoring `-pooler`). The URLs
 *     are never printed.
 *
 *   HALLPASS_DB_TEST=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run <file>
 *
 * Each test file creates throwaway rows under a random `zz-` tag and removes
 * them in `afterAll`; nothing pre-existing is modified.
 */

const endpoint = (u: string) => {
  try {
    return new URL(u).hostname.split(".")[0].replace(/-pooler$/, "");
  } catch {
    return "";
  }
};

const url = process.env.DATABASE_URL ?? "";

const isProd =
  !!process.env.PROD_DATABASE_URL &&
  endpoint(url) === endpoint(process.env.PROD_DATABASE_URL);

/** True only when the flag is set, a URL exists and it is not production. */
export const dbTestEnabled = process.env.HALLPASS_DB_TEST === "1" && !!url && !isProd;

/** The URL to hand `neon()`; a harmless placeholder when the suite is skipped. */
export const dbTestConnection = dbTestEnabled ? url : "postgres://skipped@localhost/skipped";
