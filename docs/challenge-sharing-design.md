# Challenge sharing — design

Sequel to `challenge-design.md`, and it should be read after it. That document
built a challenge: a score to beat on a board, aimed at a friend, triggered by a
game through the SDK. This one adds the two things it left out — a way to
challenge from a score you set last week, and a way to challenge somebody who
does not have an account yet.

---

## 1. What is being built

**A. Challenge from your standings.** `/play/you` already lists every board you
have entered, with your best and your rank. Each row gets a Challenge action
that opens the friend picker that exists.

**B. Challenge links.** "Who can beat my 4,200 on Snake?" as a URL you can paste
into a group chat. Anyone who opens it plays immediately, signed out, and is
asked to make an account only once they have something to keep.

Both land on one branch, phased as commit order — the same arrangement
`challenge-design.md:16` chose, and for the same reason: A is a prerequisite
surface for B (the share button lives beside the challenge button), and
splitting them would mean extracting the shared picker twice.

## 2. Why B is worth reversing an exclusion

`challenge-design.md:256` lists "group/open challenges" under **deliberately
excluded**. This reverses that, and the reversal is the main claim of this
document, so it is argued rather than assumed.

The social graph today can only grow when two people **who already know each
other** both find HallPass independently and then exchange a username or a
friend code. There is no path by which an existing player produces a new one.
The in-game picker makes this visible: a player with no friends opens it and is
told to add a friend first, which is a dead end offered at the exact moment they
wanted to be social.

A challenge link is the first mechanism where an existing player recruits a new
one *and hands them a reason to sign up on arrival*. It is also the answer to
that empty picker.

The exclusion was right when it was written — a group challenge with no
recipient in mind is a broadcast, and every anti-harassment rule in
`social/config.ts` is built around somebody being *pushed at*. What changes here
is the direction. **A link is pull.** Nobody's phone buzzes; a stranger cannot
put anything in front of you. You go and get it. That inverts the safety
analysis rather than ignoring it, and §7 works through what it costs instead.

## 3. Decisions taken with the user

Asked and answered before any code, so they are settled rather than inferred:

1. **Both parts, one branch, phased.**
2. **Play first, convert on the win.** A signed-out visitor plays anonymously
   and is asked to sign in only after they post a score. §5 is the argument.
3. **One link per (player, board), score refreshes.** A stable URL that can be
   posted once and reused; it always shows the owner's current best, and each
   taker snapshots the number when they take it up.
4. **A link shows handle and score. No avatar at all.** The pitch is beat *me*,
   and a name carries that. See §7 — this started as "handle, avatar and score"
   and was tightened after `challenge-onboarding-ux.md` §9.3 pointed out what a
   Google-only product's avatars actually are.
5. **The hop out of an in-app webview fires on the "Beat it" tap**, never on page
   load — a user gesture is far more likely to be permitted, and at that moment
   there is no state to carry. §6.
6. **Non-beaters get a second, weaker ask on their third attempt.** "Convert on
   the win" is right, but most people will not beat Alice, so on its own it
   leaves roughly 70% of everyone who plays with no moment at all.
7. **Links are only offered on HallPass-hosted games.** Cross-origin games mint
   no claim token, so the last three steps of the funnel cannot exist there. §5.

## 4. Modelling: two new kinds, no new table

`kind` is the seam 022 built for exactly this, and it holds. Extending the table
above rather than adding one beside it is what keeps `resolveForScore`,
`listIncoming`, `countIncoming`, the inbox index and the resolve index working
untouched.

| kind         | challenger | target        | window | what it is                     |
| ------------ | ---------- | ------------- | ------ | ------------------------------ |
| `friend`     | set        | set           | none   | unchanged                      |
| `seasonal`   | NULL       | NULL (anyone) | set    | still unbuilt                  |
| `link`       | set        | NULL (anyone) | none   | the shareable post             |
| `link_claim` | set        | set           | none   | one person who took it up      |

**A `link` row is an invitation, not a challenge.** It is never resolved, never
dismissed, and never appears in anybody's inbox. It carries the code, the
owner, the board, and the score as of the last time it was shared.

