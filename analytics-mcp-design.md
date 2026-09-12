# Analytics MCP — design

Sibling of `bug-mcp-design.md`, `marketing-design.md` and `tracker-design.md`: the
argument for what is being built, what is deliberately excluded, and the constraints
that shaped it.

The ask was "an advanced analytics MCP where we can sign in using the account and ask
advanced questions about analytics that we can usually infer from the overview". The
answer this document argues for is **seven read-only tools added to the existing
`/api/mcp` server, reachable with a second credential: an OAuth 2.1 token minted by
signing in with your own HallPass account.**

---

## 0. Decisions taken with the user

Four questions were put and answered before any code was written.

1. **Real OAuth 2.1, not a pasted secret.** The MCP client opens a browser, you sign
   in with the Google account you already use for the dashboard, and approve a
   consent screen. §2 is what that costs and why it is worth it.
2. **Curated tools AND free-form querying.** The curated ones return the dashboard's
   own numbers; the free-form pair is what makes the feature "advanced". §5.
3. **Every table, but proxied** — "the same stuff we can see in the overview page",
   with emails removed. §4 is how that is enforced by the database rather than
   promised by a regex.
4. **On the existing `/api/mcp`,** not a second endpoint. §3 is the consequence: one
   door, two keys, two different sets of tools behind it.

## 1. Why this is worth building

`/dashboard` is a good dashboard and a closed question set.

`getDashboardStats()` runs ten HogQL queries and `getCommunityStats()` runs five
Neon ones, and between them the overview knows plays, unique visitors, retention,
hour-of-day rhythm, weekday split, zero-result searches, board emptiness, comment
sentiment and the newest eight players. Every one of those is a **panel somebody
decided to build**.

The questions that are actually interesting are the ones nobody built a panel for:

* Do players who leave a review score higher afterwards than players who do not?
* Which games do *returning* players replay, as opposed to which games get opened
  once by first-timers?
* Is the lunchtime spike the same games as the after-school hump?
* Which boards get scores from players who never come back?

Every number needed to answer those is already in Neon and PostHog. The join is not,
and building a panel per question does not scale — that is what a query tool is for.

**This is a tool for the person building, not a feature for players.** Nothing on the
public site changes.

## 2. The credential: reversing `bug-mcp-design.md` §2, on purpose

That document argued against OAuth here, and the argument was good:

> This server has exactly one operator. A bearer secret in the client config is the
> honest shape of "one person holds one key", and it reuses `admin-secret.ts` […]
> rather than introducing an auth framework to guard five tools.

Two things changed, and both cut the other way.

**The caller is now a person, not a machine.** A bug-fixing agent runs unattended
under a key an operator provisioned once. An analytics surface is driven
conversationally by whoever is asking the question, and `dashboard_users` already
knows who those people are and what rung they hold. A shared secret throws that away
and records every query as the same anonymous holder.

**What is being read is children's data.** The bug MCP reads bug reports an operator
has already decided to look at. This reads the whole player base at once. An audit
trail that can say *which account* pulled it is worth a protocol, and a credential
that can be revoked per person without rotating anything else is worth more.

**So `MCP_SECRET` does not go away.** It keeps doing exactly what it did, for exactly
the tools it did it for. OAuth is added beside it. The two are independent: either
can be unconfigured without disabling the other, and revoking one does not touch the
other.

### What OAuth actually obliges us to build

Verified against the MCP specification (2025-11-25) rather than recalled:

* The server **must** implement OAuth 2.0 Protected Resource Metadata (RFC 9728),
  and clients discover the authorization server from it.
* The server **must** validate that an access token was issued for *itself* as the
  audience, and must not accept or forward tokens issued for anything else.
* Dynamic Client Registration is optional in the spec but is what Claude clients
  actually use, so it is built.
* PKCE with `S256`. Public clients only — there is no client secret to keep, because
  a CLI on somebody's laptop cannot keep one.

Token lifetimes are 8 hours (access) and 30 days (refresh, rotating). Eight hours is
one working day: long enough not to interrupt, short enough that a stolen token is a
today problem rather than a forever one.

**Tokens are opaque random bytes, stored sha256-hashed, and looked up per request.**
A signed JWT would save a round trip and make revocation impossible, which is the
wrong trade for a credential whose whole point is that it belongs to a person who
might lose a laptop. Hashing at rest means a database dump is not a set of live keys —
the same reasoning `admin-secret.ts` already applies to the shared secrets.

