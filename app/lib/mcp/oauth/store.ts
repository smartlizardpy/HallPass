import "server-only";

/**
 * HallPass — the MCP OAuth server's database side.
 *
 * `server-only` because it holds the connection and writes credentials; the
 * rules it enforces are in `oauth/config.ts`, which is free of it and carries
 * the tests. Same split as `beta/config.ts` + `beta/store.ts`.
 *
 * ── EVERY SINGLE-USE GUARANTEE IS ONE STATEMENT, NEVER CHECK-THEN-WRITE ────
 * The two writes that must not be repeatable — redeeming an authorization code
 * and rotating a refresh token — put the consumption in the `WHERE` of the
 * UPDATE that consumes it, and report what the UPDATE matched. Reading the row,
 * deciding in JavaScript and then writing would leave a whole network round
 * trip in which a replayed code is redeemed twice, and the neon() HTTP driver
 * is one stateless request per call, so two statements are genuinely not one
 * transaction here. `role-seats-design.md` makes the same argument about seat
 * counting and it applies with more force to a credential.
 *
 * ── THE SWEEP RIDES ON THE WRITES ─────────────────────────────────────────
 * Expired codes and tokens are deleted from data-modifying CTEs on the writes
 * that already touch these tables, so there is no cron and no round trip spent
 * on housekeeping. Same pattern as `beta_agent_activity`. Revoked rows are kept
 * until they expire — a revoked token must stay REFUSED rather than becoming an
 * unknown token, and deleting it early is the one way to make revocation
 * temporary.
 *
 * ── READS THROW; THEY DO NOT DEGRADE TO NULL ──────────────────────────────
 * The inverse of the fail-soft posture the public pages take, for the reason
 * `alerts/metrics.ts` argues: a token lookup that answered "not found" when the
 * database was unreachable would turn an outage into a wave of 401s that look
 * exactly like a revoked credential. The caller turns a thrown error into a
 * 503; it never turns it into a refusal.
 */

import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "@/app/lib/db";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  AUTH_CODE_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  hashSecret,
  mintSecret,
} from "./config";

/** How many clients may register in a window, from one deployment. */
export const REGISTRATION_RATE_LIMIT = { maxPerWindow: 30, windowSeconds: 3600 };

/** A registered client, as the authorize page and the consent screen need it. */
export type OauthClient = {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  createdAt: string;
  /**
   * sha256 of this client's secret, or `null` for a public client.
   *
   * Carried on the type rather than checked with a separate query because the
   * token endpoint's decision — "must this request present a secret?" — has to
   * be made from the SAME row it resolved the client from. Two reads would
   * admit a window in which a secret is added between them.
   */
  secretHash: string | null;
  /** The admin who created it by hand, or `null` for a self-registered one. */
  createdBy: string | null;
};

/** What a redeemed authorization code carried. */
export type RedeemedCode = {
  clientId: string;
  email: string;
  playerId: string | null;
  codeChallenge: string;
  scope: string;
  resource: string;
};

/** A live access token, resolved to the person who approved it. */
export type ResolvedToken = {
  grantId: string;
  clientId: string;
  clientName: string;
  email: string;
  playerId: string | null;
  scope: string;
  resource: string;
};

/** One approval, as `/dashboard/mcp` lists it. */
export type OauthGrant = {
  grantId: string;
  clientId: string;
  clientName: string;
  email: string;
  approvedAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  revokedAt: string | null;
};

/** The pair a token response carries. */
export type IssuedTokens = {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  grantId: string;
};

function text(value: unknown): string {
  return value == null ? "" : String(value);
}

function nullableText(value: unknown): string | null {
  return value == null ? null : String(value);
}

function iso(value: unknown): string {
  return new Date(value as string).toISOString();
}

/**
 * Register a client (RFC 7591). Returns `null` when the window is full.
 *
 * Rate-limited in the INSERT rather than around it, because this is the one
 * endpoint here an unauthenticated caller can reach and the one table they can
 * grow. The limit is per deployment rather than per IP on purpose: the thing
 * being protected is the table, and an attacker with addresses to spare defeats
 * a per-IP cap while a table-wide one still bounds the damage to "nobody can
 * register for an hour" — which is an outage of a setup step, not of the site.
 */
