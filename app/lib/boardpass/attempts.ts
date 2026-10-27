/**
 * BoardPass — network-level login throttling.
 *
 * Two buckets per attempt, each a counter in a fixed time window:
 *   `ip:<hash>`            generous (a school shares one address)
 *   `ipu:<hash>:<user>`    tight (stops one device hammering one account)
 *
 * Each reserve is ONE statement that increments only while under the cap, so
 * parallel requests cannot all slip past a check-then-write. It runs BEFORE any
 * Argon2 work, so a flood costs a row update, not 64 MiB of memory per request.
 *
 * The IP is hashed with the site's existing salt (`hashIp`); no raw address and
 * no PIN is ever stored. Counters are NOT reset on a success: otherwise a
 * caller with their own account could interleave a success to keep guessing.
 */

import "server-only";
import { createHash } from "node:crypto";
import { sql } from "@/app/lib/db";
import { clientKeyFromHeaders, hashIp } from "@/app/lib/scoreboard/guard";
import {
  ATTEMPTS_PER_IP,
  ATTEMPTS_PER_IP_USERNAME,
  ATTEMPT_WINDOW_SECONDS,
  CLEANUP_AFTER_SECONDS,
} from "./config";

export function ipHashFor(headers: Headers): string {
  return hashIp(clientKeyFromHeaders(headers));
}

function usernameHash(username: string): string {
  return createHash("sha256").update(username).digest("hex").slice(0, 24);
}

/** Take one slot in a bucket. `false` means the cap is reached. */
export async function reserveBucket(bucketKey: string, limit: number): Promise<boolean> {
  const rows = (await sql`
    INSERT INTO boardpass_attempts (bucket_key, window_start, count)
    VALUES (
      ${bucketKey},
      to_timestamp(floor(extract(epoch FROM now()) / ${ATTEMPT_WINDOW_SECONDS}::int) * ${ATTEMPT_WINDOW_SECONDS}::int),
      1
    )
    ON CONFLICT (bucket_key, window_start)
    DO UPDATE SET count = boardpass_attempts.count + 1
      WHERE boardpass_attempts.count < ${limit}::int
    RETURNING count
  `) as { count: number }[];
  return rows.length > 0;
}

/** Both network buckets for one attempt. `false` = answer 429 without hashing. */
export async function reserveLoginAttempt(
  ipHash: string,
  username: string,
): Promise<boolean> {
  const ipOk = await reserveBucket(`ip:${ipHash}`, ATTEMPTS_PER_IP);
  if (!ipOk) return false;
  return reserveBucket(
    `ipu:${ipHash}:${usernameHash(username)}`,
    ATTEMPTS_PER_IP_USERNAME,
  );
}

/** Drop old throttle windows. Called opportunistically, never on a hot path. */
export async function cleanupAttempts(): Promise<void> {
  await sql`
    DELETE FROM boardpass_attempts
    WHERE window_start < now() - make_interval(secs => ${CLEANUP_AFTER_SECONDS}::int)
  `;
}
