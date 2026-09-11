# Agent activity, and a dashboard you can read — design

Sibling of `bug-mcp-design.md`, which built the MCP this extends. Same job as
the rest of the `*-design.md` family: the argument for what is being built, what
is deliberately excluded, and the constraints that shaped it.

Two asks, taken together because they land on the same screen and pull in the
same direction:

1. **Show what the agent is doing** on `/dashboard/beta`, so an operator
   watching the queue drain knows who drained it and why.
2. **Declutter that dashboard** — group assignments under the tester they were
   given to, drop finished playtests off the admin surface, and stop rejected
   reports sitting in the triage queue forever.

The second is not a tidy-up bolted onto the first. Adding a live feed to a page
that already shows every assignment ever issued and every report ever rejected
makes the new panel the sixth thing competing for attention on a screen whose
whole job is "what needs me now". The feed is only worth having on a page where
something moving is visible.

---

## 0. Decisions taken with the user

Four questions were put and answered before any code was written.

1. **Automatic logging AND a narration tool.** Every MCP tool call is recorded
   without the agent's cooperation, and a new tool lets the agent say in its own
   words what it is up to. §2 is why neither half is sufficient alone.
2. **The panel polls (~10s).** Watching an agent work is the point; a panel that
   needs a reload is a panel you check after the fact. §5.
3. **Rejected reports are hidden from the dashboard, not deleted.** The row is
   the tester's record of what was decided. §7.
4. **The assign panel shows active playtests only, grouped by tester.**
   Submitted and closed ones leave the admin surface and stay on the tester's
   own page, where they already render. §8.

## 1. Why the feed is worth building

The MCP's write surface is irreversible by construction: closing a report as
fixed **deletes the row** and **pays XP** (`bug-mcp-design.md` §3). That was
argued as safe — the payment is in the ledger and the queue is smaller — and it
is, but it has a side effect nobody sees until they are staring at it: the
dashboard is where the evidence WAS, and after an agent has worked the queue the
dashboard is where the evidence ISN'T.

Today an operator who left an agent running comes back to a shorter queue and no
account of what happened to the missing rows. The XP ledger knows — every award
carries `awarded_by`, and `mcpActor()` exists precisely so a machine's decision
is distinguishable from an admin's — but reading it means opening the database,
which is the thing this whole programme's dashboard exists to avoid.

So: an append-only trail of what the agent did, rendered where the work
disappeared from.

**This is a tool for the person building, not a feature for players.** Nothing on
the public site changes, and nothing a tester sees changes.

## 2. Both halves of the recording, and why neither alone

**Automatic logging** covers every tool call — read and write, applied and
refused. Its virtue is that it cannot be forgotten: an agent that never thinks
about the dashboard still fills it. Its limit is that it can only report
mechanism. "read report 42, marked report 42 fixed" is a true and largely
useless account of an afternoon.

**The narration tool** (`log_agent_activity`) covers intent: "reproducing the
collision bug in neon-snake — the error log points at the sprite pool". Its
virtue is that it says the thing an operator actually wants to know. Its limit
is that it is voluntary, and a tool an agent forgets to call produces a feed that
is silent exactly when the agent is deepest in something.

Together they degrade the right way. The mechanical trail is the floor, and the
narration is what makes it readable. A model that never calls the narration tool
still produces a usable feed; one that uses it produces a good one.

**The instructions string is how the second half actually happens.** The server's
`instructions` already tells an agent to start with `list_bug_reports`; it now
also tells it to narrate before a long stretch of work. `bug-mcp-design.md` §7
makes the point that tool descriptions are the interface because the caller
chooses from their text — the same is true of a tool whose entire value is that
it gets called at all.

## 3. The table

`beta_agent_activity`, migration 029, mirrored into `beta/schema.sql` as every
beta table is.

```
id         BIGINT identity PK
actor      TEXT NOT NULL          -- mcpActor(): which key did this
tool       TEXT NOT NULL          -- the MCP tool name
outcome    TEXT NOT NULL          -- 'ok' | 'refused' | 'failed'
report_id  BIGINT                 -- which report, when there is one
slug       TEXT                   -- which game, when known
summary    TEXT NOT NULL          -- one line, <= 300 chars
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
```

