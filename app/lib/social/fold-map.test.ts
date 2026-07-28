/**
 * The fold map's only real invariant.
 *
 * Postgres `translate()` pairs its two argument strings POSITIONALLY and silently
 * DELETES any source character with no partner. A one-character drift therefore
 * does not error — it quietly turns "Ateş" into "Ate" and breaks the very search
 * the map exists to make work. That is exactly the mistake that was made writing
 * it (five "o"s for four accented o's), so it gets a test rather than a comment.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

function constant(name: string): string {
  const src = readFileSync("app/lib/social/store.ts", "utf8");
  const m = new RegExp(`const ${name} = "([^"]*)";`).exec(src);
  if (!m) throw new Error(`${name} not found in store.ts`);
  return m[1];
}

describe("HANDLE_FOLD map", () => {
  it("has the same number of characters on both sides", () => {
    const from = [...constant("HANDLE_FOLD_FROM")];
    const to = [...constant("HANDLE_FOLD_TO")];
    expect(from.length).toBe(to.length);
  });

  it("maps every source character to a plain ASCII letter", () => {
    for (const ch of constant("HANDLE_FOLD_TO")) {
      expect(ch).toMatch(/[a-z]/);
    }
  });

  it("covers the Turkish letters this site's players actually type", () => {
    const from = constant("HANDLE_FOLD_FROM");
    for (const ch of "şığüöç") expect(from).toContain(ch);
  });

  it("agrees with foldToAscii on the characters it covers", async () => {
    // The two folds are independent implementations — one in JS for the query,
    // one in SQL for the column. If they disagree, a search folds to something
    // the column never folds to and matches nothing.
    const { foldToAscii } = await import("@/app/lib/username");
    const from = [...constant("HANDLE_FOLD_FROM")];
    const to = [...constant("HANDLE_FOLD_TO")];
    from.forEach((ch, i) => {
      expect(foldToAscii(ch), `foldToAscii(${ch}) should match the SQL map`).toBe(to[i]);
    });
  });
});
