# Marketing & growth — design

Sibling of `challenge-design.md`, `tracker-design.md` and `notifications-design.md`:
the argument for what is being built, what is deliberately excluded, and the
constraints that shaped it.

The ask was "what can we add marketing-wise, we don't have many users". The
answer this document argues for is **not** more marketing surface. It is the
instrumentation and the internal tooling that make the marketing surface we
already have legible — because right now nothing in this repo can answer "where
did our players come from", and every growth decision after that is a guess.

---

## 0. Decisions taken without the user (they were AFK)

Recorded here because they were the open questions in §10, not settled ones.
Each is reversible, and each names what would change it.

1. **No short domain is assumed.** `ref` codes ride the full URL. If one ever
   lands, nothing in the design changes — the builder gains a base-URL constant.
2. **The QR generator is cut from phase 1.** It needs either a new runtime
   dependency or a few hundred lines of encoder, and its real use case is a code
   read off a poster or a whiteboard — which is exactly the case decision 1 says
   we cannot serve yet. Deferred as a pair with the short domain, not forgotten.
3. **The channel vocabulary starts as a guess**, in one editable file. A `ref`
   outside the list is reported as `unknown` rather than silently becoming a new
   channel, so a typo shows up as a typo. It shipped as `tiktok`, `youtube`,
   `discord`, `reddit`, `qr`, `poster`, `friend`, `other`, and has since been
   widened on request — see §4b for what is in it now and why.
4. **We optimise for returning devices, not ad revenue.** `ad_clicked` stays on
   the existing overview; no session-depth-for-revenue panel is built. If the ad
   strip is ever meant to earn, panel 2 gains a column and this line gets edited.
5. **Search Console stays a manual read** — the property is verified, so the data
   is already there, and an integration needs OAuth plus a scheduler this repo
   deliberately does not have.
6. **Sign-in conversion is reported but is never the headline** — §2's ceiling.

## 0b. What the verification in §4a found

Checked against the installed `posthog-js` **1.395.0**, since the plan refused to
assert it from memory:

- `utm_source/medium/campaign/content/term` plus a click-ID list (`gclid`,
  `fbclid`, `ttclid`, `igshid`, …) are captured automatically, and
  `$initial_campaign_params` / `$initial_referrer_info` hold the first-touch
  copies. **Layer (a) is zero code, as hoped.**
- `custom_campaign_params: []` is a supported init option feeding the same
  `update_campaign_params()` pipeline, so `ref` can ride the built-in path
  instead of a hand-rolled parser that would shadow it.
- **But** `getSetOnceProps()` enumerates only the five `utm_*` names in its
  fallback branch, so a custom param is not guaranteed to reach the initial-touch
  props. First-touch `ref` therefore needs one explicit `$set_once` of our own.
  That is not shadowing a built-in; it is covering a gap the built-in has.

One more thing the read-through settled: `recordPlay()` in
`app/lib/streak/store.ts` **already** fires `STREAK_EVENT` exactly when a play
advances into a new calendar day, idempotently, with DST-safe day maths. The
retention marker in §3 is a listener on an event that already exists, not a new
tracker. Its detail carries `{current, longest, milestone}`, which cannot tell a
first-ever play from a return after a gap (both can read `current: 1`), so the
detail gains a `days` total — a two-line extension of a tested module.

---

## 1. Where we actually stand

Worth stating plainly, because the honest starting position is better than the
assumed one. The SEO fundamentals here are already strong:

- `app/sitemap.ts` covers the home grid, every category and every game page.
- `app/game/[slug]/page.tsx` emits `VideoGame` JSON-LD and a
  "Play X Unblocked — Free Online" title per game, with a real screenshot as the
  social image.
- `app/components/SiteJsonLd.tsx` emits `WebSite` + `Organization` with a working
  `SearchAction`.
- `app/robots.ts` is correctly permissive, with the `/u/*` crawlable-plus-noindex
  argument already thought through.
- Google Search Console is **already verified** — `verification.google` in
  `app/layout.tsx` carries the token.
- The PWA precaches the whole arcade, which is a retention asset most sites in
  this niche do not have.