**`report_id` is deliberately NOT a foreign key**, and this is the one schema
decision here worth arguing. Every other reference to a report in this schema is
`REFERENCES beta_reports(id) ON DELETE SET NULL`, so that a fixed report's XP
award survives the row it paid for. That is right for the ledger and wrong here:
the most important row this table will ever hold is "marked report 42 fixed",
and the write that produces it is the write that deletes report 42. An FK with
SET NULL would blank the subject of the sentence at the moment it was written.
A plain BIGINT keeps the number, which is all the feed needs — nothing joins on
it, exactly as `slug` is never an FK anywhere in this codebase.

**`outcome` has three values and they are not decoration.** `refused` is the
interesting one: the MCP's writes return `applied: false` rather than throwing
when their `WHERE` matched nothing, and `bugs.ts` turns that into a refusal
message rather than a success. A feed that rendered a refused close as a close
would tell an operator a bug was dealt with when it was not — the same failure
the tool layer already goes out of its way to avoid.

**Retention is by age, in the insert's own statement.** The trail is per tool
call, so a working agent writes rows steadily and nothing else would ever remove
them. The insert is a data-modifying CTE whose top-level statement is a DELETE of
anything past the window, which keeps it one round trip — the `neon()` driver is
one stateless request per call, so two statements would not be one transaction
anyway (`store.ts`'s header). Fourteen days: long enough to answer "what happened
overnight" and over the weekend, short enough that the table never becomes
something to think about.

## 4. Where the logging happens

**Wrapped around the tool handlers, not written into each tool body.** `bugs.ts`
opens by asserting that it adds no SQL and no XP arithmetic — it replays
decisions the server actions already make. Sprinkling a log call through its five
functions would put a cross-cutting concern in the module whose stated virtue is
that it does one thing, and would guarantee that the sixth tool added later
forgets.

So `server.ts` wraps every registered handler once, and the wrapper is the only
thing that knows the feed exists. Three modules, following the pure/server-only
split the rest of the folder uses (`bug-mcp-design.md` §8):

| Module | Pure? | What |
|---|---|---|
| `mcp/activity.ts` | pure | The vocabulary, the summary cap, and `describeToolCall()` — turning a tool name, its arguments and its result into the row to write. Unit-tested. |
| `mcp/activity-log.ts` | server-only | `recordActivity()`: the store write, fail-soft. |
| `mcp/server.ts` | server-only | `withActivity()`, applied to all six tools. |

**Logging never fails a tool call.** `recordActivity` swallows its own errors
after logging them, for the same reason `beta/index.ts`'s reads degrade: schema
here is applied by hand, so there is always a window where the code is live
against a database with no `beta_agent_activity` yet. An agent that could not
close a bug because the feed table was missing would be a feature that broke the
thing it was built to observe.

**A failed tool call is logged too.** The wrapper catches, records `failed`, and
rethrows so the SDK still reports the error to the client. A crash the operator
cannot see is the worst case for a surface whose purpose is visibility.

## 5. The panel

A new section on `/dashboard/beta`, above the triage queue — the queue is where
the agent's writes land, and an explanation below the thing it explains is read
second.

**A client island that polls, seeded by the server.** Exactly the shape
`OpenReportBadge` argues for and for the same reasons: it calls a Server Function
(`agentActivityAction`), gated by `requireRole(BETA_MIN_ROLE)` like everything
else on this surface, because invoking one does not re-render the calling page —
it costs a POST and nothing else. The initial rows are rendered server-side and
passed as props, so the panel is correct before any JavaScript runs and correct
without it. The timer skips hidden tabs, so a dashboard left open in a background
tab all day makes no queries at all.

**The island renders the whole section, and renders NOTHING when there is no
activity.** Both halves are deliberate. A permanently empty "Agent activity" card
on a deployment with no `MCP_SECRET` set is precisely the clutter the other half
of this task is removing. And because the island owns the section rather than
sitting inside one, the panel APPEARS on the poll that first sees a row — an
operator who starts an agent while watching the dashboard sees it arrive, which
is the entire point of polling.

## 6. Deliberately absent

- **Streaming / SSE.** `bug-mcp-design.md` §4 already argues that a serverless
  function has no business holding an event stream open. A 10-second poll of a
  20-row read is the honest shape.
- **A per-report activity history.** The feed is chronological. Threading it
  under each report means a join against rows whose report may no longer exist,
  to answer a question ("what happened to THIS bug") whose answer is usually
  "it was fixed and deleted, here is the ledger".
- **Activity from human admins.** The server actions could log here too, and
  then the panel would stop being about the agent. Who did what by hand is
  already on the row (`resolved_by`) and in the ledger (`awarded_by`).
- **Anything on the tester's page.** A child does not need to know a machine is
  reading their bug report, and the feed carries an internal actor string.
- **Editing or deleting feed rows from the UI.** A trail somebody can tidy is not
  a trail. (Since §11 a run's lines are deleted when it ends — by the agent, or
  by the idle window — but still never by an operator's hand.)

## 7. Rejected reports leave the dashboard

`triageReportAction` sets `rejected` and keeps the row, and the triage queue
renders every report it is handed. So a rejected report sits in the queue
forever, carrying no buttons, below the reports that still need a decision.

It goes into a collapsed `<details>` — **the same pattern, and the same words,
the image panel already uses** for its settled shots ("N already dealt with").
That precedent matters more than the specific markup: an admin who has learned
where finished business goes on this page should find it in the same place in
the next panel.

**Hidden, not deleted**, which the user chose and which is also the only answer
consistent with the rest of the schema. A rejected report is the tester's record
of what was decided about their find; `/beta` renders it with its status chip.
Deleting it would take that away to tidy someone else's screen, and — unlike a
fixed or duplicate report, which is deleted because its XP is already in the
ledger and there is nothing left to do — a rejection pays nothing, so nothing
survives it. The row IS the record.

**Accepted reports stay in the open list.** They still carry a control (Fixed,
paying the bonus), so they are not finished business. The line is "is there
anything left to decide", not "has anything been decided".

## 8. Assignments, grouped and pruned

The assign panel lists every assignment ever issued, flat, newest first, each
with a Remove button. It is the fastest-growing thing on the page: nothing ever
leaves it, and a tester who has finished six playtests contributes six rows that
look exactly like the one they are working on now.

Two changes:

**Grouped by tester.** The question an operator asks this panel is "what is
$TESTER on" or "has anyone got a free slot", and both are answered by a list
sorted by game title in roughly never. Groups are ordered by the roster's own
order (active members first, newest invite first), and a tester with nothing
active is not rendered at all — an empty group per idle tester is the same
clutter in a new shape.

**Active only.** `assigned` and `in_progress` stay; `submitted` and `closed`
leave the dashboard. They are not lost and this is the whole reason the choice is
safe: `/beta` already renders a tester's finished playtests under a "Finished"
heading, which is the audience that wants them — a tester looking at what they
have done. The panel's subtitle says how many finished ones exist, so the number
does not simply vanish.

**One vocabulary, two pages.** Both pages currently hardcode the same two-status
filter, which is a drift waiting to happen the moment a fifth assignment status
is added. `ACTIVE_ASSIGNMENT_STATUSES` and `isActiveAssignment()` move to
`beta/config.ts`, where the rest of the beta vocabulary already lives, and both
pages read them.

## 9. Phasing — the file-by-file plan, and what shipped

Twelve commits, each leaving the tree working. **All of it is built**; this table
is now a record rather than a plan.

| # | Commit | Files |
|---|---|---|
| 1 | This plan | `agent-activity-design.md` |
| 2 | Shared assignment vocabulary | `beta/config.ts` + test |
| 3 | The table | `migrations/029_beta_agent_activity.sql`, `beta/schema.sql` |
| 4 | Write and read the trail | `beta/store.ts` + test |
| 5 | The fail-soft read | `beta/index.ts` |
| 6 | Tool call → feed row | `mcp/activity.ts` + test |
| 7 | Recording, and the wrapper | `mcp/activity-log.ts`, `mcp/server.ts` |
| 8 | The narration tool | `mcp/server.ts`, `mcp/config.ts` |
| 9 | The panel | `dashboard/beta/_ui/AgentActivityFeed.tsx`, `actions.ts`, `page.tsx` |
| 10 | Rejected reports collapse | `dashboard/beta/page.tsx` |
| 11 | Assignments grouped and pruned | `dashboard/beta/page.tsx`, `beta/page.tsx` |
| 12 | Say so | `README.md`, `bug-mcp-design.md`, this file |

**Two constants landed a commit away from where the table puts them.**
`ACTIVITY_RETENTION_DAYS` is in `mcp/config.ts` from commit 7, because the
recorder needs it; `AGENT_FEED_LIMIT` is in `mcp/activity.ts` rather than beside
the panel, because how big the feed is is the MCP's business and the dashboard is
one reader of it.

**Verified after the build, not assumed.** `npm test` passes (1667 tests, 100
files — 56 of them new here); `npm run lint` reports the same 11 pre-existing
warnings and no new ones; `npm run build` succeeds with `/api/mcp` still dynamic
(`ƒ`), `/dashboard/beta` dynamic, and `public/sw-manifest.js` still carrying
**28** `/game/` routes — the regression check the game page's docblock specifies.

The protocol was exercised against a running dev server rather than reasoned
about. `tools/list` returns **six** tools with the intended annotations
(`log_agent_activity` non-destructive, the two closers destructive); an empty
`summary` is refused by the schema before it reaches anything; and — the case
this feature's own docblocks promise — a `log_agent_activity` call against an
**unconfigured database succeeds anyway**, returning the recorded line to the
agent while the failed feed write is logged and swallowed. A read against the
same unconfigured database still reports the real error rather than an empty
list, which is the property `bug-mcp-design.md` §5 asks for.

**Not exercised: the panel against real rows.** There is no database reachable
from this environment, so `beta_agent_activity` has never been written to or read
from for real, and the dashboard was verified by build and types only. Migration
029 has not been applied anywhere — `npm run migrate` is the remaining step, and
until it runs the panel stays empty while every tool goes on working.

## 10. Open questions

1. **Should the feed record the agent's IDENTITY beyond the actor string?** MCP
   clients send a client name in `initialize`. The transport is stateless and a
   new server is built per request, so recovering it per tool call means reading
   it off the connection — possible, not free, and `MCP_ACTOR` already
   distinguishes the keys an operator issued.
2. **Should a refused write be louder than a line in a feed?** An agent that
   repeatedly tries to close the same already-gone report is a bug in the agent,
   and nothing here escalates it.
3. **Should the retention window be configurable?** Fourteen days is a constant.
   Making it an env var is one more thing to set and get wrong.

## 11. The feed closes when the agent stops

Added after the first real session, 2026-09-11. The agent finished at 20:12;
half an hour later the panel still showed its 53 lines above a "refreshes every
10s" footer, which reads as an agent at work. The ask was for the panel to
close, and reset, when nothing is running.

### Decisions taken with the user

1. **Hidden completely** while no agent is running, not collapsed to a summary.
   §5's panel already renders nothing when there is nothing to show; this makes
   "the run is over" one of the ways of having nothing.
2. **Reset deletes.** A finished run's lines are removed from the table, not
   filtered out of the panel. This changes §3: a run is now kept until it ends,
   and fourteen days is only a cap on a run that never does.
3. **The agent closes it; thirty minutes of silence closes it anyway.**
4. **A tool for "finished"**: `finish_agent_activity`, the seventh.

### Why "running" has to be inferred

The transport is stateless (`app/api/mcp/route.ts`): no session id is minted,
nothing is held open, and `DELETE`, the method that ends a session, answers 405
because there are no sessions to end. A server that is never told a client has
gone cannot know an agent stopped. It can be told (the new tool) or notice
silence (the window), and it needs both: the tool is the clean ending, and the
window covers the agent that crashed, was killed, or forgot.

Thirty minutes errs long on purpose. The longest gap between two lines while
agents were working on 2026-09-11 was 5 m 34 s. A window that closed on an agent
still thinking would tell the operator it had stopped, which §5 names as the one
thing this panel must never say by accident.

### How

- **The table only ever holds one run.** Finishing deletes it, and the next
  run's first line deletes a quiet one. So there is no run id and no migration:
  the only question left is "has anything been written in the last thirty
  minutes?"
- **Read.** `recentAgentActivity` returns nothing unless a line is newer than
  the window, judged by the database's `now()` rather than the browser's clock.
  The panel disappears on the first poll after the window closes, although the
  rows are still in the table.
- **Write.** The insert's sweep (§3) gains a second condition: if nothing was
  written within the window, delete every existing line. It is the same
  statement, so it runs on the same snapshot. The sweep cannot see the line
  being inserted, which makes the check "was the previous run quiet?" and keeps
  the new line.
- **Finish.** `finish_agent_activity` deletes every line and tells the agent how
  many. It is the one tool whose success is not recorded, because recording it
  would reopen the panel it had just closed. A failure is still recorded, like
  every other tool's, so a finish that cleared nothing stays on the panel with
  its error.
- **A quiet run's rows stay until the next run starts.** Deleting at the
  thirty-minute mark would need something to wake up for it. The read hides the
  rows from that mark onward, so the difference only shows in the table.
- **A failed poll no longer hides the panel.** Empty now means "no agent is
  running", and `getAgentActivity` degrades a database error to `[]`, so a
  hiccup would announce that the agent had stopped. The poll's Server Function
  reads the store directly and lets the error throw. The island already keeps
  its last rows when a poll throws, which its docblock promised all along. The
  page's server render stays fail-soft.

### Deliberately absent

- **Per-agent runs.** Every agent authenticates with the same `MCP_SECRET` and
  writes the same actor, so there is one feed. When two agents work at once, the
  first to finish clears both, and the other's next call starts a new run.
- **A wrap-up line from the finish tool.** It would be deleted in the moment it
  was written. The agent's last `log_agent_activity` line is the wrap-up an
  operator watching sees.
- **Keeping finished runs.** The user chose deletion. Every decision a run made
  is still in the XP ledger under `awarded_by`, which was the durable record
  before this panel existed.
- **A migration.** No column changes, and `029` stays byte-identical: its
  checksum is in production's ledger.

### File-by-file plan

| # | Commit | Files |
|---|---|---|
| 1 | This plan | `agent-activity-design.md` |
| 2 | The idle window | `mcp/config.ts` + test |
| 3 | A quiet run is reset by the next line | `beta/store.ts` + test, `mcp/activity-log.ts` |
| 4 | A quiet run leaves the panel | `beta/store.ts` + test, `beta/index.ts`, `dashboard/beta/page.tsx`, `actions.ts` |
| 5 | A failed poll keeps the panel | `dashboard/beta/actions.ts` |
| 6 | The store can clear the feed | `beta/store.ts` + test |
| 7 | `finish_agent_activity` | `mcp/server.ts`, `mcp/activity-log.ts` |
| 8 | The panel says when it closes | `dashboard/beta/_ui/AgentActivityFeed.tsx` |
| 9 | Say so | `README.md`, `bug-mcp-design.md`, `beta/schema.sql` (comment), this file |

**Checks.** `npm run lint`, `npm test` and `npm run build`. Then the protocol,
against a local dev server on `dashboard-dev` (which needs migrations 027–029
first): a line, a backdated quiet run reset by the next line, and a finish that
empties the table. After the deploy, a finish against production.

### What shipped, and what the checks showed

Built as planned, in the nine commits above, with two additions: commit 8 also
touches `page.tsx`, because the idle window reaches the panel as a prop rather
than an import, and commit 9 also corrects the README's count of irreversible
tools (four of seven).

- `npm run lint`: 0 errors. The 11 warnings are all in files this branch does
  not touch.
- `npm test`: 1655 pass, 5 of them new. 17 fail, in `console-capture.test.ts`
  and `streak-event.test.ts`, which this branch does not touch; the same 17
  failed on `main` in the previous session.
- `npm run build` succeeds: `/api/mcp` and `/dashboard/beta` stay dynamic, and
  `public/sw-manifest.js` still carries 28 `/game/` routes.
- The protocol, against a local dev server on `dashboard-dev` (brought to 029
  with `npm run migrate` first), passed 14 of 14 checks. `tools/list`
  advertises seven tools, with `finish_agent_activity` destructive, idempotent
  and argument-free. A line backdated 31 minutes is in the table, but the
  panel's read returns nothing. The next line deletes it and is the only row
  left, and a second call keeps the first. Finish answers "Cleared 2 lines",
  leaves the table empty and records nothing of its own. A second finish clears
  0, and the call after it starts a fresh one-line run.

**Not exercised: the dashboard page itself.** The panel needs a signed-in
session, so hiding on an empty read was checked through the read (the store's
SQL, run on the dev database) and by types, not in a browser. Production still
holds the first session's 53 lines until this deploys. From then the panel hides
them at once, since they are hours old, and the next agent's first line deletes
them.