export async function registerClient(input: {
  clientName: string;
  redirectUris: string[];
}): Promise<OauthClient | null> {
  const clientId = mintSecret(randomBytes);
  const rows = await sql`
    WITH recent AS (
      SELECT count(*) AS n FROM mcp_oauth_clients
      WHERE created_at >= now()
            - make_interval(0,0,0,0,0,0,${REGISTRATION_RATE_LIMIT.windowSeconds})
        AND created_by IS NULL
    ),
    ins AS (
      INSERT INTO mcp_oauth_clients (client_id, client_name, redirect_uris)
      SELECT ${clientId}, ${input.clientName}, ${input.redirectUris}
      WHERE (SELECT n FROM recent) < ${REGISTRATION_RATE_LIMIT.maxPerWindow}
      RETURNING client_id, client_name, redirect_uris, created_at,
                client_secret_hash, created_by
    )
    SELECT * FROM ins
  `;
  const row = rows[0];
  if (!row) return null;
  return toClient(row);
}

/** Map a `mcp_oauth_clients` row. One place, so a new column cannot be missed. */
function toClient(row: Record<string, unknown>): OauthClient {
  return {
    clientId: text(row.client_id),
    clientName: text(row.client_name),
    redirectUris: (row.redirect_uris as string[]) ?? [],
    createdAt: iso(row.created_at),
    secretHash: nullableText(row.client_secret_hash),
    createdBy: nullableText(row.created_by),
  };
}

/**
 * Create a client by hand, for a connector UI that has no registration call.
 *
 * Returns the PLAINTEXT secret when one was asked for; it is shown once and
 * never stored. `createdBy` marks the row as deliberate, which also keeps these
 * out of the self-registration rate limit above — an admin filling in a form is
 * not the thing that limit is defending against.
 */
export async function createManualClient(input: {
  clientName: string;
  redirectUris: string[];
  withSecret: boolean;
  createdBy: string;
}): Promise<{ client: OauthClient; secret: string | null }> {
  const clientId = mintSecret(randomBytes);
  const secret = input.withSecret ? mintSecret(randomBytes) : null;
  const rows = await sql`
    INSERT INTO mcp_oauth_clients
      (client_id, client_name, redirect_uris, client_secret_hash, created_by)
    VALUES (${clientId}, ${input.clientName}, ${input.redirectUris},
            ${secret ? hashSecret(secret) : null}, ${input.createdBy})
    RETURNING client_id, client_name, redirect_uris, created_at,
              client_secret_hash, created_by
  `;
  return { client: toClient(rows[0]), secret };
}

/** The hand-made connectors, for the dashboard to list and revoke. */
export async function listManualClients(): Promise<OauthClient[]> {
  const rows = await sql`
    SELECT client_id, client_name, redirect_uris, created_at,
           client_secret_hash, created_by
    FROM mcp_oauth_clients
    WHERE created_by IS NOT NULL
    ORDER BY created_at DESC
  `;
  return rows.map(toClient);
}

/**
 * Delete a hand-made client. Its codes and tokens go with it by cascade, so
 * deleting a connector revokes every grant made through it.
 *
 * `created_by IS NOT NULL` is in the predicate so this can never reach a
 * self-registered client — those are removed by revoking their grants, not by
 * deleting a row somebody else's client still depends on.
 */
export async function deleteManualClient(clientId: string): Promise<boolean> {
  const rows = await sql`
    DELETE FROM mcp_oauth_clients
    WHERE client_id = ${clientId} AND created_by IS NOT NULL
    RETURNING client_id
  `;
  return rows.length > 0;
}

/**
 * Record a CIMD client so everything downstream can treat it like any other.
 *
 * A client identified by URL has no registration row, but `mcp_oauth_codes` and
 * `mcp_oauth_tokens` both carry a foreign key to `mcp_oauth_clients`, and
 * `/dashboard/mcp` renders `client_name` through a JOIN. Rather than weaken the
 * key or special-case the dashboard, the resolved document is UPSERTED under
 * its own URL as the primary key — so a grant to a CIMD client is stored,
 * listed and revoked by exactly the same code as any other.
 *
 * The row is a CACHE OF A SNAPSHOT, not the source of truth: the live document
 * is re-fetched and re-validated on every authorization request, so a client
 * that removes a redirect URI from its document stops being able to use it
 * immediately rather than at the next upsert.
 */