**A `link_claim` row is a real challenge** with a target, created when a
specific person takes the link up. This is the load-bearing choice: because it
is target-shaped, every existing read and the entire resolution path apply to it
with no new branch. `resolveForScore` matches on `target_id = <player>` and
carries no `kind` filter (`challenges/store.ts:589`), so a link claim resolves
itself, produces a notification and renders in `ChallengeList` for free.

That reuse is the whole argument for this shape, and it is worth being precise
that the seam was only ever a claim about the *rule*, not the query —
022 says so at the `resolveForScore` docblock about `seasonal`. `link_claim`
fits because it restores the target column that seasonal removes.

### What this shape costs, stated up front

- **`listOutgoing` breaks without a filter.** It selects on `challenger_id = me`
  with no `kind` predicate, so a `link` row would arrive in the outbox as a
  challenge with no target and blow up the renderer. It needs `AND kind <>
  'link'`, and the links get their own grouped section.
- **One `link_claim` per taker.** A link posted to a class of thirty puts thirty
  rows in the owner's outbox. The outbox therefore groups by link — "14 opened ·
  3 beat you" — rather than listing them flat.
- **`challenges_friend_pair_idx` does not cover claims.** It is partial on
  `kind = 'friend'`, so claims need their own partial unique index on
  `(parent_id, target_id)` to make taking the same link twice idempotent.
- **The friends-only gate is bypassed on the claim path.** Deliberate, and it
  does not go through `create()` — a separate store method with its own gates,
  so nobody can reach it by passing a different `kind` to the existing one.

## 5. The onboarding flow

Bob opens Alice's link from a group chat. He is signed out, on a phone, and
quite possibly inside an in-app webview.

1. **`/c/<code>`** — Alice's handle, the number, the game art, one button. No
   avatar (§7), no account, no interstitial, no cookie banner.
2. **Straight into the game, anonymous.** `POST /api/v1/leaderboard/<board>`
   already accepts guest scores and already returns a short-lived HMAC
   `claimToken` for exactly this (`route.ts:225`).
3. **The score lands, and that is the moment of leverage:**
   - **Beat it** → "You beat Alice — 4,510 to 4,200. Sign in to keep it and send
     one back." This is not a signup request. It is an offer to make a win
     permanent and to hit back, at the one second where both are wanted.
   - **Fell short** → "Try again" as the primary action. On the **third**
     attempt, and once only, a quieter "sign in to keep your scores" — which is
     literally true, since `/api/v1/me/claim` accepts up to `MAX_CLAIM_TOKENS`
     at a time and the store holds every token from this visit. Without this,
     the whole flow has nothing to say to the ~70% of players who do not beat
     the score, which is most of the traffic.
4. **Sign in → claim → he is on the board**, Alice is notified, and adding her
   as a friend is one tap. Offered, never automatic — consent is not implied by
   having clicked a link.

**Why play-first is not merely the higher-converting order.** Google OAuth
frequently refuses to run inside the Instagram and Snapchat in-app browsers
(`disallowed_useragent`). A sign-in gate at step 1 is not just lossy there; it
is a wall with nothing behind it, on the exact surface this feature exists to
serve. Play-first degrades to "you played a game and could not sign in", which
is a bad outcome instead of a broken one.

### The one real backend gap

`claimScores` re-attributes score rows and nothing else
(`scoreboard/store.ts:396`), and `resolveChallengesForScore` runs only on live
submission by an already-signed-in player (`leaderboard/[slug]/route.ts:211`).
**So Bob's beat currently closes nothing.** Step 4 above does not work today.

The fix is small and well-shaped: `claimScores` returns `(board_id, score)` per
claimed row instead of a bare count, and `/api/v1/me/claim` runs resolution over
them after the transfer. It must be as fail-soft as the submission path is — a
claim that succeeds and a resolution that does not is recoverable; the reverse
is not.

Worth noting that this also closes a hole that exists **today**, independent of
links: play anonymously, sign in afterwards, and your beat does not count
against an ordinary friend challenge either.

### The ceiling nobody had costed

Google Workspace for Education **blocks under-18 accounts from signing in to
unconfigured third-party apps by default** (rolled out August 2023; the block
clears only when a school IT admin marks the app trusted). No school IT admin is
going to approve an unblocked-games site whose headline feature disguises the
screen from a teacher. On a school Chromebook the browser's Google account *is*
the school account.

