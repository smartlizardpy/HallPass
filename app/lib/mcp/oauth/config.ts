/**
 * HallPass — the MCP OAuth server's vocabulary, lifetimes and validation.
 *
 * PURE and free of `server-only`, exactly like `mcp/config.ts`, `mcp/guard.ts`
 * and `beta/config.ts`: no database, no `next/headers`, no SDK import. Every
 * rule an attacker could care about lives here — redirect-URI validation, PKCE
 * verification, code and token minting — precisely so it is unit-tested in the
 * plain `node` environment rather than eyeballed in a route handler.
 *
 * `analytics-mcp-design.md` §2 is the argument. The short version: `/api/mcp`
 * grows a SECOND credential beside `MCP_SECRET`, so a person can sign in with
 * the Google account that already opens the dashboard instead of pasting a
 * shared key.
 *
 * ── OAUTH 2.1, WHICH IS STRICTER THAN THE OAUTH YOU REMEMBER ───────────────
 * Three rules below are not defensive extras; they are what the current spec
 * and the MCP specification (2025-11-25) require, and dropping any one of them
 * turns this into a credential-leaking redirector:
 *
 *   * PKCE `S256` on every request. No `plain`, and no PKCE-less flow, because
 *     every client here is PUBLIC — a CLI on somebody's laptop cannot keep a
 *     client secret, so the code verifier is the only thing binding the
 *     redemption to the browser that started it.
 *   * Redirect URIs are matched EXACTLY against the registered list. Not
 *     prefix, not origin, not "same host". Prefix matching is how an open
 *     redirect on an unrelated path turns into a stolen authorization code.
 *   * Plain `http` is refused except on loopback. A CLI legitimately listens on
 *     `http://127.0.0.1:<port>`; anything else on the public internet must be
 *     `https` or the code crosses the network in the clear.
 *
 * ── ENV IS READ AT CALL TIME, NEVER AT IMPORT ─────────────────────────────
 * Same rule as everywhere else here: a value set after import — by Vercel, or
 * by a test — has to be seen.
 */

import { createHash } from "node:crypto";
import { sha256Hex, timingSafeSecretEqual } from "@/app/lib/admin-secret";

/**
 * The one scope this server grants.
 *
 * One, because there is currently one thing to grant: read the analytics. A
 * scope system with a single member is a ceremony, and the honest way to add
 * the second is when a second capability exists — see `analytics-mcp-design.md`
 * §7, which records that decision rather than leaving it to be rediscovered.
 */
export const OAUTH_SCOPE = "hallpass:analytics";

/**
 * How long an access token lives: one working day.
 *
 * Long enough that a conversation is never interrupted to sign in again, short
 * enough that a token copied off a laptop is a today problem rather than a
 * forever one. The refresh token is what makes the re-sign-in rare rather than
 * the access token being long.
 */
export const ACCESS_TOKEN_TTL_SECONDS = 8 * 60 * 60;

/**
 * How long a refresh token lives. Rotated on every use — redeeming one revokes
 * it and mints its replacement — so a leaked refresh token is detectable: the
 * legitimate client's next refresh fails, loudly, instead of both parties
 * quietly sharing the grant.
 */
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * How long an authorization code lives. Sixty seconds is the round trip from
 * the browser redirect to the client's token request; anything longer is a
 * window in which a code sitting in a shell history or a proxy log is still
 * live. Single use as well as short — see `oauth/store.ts`.
 */
export const AUTH_CODE_TTL_SECONDS = 60;

/** The most redirect URIs one client may register. Mirrors the CHECK in `030`. */
export const MAX_REDIRECT_URIS = 10;

/** Bounds on the client name the consent screen renders. Mirrors `030`'s CHECK. */
export const CLIENT_NAME_MAX_LENGTH = 120;

/**
 * What the consent screen calls a client that registered without a name.
 *
 * Deliberately not the client id. "Connect a1b9f2…e4 to HALLPASS" asks somebody
 * to approve a string they cannot evaluate; naming the absence at least says
 * plainly that the client did not identify itself.
 */
export const DEFAULT_CLIENT_NAME = "An unnamed MCP client";

/**
 * Is the OAuth path provisioned at all?
 *
 * An explicit switch, defaulting OFF, for the same reason `MCP_SECRET` has no
 * fallback chain (`mcp/guard.ts`): this surface reads the whole player base of
 * a children's site, and a capability like that must not switch itself on as a
 * side effect of Google sign-in already being configured for the dashboard.
 * Turning it on is a deliberate act, and `/api/mcp` answers 503 naming the
 * variable until it is.
 */
