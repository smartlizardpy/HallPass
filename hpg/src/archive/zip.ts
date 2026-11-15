/**
 * Bounded ZIP reading and deterministic ZIP writing.
 *
 * WHY THE CENTRAL DIRECTORY IS PARSED HERE rather than handed to fflate's
 * `unzipSync`. `unzipSync` inflates whatever the headers announce. It never
 * looks at the encryption flag, never checks a CRC and cannot report that an
 * entry inflated to MORE than it declared (with a fixed `out` buffer, extra
 * bytes are silently dropped). Each of those is a way for a hostile archive to
 * become something other than what it says. This module reads and checks every
 * header first: count, names, flags, method and declared sizes against the
 * limits. Only then does it inflate, with fflate's `inflateSync`, into a buffer
 * ONE byte larger than declared. If that extra byte gets used, the entry lied
 * and is refused. Memory therefore never exceeds the declared sizes, and those
 * were capped before any inflation.
 *
 * Supported: stored (0) and deflate (8), no encryption, no ZIP64, single disk.
 * That covers every archive our packager writes and every archive the common
 * OS "compress" commands produce at these sizes.
 */

import { inflateSync, zipSync, type ZipOptions } from "fflate";
import { isSafePackagePath, pathKey } from "../format/paths";

export type ZipLimits = {
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
  maxCompressionRatio: number;
};

export type ZipErrorCode =
  | "not-zip"
  | "corrupt"
  | "unsupported"
  | "too-many-entries"
  | "entry-too-large"
  | "too-large"
  | "suspicious-ratio"
  | "unsafe-path"
  | "duplicate-path"
  | "crc-mismatch"
  | "size-mismatch";

export class ZipError extends Error {
  readonly code: ZipErrorCode;
  constructor(code: ZipErrorCode, message: string) {
    super(message);
    this.name = "ZipError";
    this.code = code;
  }
}

export type ZipEntryInfo = {
  /** The raw entry name, decoded as UTF-8 (or CP437-as-latin1 without the UTF-8 flag). */
  name: string;
  isDirectory: boolean;
  /** Whether the name satisfies the package path grammar. */
  safePath: boolean;
  method: number;
  compressedSize: number;
  size: number;
  crc32: number;
  localHeaderOffset: number;
};

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const FLAG_ENCRYPTED = 0x0001;
const FLAG_UTF8 = 0x0800;

function u16(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8);
}
function u32(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

function decodeName(raw: Uint8Array, utf8: boolean): string {
  if (utf8) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(raw);
    } catch {
      return "�"; // fails the path grammar → treated as unsafe
    }
  }
  // Without the UTF-8 flag the spec says CP437; ASCII is identical, and any
  // high byte makes the name fail the ASCII-only path grammar regardless.
  let s = "";
  for (const c of raw) s += String.fromCharCode(c);
  return s;
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  // The EOCD record is 22 bytes plus a comment of at most 65535 bytes.
  const min = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= min; i--) {
    if (u32(bytes, i) === SIG_EOCD) return i;
  }
  return -1;
}

/**
 * Read and check the central directory without inflating anything. Throws a
 * {@link ZipError} for anything structurally wrong or over the entry-count
 * limit. Per-entry size limits are applied in {@link readZipEntries}, to only
 * the entries actually selected.
 */
export function listZip(bytes: Uint8Array, limits: ZipLimits): ZipEntryInfo[] {
  if (bytes.length < 22) throw new ZipError("not-zip", "file is too small to be a ZIP archive");
  const eocd = findEndOfCentralDirectory(bytes);
  if (eocd < 0) throw new ZipError("not-zip", "no ZIP end-of-central-directory record");
  if (eocd >= 20 && u32(bytes, eocd - 20) === SIG_ZIP64_LOCATOR) {
    throw new ZipError("unsupported", "ZIP64 archives are not supported");
  }
  if (u16(bytes, eocd + 4) !== 0 || u16(bytes, eocd + 6) !== 0) {
    throw new ZipError("unsupported", "multi-disk archives are not supported");
  }
  const count = u16(bytes, eocd + 10);
  const cdSize = u32(bytes, eocd + 12);
  const cdOffset = u32(bytes, eocd + 16);
  if (count !== u16(bytes, eocd + 8)) throw new ZipError("corrupt", "inconsistent entry counts");
  if (count > limits.maxEntries) {
    throw new ZipError("too-many-entries", `${count} entries (limit ${limits.maxEntries})`);
  }
  if (cdOffset + cdSize > eocd) throw new ZipError("corrupt", "central directory out of bounds");

  const entries: ZipEntryInfo[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > eocd || u32(bytes, p) !== SIG_CENTRAL) {
      throw new ZipError("corrupt", `central directory entry ${i} is damaged`);
    }
    const flags = u16(bytes, p + 8);
    const method = u16(bytes, p + 10);
    const crc32 = u32(bytes, p + 16);
    const compressedSize = u32(bytes, p + 20);
    const size = u32(bytes, p + 24);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const localHeaderOffset = u32(bytes, p + 42);
    const end = p + 46 + nameLen + extraLen + commentLen;
    if (end > eocd) throw new ZipError("corrupt", `central directory entry ${i} overruns`);
    const name = decodeName(bytes.subarray(p + 46, p + 46 + nameLen), (flags & FLAG_UTF8) !== 0);
    p = end;

    if (flags & FLAG_ENCRYPTED) throw new ZipError("unsupported", `${name}: encrypted entries are not supported`);
    if (compressedSize === 0xffffffff || size === 0xffffffff || localHeaderOffset === 0xffffffff) {
      throw new ZipError("unsupported", `${name}: ZIP64 entries are not supported`);
    }
    const isDirectory = name.endsWith("/");
    if (!isDirectory && method !== 0 && method !== 8) {
      throw new ZipError("unsupported", `${name}: compression method ${method} is not supported`);
    }
    if (localHeaderOffset + 30 > cdOffset) {
      throw new ZipError("corrupt", `${name}: local header out of bounds`);
    }
    entries.push({
      name,
      isDirectory,
      safePath: !isDirectory && isSafePackagePath(name),
      method,
      compressedSize,
      size,
      crc32,
      localHeaderOffset,
    });
  }
  return entries;
}

