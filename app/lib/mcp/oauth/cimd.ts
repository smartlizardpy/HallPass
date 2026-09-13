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
 *   * REDIRECTS ARE FOLLOWED BY HAND, AND EVERY HOP IS RE-CHECKED. `fetch`'s
 *     own following is off, because that would let an allowed host hand the
 *     request to a private one after the check has passed. Refusing redirects
 *     outright was the first version and was too strict for the real world: an
 *     `https://example.com/meta.json` that 301s to `https://www.example.com/...`
 *     is an ordinary hosting arrangement, not an attack. So up to
 *     {@link CIMD_MAX_REDIRECTS} hops are followed, each one validated by the
 *     same rules as the original URL.
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

/**
 * How many redirects to follow, each re-validated against the same host rules.
 *
 * Two, because the common legitimate case is one hop (apex → `www`, or a
 * path normalisation) and a second covers both happening. A chain longer than
 * that is not a metadata document being served, it is something else.
 */
export const CIMD_MAX_REDIRECTS = 2;

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

/** The outcome of one check within {@link validateClientMetadata}. */
type CimdCheck = { ok: true } | { ok: false; reason: string };

/**
 * Client authentication methods a CIMD client can never use, because each one
 * is built on a secret the client and the server are supposed to have agreed
 * on in advance — and a client that registers by publishing a URL has agreed
 * nothing with anybody. The CIMD draft forbids them by name.
 */
const SHARED_SECRET_AUTH_METHODS = new Set([
  "client_secret_basic",
  "client_secret_post",
  "client_secret_jwt",
]);

/**
 * Does the document say the client can fall back to authenticating with
 * nothing but PKCE?
 *
 * `token_endpoint_auth_methods_supported` is NOT an RFC 7591 client metadata
 * field. It is RFC 8414's, where it describes an authorization SERVER. ChatGPT
 * publishes it in its CLIENT document anyway, to mean "these are the methods I
 * can do", and it is the only signal a client offers that it is willing to
 * negotiate. Reading it can only ever NARROW what happens here: it is consulted
 * for exactly one purpose, deciding whether a client that asked for something
 * HallPass does not implement would rather be a public client than fail.
 */
function offersNoneAsFallback(supported: unknown): boolean {
  return Array.isArray(supported) && supported.includes("none");
}

/**
 * Can HallPass serve the client authentication this document asks for?
 *
 * ── WHY THIS IS NOT SIMPLY `must be "none"` ───────────────────────────────
 * It was, and it kept ChatGPT out. Its document asks for `private_key_jwt`,
 * which is not a client overreaching: the CIMD draft forbids only the
 * SHARED-SECRET methods above, and separately RECOMMENDS `private_key_jwt` for
 * any client able to hold a key. Refusing it punished the one connector that
 * took the specification's own advice, and the consent screen said "this
 * application's details could not be read" — which reads as a broken document
 * rather than a rule on this side.
 *
 * So the three cases are now distinguished:
 *
 *   * NOTHING, or `none`. A public client. (RFC 7591 says an absent value means
 *     `client_secret_basic`; that default is meaningless for a client with no
 *     secret, so absence is read as `none`, which is what such clients mean.)
 *   * A SHARED-SECRET METHOD. Still refused, and now says why rather than
 *     restating the rule.
 *   * ANYTHING ELSE — an asymmetric method such as `private_key_jwt`. Legal in
 *     a CIMD document, and NOT IMPLEMENTED at `/api/oauth/token`, which
 *     authenticates public clients with PKCE alone. Accepted only when the
 *     client has published that `none` is also acceptable to it, which is a
 *     downgrade the client offered rather than one taken behind its back. The
 *     authorization server metadata never advertises the asymmetric method, so
 *     a client reading it picks `none` of its own accord and the two agree.
 *
 * The last case is the whole substance of the change. Accepting a client that
 * WANTS to authenticate and then not making it do so is a real, if small,
 * weakening — it is why the fallback must be published by the client instead of
 * assumed, and why a client that names no fallback is turned away with the
 * reason rather than quietly treated as public.
 */
