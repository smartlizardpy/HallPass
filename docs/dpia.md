# HallPass: Data Protection Impact Assessment

> **Version 1.0, 11 October 2026.** Written from the code and the owner's stated
> design decisions, and checked against the merged code on this date. It is not
> legal advice and has not been reviewed by a solicitor. Points that need a
> decision or an outside answer are numbered **items** and tracked in section 9
> with a status, an owner and a review date. Keep this document under review
> (section 8).

Structure follows the ICO DPIA template (describe the processing; consultation;
necessity and proportionality; identify and assess risks; measures; sign-off).

## 1. Why a DPIA is needed

HallPass is a free browser-game arcade whose audience is mostly school-age
children (13 and over by the terms, but with no age check, so younger children
will use it). A DPIA is appropriate because the service involves:

- **Children's personal data**, including Google profile photos that are often
  real photographs of a child;
- **Analytics using a persistent device ID** on by default (profiling-adjacent:
  it can follow a browser across visits, though it is not linked to a named
  account);
- **User-to-user features**: friends, challenges, invite links, reviews, online
  peer-to-peer co-op, profile reports;
- **Recordings of children's screens** (beta bug clips and screenshots, which
  can show a child playing);
- **Disclosure of IP addresses** between players in co-op rooms.

The ICO's Children's Code (standard 2) expects a DPIA for services likely to be
accessed by children.

## 2. Nature of the processing

Controller: the operator of HallPass, a small team of young hobbyists, with at least one operator under 18 (item 1, accepted).
By the owner's decision the public policies name no individual, postal address
or registration, and give one contact, legal@hallpass.games (a forwarding
address). ICO registration: not registered (item 3). No data protection
officer.

Sources: the player (Google sign-in, forms, gameplay), the browser (device
storage, headers), the host (country, IP).

### 2.1 Data inventory