export function isOauthEnabled(): boolean {
  const raw = process.env.MCP_OAUTH_ENABLED?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/**
 * Base64url with no padding — the encoding OAuth and PKCE use throughout.
 * Node's `"base64url"` digest encoding is already unpadded; the replace is
 * belt-and-braces for inputs that arrive as standard base64.
 */
export function base64url(input: Buffer): string {
  return input.toString("base64url").replace(/=+$/, "");
}

/**
 * Mint an opaque secret: 32 random bytes, base64url.
 *
 * NOT a JWT. A signed token would save a database round trip per request and
 * make revocation impossible, which is the wrong trade for a credential whose
 * whole point is that it belongs to a person who might lose a laptop. What is
 * stored is {@link hashSecret} of this; the plaintext exists only in the
 * response that returns it.
 *
 * `randomBytes` is passed in rather than imported so this module stays testable
 * with a deterministic source — the test needs to assert the SHAPE, and a
 * function that reaches for entropy itself cannot be pinned.
 */
export function mintSecret(randomBytes: (size: number) => Buffer): string {
  return base64url(randomBytes(32));
}

/**
 * What goes in the database in place of a code or token.
 *
 * The digest IS the primary key (see migration `030`), so a lookup hashes what
 * was presented and finds the row — there is never a column holding a live
 * credential. Reuses `admin-secret.ts` rather than introducing a second hash.
 */
export function hashSecret(secret: string): string {
  return sha256Hex(secret);
}

/**
 * A PKCE code challenge is 43–128 characters of base64url.
 *
 * The bounds are RFC 7636's, and they are meaningful rather than cosmetic: 43
 * characters is the length of a base64url sha256 digest, so anything shorter
 * cannot be one.
 */
export function isValidCodeChallenge(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 43 &&
    value.length <= 128 &&
    /^[A-Za-z0-9\-._~]+$/.test(value)
  );
}

/** A PKCE code verifier: the same length band, the same unreserved charset. */
export function isValidCodeVerifier(value: unknown): value is string {
  return isValidCodeChallenge(value);
}

/**
 * Does this verifier produce this challenge under `S256`?
 *
 * Compared in constant time. The comparison is not obviously timing-sensitive —
 * the challenge is public, sitting in the authorization request — but the
 * verifier is not, and a comparison that returns early is the kind of thing
 * that becomes sensitive when somebody later reuses the helper. Cheap to get
 * right once.
 */
export function verifyPkceS256(verifier: string, challenge: string): boolean {
  if (!isValidCodeVerifier(verifier) || !isValidCodeChallenge(challenge)) {
    return false;
  }
  const computed = base64url(createHash("sha256").update(verifier).digest());
  return timingSafeSecretEqual(computed, challenge);
}

/**
 * Is this a redirect URI we are willing to register?
 *
 * `https` anywhere, `http` on loopback only. The loopback exception is not a
 * loosening — it is the case OAuth 2.1 explicitly carves out for native and CLI
 * clients, which is exactly what an MCP client is: it opens a local listener on
 * an ephemeral port and the code never leaves the machine.
 *
 * A fragment is refused because the authorization response appends its own
 * query parameters and a URI carrying a fragment cannot receive them
 * predictably. Credentials in the URI are refused because they have no business
 * being echoed back through a browser redirect.
 */
export function isAllowedRedirectUri(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  if (url.protocol !== "http:") return false;
  const host = url.hostname.toLowerCase();
  return host === "127.0.0.1" || host === "::1" || host === "[::1]" || host === "localhost";
}

/** Outcome of validating a registration's `redirect_uris`. */
export type RedirectUrisResult =
  | { ok: true; uris: string[] }
  | { ok: false; reason: string };

/**
 * Validate the `redirect_uris` of a dynamic client registration.
 *
 * Duplicates are collapsed and order is preserved, but the strings are
 * otherwise kept VERBATIM — no normalising of trailing slashes, no lowercasing
 * of the path. Registration and authorization must compare identical strings,
 * and a normaliser applied on one side and not the other is how exact matching
 * silently becomes approximate matching.
 */
