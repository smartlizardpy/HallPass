# Fright Fest referrals — design

Sibling of `candy-hunt.md` and `championship-design.md`. The plan written before
the code (AGENTS.md, phases 1 and 2) and the record of the decisions behind it.
The product brief was the "Social Sharing & Friend Referrals" PRD (28 Oct 2026);
where this document differs from it, the difference is listed in §6.

## 1. What is built

A **"Spread the Fright"** section on `/fright-fest` (`#spread`, under the player's
progress) with three actions, and the referral system behind the middle one.

1. **Copy a Post** and 3. **Copy a Comment**: put ready-made text on the clipboard
   (dates from the event window, the player's link when they are signed in).
   Nothing is posted anywhere and no social login is asked for.
2. **Invite a Friend**: a dialog with the player's personal link, "Copy Invite
   Link" and "Copy Invite Message", friends joined, candy earned, rewards left,
   and a progress bar. When a **new** friend, arriving through that link, gets
   their **first accepted ranked run** in the window, the inviter is paid
   **+10 candy**, for at most **4 friends** (40 candy).

Sharing is optional. Nothing is paid for copying, clicking or posting.

## 2. Decisions

Taken with the owner on 28 Oct 2026:

- **The reward is Candy**, not Fright Points. Fright Points are derived from board
  ranks (100 for 1st down to 5) and decide the Overall Champion; a flat bonus
  would swamp that scale and need changes to standings, tiebreaks and the finalise
  flow. Candy is a spendable ledger with idempotent award keys, a revocation
  path and an audit log, which is what the PRD's "atomic, idempotent, auditable"
  asks for. A referral is a candy-ledger credit of kind `referral`.
- **Qualifying** = a signed-in NEW account whose first ranked run is accepted.
  Guests cannot produce a ranked run, so a guest who never signs in earns the
  inviter nothing (the PRD's "preserve attribution, award nothing" case).
- **The cap is 4 friends per player** (the PRD proposed 5; the owner asked for
  3 to 4, never unlimited). One number in `config.ts`; an admin can change it.

Engineering decisions:

- **`?fref=` not `?ref=`.** `ref` is the marketing-channel parameter
  (`growth/first-touch.ts`); friend codes in it would read as an acquisition
  channel. The link is `https://www.hallpass.games/fright-fest?fref=<token>`.
- **Token**: 12 characters of the friend-code alphabet (no vowels, no confusable
  pairs), ~1.5e17 combinations, one per player per event. It is not the player id
  and exposes nothing about the account.
- **Attribution is a first-party, HttpOnly cookie** (`hp_fref`, Lax, until the
  event closes). `/fright-fest` is a static page with no cookies or headers, so a
  client island posts the token to `POST /api/v1/referrals/visit`, which sets the
  cookie. **First touch**: an existing cookie is never overwritten. The island
  then removes `fref` from the address bar so the friend's own shares do not carry
  somebody else's code. The query string survives ordinary redirects, and the
  cookie survives sign-in (a same-site navigation).
- **A friend is "new"** when their account was created inside the event window and
  they have no run or score yet. A returning player (account older than the
  event, or already playing) is recorded `ineligible` ("Not a new player"): they
  can play, they just earn nobody a reward. A player's own link is ignored.
- **Attribution happens in two places**, both server-side: when a signed-in
  visitor lands (`visit`), and at **run start** (`postRunStart`), which covers a
  friend who landed signed out, signed in, and went straight to a game.
- **Qualification happens in two places**: right after a run is accepted
  (`postChampionshipScore`) and whenever the inviter opens the panel
  (`GET /api/v1/referrals/me` reconciles). A failed hook is repaired by the next
  look. Both hooks are fail-soft: a referral problem never fails a run.
- **Only `accepted` runs qualify** (not `flagged`, `rejected` or `disqualified`),
  submitted inside the window. The run's own server-side checks are the fraud
  gate; referrals add none of their own to scoring.
- **No IP rules.** Schools and households share addresses, so IPs are not used.
  Abuse signals are for a human: a burst of three or more friend accounts created
  within ten minutes, and a referrer whose own account was under an hour old.
- **Counters live in our database**, not PostHog (the growth panels' convention:
  exact, and not subject to ad blockers or consent). Copies and dialog opens are
  daily tallies with no player and no device.

## 3. The reward, step by step

```
visit  ──▶ cookie hp_fref (first touch) ──▶ claim()           referrals row, status pending
run accepted ──▶ qualifyReferred(friend) ──▶ qualifyReferrer(inviter)
```

`qualifyReferrer` is ONE transaction under `pg_advisory_xact_lock('referral:<id>')`:

1. insert the candy credit for every pending referral whose friend has an
   accepted in-window run, oldest run first, only while
   `n <= cap - (rewarded + revoked)`; `ON CONFLICT (award_key) DO NOTHING`;
2. mark those referrals `rewarded`, FROM the ledger row that exists (this also
   repairs a half-finished earlier attempt);
3. mark any other qualified pending referral `capped` (qualified, no candy).

Award key: `candy:<event>:referral:<referrerId>:<referredId>`, so one friend can
pay once however many requests race. The cap is a COUNT inside the same
transaction, so two friends qualifying at once cannot both take the last slot
(proved against Postgres in `store.db.test.ts`). **A revoked referral keeps using
its slot**, so revoking a fraud does not hand the farmer another try.

Statuses: `pending`, `rewarded`, `capped`, `ineligible`, `revoked`.

## 4. Schema — migration 052

`app/lib/scoreboard/migrations/052_referrals.sql`, canonical copy
`app/lib/referrals/schema.sql`. Idempotent, one transaction. Depends on 050.

- `candy_ledger.kind` gains `'referral'`.
- `referral_codes (player_id, event_id) → token UNIQUE, visits`
- `referrals`: one row per referred player per event (`UNIQUE (event_id, referred_id)`
  is first touch), `referrer_id`, `status`, `reason`, `attributed_at`,
  `qualified_at`, `amount`, `award_key UNIQUE`, `ledger_id`. A CHECK forbids
  self-referral.
- `referral_counters (event_id, kind, day) → count`
- `referral_settings`: the admin's `enabled`, `bonus`, `cap` over the code defaults.
- `referral_log`: the admin audit trail (revokes also write `candy_log`).

Like every migration here it is applied by hand. Until it is, the panel reports
"Invites are unavailable" and nothing is paid; run hooks swallow the missing-table
error.

## 5. Privacy

- No player id leaves the server. Tokens are random; the inviter sees **counts
  only**, never who joined.
- The admin desk shows public names and public ids only (no emails, no Google
  names). It is **super admin only**, like the Candy desk.
- Counters carry no player or device. The cookie is first-party, holds only a
  random token, and is set only when someone follows a referral link.
- Players include children. Nothing here messages anyone, and the friend is not
  asked for anything extra.

## 6. Differences from the PRD

| PRD | Built | Why |
|---|---|---|
| "+10 event points" | +10 **candy** | §2: Fright Points are rank-derived |
| Max 5 rewarded referrals / 50 points | **4** / 40 candy | owner: 3 to 4, never unlimited |
| `?ref=` | `?fref=` | `ref` is the marketing channel |
| Buttons say "Win More Points" | say "Win More Candy" | the reward is candy |
| Admin edits event start and end | the window is the championship's, read from `FRIGHT_FEST_2026` | one source of truth; moving the event moves referrals |
| "Leaderboard shows referral points" | candy shows in the balance and the Candy desk | candy is not on a leaderboard |
| Analytics in "existing conventions" | own-database counters + the referrals desk | the share-loop convention; no PostHog dependency |
| "Your friend joined the Fright! +10 bonus points!" | "+N candy" with the real amount, shown on the inviter's next visit | no push or email channel; N is what they actually earned |

## 7. Not done

- No notification to the inviter (push/email); they see a banner next visit.
- No per-event admin editing of the post/comment text: it is in `copy.ts`, one
  place per event (reusable by copying `config.ts` for the next event).
- Revoking is per referral. There is no bulk "revoke everything from this
  player"; use the Candy desk's ledger for that.