| Data | Source | Purpose | Lawful basis (proposed) | Recipients / processors | Retention | Where in code |
|---|---|---|---|---|---|---|
| Google account ID, email, name, avatar URL | Google sign-in | Run the account | Contract | Neon (DB), Google | Until account deleted | `app/lib/auth.ts`, `app/lib/players.sql`, `app/lib/players.ts` |
| Handle, username, friend code, profile visibility, Google-photo choice, joined/last-seen, signup country | Player; host geo header | Identity on the site; roughly where players are from | Contract; legitimate interests (country) | Neon | Until account deleted | `app/lib/players.ts`, `app/lib/handle.ts`, `app/lib/username.ts`, `app/lib/geo.ts` |
| Scores (guest name or handle, score, time, salted IP hash) | Player; request | Leaderboards; anti-cheat/spam | Legitimate interests | Neon | Scores kept after deletion with name "Deleted" | `app/lib/scoreboard/*` (`guard.ts` hashes IP) |
| Favourites, plays, achievements, streak (with time-zone offset) | Player | Features, "friends who play this", reminders | Contract | Neon | Deleted with account | `app/lib/streak/*`, `app/lib/social/*` |
| Per-game play counts and last-played times, for the "for you" order | Player's own plays, while signed in | Order the games list for the player | Contract (a feature of the account), switchable off | None: stays in the browser (`localStorage` `hp:taste`), not sent anywhere | Capped at 60 games; deleted on sign-out of the device, when switched off, or on reset | `app/lib/taste-store.ts`, `app/lib/for-you.ts` |
| Friends, blocks | Player | Social features, safety | Contract; legitimate interests (blocks) | Neon | Friends deleted with account; some block records kept | `app/lib/social/*` |
| Challenges and invites | Player | Sharing | Contract | Neon | Invites 30 min default (max 120), removed about 1 h after expiry; challenge links until switched off or account deleted | `app/lib/challenges/*`, `app/lib/invites/*`, `docs/challenge-sharing-design.md`, `docs/invites-design.md` |
| Reviews, review reports | Player | Public reviews; moderation | Contract; legitimate interests | Neon; Google Translate (review text only, on request) | Reviews deleted with account; auto-hide at 3 reporters | `app/lib/reviews/*` |
| Profile reports and moderation queue | Player | Moderation | Legitimate interests | Neon | Open reports until resolved; resolved reports deleted 90 days after resolution by a daily job; deleted with the reported player's account; the reporter link is cut when the reporter's account is deleted. Review reports: item 4 | `app/lib/profile-reports/*`, `app/api/v1/admin/profile-reports/retention/route.ts` |
| Push subscriptions (endpoint, keys, up to 10 per player) | Browser | Notifications | Consent | Neon; browser push services (Apple, Google, Microsoft, Mozilla) | Until removed or account deleted | `app/lib/push/*`, `app/lib/notifications/*` |
| Notifications | System | Notifications | Contract | Neon | Latest 100 | `app/lib/notifications/*` |
| Survey answers | Player | Improve the site | Legitimate interests | Neon | Kept; unlinked on account deletion | `app/lib/surveys/*` |
| Beta reports (text, rating, UA/device, game errors) | Tester | Fix bugs | Legitimate interests | Neon | Text kept; unlinked on deletion | `app/lib/beta/*`, `app/lib/capture/*` |
| Beta clips and screenshots | Tester (button press) | Fix bugs | Legitimate interests | Vercel Blob | 30 days if unresolved; at once when fixed/closed; on account deletion | `app/api/v1/beta/clips/[id]/route.ts`, `docs/game-recorder.md` |
| Analytics events and device ID | Browser | Count visits, returning visitors, find errors | Legitimate interests; PECR position is item 5 | PostHog (EU), via `/ingest` proxy | item 6 (PostHog retention setting) | `instrumentation-client.ts`, `next.config.ts`, `app/lib/growth/first-touch.ts` |
| Co-op signalling messages (contain network addresses) and room records, hashed player/IP | Browser | Connect two players | Contract / legitimate interests | Neon | Rooms about 3 min after host goes quiet; signals 10 min | `app/lib/p2p/*` (`ROOM_TTL_SECONDS`, `SIGNAL_TTL_SECONDS`), `docs/p2p-design.md` |
| IP address revealed to co-op peers | Browser (WebRTC) | Peer connection | Contract (the feature requested) | The other players; Cloudflare and Google STUN servers | Not stored by us | `sdk/p2p/src/client.ts`, `app/lib/p2p/config.ts` (`DEFAULT_STUN_URLS`) |
| Anonymous co-op session counts (rooms made, sessions of 2+ players, length, end reason, game) | Browser (P2P SDK via the page shell) | Understand co-op usage | Legitimate interests; not sent if the device opted out of analytics | PostHog | PostHog's retention | `app/lib/coop-telemetry.ts`, `sdk/p2p/src/telemetry.ts`, `docs/p2p-design.md` §8 |
| Server/host logs (IP, user agent) | Request | Security, operation | Legitimate interests | Vercel | item 7 (host log retention) | hosting platform |
| Device storage (`hp:*` keys, service worker cache) | Browser | Features | Strictly necessary / user-requested | None (stays on device) | Until cleared | `app/lib/personalization.ts`, `app/lib/streak/store.ts`, `app/lib/stealth/config.ts`, `app/lib/catalog-prefs.ts`, `public/sw.js` |

### 2.2 Flows and technology

Next.js app on Vercel; Postgres on Neon; PostHog EU through a first-party
`/ingest` rewrite; Google OAuth with JWT sessions (no database session store);
WebRTC data channels for co-op with database-backed signalling and STUN only (no
TURN relay; the TURN code in `app/lib/p2p/ice.ts` exists but is unused if no
TURN environment variables are set; the owner confirmed on 11 October 2026 that
production has none, item 8).
No advertising, no data sales, no automated decisions with legal effect.

## 3. Scope and context

- **Audience:** school-age children, most likely 8 to 17 in practice; the terms
  say 13+. A signed-in account needs a Google account, and many school Google
  accounts cannot sign in to third-party sites, so many players are guests.