export async function upsertCimdClient(client: {
  clientId: string;
  clientName: string;
  redirectUris: string[];
}): Promise<OauthClient> {
  const rows = await sql`
    INSERT INTO mcp_oauth_clients (client_id, client_name, redirect_uris)
    VALUES (${client.clientId}, ${client.clientName}, ${client.redirectUris})
    ON CONFLICT (client_id) DO UPDATE
      SET client_name   = EXCLUDED.client_name,
          redirect_uris = EXCLUDED.redirect_uris
    RETURNING client_id, client_name, redirect_uris, created_at,
              client_secret_hash, created_by
  `;
  return toClient(rows[0]);
}

/** One client by id, or `null` when it was never registered. */
export async function getClient(clientId: string): Promise<OauthClient | null> {
  const rows = await sql`
    SELECT client_id, client_name, redirect_uris, created_at,
           client_secret_hash, created_by
    FROM mcp_oauth_clients
    WHERE client_id = ${clientId}
  `;
  const row = rows[0];
  return row ? toClient(row) : null;
}

/**
 * Mint an authorization code for an approval. Returns the PLAINTEXT code, which
 * exists only in the redirect that carries it — the row holds its digest.
 *
 * The sweep deletes codes that expired more than an hour ago rather than any
 * expired code, so a code that has just lapsed is still FOUND at redemption and
 * refused as expired, instead of vanishing and being reported as "no such
 * code". The two are different afternoons for whoever is debugging.
 */
export async function issueCode(input: {
  clientId: string;
  email: string;
  playerId: string | null;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  resource: string;
}): Promise<string> {
  const code = mintSecret(randomBytes);
  await sql`
    WITH swept AS (
      DELETE FROM mcp_oauth_codes
      WHERE expires_at < now() - INTERVAL '1 hour'
    )
    INSERT INTO mcp_oauth_codes (
      code_hash, client_id, email, player_id, redirect_uri,
      code_challenge, scope, resource, expires_at
    ) VALUES (
      ${hashSecret(code)}, ${input.clientId}, ${input.email}, ${input.playerId},
      ${input.redirectUri}, ${input.codeChallenge}, ${input.scope}, ${input.resource},
      now() + make_interval(0,0,0,0,0,0,${AUTH_CODE_TTL_SECONDS})
    )
  `;
  return code;
}

/**
 * Redeem a code, atomically and once.
 *
 * The consumption is the `WHERE` of the UPDATE, so a replayed code matches
 * nothing and returns `null` — there is no window in which two token requests
 * both see an unconsumed row. `client_id` and `redirect_uri` are re-checked in
 * the same predicate because RFC 6749 requires the token request to present the
 * same values the code was issued against; without that, a code intercepted at
 * one registered URI could be redeemed against another.
 *
 * A `null` here is deliberately indistinguishable between "no such code",
 * "already used", "expired" and "wrong client". They are all `invalid_grant` on
 * the wire, and an error that told a caller WHICH would be an oracle for
 * probing codes.
 */