- `/c/<code>` challenge links are a genuine viral loop with a dynamic OG card.

So the gap is not "we forgot SEO". The gaps are three:

1. **Nothing records where a visit came from.** There is no `utm_*` or `ref`
   handling anywhere in `app/`. PostHog is installed and proxied, but the team
   has no readout of acquisition in the surface it actually opens.
2. **The share loop is unmeasured.** `challenges` rows of kind `link` /
   `link_claim` contain an exact, first-party record of every share and every
   person who took one up. Nothing reads it as a growth number.
3. **The catalogue is 30 games.** In this niche each title is its own query.
   No instrumentation substitutes for that, and `/add-game` already automates
   onboarding, so "ship more games" stays line item zero of any growth plan.

## 2. The constraint that shapes every decision: who the players are

Children, frequently on **shared school devices**, behind **filtered networks**,
often on **school-managed Google accounts**. Four consequences, all load-bearing:

**No third-party pixels. Ever.** No Meta, TikTok, Google Ads or affiliate
conversion tags. Retargeting minors is the thing we do not do, and the site's
whole `/u/` and `/c/` design — no avatars, noindex, revocable — already commits
to that posture. A marketing tag would contradict a child-safety argument the
codebase makes in three separate docblocks.

**"Users" is not a real unit here.** A class of thirty shares a trolley of
Chromebooks; one browser profile is many children, and one child is many
profiles. Any panel that prints "unique users" is lying. We count **sessions**
and **returning devices**, and we say so on the panel.

**`/ingest` is an acquisition asset, not just a proxy.** The rewrite in
`next.config.ts` means analytics traffic is same-origin, so it survives the DNS
filtering that would kill a direct `eu.i.posthog.com` call on a school network.
That is why our numbers exist at all. It also means a filter that blocks by path
pattern takes the whole readout down silently — see §7.

**Sign-in has a hard ceiling we did not choose.** README already documents it:
Google Workspace for Education blocks under-18 accounts from unapproved
third-party apps, and this site will not be approved. A pupil on a school
Chromebook **cannot** complete sign-in. Any funnel that treats account creation
as the goal will read as broken forever, through no fault of the funnel.

**Therefore the north-star metric is returning player-devices per week, not
accounts.** Sign-ups are a supporting metric with a known cap. This is the single
most important decision in this document; every panel below is ordered by it.

## 3. What to measure — the funnel, and what exists today

Five steps. The point of writing them out is that three of them have no marker.

| # | Step | Marker | Exists? |
|---|---|---|---|
| 1 | Arrive | `$pageview` | ✅ autocapture |
| 2 | Play something | `game_started` | ✅ `Arcade.tsx` |
| 3 | Come back another day | — | ❌ **missing** |
| 4 | Stick (streak ≥ 3, or D7) | — | ❌ **missing** |
| 5 | Bring someone | share minted → opened → claimed | ⚠️ in Neon, unread |

Steps 3 and 4 do **not** need new client state. `app/lib/streak/store.ts` already
stamps a local `YYYY-MM-DD` per calendar day from `recordPlay()`, idempotently,
and already knows the current and best streak. A returning-device event is one
capture at the existing day-boundary transition, reusing the DST-safe day maths
that is already written and tested. Building a parallel retention tracker beside
it would be the mistake.

Step 5 is the interesting one, and it does not need PostHog at all — see §4c.

## 4. Attribution — three layers, first-party only

### a. What PostHog already gives us — verify before writing anything

`posthog-js` captures referrer and campaign parameters on pageview and keeps
initial-touch equivalents as person properties. This was verified against the
installed version rather than asserted from memory — **see §0b for what the read
found.** In short: layer (a) is zero code, `ref` rides the supported
`custom_campaign_params` option, and only first-touch `ref` needs a line of ours.

The failure mode avoided is shipping our own UTM parser that shadows a built-in
one and then quietly disagrees with it.

### b. Our own `ref` taxonomy — because UTM strings do not survive a screenshot

