/**
 * Data-channel framing.
 *
 * Every frame is an envelope `header` (a short array: type + routing fields)
 * plus a `body`:
 *
 *  - JSON body  → a TEXT frame: `JSON.stringify([...header, body])`.
 *  - binary body (ArrayBuffer, any typed array, DataView) → a BINARY frame:
 *      [0xB1][type tag][header length u16 LE][header JSON][payload bytes]
 *    The receiver gets the same typed-array type back (platform endianness).
 *
 * Reliable frames larger than CHUNK_BYTES are split into CHUNK frames and
 * reassembled by the receiver; the reliable channel is ordered and chunks of one
 * frame are always queued back to back, so reassembly needs no reordering:
 *      [0xC1][flags: 1 = text][message id u32 LE][index u16 LE][count u16 LE][bytes]
 */

import { P2PError } from "./errors";

export const CHUNK_BYTES = 16 * 1024;
export const MAX_RELIABLE_BYTES = 256 * 1024;
export const MAX_UNRELIABLE_BYTES = 16 * 1024;

const BIN = 0xb1;
const CHUNK = 0xc1;
const CHUNK_HEAD = 10;

export type Header = Array<string | number | boolean | null>;
export type Frame = string | Uint8Array;

const TYPES = [
  "ArrayBuffer",
  "Uint8Array",
  "Int8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
  "DataView",
] as const;

const enc = new TextEncoder();
const dec = new TextDecoder();

export function isBinary(v: unknown): v is ArrayBuffer | ArrayBufferView {
  return v instanceof ArrayBuffer || ArrayBuffer.isView(v);
}

/** Encode an envelope. Throws `invalid-argument` for a body JSON cannot carry. */
export function encode(header: Header, body: unknown): Frame {
  if (isBinary(body)) {
    const name = body instanceof ArrayBuffer ? "ArrayBuffer" : body.constructor.name;
    let tag = TYPES.indexOf(name as (typeof TYPES)[number]);
    if (tag < 0) tag = 1; // an unknown view travels as bytes
    const bytes =
      body instanceof ArrayBuffer ? new Uint8Array(body) : new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    const head = enc.encode(JSON.stringify(header));
    const out = new Uint8Array(4 + head.length + bytes.length);
    out[0] = BIN;
    out[1] = tag;
    out[2] = head.length & 0xff;
    out[3] = head.length >> 8;
    out.set(head, 4);
    out.set(bytes, 4 + head.length);
    return out;
  }
  let text: string | undefined;
  try {
    text = JSON.stringify([...header, body === undefined ? null : body]);
  } catch {
    text = undefined;
  }
  if (typeof text !== "string") {
    throw new P2PError("invalid-argument", "This message can't be sent: its data is not JSON-serialisable.");
  }
  return text;
}

export interface Decoded {
  header: Header;
  body: unknown;
}

/** Decode a complete (non-chunk) frame. Returns `null` for garbage. */
export function decode(frame: string | ArrayBuffer | Uint8Array): Decoded | null {
  try {
    if (typeof frame === "string") {
      const arr = JSON.parse(frame) as unknown[];
      if (!Array.isArray(arr) || arr.length < 2) return null;
      return { header: arr.slice(0, -1) as Header, body: arr[arr.length - 1] };
    }
    const u8 = frame instanceof Uint8Array ? frame : new Uint8Array(frame);
    if (u8[0] !== BIN) return null;
    const hlen = u8[2] | (u8[3] << 8);
    const header = JSON.parse(dec.decode(u8.subarray(4, 4 + hlen))) as Header;
    // Copy into a fresh, aligned buffer so any typed array can view it.
    const payload = u8.slice(4 + hlen).buffer;
    const name = TYPES[u8[1]] ?? "Uint8Array";
    if (name === "ArrayBuffer") return { header, body: payload };
    const Ctor = (globalThis as unknown as Record<string, new (b: ArrayBuffer) => unknown>)[name];
    return { header, body: Ctor ? new Ctor(payload) : new Uint8Array(payload) };
  } catch {
    return null;
  }
}

export function frameSize(frame: Frame): number {
  // A UTF-8 character is at most 3 bytes per UTF-16 unit; skip the encode when
  // the frame is obviously small.
  if (typeof frame === "string") return frame.length * 3 <= CHUNK_BYTES ? frame.length : enc.encode(frame).length;
  return frame.length;
}

export function isChunk(data: ArrayBuffer | Uint8Array): boolean {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  return u8[0] === CHUNK;
}

/** Split a frame that is too big for one data-channel message. */
export function split(frame: Frame, messageId: number): Uint8Array[] {
  const text = typeof frame === "string";
  const bytes = text ? enc.encode(frame) : frame;
  const per = CHUNK_BYTES - CHUNK_HEAD;
  const count = Math.ceil(bytes.length / per);
  const out: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const part = bytes.subarray(i * per, Math.min(bytes.length, (i + 1) * per));
    const c = new Uint8Array(CHUNK_HEAD + part.length);
    const dv = new DataView(c.buffer);
    c[0] = CHUNK;
    c[1] = text ? 1 : 0;
    dv.setUint32(2, messageId >>> 0, true);
    dv.setUint16(6, i, true);
    dv.setUint16(8, count, true);
    c.set(part, CHUNK_HEAD);
    out.push(c);
  }
  return out;
}

/** Rebuilds chunked frames from one ordered sender. */
export class Reassembler {
  private id = -1;
  private parts: Uint8Array[] = [];
  private size = 0;

  /** Feed one chunk; returns the whole frame when its last chunk arrives. */
  push(data: ArrayBuffer | Uint8Array): Frame | null {
    const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const id = dv.getUint32(2, true);
    const index = dv.getUint16(6, true);
    const count = dv.getUint16(8, true);
    if (index === 0) {
      this.id = id;
      this.parts = [];
      this.size = 0;
    } else if (id !== this.id || index !== this.parts.length) {
      // Out of sequence: impossible on an ordered channel; drop the partial frame.
      this.id = -1;
      this.parts = [];
      return null;
    }
    const part = u8.slice(CHUNK_HEAD);
    this.parts.push(part);
    this.size += part.length;
    if (this.size > MAX_RELIABLE_BYTES + CHUNK_BYTES) {
      this.id = -1;
      this.parts = [];
      return null;
    }
    if (index + 1 < count) return null;
    const whole = new Uint8Array(this.size);
    let off = 0;
    for (const p of this.parts) {
      whole.set(p, off);
      off += p.length;
    }
    this.id = -1;
    this.parts = [];
    return u8[1] & 1 ? dec.decode(whole) : whole;
  }
}
