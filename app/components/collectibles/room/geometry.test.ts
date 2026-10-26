import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PlayerPack } from "@/app/lib/collectibles/store";
import { arrange, DESK_MAX_PX, groupSealed, packBox, pct, PHONE_BELOW_PX, SCENES, type Box } from "./geometry";

const ROOM = join(__dirname, "../../../../public/collectibles/room/a");
const pngSize = (file: string) => {
  const b = readFileSync(file);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};
const inside = (b: Box, w: number, h: number) => b.x >= 0 && b.y >= 0 && b.x + b.w <= w && b.y + b.h <= h;
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const pack = (packId: string, grantedAt: string, publicId = `${packId}-${grantedAt}`): PlayerPack => ({
  publicId,
  packId,
  packVersion: 1,
  source: "championship",
  grantedAt,
  openedAt: null,
  revokedAt: null,
});

describe("the scenes", () => {
  for (const [name, scene] of Object.entries(SCENES)) {
    it(`${name}: the art is on disk at the scene's size, in both seasons`, () => {
      for (const season of ["normal", "halloween"]) expect(pngSize(join(ROOM, `${name}-${season}.png`))).toEqual([scene.w, scene.h]);
    });

    it(`${name}: every pack, board and loop is inside the picture, and no two packs collide`, () => {
      const packs = [scene.featured, ...scene.slots].map(packBox);
      for (const b of [...packs, scene.recent, scene.collection, ...scene.loops]) expect(inside(b, scene.w, scene.h), JSON.stringify(b)).toBe(true);
      for (let i = 0; i < packs.length; i++) for (let j = i + 1; j < packs.length; j++) expect(overlaps(packs[i], packs[j])).toBe(false);
    });

    it(`${name}: each loop strip holds its frames at the loop's size`, () => {
      for (const l of scene.loops) {
        const file = join(ROOM, l.file);
        expect(existsSync(file), l.file).toBe(true);
        expect(pngSize(file), l.file).toEqual([l.w * l.frames, l.h]);
      }
    });
  }

  it("draws the laptop packs at exactly 2× in a 3× room", () => {
    const b = packBox(SCENES.desk.featured);
    expect((parseFloat(pct(b.w, SCENES.desk.w)) / 100) * DESK_MAX_PX).toBeCloseTo(192, 3);
    expect(PHONE_BELOW_PX).toBe(SCENES.desk.w * 2);
  });

  it("stands a pack on its spot's bottom edge, centred", () => {
    const b = packBox({ x: 10, y: 20, w: 64, h: 93, k: 2 / 3 });
    expect(b.x + b.w / 2).toBeCloseTo(42, 6);
    expect(b.y + b.h).toBeCloseTo(113, 6);
  });
});

describe("grouping sealed packs", () => {
  it("groups by kind, newest kind first, oldest pack of each kind first", () => {
    const groups = groupSealed([
      pack("hpo-standard", "2026-10-02T10:00:00Z"),
      pack("ff26-participation", "2026-11-01T10:00:00Z"),
      pack("hpo-standard", "2026-10-01T10:00:00Z"),
      pack("tr-standard", "2026-10-20T10:00:00Z"),
    ]);
    expect(groups.map((g) => g.packId)).toEqual(["ff26-participation", "tr-standard", "hpo-standard"]);
    expect(groups[2].items.map((p) => p.grantedAt)).toEqual(["2026-10-01T10:00:00Z", "2026-10-02T10:00:00Z"]);
  });

  it("is empty for no packs", () => {
    expect(groupSealed([])).toEqual([]);
    expect(arrange([], null, 4)).toEqual({ featured: null, counter: [], more: 0 });
  });
});

describe("arranging the counter", () => {
  const groups = groupSealed(["a", "b", "c", "d", "e", "f"].map((id, i) => pack(id, `2026-10-${10 + i}T00:00:00Z`)));

  it("puts the newest kind in the light and the rest on the counter", () => {
    const a = arrange(groups, null, 4);
    expect(a.featured?.packId).toBe("f");
    expect(a.counter.map((g) => g.packId)).toEqual(["e", "d", "c", "b"]);
    expect(a.more).toBe(1);
  });

  it("brings a chosen kind forward, and falls back when it is gone", () => {
    expect(arrange(groups, "c", 4).featured?.packId).toBe("c");
    expect(arrange(groups, "c", 4).counter.map((g) => g.packId)).toEqual(["f", "e", "d", "b"]);
    expect(arrange(groups, "opened-already", 4).featured?.packId).toBe("f");
  });
});
