# Bug MCP — design

Sibling of `marketing-design.md`, `tracker-design.md` and `notifications-design.md`:
the argument for what is being built, what is deliberately excluded, and the
constraints that shaped it.

The ask was "let's build a bug MCP, for fixing bug requests". The answer this
document argues for is a **read-and-triage MCP server over HTTP**, mounted at
`/api/mcp`, exposing the `beta_reports` queue to a coding agent so that the
round trip from "a tester filed a bug" to "the bug is fixed and the tester is
paid" happens without anybody opening the dashboard in between.

---

## 0. Decisions taken with the user

Three questions were put and answered before any code was written. They are the
frame for everything below.

1. **HTTP, in the Next app** — not a stdio server in a sibling folder. The
   endpoint lives in the deployed site, so any MCP client that can reach the
   site can use it. §4 is the security consequence, and it is the whole reason
   this document spends more words on the door than on the tools.
2. **`beta_reports` only.** Game bugs filed by testers. Not `tracker_items`,
   not GitHub issues — see §6.
3. **Writes included: mark reports fixed, and the rest of triage.** This is the
   sharp one. Closing a report as fixed **deletes the row** and **pays XP**, so
   the write surface is irreversible by construction. §3 is about not
   reimplementing that path, and §5 about what could go wrong with it.

## 1. Why this is worth building

The bug data in this repo is unusually good, and unusually stranded.

`beta_reports` already carries, per row: the tester's title and body, a
severity, the **game's own JavaScript errors** collected silently during the
session (`error_log`, with `error_count` denormalised), a screenshot, a replay
clip, and the device string. That is most of a reproduction case, written by
somebody who was actually there.

Today the only way to read it is `/dashboard/beta`, by eye. An agent asked to
fix a bug has to be told the bug first, by a human who read it and retyped it.
The MCP removes that step: the agent lists the queue, reads the full report
including the error log, fixes the code, and closes the report — and the tester
gets paid for the find in the same motion.

**This is a tool for the person building, not a feature for players.** Nothing
on the public site changes.

## 2. The constraint that shapes everything: this endpoint is on a children's site

`marketing-design.md` §2 spends a page on who the players are — children, on
school devices, whose screenshots and screen recordings are in these very rows.
That argument applies here with more force than it does to a marketing panel,
because this surface **reads their evidence and can delete it**.

Four consequences, all load-bearing:

**The credential is dedicated and has no fallback.** `alerts/guard.ts` falls
back from `ALERTS_SECRET` to `SCOREBOARD_ADMIN_SECRET` to `ADMIN_HTML_PASSWORD`,
and argues for it: an operator can turn the feature on with what they already
have. That argument is right for two endpoints that read counts and file
notifications. It is wrong here. `MCP_SECRET` is checked and **nothing else is**,
so this endpoint is OFF — answering 503, not 401 — until somebody deliberately
provisions it. A surface that deletes rows and pays XP should not switch itself
on because an unrelated password happens to be set.

**Unconfigured is 503, unauthorized is 401**, exactly as `alerts/http.ts` argues:
"I never set this up" and "my key is wrong" are two different afternoons.

**It inherits the site's existing exclusions by living under `/api/`.**
`app/robots.ts` disallows `/api/`, and `public/sw.js` never intercepts it
(`url.pathname.startsWith("/api/")`). Neither needed editing, and that is a
reason to prefer `/api/mcp` over a top-level path.

**No OAuth, no dynamic client registration.** The MCP spec has an authorization
story built on OAuth 2.1, and it is the right one for a server exposed to
third-party clients. This server has exactly one operator. A bearer secret in the
client config is the honest shape of "one person holds one key", and it reuses
`admin-secret.ts` — constant-time, hashed-first, already tested — rather than
introducing an auth framework to guard five tools.

## 3. The write path is already written, and must not be written again

This is the most important section in this document.

`app/dashboard/(app)/beta/actions.ts` contains three actions that end a report,
and every one of them encodes a decision that took somebody a while to get
right. `store.ts`'s `payAndRemoveReport` carries a comment explaining that the
order of two statements is a safety property:

> PAY, THEN DELETE. […] paid but not deleted — self-healing. deleted but not
> paid — unrecoverable. Reversing these two lines converts a retry into a silent
> theft.

**The MCP calls the same store methods and the same minting functions.** It adds
no SQL and no XP arithmetic. Specifically it reuses:

| Concern | Reused from |
|---|---|
| Set an outcome, keep the row | `beta.triageReport()` |
| Pay and remove (fixed, duplicate) | `beta.payAndRemoveReport()` |
| What acceptance pays | `xpForReport()` |
| What a fix pays | `xpForFix()` |
| The ledger reason string | `acceptanceReason()`, `REASON_FIXED`, `REASON_DUPLICATE` |
| Reading one report / the queue | `beta.reportById()`, `beta.reportQueue()`, `beta.reportByIdWithAuthor()` |