/**
 * Inflate the selected entries. Every selected entry must have a safe, unique
 * (case-insensitively) path, and pass the size, total and ratio limits, all
 * checked BEFORE any inflation. Each inflated entry is then checked against its
 * declared size and CRC-32.
 */
export function readZipEntries(
  bytes: Uint8Array,
  entries: readonly ZipEntryInfo[],
  limits: ZipLimits,
): Map<string, Uint8Array> {
  const seen = new Map<string, string>();
  let total = 0;
  for (const e of entries) {
    if (e.isDirectory || !e.safePath) {
      throw new ZipError("unsafe-path", `unsafe entry name ${JSON.stringify(e.name)}`);
    }
    const key = pathKey(e.name);
    const clash = seen.get(key);
    if (clash !== undefined) {
      throw new ZipError("duplicate-path", `${e.name} duplicates ${clash}`);
    }
    seen.set(key, e.name);
    if (e.size > limits.maxEntryBytes) {
      throw new ZipError("entry-too-large", `${e.name} is ${e.size} bytes (limit ${limits.maxEntryBytes})`);
    }
    total += e.size;
    if (total > limits.maxTotalBytes) {
      throw new ZipError("too-large", `archive unpacks to over ${limits.maxTotalBytes} bytes`);
    }
    if (e.method === 8 && e.size > 0) {
      const ratio = e.size / Math.max(1, e.compressedSize);
      if (ratio > limits.maxCompressionRatio) {
        throw new ZipError("suspicious-ratio", `${e.name} expands ${Math.round(ratio)}x (limit ${limits.maxCompressionRatio}x)`);
      }
    }
    if (e.method === 0 && e.compressedSize !== e.size) {
      throw new ZipError("corrupt", `${e.name}: stored entry sizes disagree`);
    }
  }

  const out = new Map<string, Uint8Array>();
  for (const e of entries) {
    const lh = e.localHeaderOffset;
    if (u32(bytes, lh) !== SIG_LOCAL) throw new ZipError("corrupt", `${e.name}: local header is damaged`);
    const dataStart = lh + 30 + u16(bytes, lh + 26) + u16(bytes, lh + 28);
    const dataEnd = dataStart + e.compressedSize;
    if (dataEnd > bytes.length) throw new ZipError("corrupt", `${e.name}: data runs past the end of the archive`);
    const raw = bytes.subarray(dataStart, dataEnd);
    let data: Uint8Array;
    if (e.method === 0) {
      data = raw.slice();
    } else {
      // One spare byte: if inflation fills it, the entry is bigger than declared.
      let inflated: Uint8Array;
      try {
        inflated = inflateSync(raw, { out: new Uint8Array(e.size + 1) });
      } catch {
        throw new ZipError("corrupt", `${e.name}: compressed data is damaged`);
      }
      if (inflated.length !== e.size) {
        throw new ZipError("size-mismatch", `${e.name}: inflates to a different size than declared`);
      }
      data = inflated;
    }
    if (crc32(data) !== e.crc32) throw new ZipError("crc-mismatch", `${e.name}: CRC-32 mismatch (damaged)`);
    out.set(e.name, data);
  }
  return out;
}

let CRC_TABLE: Uint32Array | null = null;

/** CRC-32 (IEEE 802.3), as ZIP uses. */
export function crc32(data: Uint8Array): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * A fixed timestamp for every entry, so the same inputs always produce the same
 * archive bytes. Rebuilding an unchanged game yields an identical `.hpg` with an
 * identical digest. 1 Jan 2020 is inside the DOS date range ZIP can store.
 */
export const DETERMINISTIC_MTIME = new Date(Date.UTC(2020, 0, 1, 0, 0, 0));

export type ZipInput = { path: string; data: Uint8Array; level?: 0 | 9 };

/**
 * Write a deterministic ZIP: entries in the order given, a fixed mtime, deflate
 * level 9 unless the entry asks to be stored (already-compressed media).
 */
export function writeZip(files: readonly ZipInput[]): Uint8Array {
  const tree: Record<string, [Uint8Array, ZipOptions]> = {};
  for (const f of files) {
    if (Object.prototype.hasOwnProperty.call(tree, f.path)) throw new Error(`duplicate zip path ${f.path}`);
    tree[f.path] = [f.data, { level: f.level ?? 9, mtime: DETERMINISTIC_MTIME }];
  }
  return zipSync(tree);
}