UTM is fine for a link someone clicks. It is useless for how this audience
actually spreads a site: read off a friend's screen, typed from memory, written
on a whiteboard, pasted into a bio with the query string trimmed. So we mint
short, human-typable codes — `?ref=tiktok`, `?ref=poster` — and treat them as a
**controlled vocabulary owned by the growth page**, not free text sprayed by
whoever makes a link.

**What is in the vocabulary**, grouped the way the builder's picker shows it:

| Group | Codes |
|---|---|
| Social | `tiktok` · `youtube` · `instagram` · `twitter` |
| Messaging | `whatsapp` · `snapchat` · `telegram` · `sms` · `email` |
| Communities | `discord` · `reddit` |
| School & word of mouth | `qr` · `poster` · `friend` · `teacher` |
| Catch-all | `other` |

The messaging block is the wide one on purpose. §2 says the audience is children
on shared school devices, and a link reaches the next child in a group chat far
more often than through a bio — so the chat apps are where the split between
channels is worth having, and lumping them into `friend` would throw away the
only distinction that matters there. `teacher` is in for the same reason from the
other direction: a link handed out in class behaves nothing like one posted to
TikTok, and a single bucket would average the two into a number describing
neither.

X is tagged `twitter`, not `x`. A single character is not a readable code on a
screen, a whiteboard or in a message, and it is one keystroke away from a typo
that lands in `unknown` — the label follows the brand, the `ref` follows §4b's
own rule that codes must survive being read and retyped.

The group is a **presentation device only**: it is never written into a URL and
never reported, so regrouping a channel changes a dropdown and nothing else.

**Phase 1 stores no codes and adds no migration.** A `ref` is a string echoed
into the analytics event and nothing else. The trade-off, stated so it is a
choice rather than an oversight: unstored codes cannot be revoked or renamed, and
a typo silently becomes a new "source" that splits a channel's numbers in two.
The trigger to revisit is real usage — if the team is minting more than a handful
of codes, or wants one dead, that is when a `marketing_links` table earns itself.

Two rules that are not negotiable:

- **`ref` must never change what renders.** It is reported, never read by a
  component. The service worker serves HTML navigations network-first with a
  query-ignoring fallback match, so a cached copy can absolutely be served for a
  URL carrying a `ref` — if the parameter affected the page, the wrong page would
  be served from cache with no error.
- **`ref` must not split SEO signals.** The game page already declares a
  canonical; the same must hold for the home grid and category pages before any
  `ref` link is published, or Google sees N copies of the homepage.

No `/r/<code>` redirect route in phase 1: it would be a new dynamic route to keep
out of the precache, and `?ref=` on the real URL costs nothing.

### c. Internal share provenance — the number that is actually true

Every challenge link is a row. `kind='link'` is a share that was minted;
`kind='link_claim'` is a person who took one up; the claim path already resolves
through `POST /api/v1/me/claim`. That is a **first-party, exact, filter-proof**
record of the viral loop, sitting in Neon, read by nothing.

From it, with no new writes and no new table:

- links minted, per game and per week
- claims per link — the actual branching factor
- claim → played, claim → signed-in
- how many links were revoked (a health signal for the feature, not just growth)

**When the PostHog panel and the Neon panel disagree, the Neon panel is right.**
That hierarchy goes on the page in words, because someone will eventually ask.

## 5. The marketing tools — `/dashboard/growth`

A new admin page beside the existing overview. Same `requireRole("admin")` gate
re-checked in the page body (the layout-and-page-render-concurrently argument
from `dashboard/(app)/page.tsx` applies unchanged), `robots: { index: false }`,
and inside the `/dashboard` never-intercept prefix so the SW leaves it alone.

Why here rather than in the PostHog UI: nobody on this project opens PostHog, and
half of these numbers — the share loop, content health — are not in PostHog at
all. A dashboard that requires visiting a second dashboard is not a tool.

**Panel 1 — Link builder.** Pick a destination (home, a game, a category), pick a
channel from the controlled `ref` vocabulary, get back the tagged URL, a QR code,
and **the OG card exactly as it will render**. The preview is the point: it is how
someone finds out the homepage has no social image before they paste it into a
group chat, not after.