So for a meaningful share of the audience, step 4 above cannot complete — not
slowly, not with better copy, at all. Nothing in this design fixes that; the
honest response is to make the failure legible and recoverable rather than
mysterious. Force `prompt=select_account` so nobody is silently pushed into
their school identity, warn in one plain line before the tap, and detect
*that specific* failure and say what to do about it. Steps 1–3 are unaffected —
another reason play-first is the right order: the part that always works happens
first, and the part that sometimes cannot happens last.

This is the binding cap on the funnel and it argues, on the backlog rather than
here, for a sign-in route that is not Google. `challenge-onboarding-ux.md` §1.6
carries the sourcing and §6.4 the recovery screen.

## 6. Constraints inherited, and the new ones

Everything in `challenge-design.md:52` still binds — no cron, no cross-statement
transactions, boards not games, `public_id` on the wire, limit the sender never
the recipient, `contract.ts` append-only. Plus:

- **THE PAGE HOLDING THE CLAIM TOKENS MUST NEVER NAVIGATE.** This is the single
  highest-value rule in this document. `sdk/src/client.ts:111` keeps claim
  tokens **in memory and never in storage**, deliberately, so that the next kid
  on a shared school computer cannot inherit the last one's scores. They die
  with the page. So sign-in opens in a **new tab** and the claim is flushed from
  the opener, "Play again" restarts in place, and there is **no same-tab
  redirect fallback, ever** — a redirect silently throws away the score the
  player just earned, which is the whole thing we are asking them to sign in
  for. `challenge-onboarding-ux.md` §2 puts this step at ~0% versus 93%
  depending on this one decision.
- **Only HallPass-hosted games can carry a link.** `client.ts:246` mints a claim
  token only for a `sameOrigin` submission, so a cross-origin game produces
  nothing to claim and the conversion half of the funnel cannot exist. The share
  affordance is therefore absent for external games rather than present and
  broken.
- **The webview hop rides the "Beat it" tap.** `x-safari-https://` on iOS,
  `intent://…package=com.android.chrome` on Android, gated on user-agent
  detection so an ordinary mobile browser never sees it. Behind a flag with a
  1200ms bail-out to playing in place: the research rates the escape as patched
  in some hosts and absent in others, so an unbailed attempt is a delay charged
  to the highest-traffic step in the funnel.
- **`/game/[slug]` cannot read `searchParams`.** Not a style preference: it
  makes the route dynamic, which drops all 28 game URLs from the service-worker
  precache with no error. The hand-off from `/c/<code>` into the player is
  therefore client-side — the landing page stores the code and a client island
  calls `useOpenGame()` — never a server-read query parameter.
- **`/c/<code>` is crawlable and `noindex`.** The `/u/<username>` argument
  applies exactly (`app/u/[username]/page.tsx:12`): a link that gets pasted into
  chats gets discovered, and a `Disallow` would stop the crawler *fetching* the
  page and therefore ever seeing the `noindex`, leaving a bare URL listed and
  unremovable. Crawlable plus an `X-Robots-Tag` header in `next.config.ts` is
  the only combination that works.
- **The landing renders the same HTML for everybody.** Viewer-specific state
  ("you have already beaten this") arrives from a client island. This keeps the
  page out of the per-viewer category, keeps the OG preview honest, and means it
  needs no entry in `sw.js`'s private-path list — only exclusion from precache.

## 7. Safety

**What a link exposes: a handle and a number. No face.**

The first draft of this document said handle, avatar and score, reasoning that
this was the same exposure `/u/<username>` already accepts. That reasoning is
right in kind and wrong in scale, and the difference matters:
**`/u/` is a page you have to find; this is a page engineered to be broadcast.**
Sign-in is Google-only, so a HallPass avatar is frequently a real photograph of
the account holder — and the account holders are children. Shipping the avatar
would take that photograph, attach it to a URL the product actively encourages
them to paste into a public story, and render it into an OG card that WhatsApp,
iMessage and Snapchat cache on other people's devices. `noindex` stops crawlers,
not people.

So the landing and the preview card carry **no avatar at all**, not even a
derived one. A handle and a number carry "beat me" perfectly well, and the
safest version of a feature this shareable is worth more than the click-through
a face would buy.

