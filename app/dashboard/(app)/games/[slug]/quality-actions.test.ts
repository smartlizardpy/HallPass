/**
 * Tests for `setGameQualityAction`: super-admin gate first, strict parsing,
 * caches invalidated only after a successful write.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  log: [] as string[],
  known: true,
  fail: false,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    h.log.push(`redirect:${url}`);
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));
vi.mock("next/cache", () => ({
  updateTag: (t: string) => h.log.push(`tag:${t}`),
  revalidatePath: (p: string) => h.log.push(`path:${p}`),
}));
vi.mock("@/app/lib/auth", () => ({
  requireRole: async (role: string) => {
    h.log.push(`role:${role}`);
    return { email: "a@x", role: "super_admin", playerId: "p" };
  },
}));
vi.mock("@/app/lib/games-store", () => ({
  CACHE_TAG: "game-overrides",
  isKnownSlug: async () => h.known,
  setGameQuality: async (slug: string, scores: unknown) => {
    h.log.push(`set:${slug}:${JSON.stringify(scores)}`);
    if (h.fail) throw new Error("boom");
  },
}));

import { setGameQualityAction } from "./quality-actions";

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

async function run(fields: Record<string, string>): Promise<string[]> {
  try {
    await setGameQualityAction(form(fields));
  } catch {
    /* the redirect */
  }
  return h.log;
}

beforeEach(() => {
  h.log = [];
  h.known = true;
  h.fail = false;
});

describe("setGameQualityAction", () => {
  it("requires super_admin before anything else", async () => {
    const log = await run({ slug: "atlas", gameplay: "8" });
    expect(log[0]).toBe("role:super_admin");
  });

  it("saves every criterion, blank meaning not rated, then invalidates caches", async () => {
    const log = await run({ slug: "atlas", gameplay: "8", visuals: "", sound: "6" });
    expect(log).toContain(
      'set:atlas:{"gameplay":8,"visuals":null,"sound":6,"polish":null,"fun":null}',
    );
    expect(log).toContain("tag:game-overrides");
    expect(log).toContain("path:/");
    expect(log).toContain("path:/game/atlas");
    expect(log.at(-1)).toMatch(/redirect:.*ok=Quality/);
  });

  it("refuses an out-of-range or non-whole score and writes nothing", async () => {
    for (const bad of ["0", "11", "5.5", "great"]) {
      h.log = [];
      const log = await run({ slug: "atlas", fun: bad });
      expect(log.some((l) => l.startsWith("set:"))).toBe(false);
      expect(log.at(-1)).toMatch(/redirect:.*error=Fun/);
    }
  });

  it("refuses an unknown game", async () => {
    h.known = false;
    const log = await run({ slug: "ghost", gameplay: "5" });
    expect(log.some((l) => l.startsWith("set:"))).toBe(false);
    expect(log.at(-1)).toMatch(/redirect:\/dashboard\/games\?error=Unknown/);
  });

  it("does not invalidate caches when the write fails", async () => {
    h.fail = true;
    const log = await run({ slug: "atlas", gameplay: "8" });
    expect(log.some((l) => l.startsWith("tag:"))).toBe(false);
    expect(log.at(-1)).toMatch(/redirect:.*error=Could/);
  });
});