export function validateRedirectUris(input: unknown): RedirectUrisResult {
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, reason: "redirect_uris must be a non-empty array" };
  }
  if (input.length > MAX_REDIRECT_URIS) {
    return {
      ok: false,
      reason: `redirect_uris may list at most ${MAX_REDIRECT_URIS} entries`,
    };
  }
  const uris: string[] = [];
  for (const entry of input) {
    if (typeof entry !== "string" || !entry.trim()) {
      return { ok: false, reason: "redirect_uris must contain only strings" };
    }
    const uri = entry.trim();
    if (!isAllowedRedirectUri(uri)) {
      return {
        ok: false,
        reason: `redirect_uri ${uri} must be https, or http on loopback`,
      };
    }
    if (!uris.includes(uri)) uris.push(uri);
  }
  return { ok: true, uris };
}

/** Is this host the machine the browser is running on? */
function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

/**
 * Do these two URIs differ ONLY in their port, on a loopback host?
 *
 * Everything else is compared exactly — scheme, host, path and query — so this
 * widens the match by precisely one component and only for an address that
 * cannot leave the user's machine.
 */
function loopbackMatchIgnoringPort(registered: string, presented: string): boolean {
  let a: URL;
  let b: URL;
  try {
    a = new URL(registered);
    b = new URL(presented);
  } catch {
    return false;
  }
  if (!isLoopbackHost(a.hostname) || !isLoopbackHost(b.hostname)) return false;
  return (
    a.protocol === b.protocol &&
    a.hostname.toLowerCase() === b.hostname.toLowerCase() &&
    a.pathname === b.pathname &&
    a.search === b.search &&
    a.hash === b.hash
  );
}

/**
 * Is the presented redirect URI one this client registered?
 *
 * ── EXACT, EXCEPT FOR THE PORT OF A LOOPBACK ADDRESS ──────────────────────
 * The default is byte-exact string equality, and that is the control that stops
 * an authorization code being delivered somewhere the client never registered.
 * Not `startsWith`, not origin comparison, not URL-object equality — each of
 * those admits a URI the client never named, and the code is handed to whatever
 * this returns true for.
 *
 * The ONE exception is the port of a loopback host, and it is required rather
 * than convenient. RFC 8252 §7.3:
 *
 *   > The authorization server MUST allow any port to be specified at the time
 *   > of the request for loopback IP redirect URIs, to accommodate clients that
 *   > obtain an available ephemeral port from the operating system at the time
 *   > of the request.
 *
 * A native client binds whatever port the OS gives it, so it cannot know at
 * registration time what it will be. Claude Code's own metadata document lists
 * `http://localhost/callback` and `http://127.0.0.1/callback` — no port at all —
 * and then asks for `http://localhost:51234/callback`. Byte-exact matching
 * refuses that, which is what "This application is not registered" was really
 * about. The same trap is filed against fastmcp and the MCP TypeScript SDK, so
 * it is a common mistake and not a local peculiarity.
 *
 * WHY WIDENING IT IS SAFE HERE and nowhere else: a loopback redirect resolves to
 * the machine the browser is already running on. An attacker who can listen on
 * another port of the user's own loopback interface is already running code
 * there. Every other component — scheme, host, path, query — is still compared
 * exactly, and a non-loopback URI gets no leeway whatsoever, so
 * `https://example.com/cb` still refuses `https://example.com:8443/cb`.
 */
export function isRegisteredRedirectUri(
  registered: readonly string[],
  presented: string,
): boolean {
  if (registered.includes(presented)) return true;
  return registered.some((uri) => loopbackMatchIgnoringPort(uri, presented));
}

/** Trim a client-supplied name to something the consent screen can render. */
export function normalizeClientName(input: unknown): string {
  if (typeof input !== "string") return DEFAULT_CLIENT_NAME;
  const trimmed = input.trim().replace(/\s+/g, " ");
  if (!trimmed) return DEFAULT_CLIENT_NAME;
  return trimmed.slice(0, CLIENT_NAME_MAX_LENGTH);
}

/**
 * The canonical form of a resource identifier, for the audience check.
 *
 * The MCP spec REQUIRES a server to refuse a token issued for anything but
 * itself, which means comparing two strings that different clients will spell
 * differently. A trailing slash and a mixed-case host are the two differences
 * that carry no meaning, so they are normalised away; everything else is
 * significant and is left alone.
 */
export function canonicalResource(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = "";
    url.search = "";
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.protocol}//${url.host.toLowerCase()}${path}`;
  } catch {
    return raw.trim().replace(/\/+$/, "");
  }
}

/** Do these two resource identifiers name the same thing? */
export function resourceMatches(a: string, b: string): boolean {
  return canonicalResource(a) === canonicalResource(b);
}

/** An absolute expiry `seconds` from `now`. */
export function expiryFrom(now: Date, seconds: number): Date {
  return new Date(now.getTime() + seconds * 1000);
}
