/**
 * Tests for the fingerprint half of `game-blob-index.ts` (migration 038). The
 * load-bearing claims:
 *   - a record's fingerprint is written, and REPLACED on conflict — a record
 *     without one clears the old one rather than leaving it to skip a write;
 *   - a database without the column (038 not applied yet) still gets its row,
 *     recorded the way it was before fingerprints existed;
 *   - any other failure still throws, as the callers' best-effort `try` expects;
 *   - the reindex sweep, which cannot know what changed out-of-band, clears
 *     every fingerprint.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  calls: [] as { text: string; values: unknown[] }[],
  /** Thrown by the next INSERT that names `sha256`, then cleared. */
  insertError: null as unknown,
  hashRows: [] as { pathname: string; sha256: string }[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("@/app/lib/site", () => ({ SITE_URL: "https://site.test" }));
vi.mock("@vercel/blob", () => ({
  list: async () => ({
    blobs: [
      {
        pathname: "games/g/index.html",
        url: "https://store/games/g/index.html",
        size: 5,
        uploadedAt: new Date(0),
      },
    ],
    hasMore: false,
  }),
}));
vi.mock("@/app/lib/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/app/lib/db")>();
  return {
    isMissingColumnError: real.isMissingColumnError,
    sql: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join("$").replace(/\s+/g, " ").trim();
      h.calls.push({ text, values });
      if (text.startsWith("INSERT") && text.includes("sha256") && h.insertError) {
        const error = h.insertError;
        h.insertError = null;
        throw error;
      }
      if (text.startsWith("SELECT pathname, sha256")) return h.hashRows;
      return [];
    },
  };
});

import { readGameFileHashesLive, recordGameBlobs, reindexGameBlobs } from "./game-blob-index";

const HASH = "a".repeat(64);
const inserts = () => h.calls.filter((c) => c.text.startsWith("INSERT"));

beforeEach(() => {
  h.calls = [];
  h.insertError = null;
  h.hashRows = [];
});

describe("recordGameBlobs", () => {
  it("writes each record's fingerprint and replaces the old one on conflict", async () => {
    await recordGameBlobs([
      { pathname: "games/g/index.html", url: "u1", size: 1, sha256: HASH },
      { pathname: "games/g/main.js", url: "u2", size: 2 },
    ]);
    const [insert] = inserts();
    expect(insert.text).toContain("sha256 = EXCLUDED.sha256");
    expect(insert.values.at(-1)).toEqual([HASH, null]);
  });

  it("still records the row where migration 038 has not run", async () => {
    h.insertError = Object.assign(new Error('column "sha256" does not exist'), { code: "42703" });
    await recordGameBlobs([{ pathname: "games/g/index.html", url: "u1", size: 1, sha256: HASH }]);
    const [first, second] = inserts();
    expect(first.text).toContain("sha256");
    expect(second.text).not.toContain("sha256");
    expect(second.values[0]).toEqual(["games/g/index.html"]);
  });

  it("throws any other failure to the caller", async () => {
    h.insertError = new Error("neon down");
    await expect(
      recordGameBlobs([{ pathname: "games/g/index.html", url: "u1", size: 1 }]),
    ).rejects.toThrow("neon down");
    expect(inserts()).toHaveLength(1);
  });
});

describe("readGameFileHashesLive", () => {
  it("maps each fingerprinted file of the game", async () => {
    h.hashRows = [{ pathname: "games/g/index.html", sha256: HASH }];
    const hashes = await readGameFileHashesLive("g");
    expect([...hashes]).toEqual([["games/g/index.html", HASH]]);
    expect(h.calls[0].text).toContain("sha256 IS NOT NULL");
    expect(h.calls[0].values).toEqual(["g"]);
  });
});

describe("reindexGameBlobs", () => {
  it("clears the fingerprint of every blob it lists", async () => {
    await reindexGameBlobs();
    const [insert] = inserts();
    expect(insert.text).toContain("sha256 = EXCLUDED.sha256");
    expect(insert.values.at(-1)).toEqual([null]);
  });
});
