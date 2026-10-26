import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { boxStyle, cabinetBoxes, CABINET, DESK, DESK_MAX_PX, FRAMES, PHONE, PHONE_BELOW_PX, PHONE_MAX_PX, pct, placeVars, POOL, roomScale, type Box } from "./geometry";

const ART = join(__dirname, "../../../public/events/fright-fest/hall");
const pngSize = (file: string) => {
  const b = readFileSync(join(ART, file));
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};
const inside = (b: Box, w: number, h: number) => b.x >= 0 && b.y >= 0 && b.x + b.w <= w && b.y + b.h <= h;
const within = (inner: Box, outer: Box) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("the scenes", () => {
  for (const [name, scene] of [["desk", DESK], ["phone", PHONE]] as const) {
    it(`${name}: the art is on disk at the scene's size, in both seasons`, () => {
      for (const file of [scene.files.haunted, scene.files.calm]) expect(pngSize(file), file).toEqual([scene.w, scene.h]);
    });

    it(`${name}: every loop, the sign, the ticker and the panel are inside the picture`, () => {
      for (const b of [scene.sign, scene.ticker, scene.panel, ...scene.loops]) expect(inside(b, scene.w, scene.h), JSON.stringify(b)).toBe(true);
    });

    it(`${name}: each loop strip holds its frames at the loop's size`, () => {
      for (const l of scene.loops) {
        expect(existsSync(join(ART, l.file)), l.file).toBe(true);
        expect(pngSize(l.file), l.file).toEqual([l.w * l.frames, l.h]);
      }
    });

    it(`${name}: every cabinet is inside the picture, and no two collide`, () => {
      const boxes = scene.slots.map((s) => cabinetBoxes(s));
      for (const b of boxes) {
        expect(inside(b.cabinet, scene.w, scene.h)).toBe(true);
        expect(within(b.screen, b.cabinet) && within(b.button, b.cabinet)).toBe(true);
      }
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i].cabinet, boxes[j].cabinet)).toBe(false);
    });
  }

  it("the laptop's zones are inside the picture and their calm interiors inside them", () => {
    // The doormat (the prize calm rect) sits on the threshold strip just below the door zone.
    expect(inside(DESK.prize.calm, DESK.w, DESK.h)).toBe(true);
    for (const z of [DESK.board, DESK.quest]) {
      expect(inside(z.zone, DESK.w, DESK.h)).toBe(true);
      expect(within(z.calm, z.zone)).toBe(true);
    }
    for (const e of DESK.eggs) expect(inside(e, DESK.w, DESK.h)).toBe(true);
    for (const b of [PHONE.boardGlimpse, PHONE.prizeGlimpse]) expect(inside(b, PHONE.w, PHONE.h)).toBe(true);
  });

  it("puts the first screen above the Chromebook's fold: rows 0 to 186 of the picture", () => {
    for (const s of DESK.slots) expect(cabinetBoxes(s).button.y + CABINET.button.h).toBeLessThanOrEqual(186);
    expect(DESK.board.calm.y + 24).toBeLessThan(186);
    expect(DESK.prize.zone.y).toBeLessThan(186);
  });

  it("has the cabinet's sprites, screen loop, floor light and frames on disk at the sizes the numbers say", () => {
    expect(pngSize("cab-lastbell-on.png")).toEqual([CABINET.w, CABINET.h]);
    expect(pngSize("cab-mystery-off-calm.png")).toEqual([CABINET.w, CABINET.h]);
    expect(pngSize("scr-lastbell.png")).toEqual([CABINET.screen.w * CABINET.screenFrames, CABINET.screen.h]);
    expect(pngSize(POOL.file)).toEqual([POOL.w, POOL.h]);
    for (const f of [FRAMES.board, FRAMES.quest, FRAMES.prize, FRAMES.paper]) expect(pngSize(f.file)).toEqual([FRAMES.size, FRAMES.size]);
  });
});

describe("placeVars", () => {
  it("writes the laptop and phone variables, and only those asked for", () => {
    expect(placeVars({ x: 43.4, y: 23, w: 217, h: 115 }, null)).toEqual({ "--dl": "10%", "--dt": "10%", "--dw": "50%", "--dh": "50%" });
    expect(Object.keys(placeVars(null, { x: 0, y: 0, w: 195, h: 236 }))).toEqual(["--pl", "--pt", "--pw", "--ph"]);
  });
});

describe("the arithmetic", () => {
  it("switches to the phone scene where the Pack Room does, at exactly 2x the laptop scene's width", () => {
    expect(PHONE_BELOW_PX).toBe(DESK.w * 2);
    expect(roomScale(PHONE_BELOW_PX).composition).toBe("desk");
    expect(roomScale(PHONE_BELOW_PX - 1).composition).toBe("phone");
  });

  it("draws the laptop room at 3x from 1302 px, the phone room up to 2.5x", () => {
    expect(roomScale(1302)).toEqual({ composition: "desk", scale: 3 });
    expect(roomScale(1900)).toEqual({ composition: "desk", scale: 3 });
    expect(roomScale(390)).toEqual({ composition: "phone", scale: 2 });
    expect(roomScale(800).scale).toBe(PHONE_MAX_PX / PHONE.w);
    expect(DESK_MAX_PX).toBe(1302);
  });

  it("turns room pixels into percentages of the room", () => {
    expect(pct(217, 434)).toBe("50%");
    expect(boxStyle({ x: 43.4, y: 23, w: 217, h: 115 }, DESK)).toEqual({ left: "10%", top: "10%", width: "50%", height: "50%" });
  });

  it("puts a cabinet's Play strip on its lower front", () => {
    const { button, pool } = cabinetBoxes({ x: 118, y: 60 });
    expect(button).toEqual({ x: 123, y: 128, w: 48, h: 15 });
    expect(pool).toEqual({ x: 107, y: 156, w: 80, h: 10 });
  });
});
