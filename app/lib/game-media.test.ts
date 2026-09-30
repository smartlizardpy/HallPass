/**
 * Tests for the hero/gallery split in `game-media.ts`, against a fake `sql`.
 *
 * The cover row shares a table with the gallery, so what matters is that every
 * gallery read and the 8-image cap ignore it while `getGameCoverMedia` finds it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  calls: [] as { text: string; values: unknown[] }[],
  rows: [] as Record<string, unknown>[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  unstable_cache:
    <T extends (...a: never[]) => unknown>(fn: T) =>
    (...args: Parameters<T>) =>
      fn(...args),
}));
vi.mock("@/app/lib/db", () => ({
  isMissingColumnError: () => false,
  sql: async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((a, p, i) => a + p + (i < values.length ? `$${i + 1}` : ""), "");
    h.calls.push({ text: text.replace(/\s+/g, " ").trim(), values });
    return h.rows;
  },
}));

import {
  countMediaForSlug,
  getAllGameMedia,
  getGameCoverMedia,
  getGameMedia,
  listMediaIdsForSlug,
  setMediaKind,
} from "@/app/lib/game-media";

const row = (id: string, slug: string, kind: string, position = 0) => ({
  id,
  slug,
  kind,
  blob_path: `game-media/${slug}/${id}.png`,
  content_type: "image/png",
  width: 1,
  height: 1,
  bytes: 1,
  alt: "",
  position,
});

beforeEach(() => {
  h.calls = [];
  h.rows = [row("a", "g", "screenshot"), row("c", "g", "hero", 1), row("b", "g", "screenshot", 2), row("x", "other", "hero")];
});

describe("gallery reads exclude hero", () => {
  it("getGameMedia drops the cover", async () => {
    expect((await getGameMedia("g")).map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("getAllGameMedia omits a slug whose only row is a cover", async () => {
    const all = await getAllGameMedia();
    expect([...all.keys()]).toEqual(["g"]);
  });

  it("getGameCoverMedia finds the hero, or null", async () => {
    expect((await getGameCoverMedia("g"))?.id).toBe("c");
    h.rows = [row("a", "g", "screenshot")];
    expect(await getGameCoverMedia("g")).toBeNull();
  });
});

describe("queries", () => {
  it("the cap count and the reorder list exclude heroes", async () => {
    h.rows = [{ n: 2 }];
    await countMediaForSlug("g");
    await listMediaIdsForSlug("g");
    expect(h.calls[0].text).toContain("kind <> 'hero'");
    expect(h.calls[1].text).toContain("kind <> 'hero'");
  });

  it("setMediaKind binds the kind and reports whether a row matched", async () => {
    h.rows = [{ id: "c" }];
    expect(await setMediaKind("c", "hero")).toBe(true);
    expect(h.calls[0].values).toEqual(["hero", "c"]);
    h.rows = [];
    expect(await setMediaKind("nope", "hero")).toBe(false);
  });
});