**Panel 2 — Acquisition.** First-touch source, entry pages, new vs returning
devices, week over week. Reuses `hogql()` and the `Delta`/sparkline primitives in
`app/lib/stats.ts` and `_charts/` — this is a new query set, not new charting.

**Panel 3 — Share loop.** The §4c numbers, straight from Neon. Labelled as the
authoritative panel.

**Panel 4 — Content health.** Not a rank tracker. A checklist over
`resolveGames()`: which games have no description, no screenshot, no video, no
tags, no reviews — i.e. which of the money pages are thin. This is the panel that
converts "we need more SEO" into a finite list of things to go and fix, and it
needs no external API at all.

## 6. Deliberately absent

- **Third-party ad/conversion pixels** — §2.
- **Email capture / newsletter** — consent for under-13s is a legal problem we
  have deliberately avoided by making sign-in Google-only and storing no email
  for players. A capture box would reintroduce it for a channel this audience
  does not use.
- **Cross-device identity stitching, fingerprinting, IP-derived identity** —
  `social/config.ts` already argues why IP is meaningless behind school NAT.
- **Search Console / rank tracking integration** — the property is already
  verified, so the data is readable **today with no code**. An in-repo integration
  needs OAuth plus a scheduler, and there is no cron anywhere in this project by
  explicit design (`notifications-design.md` §7). Read it in Google's UI; revisit
  only if a scheduler ever exists for another reason.
- **Paid acquisition** — the audience has no money, ad platforms restrict
  targeting minors, and the site has no revenue to pay back a CPM.
- **An A/B testing framework** — PostHog feature flags are already in use
  (`challenge-link-webview-escape`). Use those.
- **A `marketing_links` table** — §4b, with its revisit trigger.

## 7. Failure modes

- **No PostHog token at build.** Already loud in `instrumentation-client.ts`, and
  the deploy action already fails on it. But the growth page must **distinguish
  "zero" from "not reporting"** — show the timestamp of the most recent event
  received. A silent row of zeroes reads as "our marketing failed" when it means
  "our analytics stopped".
- **Filtered networks and blockers.** The `/ingest` proxy dodges most of it;
  what gets through is still an undercount of unknown size. Every PostHog-backed
  panel is directional. The Neon-backed panel is not.
- **Shared devices.** Never print "users". Panels say sessions or devices.
- **PostHog query cost.** `stats.ts` already revalidates on a 60s tag; new queries
  join that discipline rather than fetching per render.

## 8. Phasing — the file-by-file plan, and what shipped

Ten commits, each leaving the tree working. **All of it is built**; this table is
now a record rather than a plan.

| # | Commit | Files |
|---|---|---|
| 1 | This plan | `marketing-design.md` |
| 2 | Canonical on the home grid | `app/page.tsx` |
| 3 | The `ref` vocabulary | `app/lib/growth/channels.ts` + test |
| 4 | Capture `ref` (last- and first-touch) | `instrumentation-client.ts`, `app/lib/growth/first-touch.ts` + test |
| 5 | Retention marker | `app/lib/streak/store.ts`, `app/components/GrowthTracker.tsx`, `app/layout.tsx` + test |
| 6 | Share-loop reads | `app/lib/growth/{share-loop,config}.ts` + test |
| 7 | Acquisition reads | `app/lib/stats.ts` (export `hogql`), `app/lib/growth/acquisition.ts` |
| 8 | Content-health reads | `app/lib/growth/{content-health,content-rules}.ts` + test |
| 9 | Page building blocks | `app/dashboard/(app)/growth/_ui/{Bars,LinkBuilder}.tsx` |
| 10 | The page + nav | `app/dashboard/(app)/growth/page.tsx`, `_ui/DashNav.tsx` |

**Two things came out differently from the plan**, both from reading the code
rather than from changing our minds:

- **`streak/core.ts` was never touched.** The `days` total the retention marker
  needs was already sitting in `recordPlay`'s hands as `next.days.length`; only
  the event's detail type had to grow. The pure model is untouched and its
  existing tests never moved.