export async function redeemCode(input: {
  code: string;
  clientId: string;
  redirectUri: string;
}): Promise<RedeemedCode | null> {
  const rows = await sql`
    UPDATE mcp_oauth_codes
    SET consumed_at = now()
    WHERE code_hash    = ${hashSecret(input.code)}
      AND client_id    = ${input.clientId}
      AND redirect_uri = ${input.redirectUri}
      AND consumed_at IS NULL
      AND expires_at  > now()
    RETURNING client_id, email, player_id, code_challenge, scope, resource
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    clientId: text(row.client_id),
    email: text(row.email),
    playerId: nullableText(row.player_id),
    codeChallenge: text(row.code_challenge),
    scope: text(row.scope),
    resource: text(row.resource),
  };
}

/**
 * Mint the access/refresh pair for a grant.
 *
 * `grantId` is supplied on a rotation and minted on a first approval, which is
 * what makes every token from one consent approval revocable as the single
 * thing a person thinks they approved (migration `030`'s header).
 *
 * Both rows are written in ONE statement. Two statements over the HTTP driver
 * are two transactions, and the failure mode of the second failing is an access
 * token with no refresh token behind it — a grant that works today and cannot
 * be renewed, which is the kind of bug that surfaces eight hours later.
 */
export async function issueTokens(input: {
  grantId?: string;
  clientId: string;
  email: string;
  playerId: string | null;
  scope: string;
  resource: string;
}): Promise<IssuedTokens> {
  const grantId = input.grantId ?? randomUUID();
  const accessToken = mintSecret(randomBytes);
  const refreshToken = mintSecret(randomBytes);

  await sql`
    WITH swept AS (
      DELETE FROM mcp_oauth_tokens WHERE expires_at < now() - INTERVAL '7 days'
    )
    INSERT INTO mcp_oauth_tokens (
      token_hash, kind, grant_id, client_id, email, player_id,
      scope, resource, expires_at
    )
    VALUES
      (${hashSecret(accessToken)}, 'access', ${grantId}::uuid, ${input.clientId},
       ${input.email}, ${input.playerId}, ${input.scope}, ${input.resource},
       now() + make_interval(0,0,0,0,0,0,${ACCESS_TOKEN_TTL_SECONDS})),
      (${hashSecret(refreshToken)}, 'refresh', ${grantId}::uuid, ${input.clientId},
       ${input.email}, ${input.playerId}, ${input.scope}, ${input.resource},
       now() + make_interval(0,0,0,0,0,0,${REFRESH_TOKEN_TTL_SECONDS}))
  `;

  return {
    accessToken,
    refreshToken,
    expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
    grantId,
  };
}

/**
 * Resolve a presented access token, stamping `last_used_at` in the same
 * statement.
 *
 * The stamp is the only reason this is an UPDATE rather than a SELECT, and it
 * earns its place: `/dashboard/mcp` showing "last used 3d" is how somebody
 * recognises a connection they forgot about, and a list of grants with no
 * recency is a list nobody can act on.
 *
 * `revoked_at IS NULL AND expires_at > now()` is in the predicate rather than
 * checked afterwards, so a revoked token cannot be stamped as used.
 */
export async function resolveAccessToken(token: string): Promise<ResolvedToken | null> {
  const rows = await sql`
    UPDATE mcp_oauth_tokens t
    SET last_used_at = now()
    FROM mcp_oauth_clients c
    WHERE t.client_id  = c.client_id
      AND t.token_hash = ${hashSecret(token)}
      AND t.kind       = 'access'
      AND t.revoked_at IS NULL
      AND t.expires_at > now()
    RETURNING t.grant_id, t.client_id, c.client_name, t.email,
              t.player_id, t.scope, t.resource
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    grantId: text(row.grant_id),
    clientId: text(row.client_id),
    clientName: text(row.client_name),
    email: text(row.email),
    playerId: nullableText(row.player_id),
    scope: text(row.scope),
    resource: text(row.resource),
  };
}

/**
 * Redeem a refresh token, revoking it in the same statement.
 *
 * ROTATION, not reuse: the presented token is marked revoked as it is read, and
 * the caller mints a replacement pair on the same `grant_id`. That makes a
 * stolen refresh token DETECTABLE rather than silently shared — the legitimate
 * client's next refresh fails, loudly, instead of both parties renewing
 * happily for a month.
 */
