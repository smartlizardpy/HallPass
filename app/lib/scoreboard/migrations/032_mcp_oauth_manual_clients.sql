-- HallPass — migration: MCP OAuth clients an operator creates by hand.
--
-- See `app/lib/mcp/oauth/schema.sql` for the canonical fresh-install DDL; keep
-- the two in lockstep. `analytics-mcp-design.md` §2 is the argument.
--
-- ── WHY A THIRD WAY IN ─────────────────────────────────────────────────────
-- `030` assumed every client registers itself: dynamic registration (RFC 7591)
-- or, since `031`-era work, a Client ID Metadata Document. Both are automatic
-- and both are what Claude and ChatGPT do.
--
-- Some connector UIs do neither. Gemini Enterprise's "Add MCP Server" form asks
-- for an Authorization URL, a Token URL, a Client ID and a Client Secret, typed
-- in by a person — there is no registration call to make. A server that cannot
-- issue those four values cannot be added there at all.
--
-- So a client may now be created from `/dashboard/mcp` by a signed-in admin,
-- with an optional secret. Two columns carry it:
--
--   * `client_secret_hash` — sha256 of the secret, never the secret. Same rule
--     as every other credential in this schema: the plaintext exists once, in
--     the response that shows it, and is never stored. NULL means a public
--     client, which is every self-registered one.
--   * `created_by` — the admin email that minted it, so a list of connectors
--     nobody recognises can be traced to whoever added them. NULL for the
--     self-registered ones, which nobody minted.
--
-- A client with a secret is a CONFIDENTIAL client and the token endpoint
-- REQUIRES that secret; a client without one is public and PKCE is the only
-- binding. The two must not be confused, which is why the column is nullable
-- rather than defaulted to an empty string: "no secret" and "the empty secret"
-- would otherwise be the same value, and the second must never authenticate.
--
-- Fully idempotent — every statement guarded, whole file in one transaction.

BEGIN;

ALTER TABLE mcp_oauth_clients
  ADD COLUMN IF NOT EXISTS client_secret_hash TEXT,
  ADD COLUMN IF NOT EXISTS created_by         TEXT;

-- `/dashboard/mcp` lists the hand-made connectors, newest first.
CREATE INDEX IF NOT EXISTS mcp_oauth_clients_created_by_idx
  ON mcp_oauth_clients (created_by, created_at DESC)
  WHERE created_by IS NOT NULL;

COMMIT;