The rest of the mitigations are the ones `/u/` already uses plus one this needs:
an opaque code from the friend-code alphabet (`username.ts:269` — digits and
consonants, so no code accidentally spells anything), `noindex, nofollow`, no
link through to a profile that is not public, and **revocation**. A child must
be able to kill a link they regret, which on its own rules out the tempting
stateless-signed-token design.

**The harassment analysis.** A claim only ever puts a row in the *taker's* own
inbox, at the taker's request, so a link cannot be used to push anything at a
third party. The one inbound consequence for the owner is "somebody beat your
score", which is self-inflicted — they published the link. It still needs a
volume answer: a link that goes round a school produces hundreds of those.

So `challenge_beaten` is a **new notification kind defaulting to `bell`, not
`push`**. `challenge_received` stays on push because a friend challenge is one
person addressing one person. This is the same reasoning `game_drop` and
`achievement_unlocked` already use in `notifications/config.ts:167` — the bell is
for what you will see when you look, push is for what needs you now.

**Rate limits.** Minting a link is self-directed and cheap; it is upserted per
(player, board) so it cannot stack. The limit that matters is on *claiming*,
which reuses the existing sender window keyed on `playerId` — never on IP, for
the reason `social/config.ts` repeats and this document will not repeat again.

## 8. Schema — migration 025

```
ALTER  challenges_kind_chk         → kind IN ('friend','seasonal','link','link_claim')
ADD    challenges_link_shape_chk   kind <> 'link' OR (challenger_id IS NOT NULL
                                     AND target_id IS NULL
                                     AND starts_at IS NULL AND ends_at IS NULL)
ADD    challenges_link_claim_shape_chk
                                   kind <> 'link_claim' OR (challenger_id IS NOT NULL
                                     AND target_id IS NOT NULL AND parent_id IS NOT NULL)
ADD    code        TEXT            -- link only; opaque, unique
ADD    parent_id   BIGINT          -- link_claim → the link, ON DELETE CASCADE
ADD    revoked_at  TIMESTAMPTZ     -- link only
ADD    opens       INTEGER NOT NULL DEFAULT 0

CREATE UNIQUE INDEX challenges_link_code_idx  ON (code)                    WHERE kind = 'link'
CREATE UNIQUE INDEX challenges_link_owner_idx ON (challenger_id, board_id) WHERE kind = 'link'
CREATE UNIQUE INDEX challenges_link_claim_idx ON (parent_id, target_id)    WHERE kind = 'link_claim'
```

The per-kind CHECKs in 022 are written as `kind <> 'x' OR (...)` precisely so a
new kind is a new constraint rather than an edit to an existing one, and that
holds here. **The `kind` whitelist itself is the one exception** — it has to be
dropped and re-added, which is the only destructive statement in the migration
and the reason it is guarded and idempotent like 021 and 022.

`app/lib/challenges/schema.sql` carries the same DDL as the fresh-install copy
and must stay in lockstep. `HANDOFF.md` records migration 013 never reaching
production, so every read added here degrades on `isMissingColumnError` and the
deploy note is part of the work, not an afterthought.

`revoked_at` is a timestamp rather than a delete, matching everything else in
this table: the row is its own history, and a revoked link's code must stay
claimed so it can never be reissued to somebody else.

## 9. Files

**New**
```
app/lib/challenges/link.ts                 PURE: code generation, link state
app/lib/challenges/link.test.ts
app/c/[code]/page.tsx                      the landing
app/c/[code]/ChallengeLanding.tsx          client island: open the game, viewer state
app/c/[code]/ChallengeResult.tsx           the beat/miss surface and the asks
app/c/[code]/webview.ts                    PURE: UA detection + escape URLs
app/c/[code]/webview.test.ts
app/c/[code]/opengraph-image.tsx           the preview card (phase C)
app/api/v1/challenges/link/route.ts        POST mint/refresh, DELETE revoke
app/api/v1/challenges/link/[code]/route.ts POST claim
app/components/challenges/ChallengePicker.tsx   extracted from ChallengeEmbed
app/components/challenges/ShareChallenge.tsx    Web Share API + clipboard fallback
app/components/challenges/LinkOutbox.tsx        grouped links in the Challenges tab
app/play/you/_ui/ChallengeRow.tsx          the standings-row actions
scoreboard/migrations/025_challenge_links.sql
```

