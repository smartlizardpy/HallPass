# Site alerts — design

The site measures itself every half hour and tells the admins when something is
worth knowing. Three alerts ship: a **traffic spike**, an **error spike**, and a
**content gap** (a game people keep searching for that the arcade does not
have).

This document is the argument behind the shape. The code carries the same
reasoning in its docblocks; what is here is the part that spans files.

## The problem

Everything the dashboard knows, it knows only while somebody is looking at it.
A spike is the one piece of analytics with a deadline attached: an arcade that
has just been posted into a group chat can be met with a working site, more
games, a look at what they are playing — or it can be discovered a fortnight
later in a graph. The same is true of a deploy that broke a game, and of a
hundred people searching for a game we could add in an afternoon.

Vercel functions run when somebody asks. Nobody asks at 14:20 on a Tuesday.

## The shape

```
GitHub Actions (*/30)
  └─ scripts/check-alerts.mjs          thin: fetch, check, post, print
       ├─ GET  /api/v1/admin/alerts            measure + judge, notify nobody
       │        └─ alerts/metrics.ts  →  alerts/rules.ts
       └─ POST /api/v1/admin/alerts/notify     file it for every admin
                └─ alerts/wording.ts  →  notifications/deliver.ts  →  bell + push
```

Four decisions do most of the work.

### 1. The judgement is pure, and the queries only count

`metrics.ts` runs three HogQL queries that select counts. Every median, ratio and
threshold comparison happens in `rules.ts`, which has no clock, no network and no
database — so the whole of the site's alerting judgement is unit-tested against
fixtures.

The alternative was a `CASE` expression in HogQL deciding what counts as a spike.
It is less code and it cannot be tested in this repo, which matters more than
usual for a component whose entire output is "wake somebody up". The tests that
earn their keep are the ones asserting **silence**: a hundred errors on a site
that normally throws two hundred is a quiet hour, and an absolute threshold would
call it an incident.

### 2. The baseline is the same hour on previous days

This site is played from school. Traffic at 12:30 on a Tuesday and traffic at
03:00 on a Sunday differ by more than any spike worth telling anybody about, so
"the last hour vs the last 24 hours" would fire every weekday morning and stay
silent through a real surge on a quiet evening.

Both sides of every ratio are therefore the same sixty minutes of the day,
aligned exactly (minutes-ago modulo a day), and the comparison is against a
**median** of the previous seven days rather than a mean — one viral afternoon in
the sample would otherwise raise the bar for the whole following week, so the
next real spike would have to beat the last one to be noticed.

Every ratio is paired with an absolute floor, and no ratio rule fires without
`MIN_BASELINE_DAYS` of history. A rule that cannot measure says nothing.

### 3. The cooldown is a dedupe key, not a table

`notifications.dedupe_key` is already unique table-wide and `deliver.ts` already
declines to push what it did not write. Putting a six-hour clock bucket in the
key buys a cooldown with no new table, no migration — `HANDOFF.md` documents a
migration that never reached production, so this is a live risk here, not a
hypothetical — and no cleanup job. It is also correct across concurrent runs,
because the unique index does the work rather than a read-then-write.

It costs one thing, honestly: the windows are fixed rather than sliding, so an
alert straddling a boundary is told twice. A stored last-fired timestamp would
fix that and cost a table and a migration. Not worth it.

### 4. The cron holds a measurement, never a message

The credential lives in a GitHub repository's settings, where anybody who can
edit a workflow file can use it. So the notify endpoint takes **ids and
numbers**, narrows them with `parseFiredAlert`, and builds the notification text
itself from the catalogue. The worst a holder of that key can do is claim a spike
that did not happen. If the request carried a title and a body, the worst case
would be arbitrary text on an admin's lock screen.

`ALERTS_SECRET` is separate from the other admin secrets for the same reason,
and setting it **replaces** the fallbacks rather than joining them — otherwise
rotating the CI key would revoke nothing.

## Why these three alerts

| Alert | Fires when | Default | Why that channel |
|---|---|---|---|
| `traffic_spike` | ≥3× the same hour's median **and** ≥25 players | push | Only useful while it is still happening. |
| `error_spike` | ≥3× the median with ≥20 errors; ≥20 against a silent baseline; ≥100 with no baseline | push | Something is broken now. |
| `content_gap` | ≥5 people searched one term today and matched no game | bell | A to-do with no deadline. Pushing it would teach an admin to mute the group that carries the other two. |

An alert id **is** a notification kind (`ALERT_IDS` is declared `satisfies
readonly NotificationKind[]`, so an alert with no kind fails the build). Muting
"Missing games" under Settings → Notifications → Site health mutes the alert.
There is no second preference to keep in step.

Deliberately **not** shipped:

- **Traffic flatline** — zero players in an hour where the baseline is healthy,
  which would catch a build that shipped without `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN`
  (a failure this repo has actually had). Considered and dropped for now; it
  would be four lines in `rules.ts` and a fourth kind.
- **Breakout game** — one game's plays running far above its own share. Overlaps
  the traffic spike and needs a second per-game query.

## Failure

The one failure mode this feature must not have is **silence that looks like a
healthy site**. So, unlike the dashboard's panels, nothing here degrades to
zeros: `getAlertSnapshot` answers `{ ok: false, reason }`, the probe answers 503,
the runner exits non-zero, and the Actions run goes red and mails the owner. A
broken alerter announces itself through the same channel as everything else that
breaks in CI.

The exception is delivery itself. `notifyAdmins` swallows its own failures by
design, so a 200 from notify means "accepted and attempted", not "buzzed a
phone" — which is honest, because with a cooldown in play a healthy request
frequently and correctly delivers nothing.

## What is not verified

The HogQL in `metrics.ts` has not been run against a live PostHog project — this
was built without read credentials. The queries are modelled on the ones in
`stats.ts` (the zero-result subquery is lifted from it), but the baseline query's
`dateDiff`/`intDiv`/`modulo` shape is new here. If PostHog rejects it, the first
scheduled run answers 503 and goes red with the error text in the log, which is
the intended way to find out; run **Site alerts → Run workflow** with *dry run*
ticked after deploying to check it deliberately rather than by surprise.
