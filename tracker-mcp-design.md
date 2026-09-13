# The tracker on the MCP — design

Sibling of `bug-mcp-design.md` and `agent-activity-design.md`, which built the
server this extends, and of `tracker-design.md`, which built the board it
reaches. Same job as the rest of the `*-design.md` family: the argument for what
is being built, what is deliberately excluded, and the constraints that shaped
it.

Three asks, taken together because they are one loop rather than three features:

1. **Put the tracker on the MCP** — read the board, move an item, post to it.
2. **Show a green marker on an item while the agent is working on it**, the same
   way `/dashboard/beta` shows what the agent is doing.
3. **Let the agent post comments on an item — and comments are not logs.**

The third is the one that decides the shape of the other two. There are now
three different things an agent can write about its work, and the whole value
here depends on them staying distinct:

| | Where it lands | Who it is for | Lifetime |
|---|---|---|---|
| A **log line** | `beta_agent_activity` | whoever is watching right now | deleted when the run ends |
| A **comment** | `tracker_updates` | whoever opens the item next week | forever |
| An **event** | `tracker_events` | an audit, after something looks wrong | forever, written automatically |

An agent that put its narration in the Updates thread would leave fifty lines of
"checking the sprite pool" on an item whose brief somebody has to read next
month. An agent that put its conclusions in the log feed would have them deleted
thirty minutes later. Both mistakes are easy, so the tool descriptions name the
difference, and the tool that posts a comment is called
`comment_on_tracker_item` rather than anything with "log" or "update" in it.

---

## 0. Decisions taken, and the assumptions in them

This session was non-interactive, so the calls below were made rather than put.
Each one is cheap to reverse and is flagged where it is load-bearing.

1. **The agent may move lanes.** `tracker/config.ts` restricts status to
   `super_admin` with a specific argument, and this does not contradict it —
   see §2. It is the ask ("move"), and it is the thing that makes the green
   marker mean something.
2. **The green marker is driven by ACTIVITY, not by the `building` lane.** "Show
   the agent is working on it" is a claim about right now, and a lane is a claim
   about the work. §5.
3. **One feed, not two.** Tracker tool calls write to `beta_agent_activity`
   beside the bug ones, so one run, one idle window, and one
   `finish_agent_activity` that ends all of it. §4 argues the naming cost.
4. **Five tools, and no tag, archive or delete.** §8.
5. **Secret-holders only.** An OAuth caller's tool list is unchanged: still
   read-only analytics. §3.

## 1. Why this is worth building

`bug-mcp-design.md` §6 excluded the tracker, and gave a reason that has now been
answered rather than merely overruled:

> Adding it means deciding whether an agent may move lanes, which
> `tracker/config.ts` restricts to `super_admin` with an argument about who may
> truthfully claim "this is being built". One source, done properly, first.

One source has been done properly — the bug queue has been worked by an agent
through this server, and `agent-activity-design.md` §11 records what that
actually looked like. So the question is now answerable from evidence rather
than from a guess, and §2 answers it.

The concrete gap is this. The board's whole product is the *out* direction:
somebody opens `/dashboard/tracker` to find out what is being built. Today that
sentence is only true when a human remembers to move a card and type a note. The
person building is an agent for most of a working session, and it is the only
party that knows, at the moment it becomes true, that a thing has started. A
board whose status is maintained by the party doing the work is a board that is
right; a board maintained from memory afterwards is a board that is right on
Fridays.

**This is a tool for the person building, not a feature for players.** Nothing
on the public site changes, nothing a tester sees changes, and no player data is
within reach of any tool added here.

## 2. May a machine say "this is being built"?

`TRACKER_DEV_ROLE` is `super_admin`, and its docblock is worth quoting because
it is the thing this feature has to get past:

> The STATUS is a claim about the work itself ("this is being built right now",
> "this is live"), and only the person actually building it can make that claim
> truthfully.

Read carefully, that is not a rule about *roles*. It is a rule about
**knowledge**: the claim belongs to whoever is doing the work, because nobody
else can make it truthfully. A plain admin is refused not because they are less
trusted but because they would be guessing.

The agent holding `MCP_SECRET` is not guessing. It is the party doing the work,
and it is the only party that knows at the moment the work starts. So granting
it the move is not an exception to that argument — it is the first caller that
argument has ever fully described.

