/**
 * BoardPass — the board session cookie.
 *
 * `hp_boardpass` holds 32 random bytes. The database stores only their SHA-256,
 * so a read of `boardpass_sessions` cannot be replayed as a cookie.
 *
 * HttpOnly, so a game (which runs un-sandboxed on our origin) cannot read it.
 * `SameSite=Lax` and `Path=/`: the score and achievement POSTs come from inside
 * the game frame and must carry it. Only the routes that explicitly opt in ever
 * look at it, so carrying it everywhere grants nothing by itself.
 */

import { createHash, randomBytes } from "node:crypto";
import { ABSOLUTE_SECONDS } from "./config";

export const BOARDPASS_COOKIE = "hp_boardpass";

/** 32 random bytes, base64url. Handed to the browser, never stored. */
export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** What the database stores. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A token must look like one before it is hashed and looked up. */
export function isWellFormedToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: ABSOLUTE_SECONDS,
  };
}

export function clearedCookieOptions() {
  return { ...sessionCookieOptions(), maxAge: 0 };
}
