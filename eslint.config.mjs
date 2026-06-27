import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated Scoreboard SDK build output + test coverage.
    "public/sdk/**",
    "coverage/**",
  ]),
  // The browser SDK source must stay free of server / Next / Neon imports so it
  // can be lifted into a standalone published npm package with zero churn. The
  // only cross-boundary dependency allowed is `import type` from contract.ts.
  {
    files: ["sdk/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/app/*",
                "server-only",
                "@neondatabase/*",
                "next",
                "next/*",
              ],
              message:
                "SDK client code must not import server/Next/Neon modules — keep it browser-only and portable.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