This is the same shape as the one omission `bug-mcp-design.md` §3 allows itself.
`assertNotOwnWork` is skipped there because "the MCP actor is a machine holding
a secret; it has no `playerId` and cannot be the author of any report" — a guard
whose precondition cannot arise. Here the guard's *purpose* is satisfied rather
than its precondition removed, which is a weaker claim, so it is written down
rather than assumed.

**Two consequences, both enforced:**

- **The secret only.** An OAuth caller gets the analytics tools and nothing
  else, exactly as before. `server.ts` already argues that an OAuth actor has a
  `playerId` and therefore reopens questions a machine actor closes; nothing
  here reopens them.
- **`canMoveStatus` is untouched.** It answers a question about a *dashboard
  role* and the MCP has no role. Widening it to admit some notion of "the agent"
  would put a machine in a ladder built for people, and the next reader of that
  function would have to work out which of the two systems it was describing.
  The MCP's authority comes from holding the secret, and that is stated in
  `mcp/tracker.ts`'s header rather than smuggled into a role check.

## 3. The tools

Five, secret-holders only, named so an agent can guess them and shaped so the
irreversible things are absent rather than annotated.

| Tool | Writes? | What it does |
|---|---|---|
| `list_tracker_items` | no | The board. Filters: status, tag. Bounded. Summaries only — no briefs. |
| `get_tracker_item` | no | One item in full: the brief, the tags, the stamps, and the comment thread. |
| `move_tracker_item` | yes | Move it to another lane. Reversible; re-selecting the current lane is a no-op. |
| `comment_on_tracker_item` | yes | Post a dated note to the item's Updates thread. Permanent. Not a log line. |
| `create_tracker_item` | yes | Paste in a new item. Lands in `new`, where a human triages it. |

**Summaries and detail are split for the same reason the bug tools split them.**
`brief` is capped at 20 000 characters; a list call that returned briefs would
spend a hundred thousand tokens to answer "what is on the board". `listBoard()`
does not even select the column, so the split is the store's already.

**`itemId`, never `id`.** Every tracker tool names its argument `itemId` while
every bug tool names its `id`. That is not cosmetics: the activity feed decides
from the argument NAME whether a number is a report id or a tracker item id
(§4), and an agent working both queues in one session is one confident mistake
away from closing report 12 when it meant to move item 12. Two vocabularies,
two names.

**Nothing here deletes anything.** The bug tools' closers are destructive by
construction, and this surface deliberately has no counterpart: archive and
delete stay on the dashboard, where a human clicks through a disclosure that
names what is lost. See §8.

## 4. One feed, and how a line knows which board it is about

Tracker tool calls are recorded to **`beta_agent_activity`**, the table the bug
tools already write — not to a new one.

**The naming is wrong and the behaviour is right.** A `beta_`-prefixed table
holding tracker lines is a real smell, and it is worth the trade because the
alternative is two runs. The feed has a lifecycle, not just rows: a run is one
sequence of lines, it ends when `finish_agent_activity` deletes it or after
`ACTIVITY_IDLE_MINUTES` of silence, and the operator's panel disappearing is how
they learn the agent stopped (`agent-activity-design.md` §11). Two tables means
two runs, two idle windows, two things to finish, and a `finish_agent_activity`
that honestly could not say whether anything was still running. One table with
a nullable column costs a migration and keeps one answer to "is the agent
working".

### Migration 033

```sql
ALTER TABLE beta_agent_activity
  ADD COLUMN IF NOT EXISTS tracker_item_id BIGINT;
-- named, so re-running is a no-op rather than a second anonymous constraint
ALTER TABLE beta_agent_activity
  ADD CONSTRAINT beta_agent_activity_tracker_item_id_check
  CHECK (tracker_item_id IS NULL OR tracker_item_id > 0);

CREATE INDEX IF NOT EXISTS beta_agent_activity_tracker_idx
  ON beta_agent_activity (tracker_item_id, created_at DESC)
  WHERE tracker_item_id IS NOT NULL;
```

`tracker_item_id` is **not a foreign key**, for the same reason `report_id` is
not one: 029's header argues that an FK with `ON DELETE SET NULL` would blank
the subject of the sentence exactly when it matters most. Here the write that
matters is not a delete, but the rule is the same and the consistency is worth
more than the referential integrity of a feed nothing joins on.

