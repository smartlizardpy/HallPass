import { describe, expect, it } from "vitest";
import { MomentLog, PICTURE_THROTTLE_MS, type RawMoment } from "./moments";
import type { Shot } from "./tab-capture";

const raw = (name: unknown, extra: Partial<RawMoment> = {}): RawMoment => ({
  at: 1000,
  name,
  data: undefined,
  opts: undefined,
  ...extra,
});
const shot = (id = "s"): Shot => ({
  id,
  blob: new Blob(),
  previewUrl: "blob:x",
  width: 1280,
  height: 720,
  origin: "grab",
});

describe("MomentLog.admit", () => {
  it("re-validates what a game sent", () => {
    const log = new MomentLog();
    expect(log.admit(raw(42), 0)).toBeNull();
    expect(log.admit(raw("ok", { data: [1] }), 0)).toBeNull();
    expect(log.admit(raw("Boss", { data: { hp: 1 } }), 0)?.moment).toMatchObject({
      name: "boss",
      data: { hp: 1 },
    });
  });

  it("asks for a picture once per name per throttle window", () => {
    const log = new MomentLog();
    expect(log.admit(raw("dead"), 0)?.takePicture).toBe(true);
    const again = log.admit(raw("dead"), PICTURE_THROTTLE_MS - 1);
    expect(again).toMatchObject({ takePicture: false, noShot: "throttled" });
    expect(log.admit(raw("dead"), PICTURE_THROTTLE_MS)?.takePicture).toBe(true);
  });

  it("throttles per name, not globally", () => {
    const log = new MomentLog();
    expect(log.admit(raw("a"), 0)?.takePicture).toBe(true);
    expect(log.admit(raw("b"), 1)?.takePicture).toBe(true);
  });

  it("does not retry a failed picture inside the window", () => {
    const log = new MomentLog();
    log.admit(raw("a"), 0); // caller tries, fails, adds with no shot
    expect(log.admit(raw("a"), 10)?.takePicture).toBe(false);
  });

  it("event-only moments never take a picture or start the throttle", () => {
    const log = new MomentLog();
    expect(log.admit(raw("pause", { opts: { shot: false } }), 0)).toMatchObject({
      takePicture: false,
      noShot: "event-only",
    });
    expect(log.admit(raw("pause"), 1)?.takePicture).toBe(true);
  });

  it("falls back to now for a missing timestamp", () => {
    expect(new MomentLog().admit(raw("a", { at: NaN }), 777)?.at).toBe(777);
  });
});

describe("MomentLog.add", () => {
  it("keeps only the newest and hands back what it evicted", () => {
    const log = new MomentLog({ max: 2 });
    const add = (n: string, s: Shot | null) => log.add(log.admit(raw(n), 0)!, s);
    add("a", shot("1"));
    add("b", shot("2"));
    const { evicted } = add("c", shot("3"));
    expect(evicted.map((m) => m.name)).toEqual(["a"]);
    expect(log.list().map((m) => m.name)).toEqual(["b", "c"]);
  });

  it("explains a missing picture", () => {
    const log = new MomentLog();
    const failed = log.add(log.admit(raw("a"), 0)!, null);
    expect(failed.added.noShot).toBe("failed");
    const eventOnly = log.add(log.admit(raw("b", { opts: { shot: false } }), 0)!, null);
    expect(eventOnly.added.noShot).toBe("event-only");
    const throttled = log.add(log.admit(raw("a"), 1)!, null);
    expect(throttled.added.noShot).toBe("throttled");
  });

  it("gives every moment its own id", () => {
    const log = new MomentLog();
    const a = log.add(log.admit(raw("a"), 0)!, null).added.id;
    const b = log.add(log.admit(raw("b"), 0)!, null).added.id;
    expect(a).not.toBe(b);
  });

  it("clear empties the log and resets the throttle", () => {
    const log = new MomentLog();
    log.add(log.admit(raw("a"), 0)!, shot());
    expect(log.clear()).toHaveLength(1);
    expect(log.list()).toHaveLength(0);
    expect(log.admit(raw("a"), 1)?.takePicture).toBe(true);
  });
});