**Changed**
```
app/embed/challenge/ChallengeEmbed.tsx     wraps ChallengePicker, keeps the signal
app/play/you/page.tsx                      Challenge + Share on each standings row
app/lib/challenges/store.ts                mintLink / claimLink / revokeLink;
                                           listOutgoing gains `kind <> 'link'`
app/lib/challenges/index.ts                fail-soft wrappers for the new reads
app/lib/scoreboard/store.ts                claimScores returns board_id + score
app/api/v1/me/claim/route.ts               resolve challenges after a claim
app/lib/notifications/config.ts            + challenge_beaten (bell)
app/lib/notifications/copy.ts              + its copy, full and discreet
app/components/friends/ChallengeList.tsx   render link claims, grouped links
next.config.ts                             X-Robots-Tag for /c/:code*
scripts/build-sw-manifest.mjs              keep /c/ out of the precache
README.md
```

## 10. Failure modes

The house rules, unchanged. `isMissingColumnError` renders the feature as
absent; `isUnconfiguredDbError` gets its own notice; anything else rethrows,
because a Neon outage disguised as "no challenges" is the most misleading thing
these surfaces could say.

Two specific to this work:

- **A revoked, missing or malformed code is a 404 page, not an error.** It says
  the challenge is no longer available and offers the game anyway. Somebody who
  followed a dead link from a chat is a visitor, not a fault.
- **The claim path must never cost a score.** Resolution after claiming runs in
  its own try/catch after the transfer has committed, exactly as the submission
  path does. An unresolved claim is closed by the next qualifying score; a lost
  score is gone.

## 11. Commit plan (~28)

*Phase A — challenge from your standings (no migration)*
1. this design doc
2. extract `ChallengePicker` from `ChallengeEmbed`, unchanged behaviour
3. `ChallengeEmbed` wraps it and keeps the three-transport signal
4. `ChallengeRow` — the standings-row actions
5. wire it into `/play/you`
6. refusal copy for every `ChallengeReason` on this surface
7. tests

*Phase B — links*
8. migration 025 + `schema.sql`
9. `challenges/link.ts` + test
10. `store.mintLink` + test
11. `store.claimLink` + test
12. `store.revokeLink`, `listOutgoing` kind filter + test
13. `index.ts` fail-soft wrappers
14. `POST`/`DELETE /api/v1/challenges/link`
15. `POST /api/v1/challenges/link/[code]`
16. `/c/[code]` landing, server half
17. `ChallengeLanding` — hand-off into the player, in place
18. the beat/miss result surface
19. the third-attempt ask for non-beaters
20. new-tab sign-in + claim flush from the opener — the never-navigate rule
21. `claimScores` returns board and score
22. resolution on claim + test
23. `ShareChallenge` — Web Share, clipboard fallback
24. share buttons on the standings rows and in the picker, hosted games only
25. `noindex` header + precache exclusion

*Phase C — polish*
26. `challenge_beaten` kind + copy + test
27. fire it from the resolve path
28. the webview hop, behind a flag with its bail-out
29. `prompt=select_account` + the school-account recovery screen
30. grouped link outbox in the Challenges tab
31. "add them as a friend" after a resolved claim
32. OG preview image — game art, handle, number; no avatar
33. the PostHog funnel events
34. README + the migration deploy note

## 12. Deliberately excluded

Leaderboards *per link* (a link is a duel with one number, not a board);
challenge links to a game with several boards, which stays the ambiguity
`resolveBoard` already refuses; **links on external games**, per §3.7 — the
share affordance is absent there rather than present and unable to convert;
avatars on the landing or the preview card, per §7; expiry dates, because there
is no cron and revocation is the control; anonymous takers appearing in the
owner's counters beyond the raw `opens` figure, which would need the link code
carried onto the score-submission path and a second write on the guest path that
`leaderboard/[slug]/route.ts:203` deliberately keeps clear; auto-friending;
rematch chains; a non-Google sign-in route, which the ceiling in §5 argues for
and this branch does not attempt; and the `seasonal` kind, which this does not
build either.