- **Volume:** about 10 regular players at 11 October 2026 (item 9). Re-check at each review; the risk ratings assume a small, mostly known audience.
- **Vulnerabilities:** under-13s will use the site; players can be bullied or
  contacted by strangers if they share links; a Google photo can identify a
  child; school networks put many children behind one IP; children are less
  able to read policies.
- **Reasonable expectations:** children expect a game site to remember scores,
  not to reveal their photo or IP to strangers or to follow their browser. The
  design leans towards hiding by default: profiles start friends-only,
  default avatars, no public rooms.
- **Relevant context:** a minor operator without a company or guardian behind
  the service (item 1); free service, no revenue, no advertising profile.
- **Consultation:** none carried out yet (item 10).

## 4. Purposes

1. Let people play, and keep scores, streaks, friends and reviews if they sign in.
2. Keep leaderboards fair and the site safe (IP hash, rate limits, reports).
3. Understand usage, returning visitors and errors to improve the games.
4. Fix bugs reported by beta testers using screenshots and clips.
5. Let two people play together online.

Not purposes: advertising, selling data, profiling for marketing, automated
decisions about individuals.

## 5. Necessity and proportionality

- **Lawful bases** are in 2.1. Consent is used only for push notifications.
  The analytics position under PECR is unresolved (item 5).
- **Minimisation:** email and real name are never shown; the IP is stored only
  as a salted hash; PostHog is never given an identity (no `identify`); session
  recording is off and forced off in code; Google photo is
  hidden by default; no TURN relay means no third party sees
  game traffic.
- **Alternatives considered:** opt-in analytics banner (rejected by the owner
  for the default, kept as the alternative if the solicitor requires it);
  profile photos on leaderboards (removed); a TURN relay (removed to avoid a
  further processor; cost is that co-op fails on some networks).
- **Transparency:** Privacy Policy and Terms (`app/privacy/page.tsx`,
  `app/terms/page.tsx`); one-time analytics notice and co-op notice.
- **Rights:** access, correction, deletion (self-service account deletion,
  `deletePlayer` in `app/lib/players.ts`), objection and withdrawal by email.
  No self-service data download (item 11).
- **Processors:** Vercel, Neon, PostHog, Google, Cloudflare (STUN), GitHub
  (scheduled streak-reminder job; receives no player data), browser push
  services. Contracts and transfer mechanisms: item 12.

## 6. Risk register (risks to children)

Likelihood and severity: Low / Medium / High. Residual risk assumes the
mitigations are in place (all mitigations listed are in the merged code).

