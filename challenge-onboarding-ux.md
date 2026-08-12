# Challenge links — onboarding UX

How Bob gets from a tap in a Snapchat story to an account with his score on it.

Companion to `challenge-sharing-design.md`, which settled *what* is built and how
it is modelled. This document is only about the funnel: the evidence, the honest
numbers, every screen and branch, the copy, and what to measure. It assumes the
four locked decisions in that document's §3 and does not relitigate them —
except in §9, where the research says one of them exposes something it should
not.

---

## 1. Research findings

Read this part first. The design in §3 onwards is downstream of it, and the
numbers in §2 are only defensible because of it.

### 1.1 Play-first beats gate-first, and the size of the win is known

This is the best-evidenced decision in the whole flow.

- **Duolingo moved the signup prompt to after the first lesson and got a ~20%
  lift in daily active users / next-day retention.** The detail that matters is
  the structure: *soft walls* that can be dismissed with "Later", followed by a
  *hard wall* several lessons in — and the hard wall converted better *because*
  the soft walls had primed it.
  ([relaunch.ai teardown](https://relaunch.ai/blog/duolingo-onboarding-teardown-7-b-tests-behind-their-9-conver.html),
  [salesflare](https://blog.salesflare.com/duolingo-iconic-product-e3df449017df))
- **The "$300 million button":** a large retailer replaced a forced-registration
  step with guest checkout and saw a 45% lift in purchases. Around **24% of
  abandoners cite "was asked to create an account"** as the reason.
  ([corbado](https://www.corbado.com/blog/guest-checkout-vs-forced-login),
  [wcart](https://blog.wcart.io/guest-checkout-vs-account-creation/))
- **The classroom analogue is already the norm.** Kahoot, Blooket and Gimkit all
  let a student play with a code and a nickname and no account; the account is
  only needed to *keep* things (coins, history, cosmetics). Our audience has
  already been trained by these three that "code → play in under 30 seconds, sign
  in only if you want it saved" is how school games work.
  ([pdfquiz comparison](https://pdfquiz.com/blog/blooket-vs-gimkit-vs-kahoot),
  [triviamaker](https://triviamaker.com/blooket-vs-gimkit-vs-kahoot/))
- **Wordle is the closest consumer precedent**: play anonymously, and the sign-in
  offer arrives *after* the puzzle is solved, framed as saving stats and the
  streak. ([tomsguide](https://www.tomsguide.com/how-to/how-to-save-wordle-streak-across-devices))

**What the evidence does *not* say.** None of these give a "% of anonymous
players who convert on the value moment" number. Duolingo's 20% is a DAU lift,
not a signup rate. I searched for a direct benchmark on "claim your score"
prompts in web games and found nothing credible — the gaming conversion
literature is almost entirely about *payment* conversion (1–6%), which is a
different behaviour with a different cost.
([sonamine](https://www.sonamine.com/blog/improving-your-conversion-rate-guide-for-game-developers),
[gamesbrief](https://www.gamesbrief.com/2011/11/conversion-rate/))
The step-E estimates in §2 are therefore reasoned, not benchmarked, and are
labelled as such.

### 1.2 Referral / invite-link benchmarks — the calibration numbers

- **In-product viral sharing (the closest category to a challenge link): 3–8%
  click → conversion.** Mobile gaming referral links: 25–45% click → *install*
  (install is not an account). Social/messaging apps top the table at 30–55%.
  Median across all referral programmes: **3–5%**.
  ([M Accelerator](https://maccelerator.la/en/blog/entrepreneurship/referral-vs-viral-growth-conversion-rate-comparison/),
  [ReferralCandy](https://www.referralcandy.com/blog/referral-program-benchmarks-whats-a-good-conversion-rate-in-2025/))
- **K-factor reality check:** 0.15–0.25 is good, 0.4 great, ~0.7 outstanding,
  >1.0 is self-sustaining and essentially never happens.
  ([Viral Loops](https://viral-loops.com/blog/referral-program-metrics/))
- **Snapchat *paid* swipe-up CTR is 0.35–1.5%.**
  ([BeProfit](https://d256dq6lpbdor2.cloudfront.net/a/community/tracking/snapchat-ads-what-is-considered-a-good-swipe-up-rate))
  This is the *floor*, not the estimate — a named friend's message in a group
  chat is a completely different object from an ad. I could not find a published
  benchmark for organic friend-to-friend link taps in teen group chats. §2's
  step A is explicitly an assumption.
- **PLG activation** (share of signups who reach a meaningful milestone) runs
  **25–40%**. ([userpilot](https://userpilot.com/blog/saas-user-onboarding-funnel/))

### 1.3 Timing the ask: peak motivation

- **Fogg's B = MAP.** Behaviour happens when motivation, ability and a prompt
  converge. Motivation "buys you the right to ask for harder behaviours — but
  it's a loan that gets called in fast."
  ([Triple Whale](https://www.triplewhale.com/blog/fogg-behavior-model),
  [koji.so](https://www.koji.so/docs/fogg-behavior-model-guide))
- **Peak–end rule** (Kahneman & Fredericksen, 1993): an experience is
  remembered by its most intense moment and its ending, not its average. Design
  implication: place the peak deliberately and make the ending good.
  ([NN/g](https://www.nngroup.com/articles/peak-end-rule/))
- **The hardest number here comes from the app-rating literature**, which is the
  best-studied "ask at a good moment" problem: prompts fired **after a completed
  value event convert 3–5× better than prompts fired on session count**. Never
  prompt on first launch, during onboarding, or after an error.
  ([Strataigize](https://www.strataigize.com/blog/app-store-rating-strategy),
  [Appbot](https://appbot.co/blog/prompting-for-ratings-prompt-early-or-wait/))
- **One caveat, and it partly cuts against us.** That same source says fire
  *30–90 seconds after* the milestone, "not in the same UI frame". I think that
  guidance is about *unrelated* asks — a rating request is a favour to the
  developer, so it needs breathing room. Our ask is the *completion* of the value
  event: the score exists but is unsaved, and signing in is how you keep it. Same
  frame is right here. **But this is genuinely arguable and is the number one
  thing to A/B test** (see §7).

### 1.4 Friction: every step costs

- Baymard: each extra form field costs ~1–2% conversion; other studies put it at
  3–7%. The relationship is non-linear — conversion falls modestly from 23.1% at
  3 fields to 17.0% at 5, then **collapses to 11.4% at 7 fields**.
  ([digitalapplied](https://www.digitalapplied.com/blog/form-conversion-rate-benchmarks-2026-data-points))
- HubSpot: 11 fields → 4 fields = +120% conversions. 7 → 3 fields cut funnel
  abandonment 44.7%. ([same](https://www.digitalapplied.com/blog/form-conversion-rate-benchmarks-2026-data-points))
- **Social login lifts signup 20–40% over email/password**; Heap's 2025 SaaS
  benchmark across 79 sites found +8.2% from adding one-click OAuth; Pinterest
  reported +47% web signups from Google One Tap, Reddit +90% on desktop.
  ([corbado](https://www.corbado.com/blog/social-login-conversion-rate),
  [Auth0](https://auth0.com/blog/how-to-use-social-login-to-drive-your-apps-growth/))
  Google-only auth is therefore the *right* auth if it works. §1.6 is about it
  not working.

### 1.5 In-app webviews: what actually happens in 2026

- **Google has refused OAuth from embedded WebViews since 2016 and hard-enforced
  it since ~September 2021.** `WKWebView` and the deprecated `UIWebView`
  explicitly do not comply with Google's secure-browser policy. The error is
  `403: disallowed_useragent`, "Google can't sign you in safely inside this app."
  ([Google OAuth policies](https://developers.google.com/identity/protocols/oauth2/policies),
  [Google Developers Blog](https://developers.googleblog.com/upcoming-security-changes-to-googles-oauth-20-authorization-endpoint-in-embedded-webviews/))
- **It is still enforced in 2026, and there is nothing a site can do about it.**
  "There is no setting on your end that turns this off. It is enforced on
  Google's side, for every website's Google login, inside these apps." Snapchat's
  UA string carries `Snapchat`; Instagram, Messenger and LINE are all affected.
  ([TrueLink, 2026](https://truelink-group.com/en/blog/why-google-login-fails-in-line-facebook-in-app-browsers-2026/),
  [Butler University IT](https://butleru.my.site.com/askbutler/s/article/Google-Sign-in-Error-disallowed-useragent))
- **What Google *does* accept:** `SFSafariViewController` on iOS and Chrome
  Custom Tabs on Android. Those are the host app's choice, not ours. Snapchat,
  Instagram and TikTok all use their own WebView, which is the whole point of
  their in-app browser. ([Google OAuth policies](https://developers.google.com/identity/protocols/oauth2/policies))
- **The `x-safari-https://` escape is unreliable and partly patched.** Reports
  are contradictory and version-dependent: it works on some iOS versions, "on
  iOS 16 this apparently does not work", and it still works on iOS 26 on several
  iPhone models — but **Instagram actively intercepts and blocks it**. The
  general pattern is that "each trick spreads, and each stops working."
  ([Paul's Weblog, via search summary](https://paul.af/escape-in-app-browsers),
  [dev.to](https://dev.to/jplogix/escaping-instagrams-in-app-browser-on-ios-and-why-its-so-hard-58om))
  I could not fetch either of those pages directly (blocked by this environment's
  egress proxy) and am relying on the search engine's extraction, so **treat the
  iOS-version specifics as soft.**
- **Android:** `intent://…#Intent;scheme=https;package=com.android.chrome;end`
  hands the URL to the OS rather than following it in the current webview, and
  the OS opens the right app or falls back to Chrome. This is the documented,
  supported mechanism and is more reliable than anything on iOS.
  ([U2L](https://u2l.ai/blog/how-to-disable-in-app-browser))
- **TikTok has no user-facing escape at all** — no global toggle, by design,
  because handing the user to Chrome ends the session and session time is
  TikTok's metric. Instagram/Facebook/X do have a setting, but no teenager has
  changed it. ([U2L](https://u2l.ai/blog/instagram-link-opens-in-browser))

**Net:** the hop is worth attempting and must never be depended on. §5 sizes it.

### 1.6 School Google accounts — the biggest structural cap on this funnel

This one is worse than expected and deserves to change the roadmap.

- **Google Workspace for Education blocks users designated as under 18 from
  signing in to *unconfigured* third-party apps, by default.** An "unconfigured"
  app is any app the school's admin has not explicitly marked trusted, limited or
  blocked. Rolled out August 2023 with an admin deadline of **23 October 2023**.
  ([Google Workspace Updates](https://workspaceupdates.googleblog.com/2023/08/third-party-app-access-enhancements-for-google-workspace-edu.html),
  [Admin Help](https://support.google.com/a/answer/13288950?hl=en))
- **The error the kid sees is:** *"Access blocked: Your institution's admin needs
  to review [app name]."* Their only in-product option is "Request access", which
  queues a review in the school's Admin console.
  ([Classwork support](https://support.classwork.com/support/solutions/articles/72000610498-fixing-an-access-blocked-your-institution-s-admin-needs-to-review-error-popup),
  [Dr Frost Learning](https://support.drfrost.org/hc/en-gb/articles/4941417754399-I-get-an-Access-blocked-pop-up-when-trying-to-sign-in-with-Google))
- Since **19 November 2024**, admins can delegate approval to educators via proxy
  requests. ([Workspace Updates](https://workspaceupdates.googleblog.com/2024/11/request-access-to-third-party-apps-on-behalf-of-students.html))

**HallPass is an unblocked-games site whose headline feature disguises the screen
from teachers. No school IT admin will ever approve it.** For any kid on a school
Workspace account this is not friction, it is a permanent wall. On school
Chromebooks — which the brief names as a primary surface — the Google account in
the browser *is* the school account.

- **Under-13s on Family Link are gated too**, though less absolutely: supervised
  children can sign in to third-party apps only with a parent's approval, either
  per-app or via a blanket toggle in Family Link.
  ([Android Police](https://www.androidpolice.com/2021/06/10/google-accounts-for-kids-can-now-finally-sign-into-third-party-apps/),
  [Google For Families](https://support.google.com/families/answer/9043123?hl=en))

**Consequences for this design** (all of them are in §4 and §6):
1. Force the account chooser (`prompt=select_account`) so nobody is silently
   pushed into their school account.
2. Warn *before* the tap, in one plain line.
3. Detect the failure and recover specifically, not generically.
4. **Recommend a non-Google path on the backlog.** This is the single biggest cap
   on the ceiling in §2 and no amount of copy fixes it.

### 1.7 Minors, privacy, and what the copy is allowed to do

- The **ICO Children's Code** (in force 2 September 2020) covers any UK service
  "likely to be accessed by children", i.e. under-18s. It explicitly says **nudge
  techniques must not be used to push children into providing unnecessary
  personal data or weakening privacy settings**, and may be used to promote the
  *high*-privacy option. ([ICO](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/),
  [Evalian](https://evalian.co.uk/childrens-code/))
- **COPPA** (US, under-13) requires verifiable parental consent before collecting
  personal information — which is what Family Link's approval gate is
  implementing on Google's side.
  ([ConnectSafely](https://connectsafely.org/google-now-letting-parents-set-up-accounts-for-kids-under-13/))

Practical rules this imposes on the flow, all of which are also good UX:
no dark patterns on the dismiss ("Maybe later" is a real button, same weight
class as the CTA); the friend-add is opt-in and never pre-ticked; no email
capture as a signup fallback; and **§9.3 — the avatar on a public link should not
be a child's Google profile photo.**

### 1.8 Sharing and preview mechanics

- **Web Share API** (`navigator.share`) requires transient activation — it must
  fire from a click — and is HTTPS-only. Support is good on Chrome Android
  (since 2017) and Safari iOS 12.2+ (2019); Firefox is the gap. Feature-detect
  and fall back to clipboard.
  ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Share_API),
  [LogRocket](https://blog.logrocket.com/advanced-guide-web-share-api-navigator-share/))
  `ShareChallenge.tsx` in the existing plan already does exactly this.
- **OG cards:** communities that ship proper Open Graph previews report **2–3×
  the click-through** of broken/generic ones; a missing image or wrong title
  "undermines trust before the user even clicks."
  ([BuddyBoss](https://buddyboss.com/blog/open-graph-image-for-community-platforms/))
  The dynamic `opengraph-image.tsx` is not polish — it is a 2–3× multiplier on
  step A, the largest single number in the funnel.

### 1.9 PWA install and push

- **Install prompts shown after engagement (2+ pages) lift install rate by
  >30%**; custom prompts over the bare browser one report up to 6× more
  home-screen adds (Lancôme +17% A2HS, MakeMyTrip 3×).
  ([web.dev](https://web.dev/articles/promote-install),
  [digitalapplied](https://www.digitalapplied.com/blog/progressive-web-apps-2026-pwa-performance-guide))
- Overall PWA install funnels land around **12% of visitors**, and iOS is well
  below that because Add to Home Screen is a manual 4+ tap Share-sheet journey
  with no programmatic prompt.
  ([deepclick](https://deepclick.com/resources/blog/progressive-web-application-guide/),
  [brainhub](https://brainhub.eu/library/pwa-on-ios))
- **iOS web push requires the PWA be installed to the home screen** (iOS 16.4+);
  push does not work from a Safari tab.
  ([Pushpad](https://pushpad.xyz/blog/ios-special-requirements-for-web-push-notifications))
- **Pre-permission priming raises opt-in 2–3×** (cold ask 35–45% → primed
  60–75%), and contextual timing "can almost triple push opt-ins compared to
  first-launch prompts."
  ([Plotline](https://www.plotline.so/blog/how-to-improve-push-notification-opt-in-rates),
  [PushEngage](https://www.pushengage.com/ios-push-notification-permission/))
  `FeaturePromo.tsx:469` already implements exactly this rule for notifications
  ("only ask once somebody has actually been challenged"). Do not weaken it.

### 1.10 Retention benchmarks, for the activation argument

D1 retention across all mobile games averaged **27%** in 2025; casual/hypercasual
30–40% is healthy; top-quartile 26–28%, bottom quartile 10–11.5%.
([Segwise](https://segwise.ai/blog/mobile-gaming-app-user-retention-strategies),
[Liftoff 2025 casual report](https://liftoff.ai/2025-casual-gaming-apps-report/))

---

## 2. The honest conversion estimate

### 2.1 What "activated" should mean, and why

**Primary activation event: `challenge_score_claimed` — Bob signed in *and* at
least one of his guest scores got attached to the new account, in the same
session as the link.**

Argument against each alternative:

| Candidate | Why not primary |
| --- | --- |
| Signed in | Hollow. He can sign in and the claim can still fail — and the claim is the entire thing we promised him. An account with no score is a worse outcome than we told him he was getting. |
| Posted a score | Too weak. It is the *value* step, not the *activation* step. It is the guardrail metric (§7), not the goal. |
| **Claimed a score** | **The only event that proves the whole chain worked**: guest score → claim token survived → OAuth completed → claim transaction → challenge resolution. It is strictly downstream of "posted a score" and strictly downstream of "signed in", so it subsumes both. |
| Added Alice as a friend | Consent-shaped. Making it the KPI creates institutional pressure to nag a child into a social connection, which is precisely what the ICO nudge guidance is about (§1.7). Track it; never target it. |
| Came back a second day | This is the real north star, and it should be the *secondary* metric. But it is lagging by definition, it is not link-attributable once the account exists, and at this volume you cannot iterate weekly on it. |
| Installed the PWA | Downstream of everything and platform-limited (§1.9). A vanity metric for this funnel. |

**So: primary = claimed score. Secondary/north-star = D2 return of
link-originated accounts. Guardrail = `challenge_play_started /
challenge_link_opened`, which must never fall while you optimise the primary.**

### 2.2 The truth about "90% guaranteed onboarding"

It is not achievable and it is not close. Here is the arithmetic rather than the
opinion.

**The best step in this entire funnel — a one-button page with no gate, tapping
straight into a game — tops out around 80–85%.** Some fraction of people who tap
a link in a group chat are curious about the *card*, not the game; some are on
a bus; some are in a lesson. Even if every other step were 100%, the ceiling on
"tapped the link → is now playing" is roughly **0.97 × 0.85 ≈ 82%**.

There are six steps. 90% end-to-end would require every one of them to average
**98.3%**. The best-documented comparable funnels in the industry — in-product
viral sharing — run **3–8% click-to-conversion** (§1.2). 90% is not an ambitious
version of that; it is about 15× the top of the band.

**There is exactly one metric here that can hit 90%, and it is worth adopting
as the team's target because it is the one this design can actually move to the
ceiling:**

> **≥95% of link taps render Alice's face, her score and one button in under two
> seconds, with nothing else on the page.**

Everything after that is a multiply of human choice against a wall of platform
constraints that Google, Apple, Snapchat and school IT departments control and
we do not.

### 2.3 Step-by-step estimate

Floor = this shipped badly. Realistic = this shipped as designed below. Ceiling =
every step at the best number I can defend, which will not co-occur.

| # | Step | Floor | **Realistic** | Ceiling | Basis |
| --- | --- | --- | --- | --- | --- |
| A | Sees Alice's post → taps the link | 8% | **20%** | 40% | **Assumption.** Paid Snapchat swipe-up is 0.35–1.5% (§1.2) and is the floor, not the estimate. A named friend + a face + a number in a group chat is a different object. Good OG card worth 2–3× here (§1.8). |
| B | Tap → landing usable | 80% | **92%** | 97% | School wifi, webview hop failures, cold serverless start |
| C | Landing → tapped "Beat it" | 45% | **68%** | 85% | One button, no gate, no account ask (§1.1) |
| D | "Beat it" → posted a score | 55% | **72%** | 88% | Game load, rage-quit, distraction |
| E | Score → tapped sign-in **(blended)** | 10% | **28%** | 45% | Reasoned, not benchmarked (§1.1) |
| E1 | — of those who beat Alice | 20% | **40%** | 60% | Peak motivation + a thing to lose |
| E2 | — of those who did not | 5% | **14%** | 25% | Weaker offer, third-attempt escalation only |
| F | Tapped sign-in → OAuth completed | 45% | **70%** | 85% | `disallowed_useragent` (§1.5), school Workspace block (§1.6), Family Link, popup blockers |
| G | OAuth → score claimed | 85% | **93%** | 98% | In-memory token; requires the never-navigate rule (§6.2) |

**End to end, from link tap (B) to claimed score (G):**

| | Floor | **Realistic** | Ceiling |
| --- | --- | --- | --- |
| Link tap → activated account | **0.8%** | **8.2%** | **27%** |
| Link tap → played a game at all | 20% | **45%** | 82% |
| Link tap → posted a score | 20% | **45%** | 73% |

**Target: 7–10% of link taps become claimed accounts.** That sits at or above the
top of the published in-product-viral band (3–8%, §1.2) and is a genuinely good
outcome. Anything above 12% sustained means either the estimate was wrong or Bob
mostly already had an account.

**The number to actually put on a wall:** *45% of link taps end with someone
playing a HallPass game.* That is the real reach of the feature, it is honest,
and it is the number the design can push hardest.

**K-factor sanity check.** If a sharer posts one link and it is seen by ~15
people, at 20% tap × 8% activation, that is ~0.24 new accounts per sharer per
link — squarely in the "good" band (0.15–0.25) and nowhere near self-sustaining
(§1.2). Growth from this feature is real and additive, not exponential. Plan
accordingly.

**Where the ceiling actually lives.** Step F. If Google-only auth stays, a
meaningful minority of this exact audience — school-Workspace under-18s, and
under-13s on Family Link — **cannot complete sign-in at all, ever, on the account
their device is signed into.** No copy fixes that. §6.4 is the recommendation.

---

## 3. The flow, screen by screen

Notation: **[P]** primary button, **[S]** secondary, *(italic)* is a note, not
copy. All copy is final-draft, not placeholder.

### 3.0 The card in the chat *(not a screen, but step A is 40% of the funnel)*

`app/c/[code]/opengraph-image.tsx`. Alice's avatar (see §9.3), her handle, the
score, the game art, and the word "Beat it" rendered into the image so it reads
as a button even though it isn't one.

```
og:title        Alice scored 4,200 on Snake
og:description  Tap to try. No account needed.
```

"No account needed" is in the description on purpose: it removes the anticipated
cost *before* the tap, which is where the cost is being weighed.

### 3.1 Landing — `/c/<code>` — anonymous Bob

Server-rendered, identical HTML for everyone (per `challenge-sharing-design.md`
§6). One screen, no scroll, no nav, no cookie banner, no `FeaturePromo`.

```
                    ( avatar )
                     @alice

                      4,200
                      Snake

              [P]  Beat it

        No account. No sign-up. Just play.
```

*On tap: fire the webview hop if applicable (§5), then hand off client-side via
`useOpenGame()`. Never a query param — `/game/[slug]` is prerendered.*

*Preload the game bundle on landing render, not on tap. The landing is excluded
from the precache anyway, so there is no offline cost, and it buys ~300–800ms on
school wifi.*

### 3.2 In the game

A small persistent chip, top-right, outside the game canvas. It is the only
overlay.

```
  @alice  4,200          ← while behind
  Ahead of alice          ← the moment Bob's live score crosses it
```

The chip crossing over **is the peak** (§1.3). Mark it, do not interrupt it. No
modal, no confetti mid-run, no sound. Interrupting a run to congratulate someone
is how you lose the run and the peak together.

### 3.3a Result — **beat it**

Full screen, over the finished game. This is the one moment the whole feature
exists for.

```
              You beat Alice.

              4,510 to 4,200

   Sign in to put it on the board with your
   name on it — and send one back.

        [P]  Sign in with Google
        [S]  Play again

   Use a personal Google account. School ones
   are usually blocked.

   Right now this score only lives in this tab.
```

Rules for this screen:
- **Nothing else is on it.** No friend ask, no install, no username, no
  notifications, no nav. One ask (§4.3).
- The school-account line is not a warning banner, it is quiet grey text under
  the button. It costs nothing and it is the difference between a confused kid
  and a kid who taps the right account (§1.6).
- "Right now this score only lives in this tab" is honest, is the actual
  mechanic, and is a loss frame — which is the correct frame, because the loss is
  real.
- **`[S] Play again` must not navigate.** It restarts the game in place. A
  navigation destroys the claim token and with it every score of the session.

### 3.3b Result — **didn't beat it**

```
              3,880.

              Alice has 4,200. 320 off.

        [P]  Try again
        [S]  Sign in to save your scores
```

- Primary is "Try again", not sign-in. He has nothing worth keeping yet and
  asking now spends the ask for nothing (§1.3: never prompt after a failure).
- The sign-in offer is a quiet text link, not a button.

**On the third attempt without beating it**, and only once, `[S]` upgrades:

```
        [P]  Try again
        [S]  Three goes in. Sign in and they all count.
```

This is literally true: `claim.ts` accepts up to `MAX_CLAIM_TOKENS = 20` tokens
in one request, so hold every attempt's token in memory and claim the lot. By
attempt three there is real sunk cost and a real thing to keep — a weaker peak,
but a genuine one. **Never escalate a fourth time.**

### 3.4 Sign-in

**This is the most fragile step in the product and the rule is absolute: the page
holding the claim tokens must never navigate.**

- Open `/play/signin` via `<a target="_blank">` from the direct gesture, falling
  back to `openAuthPopup()`. A new tab from a real user gesture is blocked far
  less often than `window.open` on mobile, and on mobile Safari a popup opens as
  a tab regardless. The existing three-transport signal
  (`BroadcastChannel` / `localStorage` / `postMessage` — `sdk/src/auth-flow.ts`)
  works across tabs identically.
- Append `prompt=select_account` **always**. Without it, a kid on a school
  Chromebook is silently handed into the account that cannot work (§1.6).
- The opener shows a waiting state, not a spinner-with-no-words:

```
        Finishing up in the other tab.

        [S]  Cancel
```

- On signal, the opener calls `/api/v1/me/claim` with every held token, then
  renders 3.5. **Claim from the opener, never from the popup** — the popup is a
  different page context and has none of the tokens.

### 3.5 Post-signin — same page, score confirmed

```
              Locked in.

        4,510 — #3 on Snake

        [P]  Send one back to Alice
        [S]  Play again

        Signed in as bob. Not you? Sign out.
```

- The rank is the reward. Show it if it's good; if he's #47, show
  "4,510 — saved to your account" instead. Never show a humiliating rank at the
  peak.
- "Not you? Sign out" is there because this may be a shared school laptop, and
  it is the same instinct that made the claim token in-memory in the first place.
- The handle step (display name) is handled inside the popup by
  `/play/auth/complete`, exactly as the `/play/welcome` docblock already
  prescribes for popup players. **The username step does not happen here** (§4.4).

### 3.6 The friend ask — one screen later

After 3.5 has rendered and the score is confirmed safe. Not simultaneously.

```
        Add @alice?

        You'll see each other's scores.

        [P]  Add alice     [S]  No thanks
```

Both buttons the same visual weight. Never pre-ticked, never automatic, never
shown twice. If dismissed, it is gone — the friend code path still exists later.

### 3.7 Return — Bob's second visit

Nothing special. He is now an ordinary player and the existing surfaces take
over: `FeaturePromo` becomes eligible on visit 2 (`bumpVisits() >= 2`), the
username nag fires when it fires, push is offered only once someone has actually
challenged him. **Do not build a special second-session experience for
link-originated users.** It will not move the number and it is a second codepath
to keep alive.

---

## 4. Timing and sequencing rules

Each rule, then the reason.

### 4.1 The sign-in ask fires exactly once per outcome, in the results frame

**When:** immediately on the results screen (3.3a / 3.3b), same frame as the
score. **Why:** motivation is a loan called in fast (Fogg, §1.3), and prompts
after a completed value event convert 3–5× those fired on a session counter
(§1.3). **Caveat, stated honestly:** the same literature says wait 30–90s and
change frames. I believe that applies to unrelated asks and not to one that *is*
the completion of the value event — but this is the single highest-value A/B test
in §7.

### 4.2 The sign-in ask never fires before a score exists

Not on landing, not on game load, not on rage-quit, not on exit intent. There is
nothing to keep, so the ask is pure cost (§1.1: 24% of abandonment is "was asked
to create an account"). **Explicitly: if Bob quits before scoring, he sees the
landing again with `[P] Go again` and nothing else.**

### 4.3 One ask per screen. Never two.

Never in the same breath:
- sign-in + notifications
- sign-in + add-a-friend
- sign-in + username
- friend + install
- install + notifications ("install so you can get notified so you know
  when…" is three asks wearing a coat)

**Why:** the field-count cliff (§1.4) — the marginal cost of an ask rises
non-linearly, and 5→7 costs ~2.8 points apiece against ~1.5 before it.
`FeaturePromo.tsx:496` already enforces the equivalent rule in-product ("a
dismissed variant must not fall through to another on the same page load"). Same
principle, applied to a funnel instead of a modal.

### 4.4 The username step never happens in this flow

Popup players get the handle step only, at `/play/auth/complete`. **Why:** the
`/play/welcome` docblock already argues it — a handle is coerced and cannot fail;
a username is a claim on a unique namespace and can fail repeatedly. A "that name
is taken, try another" loop landing three seconds after "You beat Alice" converts
the peak into an error state. The existing `username` variant of `FeaturePromo`
picks it up on a later visit, which is exactly right.

### 4.5 The friend ask is one screen after the claim, once, opt-in

**Why:** the score has to be visibly safe before anything else is asked, or the
second ask reads as a condition on the first. And consent is not implied by
having clicked a link (`challenge-sharing-design.md` §5); the ICO nudge guidance
(§1.7) means the dismiss must be a real, equal-weight option.

### 4.6 PWA install: not this session. Second visit at the earliest.

Leave `FeaturePromo`'s `bumpVisits() >= 2` gate exactly as it is, and add `/c/`
to `SUPPRESSED_PREFIXES`. **Why:** install prompts after engagement lift installs
>30% (§1.9), and on iOS install is a manual 4+ tap Share-sheet journey. Asking a
first-time visitor for that in the same session as a sign-up is the most reliable
way to lose both.

### 4.7 Push: unchanged. Only after someone has actually been challenged.

`FeaturePromo.tsx:469` already does this and its comment is right: prompting on
arrival spends the one permission prompt a player will ever get, and a denial is
close to permanent. Priming raises opt-in 2–3× and contextual timing nearly
triples it (§1.9). On iOS it is two gates deep anyway (install → then push).
**Do not touch this to serve the challenge funnel.**

### 4.8 Nothing at all is asked of a *returning* link opener

If Bob taps a second challenge link next week and is already signed in, the flow
is landing → play → score → resolve → done. No asks. §3.8 below.

---

## 5. The webview hop — and what to do when it fails

Locked decision #4 (hop on the "Beat it" tap, not page load) is correct, and the
research strengthens the reasoning: a gesture is required, and at that instant
there is genuinely nothing to carry across. This section is only about failure.

**Attempt order on "Beat it":**

| Platform | Attempt |
| --- | --- |
| iOS | `x-safari-https://hallpass…/c/<code>?hop=1` |
| Android | `intent://hallpass…/c/<code>?hop=1#Intent;scheme=https;package=com.android.chrome;end`, then the same without `package=` |

**Hard bail-out, 1200ms.** Register `visibilitychange` and `pagehide` before
firing. If the page is still visible after 1200ms, the hop failed: **open the
game right here, in the webview, immediately.** A silent failed hop that leaves a
kid staring at a page that did nothing is strictly worse than never trying.

Mark the session `auth_hostile = true` and change one thing downstream: on 3.3a,
the primary becomes

```
        [P]  Open in your browser to keep it
        [S]  Play again

   Snapchat's browser won't let you sign in.
   You'll need one more go out there — sorry.
```

That copy is unpleasant and it is honest, which is the trade. It also fires a
second hop attempt from a fresh gesture, which is a genuinely better chance than
the first (different moment, sometimes a different code path).

**Expected value is low.** `x-safari-https://` is patched in Instagram and
version-inconsistent on iOS (§1.5); TikTok has no escape at all. **Put the hop
behind a PostHog feature flag on day one** and kill it if
`challenge_escape_result = stayed` dominates — a hop that fails 80% of the time
is a 1.2s delay tax on the highest-traffic step in the funnel.

**Optional, needs a security decision — do not build without sign-off.** The
in-memory claim token exists so a shared school computer cannot leak the previous
kid's scores. That rationale is about *persisted device state*. A **single-use,
60-second, server-minted handoff code carried in the fragment of the escape URL**
persists nothing on the device and is handed by the OS to exactly one browser,
once. It would let the post-score hop preserve the score rather than costing a
replay. It is a real loosening of the model and I am flagging it rather than
assuming it. The default design above does not need it.

---

## 6. Every other branch

### 6.1 External / cross-origin game — no claim token

**Recommendation: do not mint challenge links for boards backed by a
cross-origin game at all.** No claim token means the anonymous→account conversion
is structurally impossible; a link for such a board is a funnel with the last
three steps removed. Shipping it means knowingly shipping a dead end to the exact
new users this feature exists to recruit.

Implementation: the Share action on `/play/you` standings rows is absent for
those boards, with a "?" that says:

> Challenge links only work on games we host.

The alternative — allow the link and invert the order ("sign in first if you want
this to count") — reintroduces the gate the whole feature is built to avoid, on
the surface where the gate is most likely to be a `disallowed_useragent` wall.
Cut it.

### 6.2 OAuth blocked by a school account

Cannot be detected before the attempt. Can be recovered after: the popup/tab
closes with no signal, and a re-check of `/api/v1/me` still says signed out.

```
        That account can't sign in here.

        School Google accounts are usually
        blocked from apps like this. Try a
        personal one.

        [P]  Try a different account
        [S]  Not now
```

`[P]` re-opens with `prompt=select_account`. `[S]` returns to 3.3a with the score
still held in memory — **do not clear the tokens on a failed sign-in.**

Same screen serves the Family Link case; "ask a parent" is not worth a separate
branch and adds a word children will not act on in the next five seconds.

### 6.3 Popup / new tab blocked

`openAuthPopup()` returns null, or the tab never appears.

```
        Your browser blocked the sign-in window.

        [P]  Try again
```

`[P]` retries from a fresh gesture. Do **not** offer a same-tab redirect as a
fallback — it navigates, which kills every claim token and silently loses the
score. If the retry fails too, fall through to 6.2's copy with the honest note
that he will need to play once more elsewhere.

### 6.4 The structural recommendation on auth

Google-only auth caps step F at ~85% for the general population and at **0%** for
kids whose device is signed into a school Workspace account. The lowest-cost
second path that fits a minors product is **passkeys (WebAuthn)** — no email, no
password, no PII at all, which is *better* under the ICO code than what exists
today. Honest caveats: passkeys do not work in hostile webviews either, they are
unfamiliar to this audience, and on a managed school Chromebook they are messy.
It is not a silver bullet; it is the only option that does not require collecting
a child's email address. **Backlog, not this feature — but it is the item that
raises the ceiling most.**

### 6.5 Bob already has an account

Detected client-side on the landing (server HTML stays identical, per
`challenge-sharing-design.md` §6).

```
                    ( avatar )
                     @alice
                      4,200
                      Snake

              Your best: 3,100

              [P]  Beat it
```

No sign-in ask anywhere in this branch — `resolveForScore` closes the challenge
live on submission. Result screen:

```
              You beat Alice.
              4,510 to 4,200

        [P]  Send one back
        [S]  Add alice          ← only if not already friends
```

Cheapest branch to build, highest value per user. Build it first.

### 6.6 Bob is the link owner

```
              This one's yours.

              4,200 on Snake
              14 opened · 3 beat you

        [P]  Share it again
        [S]  Turn it off
```

Never let the owner claim their own link.

### 6.7 Link revoked, missing or malformed

Not an error page. A visitor who followed a dead link from a chat is a visitor.

```
              That challenge is gone.

        [P]  Play Snake anyway
        [S]  See the arcade
```

If the board is unknown, `[P]` becomes "See the arcade".

### 6.8 Bob rage-quits before scoring

Back to 3.1 with `[P] Go again` and nothing else. **No sign-in ask, no exit-intent
modal, no "wait!" interstitial.** There is nothing to keep and an interstitial on
the way out of a kids' site is the single sleaziest thing in this document's
solution space.

### 6.9 Slow connection

- The landing renders avatar, score and button from server HTML with no JS
  required. Budget: LCP < 1.5s on simulated 3G.
- The game's loading state carries the target: **"Loading Snake — beat 4,200"**.
  Never a blank screen and never a bare spinner; the target is the reason he is
  waiting.
- Preload the game bundle on landing render (§3.1).

### 6.10 Offline

`/c/<code>` is deliberately outside the precache. The offline page, when the
requested path starts with `/c/`, says:

```
        No connection right now.

        The challenge will still be here.

        [P]  Try again
```

### 6.11 Two kids, one laptop

Covered by 3.5's "Signed in as bob. Not you? Sign out." — visible on the result
screen, not buried in a menu. It is the same instinct that made the claim token
in-memory, applied to the UI.

---

## 7. What to instrument

Snake_case, matching the existing convention (`game_started`, `feature_promo_shown`).

### 7.1 Events

| Event | Properties |
| --- | --- |
| `challenge_link_shared` | `board`, `surface` (web_share \| clipboard), `source` (standings \| picker) |
| `challenge_link_opened` | `board`, `link_state` (live \| revoked \| missing), `viewer` (anon \| signed_in \| owner), `webview` (none \| instagram \| snapchat \| tiktok \| facebook \| other), `platform`, `target_score` |
| `challenge_landing_rendered` | `lcp_ms`, `preload_hit` |
| `challenge_escape_attempted` | `platform`, `method` (x_safari \| intent_chrome \| intent_generic) |
| `challenge_escape_result` | `outcome` (left \| stayed \| unknown) |
| `challenge_play_started` | `board`, `target_score`, `attempt`, `auth_hostile` |
| `challenge_score_posted` | `board`, `score`, `target_score`, `beat` (bool), `attempt`, `token_minted` (bool) |
| `challenge_result_shown` | `outcome` (beat \| missed \| missed_escalated), `attempt` |
| `challenge_signin_offered` | `outcome`, `attempt`, `variant` (google \| open_browser) |
| `challenge_signin_tapped` | `outcome`, `attempt`, `transport` (new_tab \| popup) |
| `challenge_signin_result` | `result` (success \| popup_blocked \| closed_no_signal \| still_signed_out \| timeout \| error) |
| `challenge_score_claimed` | `board`, `score`, `tokens_presented`, `tokens_claimed`, `rank`, `resolved_challenge` (bool) |
| `challenge_claim_failed` | `reason` |
| `challenge_friend_offered` / `challenge_friend_added` / `challenge_friend_declined` | — |
| `challenge_rematch_sent` | `board` |
| `challenge_link_dead_shown` | `link_state` |

**Never log the raw code or the owner's id.** Hash the code; use `public_id` for
players, per the existing wire rule.

**`challenge_signin_result: still_signed_out` is the school-account proxy.** We
cannot observe Google's block directly — the failure happens in a window we don't
own. This event is the best available signal for §1.6, and its share of step F is
the number that decides whether §6.4 gets built.

### 7.2 The funnel

PostHog ordered funnel, **30-minute conversion window**, on the anonymous distinct
id:

```
challenge_link_opened
  → challenge_play_started
  → challenge_score_posted
  → challenge_signin_tapped
  → challenge_score_claimed
```

Breakdowns that matter, in order of usefulness: **`webview`**, **`beat`**,
`platform`, `attempt`, `auth_hostile`.

**Identity stitching is load-bearing and easy to get wrong.** Call
`posthog.identify(publicId)` **in the opener, immediately after the claim
succeeds** — never in the popup. The popup is a different page context with its
own anonymous distinct id; identifying there aliases the wrong person and the
funnel silently breaks at exactly the last step.

**Guardrail chart, pinned next to the funnel:**
`challenge_play_started / challenge_link_opened`. If an experiment on the sign-in
ask moves the primary up and this down, the experiment lost.

**Retention, separately:** a PostHog retention cohort of players whose first
`challenge_score_claimed` was link-originated, measured on any `game_started` at
D1/D2/D7. Benchmark against §1.10 (27% D1 all-games, 30–40% casual).

### 7.3 The experiments, in priority order

1. **Sign-in ask in the results frame vs. 45s later / after "Play again".** This
   is the one point where the literature and I disagree (§1.3, §4.1). Settle it
   with data.
2. **Kill or keep the webview hop.** Flag it from day one (§5).
3. **Third-attempt escalation on/off** for non-beaters (3.3b) — measure both the
   sign-in lift and the *retry rate*, because the risk is that it costs attempts.
4. **OG card variants** — score-forward vs. face-forward. Worth 2–3× on step A
   (§1.8), which makes it worth more absolute users than anything in steps C–G.
5. Copy on the primary button: "Sign in with Google" vs. "Keep this score".

Do not run 1–5 until the funnel in §7.2 has clean data for a week. Copy tests on
an uninstrumented funnel are guessing with extra steps.

---

## 8. What to cut

Ruthlessly. Every one of these is fun to build and none of them will move the
number.

- **Per-link leaderboards.** Already excluded in `challenge-sharing-design.md`
  §12 and the exclusion is right. A link is a duel with one number.
- **A nickname / "enter your initials" screen before playing.** Thematically
  perfect, arcade-authentic, and a form field in front of the value moment
  (§1.4). It also cannot be kept without an account, so it promises something the
  system does not deliver. Cut.
- **Rematch chains and auto-rematch.** One rematch button on 3.5 is the whole
  feature. Chains are a graph problem in service of a fantasy.
- **Expiry timers and countdowns.** No cron (constraint), revocation is the
  control, and urgency theatre aimed at children is exactly the nudge pattern the
  ICO code names (§1.7).
- **"12 people are playing right now" live counters.** Websocket infrastructure
  for a social-proof line that will read "1 person" most of the time.
- **An onboarding tour, feature carousel or value-prop list on the landing.** The
  landing has one job and adding a second one costs step C directly.
- **Email capture as an auth fallback.** No infrastructure for it, and collecting
  a minor's email address in order to send them re-engagement nags is the single
  worst idea available under §1.7. If a second auth path is built, build §6.4.
- **Persisting a guest identity in `localStorage` so scores survive the tab.**
  Directly contradicts the shared-school-computer decision that made the claim
  token in-memory. This will be proposed by someone; the answer is no.
- **QR codes for the challenge link.** Real use case in a classroom, near-zero
  volume phone-to-phone. Post-v1 at best.
- **Animated OG previews / video cards.** Snapchat and iMessage will not render
  them reliably and a static card that always works beats a moving one that
  sometimes does.
- **A bespoke second-session experience for link-originated users.** The existing
  `FeaturePromo` ladder already handles visit two correctly. A parallel codepath
  is a maintenance liability in exchange for a rounding error.
- **Exit-intent anything.**

---

## 9. Where the research disagrees with the plan

Four things. The first three are amendments; the fourth is a real objection.

### 9.1 "Convert on the win" leaves ~70% of scorers with no moment

Locked decision #1 is well-evidenced and correct in direction. But if Alice's
score is any good, most people will not beat it, and "on the win" gives you
nothing for them. That is the difference between a blended step-E of 14% and 28%.

**Amendment, not reversal:** keep the win as the strong trigger, add the
third-attempt escalation in 3.3b as a weak one (§3.3b), fire each at most once.
This is Duolingo's soft-wall/hard-wall structure (§1.1) at the scale of a single
session.

### 9.2 The results-frame ask contradicts one piece of the timing literature

The app-rating research is the hardest evidence available on ask timing and it
says *30–90 seconds after the milestone, not in the same frame* (§1.3). I have
argued in §4.1 why I think it does not apply, but I am not confident enough to
present it as settled. It is experiment #1 in §7.3.

### 9.3 **A challenge link publishes a child's Google profile photo to anyone with the URL**

This is the objection.

Locked decision #3 says the link shows the owner's handle, avatar and score, and
`challenge-sharing-design.md` §7 correctly reasons that this is the same exposure
`/u/<username>` already accepts. **But `/u/` is a page you have to find, and a
challenge link is a page designed to be pasted into a public Snapchat story.**
The exposure is the same in kind and completely different in scale — that is the
whole point of the feature.

Existing player accounts are Google sign-in only. **Google avatars are frequently
real photographs of the account holder.** So the feature as specified takes a
minor's photograph and attaches it to a URL that the product actively encourages
them to broadcast, plus renders it into an OG card that Snapchat, WhatsApp and
iMessage will cache on other people's devices. `noindex` does not help — it stops
search engines, not people.

**Recommendation, and I would treat this as blocking:** on `/c/<code>` and its OG
image, render a **derived** avatar — the initial on a colour from the handle
hash, or the existing badge art — never the Google photo, unless the player has
explicitly set a non-Google avatar. It costs one branch in one component. Under
the ICO code this is the "promote the high-privacy option" case, which is the one
kind of nudge the code explicitly endorses (§1.7).

Locked decision #3 survives with "avatar" redefined. The pitch is still "beat
*me*" and a handle plus a coloured initial carries that fine.

### 9.4 The Google-only constraint contradicts the ambition, not the design

Not a locked decision, but it is the binding constraint on §2 and it deserves to
be said plainly rather than buried: **a school Workspace under-18 account cannot
sign in to HallPass, and never will be able to, because the block clears only
when a school IT admin approves the app, and no school IT admin will approve an
unblocked-games site with a teacher-evasion feature** (§1.6). Every kid whose
phone or Chromebook is signed into their school account is permanently at 0% on
step F. The design in §6.2 makes that failure legible and recoverable *if they
have a personal account to switch to*. §6.4 is what to do if they don't.

---

## 10. Summary of the five decisions that matter

| # | Decision | Evidence | Worth |
| --- | --- | --- | --- |
| 1 | **The ask is "keep the thing you just made", not "make an account"** — fired on the results frame, once per outcome, with nothing else on the screen. | Duolingo +20% DAU from deferred signup with soft→hard walls; $300M button (+45%); 24% of abandonment is "was asked to create an account"; post-value-event prompts 3–5× session-count prompts (§1.1, §1.3) | The whole of step E. Getting this wrong costs ~2× on the primary metric. |
| 2 | **The page holding the claim tokens never navigates.** New tab / popup sign-in, claim from the opener, `[Play again]` restarts in place, no same-tab redirect fallback ever. | The claim token is in-memory by design; a navigation is a 100% loss of the thing being sold (§3.4, §6.3) | Step G: ~0% → 93%. The largest single number in the document. |
| 3 | **Force the account chooser and pre-warn about school accounts** — `prompt=select_account` always, one grey line under the button, a specific recovery screen. | Workspace Education blocks under-18s from unconfigured third-party apps by default; "Access blocked: Your institution's admin needs to review…"; HallPass will never be approved (§1.6) | Several points on step F, and it converts "the site is broken" into "use your other account". |
| 4 | **Only mint links for same-origin games.** | No claim token cross-origin means the last three funnel steps cannot exist (§6.1) | Removes an unfixable branch before it ships. Free. |
| 5 | **Reassign the 90% target to "tap → playing", and publish 45% as the reach number.** | Even the friendliest step tops out ~82%; six steps at 90% needs 98.3% each; published in-product viral sharing is 3–8% (§2.2) | Stops the team optimising a number that cannot be reached and starts them optimising the one that can. |
