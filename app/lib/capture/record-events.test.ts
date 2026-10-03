import { describe, expect, it } from "vitest";
import {
  buildSidecar,
  EventLog,
  MAX_EVENTS,
  SIDECAR_FORMAT,
  SIDECAR_VERSION,
  type SidecarMeta,
} from "./record-events";

const meta: SidecarMeta = {
  slug: "snag",
  title: "Snag",
  file: "snag-20261002-210000.webm",
  mimeType: "video/webm",
  startedAtEpochMs: 1000,
  durationMs: 4200.6,
  width: 800,
  height: 600,
  audio: "webaudio",
  endedBy: "user",
  canvasCount: 1,
  userAgent: "ua",
};

describe("EventLog", () => {
  it("stores times relative to the start, rounded", () => {
    const log = new EventLog(1000);
    log.add("score.submit", "sdk", { score: 5 }, 1250.4);
    expect(log.snapshot()).toEqual([
      { t: 250, source: "sdk", type: "score.submit", data: { score: 5 } },
    ]);
  });

  it("clamps events from before the start to zero", () => {
    const log = new EventLog(1000);
    log.add("achievement", "sdk", undefined, 900);
    expect(log.snapshot()[0].t).toBe(0);
  });

  it("returns events in time order, arrival order breaking ties", () => {
    const log = new EventLog(0);
    log.add("mark", "tester", undefined, 500);
    log.add("pause", "recorder", undefined, 100);
    log.add("report", "tester", undefined, 500);
    expect(log.snapshot().map((e) => e.type)).toEqual(["pause", "mark", "report"]);
  });

  it("stops at the cap and says how much it dropped", () => {
    const log = new EventLog(0);
    for (let i = 0; i < MAX_EVENTS + 7; i += 1) log.add("mark", "tester", undefined, i);
    expect(log.snapshot()).toHaveLength(MAX_EVENTS);
    expect(log.droppedCount).toBe(7);
  });
});

describe("buildSidecar", () => {
  it("builds the v1 shape", () => {
    const log = new EventLog(1000);
    log.add("mark", "tester", undefined, 2000);
    const sidecar = buildSidecar(meta, log);
    expect(sidecar.format).toBe(SIDECAR_FORMAT);
    expect(sidecar.version).toBe(SIDECAR_VERSION);
    expect(sidecar.clock).toBe("mediarecorder-start");
    expect(sidecar.recording.durationMs).toBe(4201);
    expect(sidecar.recording.hasAudio).toBe(true);
    expect(sidecar.events).toEqual([{ t: 1000, source: "tester", type: "mark" }]);
    expect(sidecar.droppedEvents).toBe(0);
  });

  it("says there is no audio when the take has none", () => {
    const sidecar = buildSidecar({ ...meta, audio: "none" }, new EventLog(0));
    expect(sidecar.recording.hasAudio).toBe(false);
  });

  it("carries nothing that identifies the player", () => {
    const json = JSON.stringify(buildSidecar(meta, new EventLog(0)));
    expect(json).not.toMatch(/playerId|handle|email/i);
  });
});
