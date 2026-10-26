// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { initialOpening, openFailure, openingReducer, revealOrder, RETRY_NOTICE, type OpeningEvent, type OpeningState, type Pull } from "./machine";
import { readResume, resumeFor, writeResume } from "./resume";

const pack = { publicId: "11111111-2222-4333-8444-555555555501", packId: "ff26-participation", packVersion: 1 };
// slot order: rare, common, legendary → reveal order: common, rare, legendary
const pulls: Pull[] = [
  { slot: 1, collectibleId: "ff26-survivor", wasNew: true },
  { slot: 2, collectibleId: "ff26-cobweb-bell", wasNew: false },
  { slot: 3, collectibleId: "ff26-the-last-bell", wasNew: true },
];
const run = (events: OpeningEvent[], from: OpeningState = initialOpening()) => events.reduce(openingReducer, from);
const opened = () => run([{ type: "loaded-sealed", pack }, { type: "tear-start" }, { type: "commit" }, { type: "open-ok", pulls }]);
const revealing = () => run([{ type: "loosened" }, { type: "extracted" }], opened());

describe("the happy path", () => {
  it("walks sealed → tearing → committing → opened → extracting → revealing → summary", () => {
    let s = run([{ type: "loaded-sealed", pack }]);
    expect(s.stage).toBe("sealed");
    s = run([{ type: "tear-start" }], s);
    expect(s.stage).toBe("tearing");
    s = run([{ type: "commit" }], s);
    expect(s.stage).toBe("committing");
    s = run([{ type: "open-ok", pulls }], s);
    expect(s.stage).toBe("opened");
    s = run([{ type: "loosened" }, { type: "extracted" }], s);
    expect(s.stage).toBe("revealing");
    s = run([0, 1, 2].flatMap((i) => [{ type: "flip", index: i }, { type: "flip-done", index: i }] as OpeningEvent[]), s);
    s = run([{ type: "finish" }], s);
    expect(s.stage).toBe("summary");
  });

  it("reveals rarest last, keeping slot order within a rarity", () => {
    expect(revealOrder(pulls).map((p) => p.collectibleId)).toEqual(["ff26-cobweb-bell", "ff26-survivor", "ff26-the-last-bell"]);
    expect(opened().pulls.map((p) => p.slot)).toEqual([2, 1, 3]);
  });

  it("lets the tear be abandoned and retried", () => {
    expect(run([{ type: "loaded-sealed", pack }, { type: "tear-start" }, { type: "tear-cancel" }]).stage).toBe("sealed");
  });
});

describe("guards: nothing happens twice", () => {
  it("commits once: a second commit (pointerup racing a keypress) is ignored", () => {
    const once = run([{ type: "loaded-sealed", pack }, { type: "commit" }]);
    expect(run([{ type: "commit" }], once)).toBe(once);
  });
  it("ignores presentation events that arrive in the wrong stage", () => {
    const s = run([{ type: "loaded-sealed", pack }]);
    for (const e of [{ type: "loosened" }, { type: "extracted" }, { type: "flip", index: 0 }, { type: "finish" }, { type: "open-ok", pulls }] as OpeningEvent[]) {
      expect(run([e], s)).toBe(s);
    }
  });
  it("turns a card over once, and only settles a card that was turned", () => {
    const s = run([{ type: "flip", index: 1 }], revealing());
    expect(run([{ type: "flip", index: 1 }], s)).toBe(s);
    expect(run([{ type: "flip-done", index: 0 }], s)).toBe(s);
    expect(run([{ type: "flip", index: 9 }], s)).toBe(s);
  });
  it("won't finish until every card has settled", () => {
    const s = run([{ type: "flip", index: 0 }, { type: "flip-done", index: 0 }, { type: "finish" }], revealing());
    expect(s.stage).toBe("revealing");
  });
});

