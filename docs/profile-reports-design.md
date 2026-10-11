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
  with *Mark actioned* and *Dismiss*; the sidebar badge counts these too.

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
  reporter is not shown at all; the moderator judges the report, not the child
  who made it (open question below).
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

## 7. Retention (proposal, not built)

Proposal: delete `actioned` and `dismissed` reports 90 days after `resolved_at`,
and keep `open` reports until resolved. 90 days is far longer than the 24 hour
rate-limit window, which needs the rows to exist. No job is built here; this
codebase prefers opportunistic deletion in a write path, and a one-line
`DELETE ... WHERE status <> 'open' AND resolved_at < now() - interval '90 days'`
could ride on `resolve()`. This needs a decision, and the privacy notice should
state whatever is chosen.

## 8. Open questions

- Retention period (above), and whether open reports should also age out.
- Should moderators see who reported (for follow-up and for spotting abuse of
  reports)? Currently no; the data is in the table for a manual lookup.
- Should *Mark actioned* offer a next step on the reported account (rename,
  hide the picture)? Today it only closes the report.
- Whether a notification to admins is wanted for new profile reports (reviews
  notify via `review_posted`; this does not).
- `reported_id` CASCADE means a harasser who deletes their account ends the
  report; if the policy owner prefers to keep a minimal record, that is a
  different table, not a different `ON DELETE`.