| # | Risk | L | S | Mitigation | Residual |
|---|---|---|---|---|---|
| R1 | **Avatars/photos:** a child's real Google photo is visible to strangers (previously on leaderboards and reviews) | High before change | High | Default meme avatar from public id; Google photo only if the player ticks the setting, only to accepted friends, never on leaderboards, reviews, non-friend lookups, challenge/invite links or co-op rooms | Low |
| R2 | **Public leaderboards and handles:** a handle or username reveals identity or is offensive; leaderboards readable by other sites | Medium | Medium | Handles/usernames filtered (`app/lib/handle.ts`, `app/lib/username.ts`); guest names; "Deleted" on deletion; terms ban personal details; moderation can rename. Filter tests pass (item 13); reports are the backstop | Medium |
| R3 | **Friends, invites, challenges:** unwanted contact; links forwarded to strangers | Medium | High | Friends are mutual and blockable; profiles start friends-only; invite links expire (30 min default); challenge links show name and score only and can be switched off; report button on profiles; admins are notified of each new profile report (reason only, no names); a moderator can reset a reported profile (clears display name and username, hides the Google photo) | Medium (links are bearer links by design) |
| R4 | **Co-op IP exposure:** peers see IP (rough location, ISP); a stranger who gets a code could harvest it | Medium | High | No public rooms, codes/links only; one-time notice before first connection; no avatar sent to peers; rooms expire; rate limits on joins and code guessing (`RATE_LIMITS`); terms rule against sharing codes | Medium |
| R5 | **Analytics and device ID:** a persistent ID tracks a child's browser; on by default; shared school machines | Medium | Medium | EU region; first-party proxy; no `identify`; no session recording (forced off in code); Analytics switch in settings clears the ID; one-time notice; no ads, no selling. Opt-out rather than opt-in is the owner's choice and PECR/Children's Code position is unconfirmed | Medium until solicitor decides (item 5) |
| R6 | **Beta recordings:** clips/screenshots can show a child, their name or private info | Low (invite only, button-press) | High | Capture only on press, game window only, no mic/camera; unguessable URLs, never rendered raw (`clips/[id]/route.ts`); deleted at 30 days, on fix/close, on account deletion; team access limited; AI tools may read reports (disclosed). No parental consent step for under-18 testers (item 14) | Medium |
| R7 | **Reviews and reports:** bullying or personal info in reviews; reports about children kept; reporter exposed | Medium | Medium | Wordlist and moderation (`app/lib/reviews/moderation.ts`, `wordlist.ts`), auto-hide at 3 reports, rate limits, report reasons, complaints email; reporter not told to the reported person; reporters of profiles are never shown to moderators or to the reported player (the id is stored for rate limits only); profile reports deleted 90 days after resolution, but review-report retention is still undefined (item 4); single human moderator who is a minor (item 1) | Medium |
| R8 | **No age check:** under-13s hold accounts or use the site without permission | High | Medium | Terms: 13+, parent permission for under-13s; delete accounts found to be under 13; Google's own age rules gate sign-in; guests collect little. Owner decision to have no check is CONFIRMED but it is a recognised gap against Children's Code standard 3 | Medium |
| R9 | **Account deletion / de-identification:** residual data after deletion (scores, analytics, backups, blobs) | Medium | Low | `deletePlayer` removes the player row (cascades) and renames scores to "Deleted"; beta clips deleted with account; analytics not linked to account. Backup retention at Neon unknown (item 15); analytics deletion by browser not self-service | Low |
| R10 | **Third parties:** Vercel, Neon (US/other processing), PostHog (EU), Google (sign-in, STUN, translate), Cloudflare (STUN), GitHub (cron), push services: transfers, breaches, onward use | Medium | Medium | EU PostHog; IP hash only; Google translate sends review text only; GitHub gets no player data; regions and transfer mechanisms to be confirmed (item 12) | Medium |
| R11 | **Operator is a minor / single person:** capacity, availability for rights requests and incidents, breach reporting | Medium | High | Name a parent/guardian or company as operator; incident process (item 1, 16) | Medium (accepted by the owner while the project stays small, item 1) |
| R12 | **Guest play with Google Sign-In:** Google API policy says mixed-audience apps must allow full access without sign-in | Low | Low | Guest play exists (checked in research notes); confirm no feature is sign-in only that Google would count as essential | Low |
| R13 | **On-device profiling ("for you" order):** a profile of a child's tastes exists on a shared school computer and the next user could see an order shaped by it; profiling of children is off by default under the Children's Code | Medium | Low | Only while signed in; stays in the browser, never sent or synced; deleted on sign-out, when switched off and on reset; states what it is on the games list and in settings; never filters, only orders; no ads or decisions use it | Low. OPEN: confirm sign-in as the opt-in is acceptable for standard 12 |

## 7. Children's Code (15 standards)

Status values: met / partly / not met / n/a. Statuses were checked against the merged code on 11 October 2026.