**One read WAS added to the store, and the claim above is about writes.** Stated
plainly because the first draft of this document said "adds no SQL" without
qualification, and that turned out to be true of the write path and false of the
reads. `reportByIdWithAuthor` is a single-row version of the queue's join: the
detail tool wants one report and its author, and the alternative was reading five
hundred rows — every body and every error log — to recover one handle. It lives
in `store.ts` because that is where SQL lives here, and it is held to the same
asserted invariants as the queue it mirrors (public player columns only, LEFT
joined so an orphaned report survives).

And it repeats the same guards the actions apply before calling them, because
those guards live in the action bodies rather than in the store:

- the report must exist;
- `triage` requires `status = 'open'` — an already-judged report is refused, so
  no outcome can be re-triggered and re-paid;
- `fixed` refuses a `rejected` report ("we fixed the thing you told us was not a
  thing" is a triage contradiction, and `xpForFix` is documented as refusing to
  price it);
- `duplicate` requires `open`, because calling something a duplicate after
  accepting it would have to decide what happens to the severity award already
  paid, and there is no answer that is not a clawback or a double payment;
- a feature carries no severity, a bug keeps its own unless overridden — the
  cross-field CHECK turns a stray severity on a feature into a 500;
- the clip blob is deleted **after** the write, best-effort, because a failed
  blob delete must never undo a decision.

**`assertNotOwnWork` is the one guard that is not repeated, and that is safe by
construction.** It stops an admin triaging a report they filed themselves, by
comparing the actor's `playerId` against the report's. The MCP actor is a
machine holding a secret; it has no `playerId` and cannot be the author of any
report, so the self-dealing case it defends against cannot arise. Recorded here
rather than silently omitted.

**Who gets recorded as the resolver.** `resolved_by` and `awarded_by` are TEXT
and deliberately not foreign keys, so the actor string is free — which means it
is worth choosing rather than defaulting. `MCP_ACTOR` names it, falling back to
a constant that is obviously not a person, so an audit of the XP ledger can tell
a machine's decision from an admin's at a glance.

## 4. The transport — verified, not recalled

`AGENTS.md` says to verify framework APIs against the installed source rather
than from memory. Both halves of this were checked that way, because the
protocol spec site is unreachable from the build network:

- **Next 16 route handlers** take a Web `Request` and return a Web `Response`;
  `POST` is never cached; `revalidatePath` is explicitly supported in a route
  handler (verified in `node_modules/next/dist/docs/`).
- **`@modelcontextprotocol/sdk` 1.30.0** ships
  `WebStandardStreamableHTTPServerTransport`, whose `handleRequest(req: Request):
  Promise<Response>` is exactly the route handler's signature. Its own docblock
  offers Hono and Cloudflare Workers as the examples. The protocol constants
  read `LATEST_PROTOCOL_VERSION = '2025-11-25'` with four older versions still
  supported, so version negotiation is the SDK's job and not ours.

**The SDK is used rather than hand-rolled.** A minimal JSON-RPC POST handler is
perhaps eighty lines and would have no dependency — the trade `uqr` was weighed
against in `marketing-design.md` §8b. It comes out the other way here: QR
geometry is a fixed, finished spec, whereas MCP negotiates a protocol version
per connection and has five supported ones in flight. Hand-rolling it means
owning that negotiation forever, and the failure mode is a client that connects
and then behaves strangely rather than one that fails loudly.

**Stateless, with JSON responses.** `sessionIdGenerator: undefined` puts the
transport in stateless mode and `enableJsonResponse: true` makes it answer
`application/json` rather than opening an SSE stream. Both are forced by where
this runs: Vercel functions do not survive between invocations, so a session id
minted on one request has nothing to resolve against on the next, and a
long-lived event stream is not a thing a serverless function should hold open. A
new server and transport are constructed per request for the same reason.

## 5. Failure modes

- **No secret set** → 503 naming `MCP_SECRET`, never a silent accept. `verifySecret`
  treats a blank secret as `unconfigured` rather than matching an empty string.
- **Someone else resolved it first.** Every write returns `applied: false` rather
  than throwing when its `WHERE` matched nothing. The tool reports that as a
  refusal ("already triaged / already gone"), not as success — an agent that
  reads "ok" for a write that did nothing will confidently tell you a bug is
  closed when it is not.
- **A retried fix.** The partial unique index on `(report_id, reason)` makes a
  repeated payment a no-op, which is what makes the pay-then-delete order
  self-healing. The MCP inherits this by calling the same method.
- **A double-spend across two agents.** Not possible for the same report: the
  first delete removes the row, the second finds nothing and reports `applied:
  false`.
- **Clip cleanup fails.** Logged, never fatal — the decision stands.
- **Stale dashboard.** Writes call `revalidatePath` for `/dashboard/beta` and
  `/beta`, exactly as the server actions do, or an admin refreshing the queue
  sees rows the agent has already closed.
- **A tool that returns too much.** `error_log` is capped text and a queue can be
  long; the list tool takes a limit with a documented ceiling, and detail is a
  separate call. An agent that pulls two hundred full reports into its context to
  answer "what is open" has been failed by the tool design.

## 6. Deliberately absent

