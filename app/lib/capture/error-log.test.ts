import { describe, expect, it } from "vitest";
import {
  ErrorLog,
  MAX_ENTRIES,
  MAX_MESSAGE_CHARS,
  MAX_STACK_CHARS,
  normaliseMessage,
  normaliseStack,
  shortenFile,
} from "./error-log";

const T0 = 1_000_000;

function entry(over: Partial<Parameters<ErrorLog["push"]>[0]> = {}) {
  return {
    source: "game" as const,
    kind: "error" as const,
    message: "TypeError: x is undefined",
    ...over,
  };
}

describe("normaliseMessage", () => {
  it("keeps a plain string", () => {
    expect(normaliseMessage("boom")).toBe("boom");
  });

  it("names an Error properly", () => {
    expect(normaliseMessage(new TypeError("x is undefined"))).toBe(
      "TypeError: x is undefined",
    );
  });

  it("flattens newlines and runs of whitespace", () => {
    expect(normaliseMessage("a\n\n  b\tc")).toBe("a b c");
  });

  it("truncates a very long message", () => {
    const out = normaliseMessage("x".repeat(5000));
    expect(out.length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS + 1);
    expect(out.endsWith("…")).toBe(true);
  });

  it("survives null, undefined and empty", () => {
    expect(normaliseMessage(null)).toBe("(no message)");
    expect(normaliseMessage(undefined)).toBe("(no message)");
    expect(normaliseMessage("   ")).toBe("(no message)");
  });

  it("reads an Error from ANOTHER REALM", () => {
    // The regression that mattered. A game throws inside the iframe's own
    // realm, so its Error is not `instanceof` the parent page's Error. An
    // `instanceof` check fell through to JSON.stringify, and an Error
    // serialises to "{}" — so every captured stack arrived labelled "{}".
    // This object is exactly what a cross-realm Error looks like from here.
    const crossRealm = { name: "TypeError", message: "sprite is undefined" };
    expect(normaliseMessage(crossRealm)).toBe("TypeError: sprite is undefined");
    expect(crossRealm instanceof Error).toBe(false);
  });

  it("labels an error-shaped object with no name", () => {
    expect(normaliseMessage({ message: "went wrong" })).toBe("Error: went wrong");
  });

  it("survives a thrown non-Error object", () => {
    // Games throw all sorts of things.
    expect(normaliseMessage({ code: 42 })).toContain("42");
  });

  it("survives a circular object without throwing", () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(() => normaliseMessage(circular)).not.toThrow();
  });
});

describe("normaliseStack", () => {
  it("drops a non-string or empty stack", () => {
    expect(normaliseStack(undefined)).toBeUndefined();
    expect(normaliseStack(123)).toBeUndefined();
    expect(normaliseStack("  ")).toBeUndefined();
  });

  it("truncates a huge stack", () => {
    const out = normaliseStack("y".repeat(9000));
    expect(out!.length).toBeLessThanOrEqual(MAX_STACK_CHARS + 1);
  });

  it("keeps newlines, which are what makes a stack readable", () => {
    expect(normaliseStack("at a\nat b")).toBe("at a\nat b");
  });
});

describe("shortenFile", () => {
  it("strips the origin", () => {
    expect(shortenFile("http://localhost:3001/game-html/pixel-slicer/main.js")).toBe(
      "/game-html/pixel-slicer/main.js",
    );
  });

  it("leaves a relative path alone", () => {
    expect(shortenFile("./main.js")).toBe("./main.js");
  });

  it("returns undefined for nothing", () => {
    expect(shortenFile(undefined)).toBeUndefined();
    expect(shortenFile("")).toBeUndefined();
  });
});

describe("ErrorLog", () => {
  it("records time relative to the session start", () => {
    const log = new ErrorLog(T0);
    log.push(entry(), T0 + 4500);
    expect(log.snapshot()[0].at).toBe(4500);
  });

  it("never records a negative time", () => {
    // A clock that jumps backwards must not produce a nonsense timestamp.
    const log = new ErrorLog(T0);
    log.push(entry(), T0 - 9999);
    expect(log.snapshot()[0].at).toBe(0);
  });

  it("collapses consecutive identical errors into a count", () => {
    // The property that makes a broken render loop survivable.
    const log = new ErrorLog(T0);
    for (let i = 0; i < 500; i += 1) log.push(entry(), T0 + i);
    expect(log.size).toBe(1);
    expect(log.snapshot()[0].count).toBe(500);
  });

  it("does not collapse errors that differ", () => {
    const log = new ErrorLog(T0);
    log.push(entry({ message: "a" }), T0);
    log.push(entry({ message: "b" }), T0);
    log.push(entry({ message: "a" }), T0);
    expect(log.size).toBe(3);
  });

  it("treats a different line number as a different error", () => {
    const log = new ErrorLog(T0);
    log.push(entry({ line: 10 }), T0);
    log.push(entry({ line: 11 }), T0);
    expect(log.size).toBe(2);
  });

  it("caps the number of entries, dropping the oldest", () => {
    const log = new ErrorLog(T0);
    for (let i = 0; i < MAX_ENTRIES + 20; i += 1) {
      log.push(entry({ message: `err-${i}` }), T0 + i);
    }
    expect(log.size).toBe(MAX_ENTRIES);
    // Recency wins: a report is about what just happened.
    expect(log.snapshot()[MAX_ENTRIES - 1].message).toBe(
      `err-${MAX_ENTRIES + 19}`,
    );
  });

  it("keeps a repeat from flushing the buffer's history", () => {
    // Without de-duplication, one runaway error would evict everything else.
    const log = new ErrorLog(T0);
    log.push(entry({ message: "the real cause" }), T0);
    for (let i = 0; i < 10_000; i += 1) log.push(entry({ message: "spam" }), T0);
    expect(log.snapshot()[0].message).toBe("the real cause");
    expect(log.size).toBe(2);
  });

  it("hands out copies, not internal references", () => {
    const log = new ErrorLog(T0);
    log.push(entry(), T0);
    const snap = log.snapshot();
    snap[0].message = "tampered";
    expect(log.snapshot()[0].message).not.toBe("tampered");
  });

  it("clears", () => {
    const log = new ErrorLog(T0);
    log.push(entry(), T0);
    log.clear();
    expect(log.size).toBe(0);
  });
});
