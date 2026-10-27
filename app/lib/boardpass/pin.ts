/**
 * BoardPass — the PIN: policy, hashing, verification.
 *
 * A 6-digit PIN has only a million values, so a leaked database of plain hashes
 * would be brute-forced in seconds. Two things stand between that and a break:
 *
 *   1. The hash input is `HMAC-SHA256(PEPPER, "<playerId>:<pin>")`, and the pepper
 *      lives in an env var, not the database. A database-only leak cannot be
 *      attacked offline at all without it. Binding the player id also stops two
 *      players with the same PIN from sharing a hash shape.
 *   2. Argon2id (built into `node:crypto`, no dependency) makes each guess cost
 *      real memory and time once the pepper is also gone.
 *
 * FAILS CLOSED. With no (or a short) pepper nothing here hashes or verifies; it
 * throws `PinUnavailableError` and the routes answer 503. A deploy that forgot
 * the secret therefore turns BoardPass off instead of storing weak hashes.
 *
 * The stored value is self-describing, `argon2id$v1$m=…,t=…,p=…$salt$hash`, so the
 * parameters can be raised later and old hashes still verify under theirs.
 *
 * A PIN is never logged, never put in a URL and never returned. This file is the
 * only place that sees one in the clear on the server.
 */

import "server-only";
import * as nodeCrypto from "node:crypto";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ARGON2, HASH_VERSION, PIN_LENGTH } from "./config";

/**
 * `crypto.argon2` shipped in Node 24.7, but the repo's `@types/node` is v20 and
 * does not declare it, so it is typed here. If the runtime is older and the
 * function is absent, hashing throws `PinUnavailableError` (fail closed) rather
 * than falling back to something weaker.
 */
type Argon2Params = {
  message: Buffer;
  nonce: Buffer;
  parallelism: number;
  tagLength: number;
  memory: number;
  passes: number;
};
type Argon2Fn = (
  algorithm: "argon2id",
  params: Argon2Params,
  callback: (error: Error | null, key: Buffer) => void,
) => void;

