import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameRecorder, type RecordableGame } from "./game-recorder";
import { DESKTOP_LIMITS } from "./record-policy";

/** Just enough MediaRecorder: it only "starts" when the test says so. */
class FakeRecorder extends EventTarget {
  static instances: FakeRecorder[] = [];
  static autoStart = true;
  static isTypeSupported = () => true;
  state: "inactive" | "recording" = "inactive";
  mimeType = "video/webm";
  stopCalls = 0;
  constructor() {
    super();
    FakeRecorder.instances.push(this);
  }
  start() {
    this.state = "recording";
    if (FakeRecorder.autoStart) queueMicrotask(() => this.dispatchEvent(new Event("start")));
  }
  stop() {
    this.stopCalls += 1;
    this.state = "inactive";
    const data = Object.assign(new Event("dataavailable"), { data: new Blob(["video"]) });
    this.dispatchEvent(data);
    this.dispatchEvent(new Event("stop"));
  }
}

class FakeStream {
  stopped = 0;
  constructor(private readonly tracks: Array<{ stop(): void }> = []) {}
  getVideoTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return [];
  }
  getTracks() {
    return this.tracks;
  }
}

function makeGame(overrides: Partial<RecordableGame> = {}) {
  const track = { stop: vi.fn() };
  const win = new EventTarget() as unknown as Window;
  const canvas = {
    width: 640,
    height: 480,
    isConnected: true,
    captureStream: () => new FakeStream([track]),
    getContext: () => null,
  } as unknown as HTMLCanvasElement;
  const game: RecordableGame = {
    canvas,
    win,
    layered: false,
    canvasCount: 1,
    shimmed: false,
    ...overrides,
  };
  return { game, track, win, canvas };
}

const options = { slug: "snag", title: "Snag", limits: DESKTOP_LIMITS };

beforeEach(() => {
  vi.useFakeTimers();
  FakeRecorder.instances = [];
  FakeRecorder.autoStart = true;
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal("MediaStream", FakeStream);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("GameRecorder lifecycle", () => {
  it("records, then returns a take stamped with the real start time", async () => {
    vi.setSystemTime(new Date("2026-10-02T21:00:00Z"));
    const { game } = makeGame();
    const rec = new GameRecorder(game, options);
    await expect(rec.start()).resolves.toEqual({ ok: true });
    expect(rec.isRecording).toBe(true);
    vi.advanceTimersByTime(500);

    const take = await rec.stop();
    expect(take).not.toBeNull();
    expect(take!.sidecar.recording.startedAtEpochMs).toBe(Date.parse("2026-10-02T21:00:00Z"));
    expect(take!.fileNames.video).toMatch(/^snag-2026/);
    expect(take!.bytes).toBeGreaterThan(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stopping during the start wait cancels cleanly: no timer, no take, recorder stopped", async () => {
    FakeRecorder.autoStart = false; // Chrome withholds `start` until the canvas draws
    const { game, track } = makeGame();
    const rec = new GameRecorder(game, options);
    const starting = rec.start();
    expect(rec.isRecording).toBe(false); // still starting

    const stopped = rec.stop();
    await vi.advanceTimersByTimeAsync(2000);

    await expect(starting).resolves.toEqual({ ok: false, reason: "failed" });
    await expect(stopped).resolves.toBeNull();
    expect(vi.getTimerCount()).toBe(0); // no leaked interval
    expect(FakeRecorder.instances[0].state).toBe("inactive");
    expect(track.stop).toHaveBeenCalled();
    expect(rec.isRecording).toBe(false);
  });

  it("a game that reloaded during the start wait is a failed start, not a 1970 take", async () => {
    FakeRecorder.autoStart = false;
    const { game, canvas } = makeGame();
    const rec = new GameRecorder(game, options);
    const starting = rec.start();
    Object.defineProperty(canvas, "isConnected", { value: false });
    await vi.advanceTimersByTimeAsync(2000);
    await expect(starting).resolves.toEqual({ ok: false, reason: "failed" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("an error from the recorder while starting fails the start", async () => {
    FakeRecorder.autoStart = false;
    const { game } = makeGame();
    const rec = new GameRecorder(game, options);
    const starting = rec.start();
    FakeRecorder.instances[0].dispatchEvent(new Event("error"));
    await vi.advanceTimersByTimeAsync(2000);
    await expect(starting).resolves.toEqual({ ok: false, reason: "failed" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases everything even when the game has navigated cross-origin mid-take", async () => {
    const { game, track, win } = makeGame();
    const rec = new GameRecorder(game, options);
    await rec.start();
    // From now on touching the game's window throws, as it does for another origin.
    Object.defineProperty(win, "__hpRec", {
      get() {
        throw new DOMException("Blocked a frame", "SecurityError");
      },
    });

    const take = await rec.stop("navigated");
    expect(take?.endedBy).toBe("navigated");
    expect(vi.getTimerCount()).toBe(0);
    expect(track.stop).toHaveBeenCalled();
  });

  it("a second stop() returns the same result", async () => {
    const { game } = makeGame();
    const rec = new GameRecorder(game, options);
    await rec.start();
    const a = rec.stop();
    const b = rec.stop();
    expect(b).toBe(a);
    await a;
  });

  it("a cap during the take ends it and reports through onAutoStop", async () => {
    const { game } = makeGame();
    const onAutoStop = vi.fn();
    const rec = new GameRecorder(game, {
      ...options,
      limits: { ...DESKTOP_LIMITS, maxMs: 1000 },
      onAutoStop,
    });
    await rec.start();
    await vi.advanceTimersByTimeAsync(1500);
    expect(onAutoStop).toHaveBeenCalledTimes(1);
    expect(onAutoStop.mock.calls[0][0]).toMatchObject({ endedBy: "cap", cap: "time" });
    expect(vi.getTimerCount()).toBe(0);
  });
});