`report_id` and `tracker_item_id` are both nullable and in practice mutually
exclusive. **No CHECK forbids both being set**, because the one case where both
are meaningful is real: an agent narrating "fixing report 42, which is tracker
item 7" should be able to say so, and a constraint would refuse the most
informative line the feed can hold.

### Which number a line gets

`activity.ts`'s `describeToolCall` reads `args.id`/`args.reportId` into
`reportId` and `args.itemId` into `itemId`. That is the whole mechanism, and it
is why §3 insists on the argument name. The module's existing rule — branch on
the SHAPE of the result, not on a table of tool names — is kept: every writing
tracker tool answers `{ ok, message }`, so it is described correctly by the
branch that already exists, and only the two readers get named, exactly as the
two bug readers already are.

### A beta admin does not see tracker lines

`/dashboard/beta` is `beta_admin` and up; `/dashboard/tracker` is `admin` and
up. So the feed, rendered on the beta page, must not become the way a beta admin
reads the roadmap. `recentAgentActivity` takes `includeTracker`, and
`agentActivityAction` passes `atLeast(role, SITE_WRITE_ROLE)`.

One SQL condition, and it is the honest fix. The alternative — leaving it,
because item titles are internal work rather than player data — is a judgement
that would have to be re-made by whoever adds the next thing to this feed, and
they would not know it had ever been made.

## 5. The green marker

**What it means: a line about this item was written within the idle window.**
Not "this item is in `building`", which is a claim about the work and is already
said by the lane, the chip and the colour. The ask was to show *the agent is
working on it*, and that is a claim about right now — so it is driven by the
same rows and the same window as the panel on `/dashboard/beta`, and it goes out
in the same three ways: the agent calls `finish_agent_activity`, the run goes
quiet for `ACTIVITY_IDLE_MINUTES`, or the run is replaced by a newer one.

**And only what an agent does BECAUSE it is working on the item.** This was
wrong in the first build and was caught by looking at a real board: every item
was marked, including two the agent had only *created*. Every tracker tool
records which item its line is about — that is what makes the feed row faithful
— but "is about item 7" and "is working on item 7" are different claims, and the
marker makes the second.

So `ITEM_WORK_TOOLS` (`mcp/activity.ts`) names the three that mean work —
`move_tracker_item`, `comment_on_tracker_item`, `log_agent_activity` — and the
read counts only those. The two excluded cases each have a reason:
`create_tracker_item` files a proposal into `new` for a human to triage, and
marking it says an agent is building something nobody has agreed to;
`get_tracker_item` and `list_tracker_items` are how an agent DECIDES what to
work on, so an agent reading ten briefs to pick one would light all ten — a
board that says the agent is everywhere says nothing.

The list is passed to the store rather than written into it: which tool names
mean work is the MCP's vocabulary, and `beta/store.ts` only knows rows.

**Per item, not per run.** The panel asks "has anything been written lately";
the marker asks "has anything been written lately *about this item*". An agent
that spent an hour on item 5 and then moved to item 7 must not leave item 5
glowing, so liveness is judged from each item's own newest line:

```sql
SELECT DISTINCT ON (tracker_item_id) …
  FROM beta_agent_activity
 WHERE tracker_item_id IS NOT NULL
   AND created_at > now() - make_interval(mins => …)
 ORDER BY tracker_item_id, created_at DESC, id DESC
```

Judged by the database's `now()`, never the browser's, for the reason
`recentAgentActivity` already gives: a laptop clock a few minutes out would
otherwise close a live run early or hold a dead one open.

**A provider that polls once, and markers that read it.** The board renders
tens of cards, and one polling island per card would be tens of POSTs every ten
seconds. So `AgentWatch` is a client component taking `children` — the pattern
Next's own Server-and-Client-Components guide gives for context — and the
server-rendered lanes pass straight through it. It polls one Server Function;
`AgentBadge` and `AgentBanner` read the context. One poll, whatever is on the
board.

Everything else follows `AgentActivityFeed`, whose docblock argues each point:
seeded from the server so it is right before any JavaScript runs, the timer
skips hidden tabs, and a failed poll keeps the last state rather than flashing
the marker off — because a marker that vanished on a network hiccup would say
"the agent stopped", which is the one thing this must never say by accident.