function checkTokenEndpointAuthMethod(doc: Record<string, unknown>): CimdCheck {
  const requested = doc.token_endpoint_auth_method;
  if (requested == null || requested === "none") return { ok: true };

  // Past the client_id check above, so everything read here comes from a
  // document that named itself as this exact URL. That is what makes it safe to
  // quote a field back in a reason — see the module header on not echoing.
  if (typeof requested !== "string") {
    return {
      ok: false,
      reason: "Client metadata document: token_endpoint_auth_method must be a string.",
    };
  }

  if (SHARED_SECRET_AUTH_METHODS.has(requested)) {
    return {
      ok: false,
      reason:
        `Client metadata document: token_endpoint_auth_method "${requested}" needs a ` +
        "secret shared with HallPass in advance, which a client identified by a URL " +
        'has no way to have. Public clients use "none" and PKCE.',
    };
  }

  if (offersNoneAsFallback(doc.token_endpoint_auth_methods_supported)) return { ok: true };

  return {
    ok: false,
    reason:
      `Client metadata document: HallPass does not implement "${requested}", and the ` +
      'document does not list "none" in token_endpoint_auth_methods_supported, so ' +
      "there is no method both sides can use.",
  };
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

  const auth = checkTokenEndpointAuthMethod(doc);
  if (!auth.ok) return auth;

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

  let url = clientId;
  let res: Response | null = null;

  for (let hop = 0; hop <= CIMD_MAX_REDIRECTS; hop++) {
    try {
      res = await fetch(url, {
        // Off, so every hop goes through the host check below rather than
        // being followed blind. See the module header.
        redirect: "manual",
        headers: {
          accept: "application/json",
          // Named, and named as a browser-ish string rather than left to
          // undici's default. `claude.ai` sits behind Cloudflare — a sibling
          // path already answers a challenge page — and a request from a
          // datacenter IP with no User-Agent is the exact shape bot protection
          // dislikes. Insurance rather than a diagnosis: the fetch works from a
          // laptop with the headers this used to send.
          "user-agent": "HallPass-MCP/1.0 (+https://hallpass-rouge.vercel.app)",
        },
        signal: AbortSignal.timeout(CIMD_TIMEOUT_MS),
      });
    } catch (error) {
      // Logged with the detail, returned without it: the caller supplied the
      // URL and must not learn what this server saw at it, but an operator
      // staring at a failed connection needs exactly this line.
      console.error(`CIMD fetch failed for ${url}:`, error);
      return { ok: false, reason: "The client metadata document could not be fetched." };
    }

    if (res.status < 300 || res.status >= 400) break;

    const location = res.headers.get("location");
    if (!location) {
      console.error(`CIMD ${res.status} with no Location header at ${url}`);
      return { ok: false, reason: "The client metadata document could not be fetched." };
    }
    // Resolved against the current URL so a relative Location works, then held
    // to the same rules as the original — this is the hop an attacker would use
    // to reach a private address.
    const next = new URL(location, url).toString();
    if (!isFetchableMetadataUrl(next)) {
      console.error(`CIMD redirect from ${url} to a disallowed URL ${next}`);
      return {
        ok: false,
        reason:
          "The client metadata document redirects somewhere HallPass will not follow.",
      };
    }
    url = next;
    res = null;
  }

  if (!res) {
    console.error(`CIMD exceeded ${CIMD_MAX_REDIRECTS} redirects from ${clientId}`);
    return { ok: false, reason: "The client metadata document redirects too many times." };
  }

  if (!res.ok) {
    console.error(`CIMD fetch for ${url} answered ${res.status}`);
    return { ok: false, reason: "The client metadata document could not be fetched." };
  }

  const text = await res.text().catch(() => "");
  if (!text || text.length > CIMD_MAX_BYTES) {
    console.error(`CIMD document at ${url} was empty or ${text.length} bytes`);
    return {
      ok: false,
      reason: `The client metadata document is empty or larger than ${CIMD_MAX_BYTES} bytes.`,
    };
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    console.error(`CIMD document at ${url} is not JSON; starts: ${text.slice(0, 120)}`);
    return { ok: false, reason: "The client metadata document is not valid JSON." };
  }

  // Validated against the ORIGINAL client_id, not the final URL: the id the
  // client presented is the identity being claimed, and a redirect must not be
  // able to change which id a document is allowed to speak for.
  const result = validateClientMetadata(clientId, body);
  if (!result.ok) console.error(`CIMD document at ${url} rejected: ${result.reason}`);
  return result;
}
