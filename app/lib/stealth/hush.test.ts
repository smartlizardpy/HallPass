import { describe, expect, it, vi } from "vitest";
import {
  findAudioContexts,
  restoreMedia,
  resumeAudio,
  silenceMedia,
  suspendAudio,
  type Silenceable,
  type Suspendable,
} from "./hush";

/** A stand-in for `HTMLMediaElement` with just the surface the core touches. */
function fakeMedia(state: Partial<Silenceable> = {}): Silenceable & { plays: number } {
  return {
    muted: false,
    paused: false,
    plays: 0,
    pause() {
      this.paused = true;
    },
    play() {
      this.plays += 1;
      this.paused = false;
      return Promise.resolve();
    },
    ...state,
  };
}

function fakeContext(state = "running"): Suspendable & { calls: string[] } {
  return {
    state,
    calls: [],
    suspend() {
      this.calls.push("suspend");
    },
    resume() {
      this.calls.push("resume");
    },
  };
}

describe("silenceMedia / restoreMedia", () => {
  it("mutes and pauses playing media", () => {
    const el = fakeMedia();
    silenceMedia([el]);
    expect(el.muted).toBe(true);
    expect(el.paused).toBe(true);
  });

  it("leaves media the player had muted themselves muted after restore", () => {
    const el = fakeMedia({ muted: true });
    restoreMedia(silenceMedia([el]));
    expect(el.muted).toBe(true);
  });

  it("unmutes media that was audible before the disguise went up", () => {
    const el = fakeMedia({ muted: false });
    restoreMedia(silenceMedia([el]));
    expect(el.muted).toBe(false);
  });

  it("does not resume media that was already paused", () => {
    const el = fakeMedia({ paused: true });
    restoreMedia(silenceMedia([el]));
    expect(el.plays).toBe(0);
    expect(el.paused).toBe(true);
  });

  it("resumes exactly the media it paused", () => {
    const playing = fakeMedia();
    const stopped = fakeMedia({ paused: true });
    restoreMedia(silenceMedia([playing, stopped]));
    expect(playing.plays).toBe(1);
    expect(stopped.plays).toBe(0);
  });

  it("swallows a rejected play() rather than surfacing an unhandled rejection", () => {
    const el = fakeMedia({ play: () => Promise.reject(new Error("autoplay blocked")) });
    expect(() => restoreMedia(silenceMedia([el]))).not.toThrow();
  });

  it("survives an element that throws while being silenced or restored", () => {
    const hostile: Silenceable = {
      get muted() {
        return false;
      },
      set muted(_v: boolean) {
        throw new Error("detached");
      },
      paused: false,
      pause() {},
      play() {},
    };
    expect(() => restoreMedia(silenceMedia([hostile]))).not.toThrow();
  });
});

describe("suspendAudio / resumeAudio", () => {
  it("suspends running contexts and reports them back", () => {
    const running = fakeContext("running");
    const suspended = suspendAudio([running]);
    expect(running.calls).toEqual(["suspend"]);
    expect(suspended).toEqual([running]);
  });

  it("ignores a context the game had already suspended or closed", () => {
    const already = fakeContext("suspended");
    const closed = fakeContext("closed");
    expect(suspendAudio([already, closed])).toEqual([]);
    resumeAudio(suspendAudio([already, closed]));
    expect(already.calls).toEqual([]);
    expect(closed.calls).toEqual([]);
  });

  it("resumes only what it suspended", () => {
    const running = fakeContext("running");
    resumeAudio(suspendAudio([running]));
    expect(running.calls).toEqual(["suspend", "resume"]);
  });

  it("keeps going when one context throws", () => {
    const hostile = { state: "running", suspend: () => { throw new Error("closed"); }, resume: () => {} };
    const healthy = fakeContext("running");
    expect(suspendAudio([hostile, healthy])).toEqual([healthy]);
  });
});

describe("findAudioContexts", () => {
  it("finds a context parked on a global", () => {
    const ctx = fakeContext();
    const scope = { ctx, unrelated: 42 };
    expect(findAudioContexts(scope, (v) => v === ctx)).toEqual([ctx]);
  });

  it("de-duplicates one context aliased under several globals", () => {
    const ctx = fakeContext();
    expect(findAudioContexts({ a: ctx, b: ctx }, (v) => v === ctx)).toEqual([ctx]);
  });

  it("skips a value whose own type test throws", () => {
    // A cross-origin frame's WindowProxy sits among the page's globals under the
    // iframe's id, and every property read of one — including the reads a type
    // test makes — throws. Letting that escape would abort the sweep mid-raise.
    const ctx = fakeContext();
    const hostile = {};
    const contexts = findAudioContexts({ hostile, ctx }, (v) => {
      if (v === hostile) throw new Error("SecurityError: cross-origin frame");
      return v === ctx;
    });
    expect(contexts).toEqual([ctx]);
  });

  it("skips a global whose getter throws", () => {
    const ctx = fakeContext();
    const scope = { ctx };
    Object.defineProperty(scope, "landmine", {
      enumerable: true,
      get() {
        throw new Error("cross-origin");
      },
    });
    expect(findAudioContexts(scope, (v) => v === ctx)).toEqual([ctx]);
  });

  it("reads only own enumerable keys, never the prototype chain", () => {
    const ctx = fakeContext();
    const probe = vi.fn(() => false);
    findAudioContexts(Object.create({ inherited: ctx }), probe);
    expect(probe).not.toHaveBeenCalled();
  });
});