- **The pure/server-only split landed differently.** A module importing
  `server-only` cannot be loaded by Vitest at all, so the testable parts —
  `claimsPerLink`, `fillWeeks`, `isReportingHealthy`, and the whole content-health
  rule set — live in `config.ts` and `content-rules.ts` beside their server-only
  halves. That is the existing `challenges/config.ts` + `challenges/store.ts`
  pattern; it was not planned for and should have been.

**Verified after the build, not assumed:** `/` is still prerendered (`○`) despite
its new metadata export, `/dashboard/growth` is dynamic (`ƒ`) as an admin page
must be, and `public/sw-manifest.js` still carries **28** `/game/` routes —
the regression check the game page's own docblock specifies. `npm run lint`
reports the same 11 pre-existing warnings and no new ones; all 1258 tests pass.

Notes that shaped the ordering:

- **Only the home page needs a canonical.** `/game/[slug]` and
  `/category/[category]` already declare one; `app/page.tsx` exports no metadata
  at all. So commit 2 is one small addition, not the sweep §4b implied. It must
  land before any `?ref=` link is published.
- **`hogql()` in `stats.ts` is currently module-private.** Commit 7 exports it
  rather than copying it, so the 60s revalidate discipline and the
  project-selector fallback stay in one place.
- **Commit 5 touches a tested module** (`streak/core.ts` has `streak.test.ts`).
  The `days` field is additive; the existing tests must stay green untouched.
- **No migration anywhere in this plan.** Every number comes from PostHog, from
  rows the challenges feature already writes, or from `resolveGames()`.
- `/dashboard/growth` inherits the admin gate, the noindex and the SW
  never-intercept prefix by living under `/dashboard`. The page re-checks
  `requireRole("admin")` in its own body, per the concurrency argument in
  `dashboard/(app)/page.tsx`.

## 9. Not in this plan, but next

Recorded so the order is deliberate. Each of these is cheap **after** §5 exists,
and unmeasurable before it:

- **`app/opengraph-image.tsx` for the home grid and categories.** The most-shared
  URL on the site currently renders as a bare grey link in every chat app.
- **`/tag/<tag>` landing pages.** `games.ts` carries per-game tags that render
  nowhere rankable; the category page is a working template on a different axis.
- **A daily challenge.** The `kind` discriminator on `challenges` was explicitly
  built as this seam. Retention loop, legitimate push trigger, and a shareable
  artifact in one, reusing infrastructure already paid for.
- **FAQ JSON-LD on game pages.** "Does this work on a school Chromebook?" is a
  real query with an honest answer.
- **An on-site `/new` drops page.** `WhatsNewLink` currently points at a hosted
  ShipNote changelog — off-site, unindexable, and it sends traffic away.

## 10. Open questions — answered in §0, still worth confirming

These were asked before the build and answered by us when nobody was available.
The build assumes those answers; confirming or reversing any of them is cheap,
and §0 names what each one would change.

1. **Is there a short domain?** Assumed no. `ref` codes ride the full URL, and
   the QR generator is deferred with it.
2. **Which channels are actually live today?** The vocabulary in `channels.ts` is
   a guess — editing that array is the entire cost of correcting it, and history
   keeps whatever it was tagged with.
3. **Is the ad strip meant to earn?** Assumed not. Panel 2 measures returning
   devices, not session depth.
4. **Has anyone read Search Console yet?** The property is verified, so months of
   query data may already be sitting there. **This is the one item on the list
   that needs no code at all**, and it is the cheapest next thing anyone can do.

## 11. What this does NOT solve

Stated plainly so the page is not mistaken for a growth strategy.

**The catalogue is still 30 games**, and in this niche each title is its own
query. Everything built here measures and tags demand; none of it creates any.
`/add-game` already automates onboarding, and the content-health panel now names
which of the existing 30 pages are too thin to compete — but shipping more games
remains line item zero, exactly as §1 said before any of this was written.

**Nothing here has data yet.** Every panel reads real sources, and on the day it
ships every acquisition number is zero because no tagged link has been published
and no device has yet recorded a `day_played`. The share-loop and content-health
panels have history to show immediately; the analytics panels need a week and at
least one shared link before they say anything. That is expected, and the
not-reporting notice exists so an empty page cannot be misread as a broken one.
