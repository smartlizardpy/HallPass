import { describe, expect, it } from "vitest";
import type { RecordedTake } from "@/app/lib/capture/game-recorder";
import { recReducer, type RecState } from "./useGameRecorder";

const take = { bytes: 1 } as RecordedTake;
const idle: RecState = { phase: "idle" };
const recording: RecState = {
  phase: "recording",
  elapsedMs: 0,
  bytes: 0,
  layered: false,
  silent: false,
};

describe("recReducer", () => {
  it("walks the happy path idle → starting → recording → stopping → ready → idle", () => {
    let s = recReducer(idle, { type: "start" });
    expect(s.phase).toBe("starting");
    s = recReducer(s, { type: "started", layered: true, silent: false });
    expect(s).toMatchObject({ phase: "recording", layered: true });
    s = recReducer(s, { type: "tick", elapsedMs: 4000, bytes: 9 });
    expect(s).toMatchObject({ elapsedMs: 4000, bytes: 9 });
    s = recReducer(s, { type: "stopping" });
    expect(s.phase).toBe("stopping");
    s = recReducer(s, { type: "finished", take });
    expect(s).toEqual({ phase: "ready", take });
    expect(recReducer(s, { type: "discard" })).toEqual(idle);
  });

  it("refuses with the reason, and a refusal can be dismissed", () => {
    const s = recReducer({ phase: "starting" }, { type: "refused", reason: "no-canvas" });
    expect(s).toEqual({ phase: "refused", reason: "no-canvas" });
    expect(recReducer(s, { type: "discard" })).toEqual(idle);
  });

  it("lets a cap or error end a take that nobody stopped", () => {
    expect(recReducer(recording, { type: "finished", take }).phase).toBe("ready");
  });

  it("ignores a second start while recording or stopping", () => {
    expect(recReducer(recording, { type: "start" })).toBe(recording);
    expect(recReducer({ phase: "stopping" }, { type: "start" }).phase).toBe("stopping");
  });

  it("re-records from ready and from a refusal", () => {
    expect(recReducer({ phase: "ready", take }, { type: "start" }).phase).toBe("starting");
    expect(recReducer({ phase: "refused", reason: "failed" }, { type: "start" }).phase).toBe(
      "starting",
    );
  });

  it("drops stray ticks and a late finish once idle", () => {
    expect(recReducer(idle, { type: "tick", elapsedMs: 1, bytes: 1 })).toBe(idle);
    expect(recReducer(idle, { type: "finished", take })).toBe(idle);
  });

  it("will not discard a take that is still recording", () => {
    expect(recReducer(recording, { type: "discard" })).toBe(recording);
  });

  it("ignores a late 'started' once the take has finished or aborted", () => {
    expect(recReducer({ phase: "ready", take }, { type: "started", layered: false, silent: false })).toEqual({
      phase: "ready",
      take,
    });
    expect(recReducer(idle, { type: "started", layered: false, silent: false })).toBe(idle);
    const refused: RecState = { phase: "refused", reason: "failed" };
    expect(recReducer(refused, { type: "started", layered: false, silent: false })).toBe(refused);
  });

  it("turns a take that could not be produced into a refusal, not an eternal 'Saving…'", () => {
    expect(recReducer({ phase: "stopping" }, { type: "aborted" })).toEqual({
      phase: "refused",
      reason: "failed",
    });
    expect(recReducer(recording, { type: "aborted" }).phase).toBe("refused");
    expect(recReducer(idle, { type: "aborted" })).toBe(idle);
  });
});