describe("failures", () => {
  it("a retryable failure leaves the pack sealed, with a notice", () => {
    const s = run([{ type: "loaded-sealed", pack }, { type: "commit" }, { type: "open-failed", failure: "retryable" }]);
    expect(s.stage).toBe("sealed");
    expect(s.notice).toBe(RETRY_NOTICE);
    expect(run([{ type: "tear-start" }], s).notice).toBeNull();
  });
  it("maps statuses: 401 signed out, 404 missing, 410 revoked, anything else retryable", () => {
    expect([401, 404, 410, 503, 0].map(openFailure)).toEqual(["signed-out", "missing", "revoked", "retryable", "retryable"]);
  });
  it("only an error can be retried", () => {
    expect(run([{ type: "load-failed", failure: "error" }, { type: "retry" }]).stage).toBe("loading");
    const missing = run([{ type: "load-failed", failure: "missing" }]);
    expect(run([{ type: "retry" }], missing)).toBe(missing);
  });
});

describe("skip", () => {
  it("does nothing before the commit", () => {
    const s = run([{ type: "loaded-sealed", pack }]);
    expect(run([{ type: "skip" }], s)).toBe(s);
  });
  it("during the server call, waits for the answer and then shows the same cards", () => {
    let s = run([{ type: "loaded-sealed", pack }, { type: "commit" }, { type: "skip" }]);
    expect(s.stage).toBe("committing");
    s = run([{ type: "open-ok", pulls }], s);
    expect(s.stage).toBe("summary");
    expect(s.pulls).toEqual(revealOrder(pulls));
    expect(s.flipped).toEqual([true, true, true]);
  });
  it("mid-reveal jumps to the summary with every card turned", () => {
    const s = run([{ type: "flip", index: 0 }, { type: "skip" }], revealing());
    expect(s.stage).toBe("summary");
    expect(s.settled).toEqual([true, true, true]);
  });
  it("a failed call after skip still lands on the sealed pack, not a summary of nothing", () => {
    const s = run([{ type: "loaded-sealed", pack }, { type: "commit" }, { type: "skip" }, { type: "open-failed", failure: "retryable" }]);
    expect(s.stage).toBe("sealed");
    expect(s.skipping).toBe(false);
  });
});

describe("phones: one card at a time", () => {
  it("moves on only once the card in front has settled, and skips cards already turned", () => {
    let s = run([{ type: "flip", index: 0 }], revealing());
    expect(run([{ type: "next" }], s)).toBe(s);
    s = run([{ type: "flip-done", index: 0 }, { type: "next" }], s);
    expect(s.current).toBe(1);
  });
});

describe("resuming an opened pack", () => {
  beforeEach(() => {
    const mem = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => mem.get(k) ?? null,
        setItem: (k: string, v: string) => void mem.set(k, v),
        removeItem: (k: string) => void mem.delete(k),
        key: (i: number) => [...mem.keys()][i] ?? null,
        get length() {
          return mem.size;
        },
      },
    });
  });

  it("picks up the reveal where this device left it", () => {
    writeResume(pack.publicId, { flipped: [true, false, false], done: false });
    const r = resumeFor(readResume(pack.publicId), new Date().toISOString(), 3);
    const s = run([{ type: "loaded-opened", pack, pulls, ...r }]);
    expect(s.stage).toBe("revealing");
    expect(s.resumed).toBe(true);
    expect(s.flipped).toEqual([true, false, false]);
    expect(s.current).toBe(1);
  });
  it("goes to the summary when the reveal was finished, or the pack is old and unknown here", () => {
    writeResume(pack.publicId, { flipped: [true, true, true], done: true });
    expect(run([{ type: "loaded-opened", pack, pulls, ...resumeFor(readResume(pack.publicId), null, 3) }]).stage).toBe("summary");
    const old = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
    expect(resumeFor(null, old, 3)).toEqual({ flipped: null, done: true });
    expect(resumeFor(null, new Date().toISOString(), 3)).toEqual({ flipped: null, done: false });
  });
  it("prunes records older than 30 days", () => {
    const long = Date.now() - 40 * 24 * 3600 * 1000;
    writeResume("old", { flipped: [true], done: true }, long);
    writeResume("new", { flipped: [true], done: true });
    expect(readResume("old")).toBeNull();
    expect(readResume("new")).toEqual({ flipped: [true], done: true });
  });
});