- **`tracker_items`.** The site feature board is a different shape — lanes,
  positions, briefs meant for a human reader — and the tracker's own schema
  header draws exactly this line: "this tracker is for SITE features, and game
  bugs already live in `beta_reports`." Adding it means deciding whether an agent
  may move lanes, which `tracker/config.ts` restricts to `super_admin` with an
  argument about who may truthfully claim "this is being built". One source, done
  properly, first.
- **GitHub issues.** The `gh_repo` / `gh_issue_number` seam on `tracker_items` is
  still nullable and unused. Claude Code already has GitHub tools; an MCP that
  proxied them would be a second, worse way to do something that already works.
- **Prompts and resources.** The SDK supports both. Tools are what an agent needs
  to work a queue, and a resource list of every open bug would duplicate
  `list_bug_reports` with different caching.
- **`beta_shots` review.** Accepting a screenshot promotes it into `game_media`
  and onto the public site. A publish-to-a-children's-site button is not going on
  a machine-held credential.
- **Inviting, revoking or assigning testers.** Membership decisions are about
  people, and `assertNotOwnWork` and the role ladder exist because who decides
  matters. Out of scope for a bug-fixing tool.
- **SSE / streaming and sessions.** §4.
- **OAuth.** §2.

## 7. The tools

Five, named so an agent can guess them, and shaped so the destructive ones read
as destructive.

| Tool | Writes? | What it does |
|---|---|---|
| `list_bug_reports` | no | The triage queue. Filters: status, kind, severity, slug. Bounded limit. Summaries only. |
| `get_bug_report` | no | One report in full — body, error log, device, evidence URLs, author handle. |
| `triage_bug_report` | yes | `accepted` or `rejected`. Keeps the row. Pays the severity award on accept. |
| `mark_bug_report_fixed` | **destructive** | Pays acceptance (if still open) plus the fix bonus, then **deletes** the report. |
| `close_bug_report_duplicate` | **destructive** | Pays the consolation award, then **deletes** the report. |

The three writers carry `annotations` marking them destructive and
non-idempotent, which is the MCP-native way to tell a client "confirm this one".
`list` and `get` are marked read-only.

## 8. Phasing — the file-by-file plan, and what shipped

Twelve commits, each leaving the tree working. **All of it is built**; this table
is now a record rather than a plan.

| # | Commit | Files |
|---|---|---|
| 1 | This plan | `bug-mcp-design.md` |
| 2 | The dependency | `package.json` |
| 3 | Vocabulary and limits | `app/lib/mcp/config.ts` + test |
| 4 | The door | `app/lib/mcp/guard.ts` + test |
| 5 | The gate's replies | `app/lib/mcp/http.ts` |
| 6 | Report → wire shapes | `app/lib/mcp/report-view.ts` + test |
| 7 | The operations | `app/lib/mcp/bugs.ts` |
| 8 | Tool registration | `app/lib/mcp/server.ts` |
| 9 | The endpoint | `app/api/mcp/route.ts` |
| 10 | How to point a client at it | `.env.example`, `README.md` |
| 11 | One report and its author, in one query | `app/lib/beta/store.ts` + test |
| 12 | Spend that query | `app/lib/mcp/bugs.ts` |

**Commits 11 and 12 were not in the plan.** They came out of reading the finished
diff rather than from changing our minds: `getBugReport` was fetching the whole
queue to recover an author the single-row read does not carry, which is the
summary/detail argument in §5 being violated on the server's side of the wire.
The fix is the store method recorded in §3.

**Verified after the build, not assumed.** `npm test` passes (1607 tests, 98
files); `npm run lint` reports the same 11 pre-existing warnings and no new ones;
`npm run build` succeeds with `/` still prerendered (`○`), `/api/mcp` dynamic
(`ƒ`) as an authenticated endpoint must be, and `public/sw-manifest.js` still
carrying **28** `/game/` routes — the regression check the game page's docblock
specifies — with `/api/mcp` correctly absent from it.

The protocol itself was exercised against a running dev server rather than
reasoned about: an unauthenticated `POST` and a wrong secret both answer 401, a
correct one completes `initialize` and negotiates `2025-06-18`, `tools/list`
returns all five tools with the intended annotations, an invalid `severity` and a
negative `id` are refused by the schema before reaching a query, `GET` answers
405, and a tool call against an unconfigured database reports that fact rather
than an empty list.

The pure/server split follows the one `marketing-design.md` §8 landed on and the
one `beta/config.ts` + `beta/store.ts` already use: anything importing
`server-only` cannot be loaded by Vitest at all, so the testable halves —
the secret precedence, the filter validation, the wire mapping — live in modules
free of it, beside the server-only halves that read the database.

## 9. Open questions

1. **Should the agent be able to reopen a report?** Not built. `triage` refuses a
   non-open report, so a mistaken `rejected` currently needs the dashboard. The
   action layer has no reopen either, so building one here would put a capability
   on the machine surface that the human surface lacks.
2. **Should `list_bug_reports` include reports with no author?** It does.
   `player_id` is `ON DELETE SET NULL`, so an orphaned report is a real row with
   a real bug in it; hiding it would lose the bug to protect nothing.
3. **Rate limiting.** None. One operator, one key, and the endpoint is 503 by
   default. If the key is ever shared this needs revisiting before it is.