`motion-safe:animate-pulse`, so the one animated thing on the dashboard is not
animated for somebody who asked the OS for no animation.

**The honest limitation.** The marker tracks what the agent SAYS, not what it is
doing. An agent that moves an item to `building` and then writes code in silence
for an hour stops being marked after thirty minutes, and is still building. That
is a consequence of a stateless transport (`bug-mcp-design.md` §4: there is no
session to notice the end of, so silence is all there is), and the mitigation is
the instructions string — the same lever `agent-activity-design.md` §2 already
relies on for the narration tool, for the same reason. The durable answer to
"what is being built" remains the lane. This one answers "is somebody at the
keyboard right now", and a stale *yes* is the failure worth avoiding, which is
why the window is not widened.

## 6. Comments are not logs, on both ends

`comment_on_tracker_item` calls `tracker.addUpdate()` — the same store method
the dashboard's own textarea calls, with the same one-statement CTE that writes
the note, touches `updated_at` and records a `comment` event. No new SQL, the
rule `bugs.ts` opens with.

The author is `mcpActor()`, the same string the XP ledger records for a
machine's decision. `tracker_updates.author_email` is TEXT with no foreign key
(`created_by`'s docblock explains why for items; the same applies), so nothing
had to change to let a machine write there.

**The thread says which notes are the agent's.** A comment from
`mcp@hallpass.invalid` rendered like any other would read as an admin's note by
an address nobody recognises. It gets a green **Agent** chip instead, matched on
`mcpActor()` — read from the same function the writer uses, so a deployment that
sets `MCP_ACTOR` does not silently stop matching.

## 7. Failure modes

- **Migration 033 not applied.** `tracker_item_id` is missing, so every tool
  call's feed write fails — and is swallowed, because `recordActivity` never
  fails a tool call (`activity-log.ts`). The tracker tools go on working, the
  markers never appear, and the server log says why. This is the designed
  window, and it is the reason the column is additive rather than a new table
  with a new read path.
- **The tracker schema is missing entirely** (migration 021). The tools report
  the real error rather than an empty board — `mcp/tracker.ts` uses the live
  `tracker` store, not the fail-soft wrappers in `tracker/index.ts`, for the
  reason that module's header gives: a caller that needs to tell "refused" from
  "the database is down" must be handed the error. An agent told the board is
  empty would paste duplicates of everything on it.
- **A move that matched nothing.** `setStatus` returns `null` for an item that
  does not exist or is archived, and the tool reports that as a refusal, not as
  success — the rule `bug-mcp-design.md` §5 sets for every write here.
- **A move to the lane it is already in.** Reported as success, with the message
  saying it did not change. The store treats it as a no-op on purpose, and an
  agent told "refused" would retry.
- **A failed poll** keeps the last markers on screen. §5.
- **Two agents on one item.** The feed holds one run and every agent writes the
  same actor, so the marker says "an agent", not which one — the limitation
  `agent-activity-design.md` §11 already records for the panel.
- **The PWA.** Nothing to do, and worth stating because a new dashboard island
  is exactly the change that could plausibly touch it: `public/sw.js` never
  intercepts `/dashboard` or `/api/`, and these pages call `auth()` so they are
  dynamic and never enter `public/sw-manifest.js`.

## 8. Deliberately absent

- **Tags.** `setTags` CONVERGES — submitting replaces the whole set — so the
  cheapest possible agent mistake is wiping an item's tags by posting the one it
  wanted to add. The gain is an agent that can file things tidily; the loss is
  labelling a human chose. Not worth it for a first pass.
- **Archive, restore and delete.** Delete is the only unrecoverable thing on the
  board and is `super_admin` behind a disclosure that names what is lost;
  archive takes an item off the board, which is a curation decision, not a
  building one. Neither is something an agent needs in order to build what the
  board asks for, and the bug tools' two destructive closers are only there
  because there is genuinely nothing left to do with a fixed report.
- **Editing the brief.** The brief is the ask — the human's side of the
  conversation. An agent that could rewrite it could quietly restate the
  requirement as the thing it had already built. Comments are the agent's side,
  and they are append-only.
- **The activity trail in `get_tracker_item`.** `tracker_events` is an audit of
  who did what; the comment thread is the narrative. Returning both would double
  the tokens to say the same things twice, and the trail's readership is
  somebody looking at a screen after something went wrong.
- **Tracker tools for OAuth callers.** §2.
- **A second feed table, a `tracker_item_id` foreign key, and a CHECK forbidding
  both ids.** §4.
- **Real-time anything.** The marker polls at ten seconds like the panel it
  matches. `bug-mcp-design.md` §4 already argues that a serverless function has
  no business holding an event stream open.

## 9. Phasing — the file-by-file plan

Fourteen commits, each leaving the tree working.

| # | Commit | Files |
|---|---|---|
| 1 | This plan | `tracker-mcp-design.md` |
| 2 | The column | `migrations/033_agent_activity_tracker.sql`, `beta/schema.sql` |
| 3 | Write it, and read what is live | `beta/store.ts` + test |
| 4 | The fail-soft read | `beta/index.ts` |
| 5 | A line knows which board it is about | `mcp/activity.ts` + test |
| 6 | Carry it to the row | `mcp/activity-log.ts` |
| 7 | The operations | `mcp/tracker.ts` |
| 8 | The five tools | `mcp/server.ts` |
| 9 | Narration can name an item | `mcp/server.ts` |
| 10 | A beta admin does not see tracker lines | `beta/store.ts` + test, `beta/index.ts`, `beta/actions.ts` |
| 11 | The marker | `tracker/actions.ts`, `tracker/_ui/AgentWatch.tsx`, `_ui/ItemCard.tsx`, `tracker/page.tsx` |
| 12 | The item page: marker and agent comments | `tracker/[id]/page.tsx` |
| 13 | Only deliberate work lights the marker | `mcp/activity.ts`, `beta/store.ts` + test, `beta/index.ts`, the three call sites |
| 14 | Say so | `README.md`, `bug-mcp-design.md`, `tracker-design.md`, this file |

**Commit 13 was not in the plan.** It came out of looking at the built board
rather than from changing our minds — see §5, *"And only what an agent does
BECAUSE it is working on the item"*.

**Checks**, per `AGENTS.md`: `npm run lint`, `npm test`, `npm run build`, and
the protocol exercised against a running dev server rather than reasoned about —
the tool list, a move, a comment, a refused move, and the live read the marker
depends on.

## 10. What shipped, and what the checks showed

Built as planned, in the fourteen commits above.

**The protocol was exercised against a running dev server rather than reasoned
about**, on the `dashboard-dev` Neon branch with migration 033 applied:

- `tools/list` advertises **21** tools to a secret holder — the seven bug tools,
  the five tracker ones, and the analytics ones — with the tracker writers
  marked non-destructive and `move_tracker_item` idempotent.
- Three items created, two moved, one commented on, one narrated with `itemId`.
- The two paths that must not read as success both refused correctly: moving an
  item that does not exist answers `ok: false` with a reason, and moving an item
  to the lane it is already in answers `ok: true` saying nothing changed.
- The board and the item page were then opened in a browser. The marker appeared
  on exactly the worked items; the agent's comment is in the Updates thread with
  its **Agent** label; the activity trail shows `created`, `moved new →
  building` and `posted an update`, all attributed to `mcp@hallpass.invalid`.

That browser pass is what found the bug in commit 13. It is worth recording
that it was invisible to every other check: the types were right, the tests
passed, and the feature was wrong.

**Not exercised: production.** Migration 033 is applied to `dashboard-dev` only.
Until it is applied to `main`, the tracker tools work there and the feed writes
fail silently, so the markers never appear — the degradation §7 describes.

## 11. Open questions

1. **Should the agent be able to tag?** §8 says no for now. If the board grows
   past what one person can label, it is one tool and a converge-vs-add
   decision.
2. **Should a comment be able to move the item too?** One call instead of two,
   and it would make "post progress" the thing that keeps the marker alive. It
   is also two decisions in one tool, which is the shape `bugs.ts` avoided for
   triage and duplicate.
3. **Should the marker be able to say WHICH agent?** Every agent writes
   `MCP_ACTOR`, so today it cannot. Issuing a second secret would change that
   and nothing else needs it yet.