| # | Standard | Status | Evidence and what is outstanding |
|---|---|---|---|
| 1 | Best interests of the child | Partly | Design choices favour privacy (friends-only start, default avatars, no ads). No documented child-consultation (item 10). |
| 2 | Data protection impact assessments | Partly | This draft. Needs completion, consultation and sign-off (section 8). |
| 3 | Age-appropriate application | Not met | No age check or assurance by owner decision; 13+ stated; under-13 account deletion on discovery. Risk accepted by owner; solicitor to advise. |
| 4 | Transparency | Partly | Plain-English policy with "short version"; one-time analytics and co-op notices. No age-banded or just-in-time notices for every feature; policy reading level untested. |
| 5 | Detrimental use of data | Met (as designed) | No ads, no selling, no use against wellbeing known. Streak reminders and XP may count as engagement features: see 13. |
| 6 | Policies and community standards | Partly | Terms contain conduct rules, reporting, appeals and takedown. Enforcement is by one person; response times are not committed; no moderation log or documented process (item 16). |
| 7 | Default settings | Partly | Profile visibility defaults to friends; Google photo hidden by default; session recording off. Analytics is on by default (contrary to high-privacy default unless justified); push is off until the player agrees. |
| 8 | Data minimisation | Partly | Minimal data; no identify in analytics; hashed IPs. Device ID retained for analytics; country captured at signup. Retention periods missing for several items (items 4, 6, 7). |
| 9 | Data sharing | Partly | No sales; processors listed. Peer IP sharing in co-op is disclosed and gated by a notice. Transfer mechanisms unconfirmed (item 12). |
| 10 | Geolocation | Partly | No precise location. Country at signup from the host's geo header; co-op IP reveals approximate location to peers (first-use notice shown). |
| 11 | Parental controls | Not met | None. Parents can only contact the operator; no parent dashboard. N/A to monitoring features (none). |
| 12 | Profiling | Partly | No profiling for ads or decisions. Analytics device ID is behavioural tracking by browser; opt-out available. Personalisation is local to the device: recents and favourites, and for signed-in players a capped per-game play record that orders the games list (R13); on only for signed-in players, switchable off, deleted on sign-out. |
| 13 | Nudge techniques | Partly | Streaks, XP and rank, daily reminders and beta XP can nudge continued use. Not assessed against the Code; no nudges to weaken privacy settings known. item 17. |
| 14 | Connected toys and devices | N/A | Browser-only. |
| 15 | Online tools | Partly | Block, report review, report profile, delete account, analytics switch, email contact. No in-product way to exercise access/portability (item 11). |

## 8. Sign-off

| Item | Name / role | Date | Notes |
|---|---|---|---|
| Measures approved by | Operator: ______________  Parent/guardian: ______________ | | To be signed by hand. |
| Residual risks approved by | ______________ | | R11 is rated Medium on the basis that the project stays small (item 1); if it grows, re-rate it, and if it becomes High consider prior consultation with the ICO |
| DPO / advice | No DPO. Solicitor review not yet obtained (item 20) | | |
| Consultation with data subjects | Not yet (item 10) | | |
| Review | Operator | Next due 11 October 2027 | Also on each new feature that touches personal data, and when player numbers grow |

## 9. Decisions and follow-up actions

Status: **Decided** (settled, no further action), **Accepted** (a known gap the
owner has chosen to carry for now), **Action** (work still to do).