**The role is re-resolved on every request, never baked into the token.** This is the
same decision the `jwt` callback in `app/lib/auth.ts` makes and for the same reason:
demotion must take effect on the next call, not in eight hours.

## 3. One door, two keys, two different rooms

`/api/mcp` now authenticates two ways and assembles a *different tool list* for each.

| Actor | Tools |
|---|---|
| `MCP_SECRET` | the 7 bug tools + the 7 analytics tools |
| OAuth account | the 7 analytics tools |

**An OAuth caller deliberately does NOT get the bug tools**, and this is the sharpest
exclusion in the document.

`bug-mcp-design.md` §3 could skip `assertNotOwnWork` — the guard that stops an admin
triaging a report they filed themselves — with this reasoning:

> The MCP actor is a machine holding a secret; it has no `playerId` and cannot be the
> author of any report, so the self-dealing case it defends against cannot arise.

An OAuth actor has a `playerId`. The case *can* arise. Giving a real identity to
`mark_bug_report_fixed` therefore reopens `assertNotOwnWork` and the four-eyes rule
in `permissions.ts` (`canConfirmOwnWork`), and deciding how those interact with a
machine-mediated close is a feature of its own — not a side effect of adding a
credential. The bug tools stay exactly as they are, on exactly the key they had.

The consequence is a clean sentence: **an OAuth session on this server can read and
cannot write.** Every tool it can reach is marked `readOnlyHint`, and that is true
rather than aspirational.

### Who may sign in

`DASHBOARD_MIN_ROLE` — the same gate as `/dashboard` itself. If you can read the
overview in a browser you can read it through the MCP; if you cannot, you cannot.
One rule, no second ladder to keep in sync, and the page that already documents what
each rung may do keeps being the only place that documents it.

## 4. "Proxied so the emails are gone" — enforced by Postgres, not by us

The request was that free-form SQL see every table, with the personal columns taken
out. There are two ways to do that and only one of them is a boundary.

**The view layer.** Migration `031` creates a `mcp` schema whose views mirror the
public tables with the identifying columns dropped and `players.public_id`
substituted for every `player_id`. Policy:

* **Never exposed:** `players.email`, `players.id` (the Google subject — an
  identifier from someone else's system), `players.name` and `players.image` (a
  child's real name and photograph), `dashboard_users` in its entirety,
  `push_subscriptions` in its entirety, every `*_blob_path` and evidence URL
  (screenshots and screen recordings of children), `ip_hash`, `body_hash`.
* **Exposed:** `username` — self-chosen, already printed on public leaderboards —
  and everything non-identifying.

This is *stricter* than the overview page, which does render eight real names and
avatars. The difference is where the data goes: the overview draws them on the
operator's own screen; an MCP tool posts them into a model's context. Loosening it
later is one column in one view; tightening it after the fact is not.

**The role is what makes the view layer real.** A view is not a permission. A
connection holding the owner role can `SELECT email FROM public.players` no matter
how many views exist beside it, so `run_analytics_sql` uses a **separate Postgres
role with no privileges on `public` at all** and `SELECT` on the `mcp` schema only,
reached through its own connection string.

Three properties follow, and all three are load-bearing:

* The views must **not** be `security_invoker`. The default (privileges checked as
  the view's owner) is precisely the mechanism that lets a role with nothing on
  `public` read through them.
* The connection is opened `readOnly`, so every statement runs in a `READ ONLY`
  transaction. Belt to the role's braces: two independent things must both fail
  before a write is possible.
* **If `MCP_ANALYTICS_DATABASE_URL` is unset, the tool is not registered at all.** It
  never falls back to `DATABASE_URL`. A fail-open here reads every child's email
  address, so this one fails closed and says why.

`scripts/provision-mcp-reader.mjs` creates the role and then **proves the boundary**:
it reconnects as the new role and asserts that reading `public.players` fails,
exiting non-zero if it succeeds. A privilege leak that announces itself is a bad
afternoon; one that does not is the only failure this feature cannot have.

## 5. The tools, and the one that matters most

| Tool | What it does |
|---|---|
| `get_overview` | The dashboard's own numbers — `getDashboardStats()` + `getCommunityStats()`. |
| `get_growth` | Acquisition, channels, retention, the share loop. |
| `get_content_health` | Games missing media, video or reviews. |
| `get_alerts` | The half-hourly alert snapshot and what it currently judges. |
| `describe_analytics_schema` | The `mcp` views, the PostHog event catalogue, and the metric definitions. |
| `run_analytics_sql` | One read-only `SELECT` over the `mcp` schema. |
| `run_analytics_hogql` | One read-only HogQL query over PostHog events. |

The curated four add no SQL. They call the functions the dashboard calls, so a number
read through the MCP and a number read on the screen cannot disagree — if they ever
do, one of them is a bug in a shared function rather than a discrepancy to
reconcile.

**`describe_analytics_schema` is worth more than either query tool.** A model handed
a schema and left to invent metrics will invent them plausibly and wrongly, and the
failure is silent. This codebase has already paid for several of those lessons and
wrote them down; the tool repeats them:

* Only `game_started` counts as a play. `featured_game_opened` fires *as well* on the
  featured banner, and counting both double-counts every featured play — a real bug,
  documented at `stats.ts:136`.
* Hour-of-day is on the **PostHog project's** clock. Not UTC, not the player's.
* ACTIVE means `last_login` — came back to the site, not played. Plays are anonymous
  and live in PostHog.
* RETURNING means a login on a *later day* than sign-up, not "more than one login". A
  single evening's session refreshes the cookie many times and is still one visit.
* PostHog counts anonymous devices; Neon counts signed-in people. A ratio with one on
  each side is almost always a mistake.

`sql-guard.ts` caps the rest: a single statement, starting `SELECT` or `WITH`, with a
`LIMIT` injected when absent and hard row and byte ceilings on the result. Same
argument as `bug-mcp-design.md` §5 — an agent that pulls fifty thousand rows into its
context to answer "how many players are there" has been failed by the tool design,
not by the model.

## 6. Failure modes

* **Neither credential configured** → 503 naming both, never a silent accept. One
  configured and the other not is a working endpoint with fewer tools, not an error.
* **A 401 that does not start the browser flow.** The `WWW-Authenticate` header must
  carry `resource_metadata=`; without it a client reports "unauthorized" and stops
  instead of signing in. This is the single most likely way to ship a feature that
  looks broken while every route works.
* **An open redirect.** A bad `client_id` or an unregistered `redirect_uri` renders an
  error page and never redirects. Redirecting to an unvalidated URI with a code
  attached is how authorization servers leak codes.
* **A replayed authorization code.** Redemption is one statement with the consumption
  in the `WHERE`, so the second attempt matches nothing and is refused.
* **A stale service worker serving yesterday's OAuth metadata.** `public/sw.js`
  bypasses `/api/` but not `/.well-known/`, so the discovery documents would land in
  `cacheFirst` and be served from a browser cache indefinitely. Both new prefixes are
  added to the bypass list.
* **Demotion mid-token.** The role is read per request, so the next call after a
  demotion is refused without waiting for expiry.
* **PostHog or Neon unreachable.** Reported, never degraded to zeros — the inversion
  `alerts/metrics.ts` argues for. An analyst told "no data" when the query failed
  will draw a conclusion from an outage.

## 7. Deliberately absent

* **Writes of any kind.** §3. The whole surface is `readOnlyHint` and that is a fact
  about the code, not a hint.
* **The bug tools on an OAuth token.** §3.
* **Player-facing analytics.** Nothing here is reachable without a dashboard role.
* **A second endpoint.** One server, two credentials. A `/api/mcp/analytics` would
  duplicate the transport, the 405s and the activity logging to gain a URL.
* **Prompts and resources.** Same reasoning as `bug-mcp-design.md` §6 — the
  definitions that would justify a resource are in `describe_analytics_schema`, where
  a model reaches them by asking rather than by the client remembering to subscribe.
* **Writing to PostHog.** The personal API key can create insights and dashboards.
  Building the dashboard is a decision about what is worth looking at every day, and
  that is not a thing to delegate to a query.
* **Scopes finer than "read analytics".** One scope, because there is currently one
  thing to grant. A scope system with one member is a ceremony.

## 8. Open questions

1. **Should `name` be exposed after all?** The overview shows it. §4 argues the
   destination differs. If the answer changes it is one column in `mcp.players`.
2. **Should a beta admin see the same analytics as a super admin?** Currently yes —
   the gate is `DASHBOARD_MIN_ROLE`, matching the overview page, which every rung may
   read. If that stops being true for the page it must stop being true here.
3. **Rate limiting on the MCP itself.** None, as with the bug MCP. Registration is
   rate-limited because it is unauthenticated; everything past the token is a person
   who could open the dashboard instead.
