# Report a player — design

Until now only reviews could be reported. This adds "Report" for a player's
profile so a child (or a parent looking over their shoulder) has a way to flag
bullying, an unsuitable name or picture, or impersonation. Read it with
`invites-design.md` (same origin/rate-limit shape) and `challenge-sharing-design.md`
(the privacy rules on what a profile may reveal).

## 1. What exists

- **Table** `profile_reports`
  (`app/lib/scoreboard/migrations/043_profile_reports.sql`, canonical copy
  `app/lib/profile-reports/schema.sql`).
- **Store** `app/lib/profile-reports/` (factory + fake-`sql` tests, live binding in
  `index.ts`).
- **Endpoint** `POST /api/v1/me/reports` `{ id: publicId, reason, note? }`.
- **UI** a "Report" button (`app/components/profile/ReportButton.tsx`) on another
  player's `/u/<username>` for signed-in viewers, and on friend-list rows. It
  opens a native modal `<dialog>`: radio list of reasons, optional note,
  "a person at HallPass will look at it", a confirmation state and an error state.
- **Dashboard** a "Reported players" queue at the top of `/dashboard/moderation`
  with *Reset this profile…* (a confirm panel), *Mark handled (no account
  change)* and *Dismiss*; the sidebar badge counts these too.
- **Admin notification** a `profile_reported` notification (section 9).
- **Retention job** `POST /api/v1/admin/profile-reports/retention` (section 7).

## 2. What is stored

One row per report: reporter and reported (internal `players.id`, server-side
only), `reason` (`bullying`, `inappropriate_name`, `inappropriate_content`,
`impersonation`, `other`), an optional `note` (at most 300 characters, typed by
the reporter), `status` (`open`, `actioned`, `dismissed`), `created_at`,
`resolved_at` and `resolved_by` (the acting admin's dashboard email).

Not stored: IP addresses, the reported profile's content at the time (a
snapshot of a name or picture would be a copy of a child's data; a moderator
looks at the live profile), or anything about the reporter beyond the id.

On the wire players are identified by `public_id` only, never `players.id`.

## 3. Who can see it

- **Reporter**: sees only "thanks". They cannot list or re-read their reports.
- **Reported player**: sees nothing, ever. They are not notified. A duplicate
  open report answers `ok` exactly like a fresh one.
- **Admins** (`requireRole("admin")`, the same as review moderation): the
  reported player's public display name, `@username` and `public_id`, the
  reason, the note, the time, and how many reports are open against that player.
  The reported child's Google `name` and email are never selected. The
  reporter is not shown at all, to moderators or the reported player: the
  moderator judges the report, not the child who made it. This is the owner's
  decision, and `anonymity.test.ts` locks it in for the store, the dashboard
  card, the notification and the MCP views (the id stays in the table for the
  rate limits and for a manual database lookup).
- The note is rendered as text, never HTML.

## 4. Privacy rules honoured

- Same `isTrustedOrigin` referrer allowlist as every `/me/` write, so a game in
  an iframe cannot file reports for the player.
- Signed-in only, content-type checked (the CSRF guard `me/invites` documents).
- The button appears wherever `/u/<username>` already renders for the viewer,
  including the minimal profile shown for private or blocked viewers; it reveals
  nothing the page does not, and a blocked child can still report the person they
  blocked. Guests never see it. An id that matches no player is a collapsed
  `404 unavailable`; reporting yourself is `400 self`.

## 5. `ON DELETE`

- `reporter_id` → **SET NULL**. A report about harassment must survive the
  reporter deleting their account (same choice as `review_reports`). Nulling
  the id removes the only link to that child.
- `reported_id` → **CASCADE**. A deleted account takes the data about it with
  it; a report is data about the reported child and keeping it would retain a
  child's data after deletion. Trade-off: deleting the account ends the open
  report. Safeguarding escalations are expected to be handled before then.

## 6. Rate limits

