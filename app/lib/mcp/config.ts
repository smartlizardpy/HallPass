/**
 * HallPass — the bug MCP's vocabulary, limits and identity.
 *
 * PURE and free of `server-only`, like `beta/config.ts`, `growth/channels.ts`
 * and `alerts/guard.ts`: no database, no `next/headers`, no SDK import. Read by
 * the tool definitions, by the server-only half that executes them AND by the
 * tests, so the bounds a tool advertises cannot drift from the bounds the
 * executor enforces.
 *
 * Read `bug-mcp-design.md` for the whole argument.
 */

/**
 * What the server calls itself on the wire, shown by clients in their server
 * list. Named for the queue it serves rather than for the site, because an
 * operator with several servers configured is choosing between tools, not
 * between projects.
 */
export const MCP_SERVER_NAME = "hallpass-bugs";

/**
 * What the server calls itself to an OAUTH caller, who gets the analytics tools
 * and not the bug ones.
 *
 * Two names for one endpoint, because it genuinely is two things depending on
 * the credential (`analytics-mcp-design.md` §3). A client list that said
 * "hallpass-bugs" beside a tool list containing no bug tools would be the
 * server lying about itself in the one place a person actually reads it.
 */
export const MCP_ANALYTICS_SERVER_NAME = "hallpass-analytics";

/**
 * Advertised server version. NOT the protocol version — the SDK negotiates that
 * per connection across the five versions it supports, which is most of why the
 * SDK is a dependency at all (`bug-mcp-design.md` §4).
 */
export const MCP_SERVER_VERSION = "1.0.0";

/**
 * The actor string written to `beta_reports.resolved_by` and
 * `beta_xp_awards.awarded_by` when a decision comes through this server.
 *
 * WHY THIS IS NOT AN ADMIN'S EMAIL. Those columns are TEXT and deliberately not
 * foreign keys, so anything at all would be accepted — which is exactly why the
 * value is worth choosing. Every other writer puts a real person's address
 * there. If this one borrowed an operator's address too, the XP ledger would
 * record an admin's judgement for a decision no admin made, and the audit trail
 * would be actively misleading rather than merely coarse. The default is shaped
 * like an address so the column stays uniform, and is obviously not a person.
 *
 * READ AT CALL TIME, never at import: a value set after import — by Vercel, or
 * by a test — has to be seen. Same rule as `alerts/guard.ts`.
 */
export const DEFAULT_MCP_ACTOR = "mcp@hallpass.invalid";

/** Who this server records as the resolver. */
export function mcpActor(): string {
  return process.env.MCP_ACTOR?.trim() || DEFAULT_MCP_ACTOR;
}

/**
 * How many reports `list_bug_reports` returns when the caller does not say.
 *
 * Deliberately smaller than the ceiling. The common question is "what should I
 * work on next", and answering it with twenty rows an agent can actually read
 * beats answering it with two hundred it has to summarise.
 */
export const DEFAULT_REPORT_LIMIT = 20;

/**
 * The most `list_bug_reports` will return, whatever it is asked for.
 *
 * A cap rather than a suggestion, because the caller is a language model paying
 * for every row in its context and the failure is silent: an agent that pulls
 * the whole queue to answer one question does not error, it just gets worse at
 * the rest of the conversation. Detail is a second call for the same reason —
 * `error_log` can be kilobytes per row.
 */
export const MAX_REPORT_LIMIT = 100;

/**
 * Clamp a caller-supplied limit into the bug queue's band. See
 * {@link clampInto} for what it does with a float or a missing value.
 */
export function clampLimit(limit: number | undefined): number {
  return clampInto(limit, DEFAULT_REPORT_LIMIT, MAX_REPORT_LIMIT);
}

/**
 * How many tracker items `list_tracker_items` returns by default, and at most.
 *
 * Both larger than the report numbers, because the units are not comparable. A
 * bug report carries a body and an error log; a tracker summary is a title, a
 * lane and a few tags, and "the whole board" is the question an agent actually
 * wants answered before it decides what to build. The board is tens to low
 * hundreds of rows by design (`tracker/store.ts`), so the default is usually
 * all of it.
 */
export const DEFAULT_TRACKER_LIMIT = 50;
export const MAX_TRACKER_LIMIT = 200;

/** {@link clampLimit}, for the tracker's own band. */
export function clampTrackerLimit(limit: number | undefined): number {
  return clampInto(limit, DEFAULT_TRACKER_LIMIT, MAX_TRACKER_LIMIT);
}

/**
 * The shared body of both clamps.
 *
 * Undefined means "use the default", not "use the maximum". A non-integer or
 * out-of-range number is CLAMPED rather than refused: the tool's job is to
 * return rows, and failing a whole call over a float is a worse answer than
 * returning the nearest sensible page.
 */
function clampInto(limit: number | undefined, fallback: number, max: number): number {
  if (limit == null || !Number.isFinite(limit)) return fallback;
  const whole = Math.floor(limit);
  if (whole < 1) return 1;
  if (whole > max) return max;
  return whole;
}

/**
 * The board a tracker write invalidates, and the prefix its item pages sit
 * under.
 *
 * Only the dashboard: unlike a bug decision, which changes what a TESTER sees
 * on `/beta`, nothing on the tracker is rendered off the dashboard at all
 * (`tracker-design.md` §5 — "Nothing is exposed through /api/v1/*").
 */
export const TRACKER_BOARD_PATH = "/dashboard/tracker";

/**
 * The longest any line of the agent activity feed is kept.
 *
 * Only a cap now. A run's lines are deleted when it ends — by
 * `finish_agent_activity`, or by the first line after
 * {@link ACTIVITY_IDLE_MINUTES} of silence (`agent-activity-design.md` §11) —
 * so this bounds the one run that never ends: an agent that works for a
 * fortnight without ever going quiet. The sweep rides on the insert
 * (`store.ts`'s `logAgentActivity`), so this is also how often the table is
 * pruned: every tool call.
 *
 * A constant rather than an env var deliberately. Every tunable is one more
 * thing to set on a deployment and get wrong, and nothing about this number is
 * deployment-specific.
 */
export const ACTIVITY_RETENTION_DAYS = 14;

/**
 * How long the feed may go quiet before the run it shows counts as over.
 *
 * The transport is stateless (`app/api/mcp/route.ts`), so the server is never
 * told that an agent has gone. It can be told the agent FINISHED, by
 * `finish_agent_activity`, or notice that nothing has been written for this
 * long — the fallback for an agent that crashed, was killed or forgot. Past it
 * the panel shows nothing, and the next line written deletes the quiet run
 * before starting a new one (`agent-activity-design.md` §11).
 *
 * Errs long on purpose. The longest gap between two lines while agents were
 * working, in the first real session, was five and a half minutes; a window
 * that closed on an agent still thinking would tell the operator it had
 * stopped, which is the one thing the panel must never say by accident. Thirty
 * was the operator's choice, and it is a constant for the same reason
 * {@link ACTIVITY_RETENTION_DAYS} is.
 */
export const ACTIVITY_IDLE_MINUTES = 30;

/**
 * Paths whose caches a write invalidates, mirroring what the beta server
 * actions revalidate.
 *
 * Both halves matter: `/dashboard/beta` is the admin queue an operator refreshes
 * after the agent has been working, and `/beta` is the tester's own page, where
 * a resolved report disappearing and an XP total moving are the visible result
 * of the decision. Missing either leaves somebody reading a screen that is
 * quietly out of date.
 */
export const REVALIDATE_PATHS = ["/dashboard/beta", "/beta"] as const;
