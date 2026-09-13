/**
 * Who has connected what — grants and hand-made clients, grouped per account.
 *
 * `/dashboard/mcp` answers this for ONE person at a time, in tables. The Users
 * screen needs the same facts as a number per row, so this module does the
 * grouping once and both readings of the word survive it:
 *
 *   * a CONNECTION is an OAuth grant — an app that account approved, and the
 *     only kind that can currently reach data on their behalf;
 *   * a CONNECTOR (as `/dashboard/mcp` labels its Advanced section) is a
 *     hand-registered client. It is not access anybody holds; it records who
 *     typed it in. Counted separately for exactly that reason — folding the two
 *     into one total would report an admin who registered a client for somebody
 *     else as having a connection they do not have.
 *
 * ── PURE, AND DELIBERATELY NOT IMPORTING THE STORE ────────────────────────
 * The inputs are described structurally rather than as `OauthGrant` /
 * `OauthClient`, so this file pulls in nothing from `store.ts` — which is
 * `server-only` and would drag a database connection into a unit test and a
 * client bundle. The store's rows satisfy these shapes as they are; the summary
 * this returns is what the Users page hands to a client island.
 *
 * ── ONE GRANT PER APPROVAL, NOT PER APP ───────────────────────────────────
 * Approving Claude on a laptop and again on a phone is two grants with one
 * name, and both can reach the data, so `connections` counts two. The name is
 * still shown once, carrying its own count, because a chip row that repeats
 * "Claude · Claude" reads as a rendering bug rather than as two devices.
 *
 * Callers pass live grants only (`listGrants` already drops revoked and expired
 * ones): the question this answers is "what can currently reach this account's
 * data", not "what ever could".
 */

/** A grant, as much of it as grouping needs. */
export type ConnectorGrant = {
  email: string;
  clientName: string;
};

/** A registered client, as much of it as grouping needs. */
export type ConnectorClient = {
  /** The admin who registered it by hand, or `null` for a self-registered one. */
  createdBy: string | null;
};

/** One connected app, and how many separate approvals carry its name. */
export type ConnectorApp = {
  name: string;
  count: number;
};

/** What one account has connected. */
export type ConnectorSummary = {
  /** Live grants. Two approvals of the same app count twice — both work. */
  connections: number;
  /** The distinct app names behind those grants, busiest first. */
  apps: ConnectorApp[];
  /** Clients this person registered by hand. Not access they hold. */
  manualClients: number;
};

/**
 * An account with nothing connected.
 *
 * Frozen and shared rather than built per lookup: it is handed to every row of
 * a table, and a mutation of it would be a bug visible on all of them at once.
 */
const NO_APPS: ConnectorApp[] = [];
Object.freeze(NO_APPS);

export const NO_CONNECTORS: ConnectorSummary = Object.freeze({
  connections: 0,
  apps: NO_APPS,
  manualClients: 0,
});

/** A blank name is still a row that exists; say so rather than render nothing. */
const UNNAMED = "Unnamed connector";

/**
 * The key both sides are grouped under.
 *
 * Every writer already lowercases (`normalizeEmail` in `dashboard-users.ts`,
 * and the OAuth actions trim + lowercase the session address before storing
 * it), so this is belt-and-braces — but the cost of it being wrong is a row
 * that silently reports zero connections for somebody who has three, which is
 * indistinguishable from the truth on screen.
 */
function key(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/**
 * Group live grants and hand-made clients by the account they belong to.
 *
 * Accounts with neither are absent from the map rather than present with
 * zeroes — the caller is looking rows up by email and `connectorsFor` supplies
 * the empty summary, so filling this in for every dashboard user would mean
 * passing the user list in just to produce entries nobody reads.
 */
export function summarizeConnectors(
  grants: readonly ConnectorGrant[],
  clients: readonly ConnectorClient[],
): Map<string, ConnectorSummary> {
  const apps = new Map<string, Map<string, number>>();
  const manual = new Map<string, number>();

  for (const grant of grants) {
    const email = key(grant.email);
    if (!email) continue;
    const byName = apps.get(email) ?? new Map<string, number>();
    const name = grant.clientName.trim() || UNNAMED;
    byName.set(name, (byName.get(name) ?? 0) + 1);
    apps.set(email, byName);
  }

  for (const client of clients) {
    // A self-registered client has no author, so it belongs to nobody's count.
    const email = key(client.createdBy);
    if (!email) continue;
    manual.set(email, (manual.get(email) ?? 0) + 1);
  }

  const summaries = new Map<string, ConnectorSummary>();
  for (const email of new Set([...apps.keys(), ...manual.keys()])) {
    const byName = apps.get(email) ?? new Map<string, number>();
    // Busiest first, ties alphabetical: the chip row has to come out the same
    // on every render, and row order out of a Map follows whatever order the
    // query happened to return.
    const sorted = [...byName.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    summaries.set(email, {
      connections: sorted.reduce((total, app) => total + app.count, 0),
      apps: sorted,
      manualClients: manual.get(email) ?? 0,
    });
  }
  return summaries;
}

/**
 * This account's summary, or `null` when the read behind the map failed.
 *
 * The two are different things to a reader — "nothing connected" is a fact,
 * "we could not ask" is not — so the caller gets `null` for the second and
 * renders it as unknown rather than as zero. Somebody deciding whether to
 * remove an account should never be shown a confident zero that came from an
 * unreachable database.
 */
export function connectorsFor(
  summaries: Map<string, ConnectorSummary> | null,
  email: string,
): ConnectorSummary | null {
  if (!summaries) return null;
  return summaries.get(key(email)) ?? NO_CONNECTORS;
}
