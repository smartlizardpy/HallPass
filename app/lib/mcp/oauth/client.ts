import "server-only";

/**
 * HallPass — resolving a `client_id`, whichever kind it is.
 *
 * `server-only` because one branch writes to the database. The two branches are
 * the two registration methods this server supports (`oauth/cimd.ts` explains
 * why both):
 *
 *   * an OPAQUE id, minted by `POST /api/oauth/register` under RFC 7591, is
 *     looked up in `mcp_oauth_clients`;
 *   * a URL id is a Client ID Metadata Document — fetched, validated against
 *     the URL it came from, and then upserted so everything downstream
 *     (foreign keys, the dashboard's JOIN, revocation) works identically.
 *
 * Every caller uses this rather than `getClient` directly, so a CIMD client is
 * never accidentally told "no such client" by a path that only knows about the
 * table.
 */

import { fetchClientMetadata, isClientIdUrl } from "./cimd";
import { getClient, upsertCimdClient, type OauthClient } from "./store";

export type ResolvedClient =
  | { ok: true; client: OauthClient }
  | { ok: false; reason: string };

/** Resolve a `client_id` from either namespace. */
export async function resolveOauthClient(clientId: string): Promise<ResolvedClient> {
  const id = clientId.trim();
  if (!id) return { ok: false, reason: "No client_id was supplied." };

  if (!isClientIdUrl(id)) {
    const client = await getClient(id);
    return client
      ? { ok: true, client }
      : { ok: false, reason: "No client with that id has registered with HallPass." };
  }

  const metadata = await fetchClientMetadata(id);
  if (!metadata.ok) return { ok: false, reason: metadata.reason };

  // Re-fetched and re-validated every time, so a client that edits its document
  // takes effect on the next request rather than at some cache boundary. The
  // upsert only keeps the row in step for the dashboard and the foreign key.
  try {
    const client = await upsertCimdClient(metadata.client);
    return { ok: true, client };
  } catch (error) {
    console.error("Failed to record a CIMD client:", error);
    return { ok: false, reason: "That client could not be recorded. Try again." };
  }
}
