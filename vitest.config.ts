import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * First test runner in the repo. Two kinds of tests live side-by-side:
 *  - Server logic in `app/lib/scoreboard/**` runs in the default `node` env.
 *  - Client SDK tests in `sdk/src/**` opt into jsdom per-file with a docblock:
 *      // @vitest-environment jsdom
 *    (kept per-file so we don't need the multi-project config API.)
 *
 * The `@/` alias mirrors tsconfig `paths` so runtime `@/`-imports resolve. The
 * `^@\/` regex avoids accidentally rewriting scoped packages like `@neondatabase/*`.
 */
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@\//,
        replacement: fileURLToPath(new URL("./", import.meta.url)),
      },
    ],
  },
  test: {
    include: ["app/**/*.test.ts", "sdk/**/*.test.ts"],
    environment: "node",
  },
});