export async function consumeRefreshToken(input: {
  refreshToken: string;
  clientId: string;
}): Promise<(RedeemedCode & { grantId: string }) | null> {
  const rows = await sql`
    UPDATE mcp_oauth_tokens
    SET revoked_at = now()
    WHERE token_hash = ${hashSecret(input.refreshToken)}
      AND client_id  = ${input.clientId}
      AND kind       = 'refresh'
      AND revoked_at IS NULL
      AND expires_at > now()
    RETURNING grant_id, client_id, email, player_id, scope, resource
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    grantId: text(row.grant_id),
    clientId: text(row.client_id),
    email: text(row.email),
    playerId: nullableText(row.player_id),
    codeChallenge: "",
    scope: text(row.scope),
    resource: text(row.resource),
  };
}

/**
 * Revoke a whole grant — every token minted from one consent approval.
 *
 * `email` is part of the predicate rather than checked by the caller, so the
 * dashboard action cannot revoke somebody else's connection by guessing a
 * `grant_id`. A super admin revoking another account's grant passes `null` and
 * the guard is the page's own role check instead; that asymmetry is deliberate
 * and is why the parameter is explicit rather than optional-by-omission.
 */
export async function revokeGrant(input: {
  grantId: string;
  email: string | null;
}): Promise<number> {
  const rows = input.email
    ? await sql`
        UPDATE mcp_oauth_tokens SET revoked_at = now()
        WHERE grant_id = ${input.grantId}::uuid
          AND email    = ${input.email}
          AND revoked_at IS NULL
        RETURNING token_hash
      `
    : await sql`
        UPDATE mcp_oauth_tokens SET revoked_at = now()
        WHERE grant_id = ${input.grantId}::uuid
          AND revoked_at IS NULL
        RETURNING token_hash
      `;
  return rows.length;
}

/**
 * Revoke by presented token (RFC 7009), whichever kind it is.
 *
 * Revoking ANY token of a grant revokes the whole grant, which is what the RFC
 * permits and what a person means: a client that has decided it is done with
 * its refresh token has not left a live access token behind on purpose.
 */
export async function revokeByToken(token: string): Promise<number> {
  const rows = await sql`
    WITH target AS (
      SELECT grant_id FROM mcp_oauth_tokens WHERE token_hash = ${hashSecret(token)}
    )
    UPDATE mcp_oauth_tokens SET revoked_at = now()
    WHERE grant_id IN (SELECT grant_id FROM target)
      AND revoked_at IS NULL
    RETURNING token_hash
  `;
  return rows.length;
}

/**
 * The connections `/dashboard/mcp` lists.
 *
 * One row per GRANT rather than per token — a person approved one thing and
 * should see one row — so the refresh token's expiry is the grant's expiry (it
 * is the longer-lived half) and `last_used_at` is the newest across the family.
 * Revoked and fully expired grants are dropped: a list of dead connections is
 * noise on a screen whose only job is "what can currently reach my data".
 */
export async function listGrants(email: string | null): Promise<OauthGrant[]> {
  const rows = email
    ? await sql`
        SELECT t.grant_id, t.client_id, c.client_name, t.email,
               min(t.created_at)   AS approved_at,
               max(t.last_used_at) AS last_used_at,
               max(t.expires_at)   AS expires_at
        FROM mcp_oauth_tokens t
        JOIN mcp_oauth_clients c ON c.client_id = t.client_id
        WHERE t.email = ${email} AND t.revoked_at IS NULL AND t.expires_at > now()
        GROUP BY t.grant_id, t.client_id, c.client_name, t.email
        ORDER BY approved_at DESC
      `
    : await sql`
        SELECT t.grant_id, t.client_id, c.client_name, t.email,
               min(t.created_at)   AS approved_at,
               max(t.last_used_at) AS last_used_at,
               max(t.expires_at)   AS expires_at
        FROM mcp_oauth_tokens t
        JOIN mcp_oauth_clients c ON c.client_id = t.client_id
        WHERE t.revoked_at IS NULL AND t.expires_at > now()
        GROUP BY t.grant_id, t.client_id, c.client_name, t.email
        ORDER BY approved_at DESC
      `;
  return rows.map((row) => ({
    grantId: text(row.grant_id),
    clientId: text(row.client_id),
    clientName: text(row.client_name),
    email: text(row.email),
    approvedAt: iso(row.approved_at),
    lastUsedAt: row.last_used_at == null ? null : iso(row.last_used_at),
    expiresAt: iso(row.expires_at),
    revokedAt: null,
  }));
}

/** Re-exported so callers do not need two imports to build a token response. */
export { ACCESS_TOKEN_TTL_SECONDS, AUTH_CODE_TTL_SECONDS };
