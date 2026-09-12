/**
 * HallPass — Client ID Metadata Documents (CIMD).
 *
 * PURE of `server-only` and of the database, like the rest of `mcp/oauth/`: it
 * validates a document and fetches a URL, so every refusal below is unit-tested
 * with a stubbed `fetch`.
 *
 * ── WHAT THIS IS, AND WHY IT EXISTS BESIDE DYNAMIC REGISTRATION ───────────
 * Under RFC 7591 dynamic client registration a client POSTs its metadata and is
 * issued an opaque id. Under CIMD the client's ID IS AN HTTPS URL that serves
 * its own metadata, and the authorization server fetches it. The MCP
 * specification of 2026-07-28 deprecates DCR in favour of CIMD, and ChatGPT's
 * connector prefers it — so a server offering only DCR is on a path to being
 * un-addable from the hosted assistants, which is exactly where these questions
 * get asked from a phone.
 *
 * Both are supported. DCR still works for every client that uses it, and
 * nothing about the existing flow changes.
 *
 * ── FETCHING A URL SOMEBODY ELSE CHOSE IS THE RISK HERE ───────────────────
 * The `client_id` arrives in an unauthenticated query string, and this module
 * turns it into an outbound request from the server. That is a server-side
 * request forgery primitive unless it is fenced, so it is:
 *
 *   * HTTPS ONLY. No `http:`, no `file:`, no `data:`.
 *   * NO LOOPBACK OR PRIVATE HOSTS. A metadata document on `127.0.0.1` or
 *     `169.254.169.254` is not a client identifying itself, it is somebody
 *     using this server as a proxy into a network it cannot reach.
 *   * NO REDIRECTS FOLLOWED. `redirect: "manual"`, because a redirect is how an
 *     allowed host hands the request to a disallowed one after the check.
 *   * BOUNDED IN TIME AND SIZE. A five-second timeout and a 64 kB ceiling, so a
 *     slow or endless response cannot hold a request open.
 *   * NOTHING FROM THE RESPONSE IS ECHOED BACK. A failure is reported as "that
 *     document could not be used", never with the body or the status, so this
 *     cannot be used to read what it fetched.
 */

import { MAX_REDIRECT_URIS, normalizeClientName, validateRedirectUris } from "./config";

/** How long a fetched document is trusted before it is fetched again. */
export const CIMD_CACHE_TTL_MS = 10 * 60 * 1000;

/** Ceiling on a metadata document, in bytes. */
export const CIMD_MAX_BYTES = 64 * 1024;

/** How long to wait for one, in milliseconds. */
export const CIMD_TIMEOUT_MS = 5000;

/** A client that identified itself with a URL. */
export type CimdClient = {
  clientId: string;
  clientName: string;
  redirectUris: string[];
};

export type CimdResult = { ok: true; client: CimdClient } | { ok: false; reason: string };

/**
 * Is this `client_id` a CIMD URL rather than an opaque registered id?
 *
 * The test is deliberately "does it parse as an https URL", not "does it
 * contain a slash": an opaque id minted by {@link mintSecret} is base64url and
 * can never parse as a URL, so the two namespaces cannot collide.
 */
export function isClientIdUrl(clientId: string): boolean {
  try {
    return new URL(clientId).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Hostnames this server will not fetch a metadata document from.
 *
 * A literal-address check, not a DNS resolution: resolving would be stronger
 * and is still not sufficient (a name can resolve differently between the check
 * and the request), so this is the cheap half and the redirect and scheme rules
 * above are the rest. The residual risk is a hostname that resolves to a
 * private address, which buys an attacker a blind GET of a JSON document whose
 * body is never returned to them.
 */
export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") return true;
  if (host === "0.0.0.0" || host === "broadcasthost") return true;
  // IPv4 literals in the private and link-local ranges.
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10).
  if (/^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host)) return true;
  return false;
}

/** Is this a URL we are willing to fetch a metadata document from? */
export function isFetchableMetadataUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  if (url.hash) return false;
  return !isBlockedHost(url.hostname);
}

/**
 * Validate a parsed metadata document against the URL it came from.
 *
 * The `client_id` MUST equal the URL. That is the whole security property of
 * CIMD: without it, anybody could host a document claiming to be somebody
 * else's client and the id would stop meaning anything.
 */
export function validateClientMetadata(url: string, body: unknown): CimdResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, reason: "The client metadata document is not a JSON object." };
  }
  const doc = body as Record<string, unknown>;

  if (typeof doc.client_id !== "string" || doc.client_id !== url) {
    return {
      ok: false,
      reason:
        "The client metadata document's client_id does not match the URL it was " +
        "served from, so it cannot be trusted to describe that client.",
    };
  }

  const redirects = validateRedirectUris(doc.redirect_uris);
  if (!redirects.ok) {
    return { ok: false, reason: `Client metadata document: ${redirects.reason}` };
  }

  // A client asking for a secret-bearing auth method has misunderstood what it
  // is: a CIMD client is public by construction — its identity is a public URL.
  const authMethod = doc.token_endpoint_auth_method;
  if (authMethod != null && authMethod !== "none") {
    return {
      ok: false,
      reason:
        "Client metadata document: only public clients are supported, so " +
        'token_endpoint_auth_method must be "none".',
    };
  }

  return {
    ok: true,
    client: {
      clientId: url,
      clientName: normalizeClientName(doc.client_name),
      redirectUris: redirects.uris.slice(0, MAX_REDIRECT_URIS),
    },
  };
}

type CacheEntry = { at: number; result: CimdResult };
const cache = new Map<string, CacheEntry>();

/** Drop the cache. Exists for tests; nothing in the app calls it. */
export function clearCimdCache(): void {
  cache.clear();
}

/**
 * Fetch and validate a client's metadata document, with a small cache.
 *
 * FAILURES ARE CACHED TOO, and briefly. A client id that does not resolve will
 * be retried by whatever is driving the flow, and without this a broken or
 * hostile id turns every retry into another outbound request.
 */
export async function fetchClientMetadata(
  clientId: string,
  now: number = Date.now(),
): Promise<CimdResult> {
  const cached = cache.get(clientId);
  if (cached && now - cached.at < CIMD_CACHE_TTL_MS) return cached.result;

  const result = await fetchUncached(clientId);
  cache.set(clientId, { at: now, result });
  return result;
}

async function fetchUncached(clientId: string): Promise<CimdResult> {
  if (!isFetchableMetadataUrl(clientId)) {
    return {
      ok: false,
      reason:
        "A client_id URL must be https, must not name a private or loopback host, " +
        "and must carry no credentials or fragment.",
    };
  }

  let res: Response;
  try {
    res = await fetch(clientId, {
      // See the header: an allowed host must not be able to hand the request on.
      redirect: "manual",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(CIMD_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: "The client metadata document could not be fetched." };
  }

  if (!res.ok) {
    // Deliberately without the status: the caller supplied the URL and must not
    // learn what this server saw at it.
    return { ok: false, reason: "The client metadata document could not be fetched." };
  }

  const text = await res.text().catch(() => "");
  if (!text || text.length > CIMD_MAX_BYTES) {
    return {
      ok: false,
      reason: `The client metadata document is empty or larger than ${CIMD_MAX_BYTES} bytes.`,
    };
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, reason: "The client metadata document is not valid JSON." };
  }

  return validateClientMetadata(clientId, body);
}