Per reporter, counted from `profile_reports` itself in the same statement as the
insert: **5 per rolling hour and 15 per rolling day** (`config.ts`). A duplicate
of an open report writes no row and so does not count. One open report per
(reporter, reported) pair is enforced by a partial unique index; once a report is
resolved the same person may report again. Request bodies are capped at 2 KB.
Best-effort under true concurrency, like every limiter here.

## 7. Retention (decided)

Resolved (`actioned` or `dismissed`) reports are deleted **90 days after
`resolved_at`** (`PROFILE_REPORT_RETENTION_DAYS`, owner decision). `open` reports
are kept until resolved and never aged out. 90 days is far longer than the 24
hour rate-limit window, which needs the rows to exist.

The sweep is `POST /api/v1/admin/profile-reports/retention`
(`store.purgeResolved`), behind `alertsAuthGate` like the other scheduled jobs,
run as the second step of the daily `.github/workflows/clip-retention.yml`
(`scripts/run-profile-report-retention.mjs`; same `ALERTS_SECRET`, and the
workflow's *dry run* input counts without deleting). It is its own route and
step so its name is honest and its failure is reported separately from the beta
clip sweep. Deleting is idempotent. No migration was needed: `resolved_at`
already existed.

## 7a. The account action

*Mark actioned* used to only close the report. The queue now has three buttons:

- **Reset this profile…** opens a confirm panel that says, before the click,
  what will happen. On confirm, in ONE SQL statement (one snapshot; the `neon()`
  HTTP driver cannot span statements): the reported player's `handle` and
  `username` become NULL, `use_google_photo` becomes false, **every** open
  report against that player is marked `actioned` with `resolved_at` and the
  acting admin, and the old username is tombstoned in `username_history` with no
  owner, so neither the child nor anyone else can take it for
  `USERNAME_TOMBSTONE_DAYS` (90). A stale click on an already-closed report
  changes nothing.
- **Mark handled (no account change)** closes this one report as `actioned`
  (the moderator dealt with it elsewhere). `actioned` therefore means "a person
  acted", with or without a reset.
- **Dismiss** closes it as `dismissed`.

Admin only (`requireRole("admin")`). The server logs one line: report id, the
player's `public_id`, how many reports were closed and the admin's dashboard
email; never a name, the child's email or the reporter.

Consequences, checked against Postgres in `store.db.test.ts`:

- `/u/<old-username>` stops resolving (not found). The old name is held back.
- Friend rows, scores, challenges and invites are untouched. Everything that
  prints a name already falls back for a NULL handle and username: the public
  leaderboard and friend standings show the generated name (`AuraFarmer#0417`
  style), friend lists and challenges show "Player", and no photo is shown.
- The player can choose a new name through the normal settings flow. While
  `username` is NULL, `claimUsername` applies neither the 30 day rename
  cooldown nor the plays requirement, so a new username can be claimed
  immediately; the moderated one cannot, for 90 days. The display name
  (`handle`) has only the short per-change cooldown. There is no rule that
  stops a player choosing another inappropriate name; that returns to the queue
  by a new report.
- The player is not told. The reset does not delete the account and does not
  touch their Google profile.

## 8. Open questions

- Whether open reports should also age out (today they never do).
- Whether the reset should tell the player (today it does not).
- Whether a repeat reset for the same player should escalate (suspension is
  not built).
- `reported_id` CASCADE means a harasser who deletes their account ends the
  report; if the policy owner prefers to keep a minimal record, that is a
  different table, not a different `ON DELETE`.

## 9. Admin notification

A new report sends the `profile_reported` notification (admin audience,
moderation group, push by default like `review_reported`;
`app/lib/notifications/config.ts`, wording in `copy.ts`): "A profile was
reported (<reason>). Open moderation to read it.", linking to
`/dashboard/moderation`. It carries no reporter, no reported name and no note.
It is sent only for a newly created report: a duplicate of an open pair writes no
row and sends nothing. It is best effort: `notifyAdmins` swallows its own
failures and the route catches anything else, so a notification problem never
fails the report request. It is not deduplicated (each new report is one new
open row, and the per-reporter rate limit bounds the volume).
