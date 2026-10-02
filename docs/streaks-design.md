# Streak and comeback notifications — design

Sibling of `notifications-design.md`. Tracker item #15: "9 returning players out
of 20 registered is decent, but there's no mechanism pushing people back."

## 1. What existed

A streak was **device-local and cosmetic**: `lib/streak/store.ts` kept played
day-keys in `localStorage`, and the chip and toast drew from it. The server knew
nothing about it, so nothing could notify anybody about it. "A friend beat your
score" was covered only for explicit challenges (`challenge_beaten`); a friend
passing your score with no challenge in play told nobody.

## 2. Decisions taken with the user

1. **Full set:** server-known streak, streak-at-risk push, streak milestone
   (bell only), and a passive "a friend passed your score".
2. **Nudges use server state only.** The header chip stays device-local; making
   it account-level is a separate change.
3. **No win-back for lapsed players.** Only a streak the player built and can
   still save is nudged. For a school audience, "we miss you" is where an arcade
   starts to feel manipulative.
4. **17:00 local**, once per local day. **Hourly** cron, its own workflow.
5. **`friend_passed` defaults to the bell**, for the reason `challenge_beaten`
   does: one popular board and one class is a dozen buzzes.
6. **Gated on a new personal best**, so the extra statement on the leaderboard
   write path runs only when an overtake is possible.

## 3. The model

`player_streaks` (migration 036) holds one row per player: current, longest,
`last_day` (a DATE — the player's own calendar day, as the device reports it),
`tz_offset_min`, and `last_nudged_day`.

The device posts `{ day, tzOffsetMin }` from the existing `hp:streak` event, so
once per local day per device. The server applies the same rule as
`streak/core.ts` in ONE statement (the Neon HTTP driver has no transactions).
The claimed day is clamped to within one day of server UTC: the only thing a
liar can fake is their own flame and their own nudge timing; no score, rank or
reward depends on it.

## 4. The reminder

`POST /api/v1/admin/streaks/remind`, behind the alerts secret, driven hourly by
`.github/workflows/streak-reminders.yml`. A player is due when their streak is
at least 2, `last_day` is their local yesterday, their local hour is 17, they
have not been nudged today, and they have a push subscription. A bell-only
nudge would be pointless: the player would have to open the site to see it,
which is the thing the nudge is for.

The run is capped, and every nudge carries a per-player per-local-day dedupe key
as well as `last_nudged_day`.

## 5. A friend passed your score

After a signed-in score is stored, ONE statement finds accepted friends whose
best on that board is strictly worse than the new score and at least as good as
the player's previous best — the friends newly passed. Anyone already told by
`challenge_beaten` for the same submit is skipped. The dedupe key includes the
passed friend's score, so each distinct overtake is announced once.

## 6. Excluded

Email/SMS; win-back for lapsed players; streak freezes or grace days; an
account-level chip; per-item dismissal, digests and quiet hours (unchanged from
the notifications design).

## 7. Operational notes

Apply migration 036 before deploying. Every read and write here is fail-soft
against a missing table. The reminder workflow is opt-in on `ALERTS_SECRET`.
