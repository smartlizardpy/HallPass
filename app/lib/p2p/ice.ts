/**
 * HallPass P2P — ICE servers (STUN + short-lived TURN credentials).
 *
 * Players on school networks often cannot reach each other directly, so a TURN
 * relay is what turns "connect-failed" into a working game. A TURN credential
 * that lives in client code can be lifted and used as a free relay by anyone,
 * so credentials are minted here, per request, with a short lifetime.
 *
 * Two providers, chosen by which env vars are set (Cloudflare wins if both are):
 *
 *  - Cloudflare Realtime TURN — `P2P_TURN_CLOUDFLARE_KEY_ID` +
 *    `P2P_TURN_CLOUDFLARE_API_TOKEN`. One API call per mint.
 *  - Any TURN server using the standard shared-secret REST scheme (coturn's
 *    `use-auth-secret`, eturnal, …) — `P2P_TURN_URLS` (comma-separated
 *    `turn:`/`turns:` URLs) + `P2P_TURN_SECRET`. Minted locally, no network.
 *
 * Neither set → STUN only, `turn: false`, and the SDK explains a failure on a
 * restrictive network as `no-turn-restrictive-network` instead of hanging.
 *
 * Nothing here throws: a provider outage degrades to STUN only (logged).
 */

import { createHmac } from "node:crypto";
import { DEFAULT_STUN_URLS, DEFAULT_TURN_TTL_SECONDS } from "./config";

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface IceConfig {
  iceServers: IceServer[];
  /** Epoch ms when the TURN credentials stop working; `null` without TURN. */
  expiresAt: number | null;
  turn: boolean;
}

type Fetch = typeof fetch;

function listEnv(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function turnTtlSeconds(): number {
  const n = Number(process.env.P2P_TURN_TTL_SECONDS);
  return Number.isFinite(n) && n >= 300 && n <= 48 * 3600 ? Math.floor(n) : DEFAULT_TURN_TTL_SECONDS;
}

export function stunServers(): IceServer[] {
  const urls = listEnv("P2P_STUN_URLS");
  return [{ urls: urls.length ? urls : DEFAULT_STUN_URLS }];
}

/** Which TURN provider is configured, without revealing any value. */
export function turnProvider(): "cloudflare" | "shared-secret" | null {
  if (process.env.P2P_TURN_CLOUDFLARE_KEY_ID && process.env.P2P_TURN_CLOUDFLARE_API_TOKEN) {
    return "cloudflare";
  }
  if (listEnv("P2P_TURN_URLS").length && process.env.P2P_TURN_SECRET) return "shared-secret";
  return null;
}

/**
 * TURN REST API credentials (draft-uberti-behave-turn-rest): the username is
 * `<expiry-unix-seconds>:<label>` and the password is base64(HMAC-SHA1(secret,
 * username)). The TURN server recomputes the HMAC and checks the expiry.
 */
export function sharedSecretCredential(
  secret: string,
  ttlSeconds: number,
  nowMs = Date.now(),
): { username: string; credential: string; expiresAt: number } {
  const expiry = Math.floor(nowMs / 1000) + ttlSeconds;
  const username = `${expiry}:hallpass`;
  const credential = createHmac("sha1", secret).update(username).digest("base64");
  return { username, credential, expiresAt: expiry * 1000 };
}

/**
 * Browsers block or stall on TURN over port 53, which Cloudflare advertises
 * alongside 3478/443; drop those URLs.
 */
function dropPort53(urls: string | string[]): string[] {
  const list = Array.isArray(urls) ? urls : [urls];
  return list.filter((u) => typeof u === "string" && !/:53(\?|$)/.test(u));
}

/** Accept both Cloudflare response shapes: `{iceServers: [...]}` and `{iceServers: {...}}`. */
export function normalizeCloudflare(body: unknown): IceServer[] {
  const raw = (body as { iceServers?: unknown } | null)?.iceServers;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out: IceServer[] = [];
  for (const s of list) {
    if (!s || typeof s !== "object") continue;
    const { urls, username, credential } = s as IceServer;
    const kept = dropPort53(urls);
    if (!kept.length) continue;
    out.push(
      typeof username === "string" && typeof credential === "string"
        ? { urls: kept, username, credential }
        : { urls: kept },
    );
  }
  return out;
}

async function mintCloudflare(ttl: number, fetchImpl: Fetch): Promise<IceServer[] | null> {
  const keyId = process.env.P2P_TURN_CLOUDFLARE_KEY_ID!;
  const token = process.env.P2P_TURN_CLOUDFLARE_API_TOKEN!;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetchImpl(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ttl }),
        signal: controller.signal,
        cache: "no-store",
      },
    );
    if (!res.ok) {
      console.error(`[p2p] Cloudflare TURN mint answered ${res.status}`);
      return null;
    }
    const servers = normalizeCloudflare(await res.json());
    return servers.some((s) => s.username) ? servers : null;
  } catch (error) {
    console.error("[p2p] Cloudflare TURN mint failed:", error instanceof Error ? error.message : error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The ICE configuration for one client. `withTurn: false` skips minting (the
 * caller is over its TURN rate limit) and returns STUN only.
 */
export async function buildIceConfig(
  opts: { withTurn: boolean; fetchImpl?: Fetch; nowMs?: number } = { withTurn: true },
): Promise<IceConfig> {
  const stun = stunServers();
  const provider = opts.withTurn ? turnProvider() : null;
  const ttl = turnTtlSeconds();
  const now = opts.nowMs ?? Date.now();

  if (provider === "cloudflare") {
    const servers = await mintCloudflare(ttl, opts.fetchImpl ?? fetch);
    if (servers) {
      // Cloudflare's list carries its own STUN entry; keep ours too.
      return { iceServers: [...stun, ...servers], expiresAt: now + ttl * 1000, turn: true };
    }
  } else if (provider === "shared-secret") {
    const cred = sharedSecretCredential(process.env.P2P_TURN_SECRET!, ttl, now);
    return {
      iceServers: [
        ...stun,
        { urls: listEnv("P2P_TURN_URLS"), username: cred.username, credential: cred.credential },
      ],
      expiresAt: cred.expiresAt,
      turn: true,
    };
  }
  return { iceServers: stun, expiresAt: null, turn: false };
}