| # | Item | Status | Detail |
|---|---|---|---|
| 1 | Operator is a minor | Accepted | Owner decision, 11 Oct 2026: HallPass is a small hobby project run by young people, with about 10 players, and no parent, guardian or company is named as legal operator. This is a recognised gap (capacity to contract and to act as controller is unresolved, and the duties in item 3 still apply). Revisit if the audience grows, the site is promoted, any money is involved, or a complaint or rights request arrives. Solicitor advice would settle it (item 20). |
| 2 | Postal address | Decided | None published. The privacy policy and terms give an email contact only (owner decision, 11 Oct 2026). |
| 3 | ICO registration and fee | Accepted | Not registered. Whether an exemption applies has not been confirmed; the ICO self-assessment should be run. |
| 4 | Retention of resolved review reports | Action | Proposed: delete 90 days after resolution, as for profile reports. No deletion job exists yet; until it does the policy says no date is set. |
| 5 | PECR position for analytics | Accepted | Owner keeps opt-out with a notice and a settings switch. The policy states the statistics-exemption reasoning and that it will switch to opt-in if that proves wrong. |
| 6 | PostHog retention; session recording off server-side | Action | `disable_session_recording` is set in code. Set a retention period (suggest 12 months) and confirm recording is off in the PostHog project settings. |
| 7 | Vercel log retention and location | Action | Check in the Vercel dashboard and note it here. |
| 8 | No TURN in production | Decided | Confirmed by the owner, 11 Oct 2026. Update the policy before enabling TURN. |
| 9 | Volumes | Decided | About 10 players on 11 Oct 2026. |
| 10 | Consultation with children, parents, teachers | Action | None yet. At this size, ask the current players and one parent or teacher and record the answers here. |
| 11 | Self-service data export | Accepted | By email within one month. A download button is a later feature. |
| 12 | Regions and transfer mechanisms (Vercel, Neon, Google, Cloudflare, GitHub) and processor terms | Action | Record each provider's region and its standard contract terms or data-bridge status. |
| 13 | Handle, username and review filters | Decided | Automated tests pass (54 tests across `handle`, `username` and `reviews/wordlist`, run 11 Oct 2026). Filters reduce but cannot remove abuse, so reports remain the backstop. |
| 14 | Parent permission for under-18 beta testers | Accepted | No technical step. The terms and policy ask testers under 18 to check with a parent or carer first; testers are invited by hand. |
| 15 | Neon backup retention | Action | Check in Neon and note it here. |
| 16 | Moderation process and Online Safety Act | Action | See 9.1 below. A written illegal-content and children's risk assessment is still to do. |
| 17 | Nudge techniques | Decided | See 9.2 below. |
| 18 | Incident and breach procedure | Decided | See 9.3 below. |
| 19 | Pending-merge statements | Decided | Re-verified on 11 Oct 2026: avatars and Google-photo opt-in, analytics switch and notice (`app/lib/analytics-consent.ts`), session recording disabled in `instrumentation-client.ts`, co-op first-use notice (`sdk/p2p/src/notice.ts`), no way to list or browse rooms, beta media deletion in `deletePlayer`. |
| 20 | Solicitor review | Action | Not yet obtained for the policies or this DPIA. |

### 9.1 Moderation process

- Reports on reviews and profiles go to the moderation queue
  (`app/dashboard/(app)/moderation/*`). The operator is notified of new profile
  reports. Reviews with three reports are hidden automatically.
- Target: look at each report within 3 days, sooner for anything involving a
  child's safety. These are aims, not promises to the public.
- Outcomes: hide or delete a review, reset a profile, or dismiss. Appeals and
  complaints go to legal@hallpass.games and are read by a person.
- Anything that suggests a child is at risk is not handled alone: tell a
  trusted adult (the parent/guardian) and, where there is a risk of harm, the
  police or NSPCC the same day. Keep a note of what was done and when.
- A short decisions log (date, report, outcome) is kept with the report record.
  Review reports are the only category with no deletion date (item 4).

### 9.2 Nudge techniques

Streaks, XP, ranks and daily reminders encourage regular play. Assessment: the
reminders are push notifications that are off until the player agrees, are
about the player's own streak, and can be turned off in settings; no nudge
discourages a player from changing a privacy setting; there are no countdown
pressure tactics, purchases or social-pressure messages. Risk: low. Revisit if
streak rewards or notification volume increase.

### 9.3 Incident and breach procedure

1. Contain: revoke the affected keys or tokens, disable the affected feature,
   rotate the database credentials if they could be exposed.
2. Assess within 24 hours: what data, whose, how many, and whether children are
   affected.
3. If the breach is likely to risk people's rights, report it to the ICO within
   72 hours of becoming aware (ico.org.uk, 0303 123 1113). If the risk is high,
   tell the affected players or their parents directly, in plain language.
4. Record every incident here with date, cause, effect and the fix, even when
   no report is needed.
5. Who: the operator, with the parent/guardian informed at once.
