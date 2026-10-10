/**
 * Framing, binary round-trips and chunking; the clock estimator; the emitter's
 * async, ordered delivery.
 */

import { describe, expect, it, vi } from "vitest";
import { ClockSync } from "./clock";
import { Emitter } from "./emitter";
import { CHUNK_BYTES, Reassembler, decode, encode, isChunk, split } from "./wire";

describe("wire", () => {
  it("round-trips JSON envelopes", () => {
    const f = encode(["m", "pos", 123], { x: 1, y: [2, 3] });
    expect(typeof f).toBe("string");
    expect(decode(f)).toEqual({ header: ["m", "pos", 123], body: { x: 1, y: [2, 3] } });
    expect(decode(encode(["m", "e", 0], undefined))?.body).toBeNull();
  });

  it("round-trips binary bodies and keeps the typed-array type", () => {
    const f32 = new Float32Array([1.5, -2.25, 3]);
    const d = decode(encode(["m", "pos", 1], f32))!;
    expect(d.header).toEqual(["m", "pos", 1]);
    expect(d.body).toBeInstanceOf(Float32Array);
    expect(Array.from(d.body as Float32Array)).toEqual([1.5, -2.25, 3]);

    const ab = new Uint8Array([9, 8, 7]).buffer;
    const d2 = decode(encode(["m", "raw", 1], ab))!;
    expect(d2.body).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(d2.body as ArrayBuffer))).toEqual([9, 8, 7]);

    // A view into the middle of a larger buffer sends only its own bytes.
    const big = new Uint16Array([1, 2, 3, 4]);
    const view = new Uint16Array(big.buffer, 2, 2);
    expect(Array.from(decode(encode(["m", "v", 1], view))!.body as Uint16Array)).toEqual([2, 3]);
  });

  it("throws a coded error for data JSON cannot carry", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => encode(["m", "x", 0], circular)).toThrow(expect.objectContaining({ code: "invalid-argument" }));
    expect(() => encode(["m", "x", 0], BigInt(10))).toThrow(expect.objectContaining({ code: "invalid-argument" }));
  });

  it("returns null for garbage", () => {
    expect(decode("not json")).toBeNull();
    expect(decode(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("splits large frames and reassembles them exactly", () => {
    const text = encode(["m", "big", 1], "é".repeat(60_000)) as string;
    const parts = split(text, 7);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(CHUNK_BYTES);
      expect(isChunk(p)).toBe(true);
    }
    const r = new Reassembler();
    const out = parts.map((p) => r.push(p));
    expect(out.slice(0, -1).every((x) => x === null)).toBe(true);
    expect(out.at(-1)).toBe(text);

    const bin = encode(["m", "b", 1], new Uint8Array(100_000).fill(5)) as Uint8Array;
    const r2 = new Reassembler();
    let whole: unknown = null;
    for (const p of split(bin, 8)) whole = r2.push(p) ?? whole;
    expect(decode(whole as Uint8Array)!.body).toEqual(new Uint8Array(100_000).fill(5));
  });

  it("drops a partial frame when chunks arrive out of sequence", () => {
    const parts = split("x".repeat(40_000), 1);
    const r = new Reassembler();
    r.push(parts[0]);
    expect(r.push(parts[2])).toBeNull();
  });
});

describe("ClockSync", () => {
  it("prefers low-RTT samples", () => {
    const c = new ClockSync();
    expect(c.offset()).toBeNull();
    // True offset 1000. Fast samples are symmetric; slow ones are skewed by queueing.
    for (let i = 0; i < 5; i++) c.add(100 * i, 100 * i + 1000 + 5, 100 * i + 10);
    for (let i = 0; i < 10; i++) c.add(2000 + i, 2000 + i + 1000 + 200, 2000 + i + 220);
    expect(Math.abs(c.offset()! - 1000)).toBeLessThan(1);
  });

  it("ignores impossible samples", () => {
    const c = new ClockSync();
    c.add(10, 5, 5);
    expect(c.size).toBe(0);
  });
});

describe("Emitter", () => {
  it("delivers asynchronously, in order, and survives a throwing handler", async () => {
    const onErr = vi.fn();
    const e = new Emitter(onErr);
    const seen: string[] = [];
    e.on("a", () => {
      throw new Error("boom");
    });
    e.on("a", (x) => seen.push(`a${x}`));
    e.on("b", (x) => seen.push(`b${x}`));
    e.emit("a", 1);
    e.emit("b", 2);
    e.emit("a", 3);
    expect(seen).toEqual([]);
    await Promise.resolve();
    expect(seen).toEqual(["a1", "b2", "a3"]);
    expect(onErr).toHaveBeenCalledTimes(2);
  });

  it("unsubscribes", async () => {
    const e = new Emitter();
    const fn = vi.fn();
    const off = e.on("x", fn);
    off();
    e.emit("x");
    await Promise.resolve();
    expect(fn).not.toHaveBeenCalled();
  });
});