function argon2Async(algorithm: "argon2id", params: Argon2Params): Promise<Buffer> {
  const fn = (nodeCrypto as unknown as { argon2?: Argon2Fn }).argon2;
  if (typeof fn !== "function") return Promise.reject(new PinUnavailableError());
  return new Promise((resolve, reject) => {
    fn(algorithm, params, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export class PinUnavailableError extends Error {
  constructor() {
    super("BoardPass is not configured");
    this.name = "PinUnavailableError";
  }
}

const MIN_PEPPER_LENGTH = 32;

function pepper(): string {
  const value = process.env.BOARDPASS_PIN_PEPPER;
  if (!value || value.length < MIN_PEPPER_LENGTH) throw new PinUnavailableError();
  return value;
}

/** Whether hashing can run at all. Routes check this and answer 503 when false. */
export function isPinConfigured(): boolean {
  const value = process.env.BOARDPASS_PIN_PEPPER;
  return Boolean(value && value.length >= MIN_PEPPER_LENGTH);
}

// ── Policy ───────────────────────────────────────────────────────────────────

/** Exactly six ASCII digits. Leading zeros are real PINs. */
export function isValidPinFormat(pin: unknown): pin is string {
  return typeof pin === "string" && /^[0-9]{6}$/.test(pin) && pin.length === PIN_LENGTH;
}

/**
 * The PINs a classmate tries first: one repeated digit, a run up or down
 * (`123456`, `654321`, `234567`, `012345`), a repeated pair or triple
 * (`121212`, `123123`), `aabbcc`, and a short list of famous ones. Not a
 * guarantee of strength — a million values cannot be — only a floor.
 */
export function isWeakPin(pin: string): boolean {
  if (!isValidPinFormat(pin)) return true;
  const d = [...pin].map(Number);
  if (d.every((x) => x === d[0])) return true;
  const steps = d.slice(1).map((x, i) => x - d[i]);
  if (steps.every((s) => s === 1) || steps.every((s) => s === -1)) return true;
  if (pin.slice(0, 2).repeat(3) === pin) return true; // 121212
  if (pin.slice(0, 3).repeat(2) === pin) return true; // 123123
  if (d[0] === d[1] && d[2] === d[3] && d[4] === d[5]) return true; // 112233
  return COMMON_PINS.has(pin);
}

const COMMON_PINS = new Set([
  "696969", "420420", "654321", "159753", "147258", "258369", "123321",
  "112233", "121212", "200000", "100000", "101010", "202020", "123654",
]);

// ── Hashing ──────────────────────────────────────────────────────────────────

function keyMaterial(playerId: string, pin: string): Buffer {
  return createHmac("sha256", pepper()).update(`${playerId}:${pin}`).digest();
}

interface Params {
  m: number;
  t: number;
  p: number;
}

async function derive(
  playerId: string,
  pin: string,
  salt: Buffer,
  { m, t, p }: Params,
): Promise<Buffer> {
  const out = await argon2Async("argon2id", {
    message: keyMaterial(playerId, pin),
    nonce: salt,
    memory: m,
    passes: t,
    parallelism: p,
    tagLength: ARGON2.tagLength,
  });
  return Buffer.from(out);
}

const CURRENT: Params = { m: ARGON2.memory, t: ARGON2.passes, p: ARGON2.parallelism };

/** Hash a PIN for storage. Throws `PinUnavailableError` without a pepper. */
export async function hashPin(playerId: string, pin: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(playerId, pin, salt, CURRENT);
  return [
    "argon2id",
    `v${HASH_VERSION}`,
    `m=${CURRENT.m},t=${CURRENT.t},p=${CURRENT.p}`,
    salt.toString("base64url"),
    hash.toString("base64url"),
  ].join("$");
}

/** Cap on what a stored string may ask for, so a corrupt row cannot exhaust memory. */
const MAX_MEMORY = 262144;
const MAX_PASSES = 10;

function parse(stored: string): { params: Params; salt: Buffer; hash: Buffer } | null {
  const parts = stored.split("$");
  if (parts.length !== 5 || parts[0] !== "argon2id" || parts[1] !== `v${HASH_VERSION}`) {
    return null;
  }
  const match = /^m=(\d+),t=(\d+),p=(\d+)$/.exec(parts[2]);
  if (!match) return null;
  const params = { m: Number(match[1]), t: Number(match[2]), p: Number(match[3]) };
  if (
    params.m < 8 || params.m > MAX_MEMORY ||
    params.t < 1 || params.t > MAX_PASSES ||
    params.p < 1 || params.p > 4
  ) {
    return null;
  }
  const salt = Buffer.from(parts[3], "base64url");
  const hash = Buffer.from(parts[4], "base64url");
  if (salt.length < 8 || hash.length !== ARGON2.tagLength) return null;
  return { params, salt, hash };
}

/**
 * Whether `pin` is the player's PIN. A malformed stored string is `false`, never a
 * throw. A missing pepper DOES throw: that is a deploy fault, not a wrong PIN.
 */
export async function verifyPin(
  playerId: string,
  pin: string,
  stored: string,
): Promise<boolean> {
  if (!isValidPinFormat(pin)) return false;
  const parsed = parse(stored);
  if (!parsed) return false;
  const candidate = await derive(playerId, pin, parsed.salt, parsed.params);
  return timingSafeEqual(candidate, parsed.hash);
}

/**
 * Burn the same CPU and memory as a real verify, for a login that has no real hash
 * to check (unknown username, locked account). Without it those paths return
 * measurably faster and the timing tells an attacker which usernames exist.
 */
export async function dummyVerify(pin: string): Promise<void> {
  const safe = isValidPinFormat(pin) ? pin : "000000";
  await derive("dummy", safe, DUMMY_SALT, CURRENT);
}

const DUMMY_SALT = Buffer.from("boardpass-dummy!");
