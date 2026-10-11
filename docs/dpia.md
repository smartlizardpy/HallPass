# HallPass: Data Protection Impact Assessment (DRAFT)

> **DRAFT. Not legal advice.** Written from the code and the owner's stated
> design decisions by someone who is not a lawyer. A solicitor, or a review
> against the ICO's DPIA template, must complete it before it is relied on.
> Anything the code and docs could not settle is marked **OPEN ITEM** and
> collected in section 9. Statements marked **(pending merge)** describe
> features built in parallel workstreams (default avatars, analytics switch,
> co-op notice, beta clip deletion) and must be re-verified
> against the merged code.

Version: draft 1, 11 October 2026.
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

Controller: Ozan Kaygusuz (an individual under 18; see OPEN ITEM 1), contact
smartlizardpy@duck.com. Postal address: OPEN ITEM 2. ICO registration: OPEN
ITEM 3. No data protection officer.

Sources: the player (Google sign-in, forms, gameplay), the browser (device
storage, headers), the host (country, IP).

### 2.1 Data inventory

| Data | Source | Purpose | Lawful basis (proposed) | Recipients / processors | Retention | Where in code |
|---|---|---|---|---|---|---|
| Google account ID, email, name, avatar URL | Google sign-in | Run the account | Contract | Neon (DB), Google | Until account deleted | `app/lib/auth.ts`, `app/lib/players.sql`, `app/lib/players.ts` |
| Handle, username, friend code, profile visibility, Google-photo choice (pending merge), joined/last-seen, signup country | Player; host geo header | Identity on the site; roughly where players are from | Contract; legitimate interests (country) | Neon | Until account deleted | `app/lib/players.ts`, `app/lib/handle.ts`, `app/lib/username.ts`, `app/lib/geo.ts` |
| Scores (guest name or handle, score, time, salted IP hash) | Player; request | Leaderboards; anti-cheat/spam | Legitimate interests | Neon | Scores kept after deletion with name "Deleted" | `app/lib/scoreboard/*` (`guard.ts` hashes IP) |
| Favourites, plays, achievements, streak (with time-zone offset) | Player | Features, "friends who play this", reminders | Contract | Neon | Deleted with account | `app/lib/streak/*`, `app/lib/social/*` |
| Friends, blocks | Player | Social features, safety | Contract; legitimate interests (blocks) | Neon | Friends deleted with account; some block records kept | `app/lib/social/*` |
| Challenges and invites | Player | Sharing | Contract | Neon | Invites 30 min default (max 120), removed about 1 h after expiry; challenge links until switched off or account deleted | `app/lib/challenges/*`, `app/lib/invites/*`, `docs/challenge-sharing-design.md`, `docs/invites-design.md` |
| Reviews, review reports | Player | Public reviews; moderation | Contract; legitimate interests | Neon; Google Translate (review text only, on request) | Reviews deleted with account; auto-hide at 3 reporters | `app/lib/reviews/*` |
| Profile reports and moderation queue | Player | Moderation | Legitimate interests | Neon | Open reports until resolved; resolved reports deleted 90 days after resolution by a daily job; deleted with the reported player's account; the reporter link is cut when the reporter's account is deleted. Review reports: OPEN ITEM 4 | `app/lib/profile-reports/*`, `app/api/v1/admin/profile-reports/retention/route.ts` |
| Push subscriptions (endpoint, keys, up to 10 per player) | Browser | Notifications | Consent | Neon; browser push services (Apple, Google, Microsoft, Mozilla) | Until removed or account deleted | `app/lib/push/*`, `app/lib/notifications/*` |
| Notifications | System | Notifications | Contract | Neon | Latest 100 | `app/lib/notifications/*` |
| Survey answers | Player | Improve the site | Legitimate interests | Neon | Kept; unlinked on account deletion | `app/lib/surveys/*` |
| Beta reports (text, rating, UA/device, game errors) | Tester | Fix bugs | Legitimate interests | Neon | Text kept; unlinked on deletion | `app/lib/beta/*`, `app/lib/capture/*` |
| Beta clips and screenshots | Tester (button press) | Fix bugs | Legitimate interests | Vercel Blob | 30 days if unresolved; at once when fixed/closed; on account deletion (pending merge) | `app/api/v1/beta/clips/[id]/route.ts`, `docs/game-recorder.md` |
| Analytics events and device ID | Browser | Count visits, returning visitors, find errors | Legitimate interests; PECR position is OPEN ITEM 5 | PostHog (EU), via `/ingest` proxy | OPEN ITEM 6 (PostHog retention setting) | `instrumentation-client.ts`, `next.config.ts`, `app/lib/growth/first-touch.ts` |
| Co-op signalling messages (contain network addresses) and room records, hashed player/IP | Browser | Connect two players | Contract / legitimate interests | Neon | Rooms about 3 min after host goes quiet; signals 10 min | `app/lib/p2p/*` (`ROOM_TTL_SECONDS`, `SIGNAL_TTL_SECONDS`), `docs/p2p-design.md` |
| IP address revealed to co-op peers | Browser (WebRTC) | Peer connection | Contract (the feature requested) | The other players; Cloudflare and Google STUN servers | Not stored by us | `sdk/p2p/src/client.ts`, `app/lib/p2p/config.ts` (`DEFAULT_STUN_URLS`) |
| Server/host logs (IP, user agent) | Request | Security, operation | Legitimate interests | Vercel | OPEN ITEM 7 (host log retention) | hosting platform |
| Device storage (`hp:*` keys, service worker cache) | Browser | Features | Strictly necessary / user-requested | None (stays on device) | Until cleared | `app/lib/personalization.ts`, `app/lib/streak/store.ts`, `app/lib/stealth/config.ts`, `app/lib/catalog-prefs.ts`, `public/sw.js` |

### 2.2 Flows and technology

Next.js app on Vercel; Postgres on Neon; PostHog EU through a first-party
`/ingest` rewrite; Google OAuth with JWT sessions (no database session store);
WebRTC data channels for co-op with database-backed signalling and STUN only (no
TURN relay; the TURN code in `app/lib/p2p/ice.ts` exists but is unused if no
TURN environment variables are set, **OPEN ITEM 8: confirm in production**).
No advertising, no data sales, no automated decisions with legal effect.

## 3. Scope and context

- **Audience:** school-age children, most likely 8 to 17 in practice; the terms
  say 13+. A signed-in account needs a Google account, and many school Google
  accounts cannot sign in to third-party sites, so many players are guests.
- **Volume:** OPEN ITEM 9 (current player and visitor counts).
- **Vulnerabilities:** under-13s will use the site; players can be bullied or
  contacted by strangers if they share links; a Google photo can identify a
  child; school networks put many children behind one IP; children are less
  able to read policies.
- **Reasonable expectations:** children expect a game site to remember scores,
  not to reveal their photo or IP to strangers or to follow their browser. The
  design leans towards hiding by default: profiles start friends-only,
  default avatars (pending merge), no public rooms (pending merge).
- **Relevant context:** a minor operator without a company or guardian behind
  the service (OPEN ITEM 1); free service, no revenue, no advertising profile.
- **Consultation:** none carried out yet (OPEN ITEM 10: ask players and
  parents/teachers).

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
  The analytics position under PECR is unresolved (OPEN ITEM 5).
- **Minimisation:** email and real name are never shown; the IP is stored only
  as a salted hash; PostHog is never given an identity (no `identify`); session
  recording is off and forced off in code (pending merge); Google photo is
  hidden by default (pending merge); no TURN relay means no third party sees
  game traffic.
- **Alternatives considered:** opt-in analytics banner (rejected by the owner
  for the default, kept as the alternative if the solicitor requires it);
  profile photos on leaderboards (removed); a TURN relay (removed to avoid a
  further processor; cost is that co-op fails on some networks).
- **Transparency:** Privacy Policy and Terms (`app/privacy/page.tsx`,
  `app/terms/page.tsx`); one-time analytics notice and co-op notice (pending
  merge).
- **Rights:** access, correction, deletion (self-service account deletion,
  `deletePlayer` in `app/lib/players.ts`), objection and withdrawal by email.
  No self-service data download (OPEN ITEM 11).
- **Processors:** Vercel, Neon, PostHog, Google, Cloudflare (STUN), GitHub
  (scheduled streak-reminder job; receives no player data), browser push
  services. Contracts and transfer mechanisms: OPEN ITEM 12.

## 6. Risk register (risks to children)

Likelihood and severity: Low / Medium / High. Residual risk assumes the
mitigations are in place (pending-merge items count only once merged).

| # | Risk | L | S | Mitigation | Residual |
|---|---|---|---|---|---|
| R1 | **Avatars/photos:** a child's real Google photo is visible to strangers (previously on leaderboards and reviews) | High before change | High | Default meme avatar from public id; Google photo only if the player ticks the setting, only to accepted friends, never on leaderboards, reviews, non-friend lookups, challenge/invite links or co-op rooms (pending merge) | Low |
| R2 | **Public leaderboards and handles:** a handle or username reveals identity or is offensive; leaderboards readable by other sites | Medium | Medium | Handles/usernames filtered (`app/lib/handle.ts`, `app/lib/username.ts`); guest names; "Deleted" on deletion; terms ban personal details; moderation can rename. Handle filter coverage is untested here (OPEN ITEM 13) | Medium |
| R3 | **Friends, invites, challenges:** unwanted contact; links forwarded to strangers | Medium | High | Friends are mutual and blockable; profiles start friends-only; invite links expire (30 min default); challenge links show name and score only and can be switched off; report button on profiles; admins are notified of each new profile report (reason only, no names); a moderator can reset a reported profile (clears display name and username, hides the Google photo) | Medium (links are bearer links by design) |
| R4 | **Co-op IP exposure:** peers see IP (rough location, ISP); a stranger who gets a code could harvest it | Medium | High | No public rooms, codes/links only; one-time notice before first connection; no avatar sent to peers; rooms expire; rate limits on joins and code guessing (`RATE_LIMITS`); terms rule against sharing codes (pending merge for notice and public-room removal) | Medium |
| R5 | **Analytics and device ID:** a persistent ID tracks a child's browser; on by default; shared school machines | Medium | Medium | EU region; first-party proxy; no `identify`; no session recording (forced off, pending merge); Analytics switch in settings clears the ID; one-time notice; no ads, no selling. Opt-out rather than opt-in is the owner's choice and PECR/Children's Code position is unconfirmed | Medium until solicitor decides (OPEN ITEM 5) |
| R6 | **Beta recordings:** clips/screenshots can show a child, their name or private info | Low (invite only, button-press) | High | Capture only on press, game window only, no mic/camera; unguessable URLs, never rendered raw (`clips/[id]/route.ts`); deleted at 30 days, on fix/close, on account deletion (pending merge); team access limited; AI tools may read reports (disclosed). No parental consent step for under-18 testers (OPEN ITEM 14) | Medium |
| R7 | **Reviews and reports:** bullying or personal info in reviews; reports about children kept; reporter exposed | Medium | Medium | Wordlist and moderation (`app/lib/reviews/moderation.ts`, `wordlist.ts`), auto-hide at 3 reports, rate limits, report reasons, complaints email; reporter not told to the reported person; reporters of profiles are never shown to moderators or to the reported player (the id is stored for rate limits only); profile reports deleted 90 days after resolution, but review-report retention is still undefined (OPEN ITEM 4); single human moderator who is a minor (OPEN ITEM 1) | Medium |
| R8 | **No age check:** under-13s hold accounts or use the site without permission | High | Medium | Terms: 13+, parent permission for under-13s; delete accounts found to be under 13; Google's own age rules gate sign-in; guests collect little. Owner decision to have no check is CONFIRMED but it is a recognised gap against Children's Code standard 3 | Medium |
| R9 | **Account deletion / de-identification:** residual data after deletion (scores, analytics, backups, blobs) | Medium | Low | `deletePlayer` removes the player row (cascades) and renames scores to "Deleted"; beta clips deleted with account (pending merge); analytics not linked to account. Backup retention at Neon unknown (OPEN ITEM 15); analytics deletion by browser not self-service | Low |
| R10 | **Third parties:** Vercel, Neon (US/other processing), PostHog (EU), Google (sign-in, STUN, translate), Cloudflare (STUN), GitHub (cron), push services: transfers, breaches, onward use | Medium | Medium | EU PostHog; IP hash only; Google translate sends review text only; GitHub gets no player data; regions and transfer mechanisms to be confirmed (OPEN ITEM 12) | Medium |
| R11 | **Operator is a minor / single person:** capacity, availability for rights requests and incidents, breach reporting | Medium | High | Name a parent/guardian or company as operator; incident process (OPEN ITEM 1, 16) | High until resolved |
| R12 | **Guest play with Google Sign-In:** Google API policy says mixed-audience apps must allow full access without sign-in | Low | Low | Guest play exists (checked in research notes); confirm no feature is sign-in only that Google would count as essential | Low |

## 7. Children's Code (15 standards)

Status values: met / partly / not met / n/a. Statuses assume pending-merge items
land; re-check after merge.

| # | Standard | Status | Evidence and what is outstanding |
|---|---|---|---|
| 1 | Best interests of the child | Partly | Design choices favour privacy (friends-only start, default avatars, no ads). No documented child-consultation (OPEN ITEM 10). |
| 2 | Data protection impact assessments | Partly | This draft. Needs completion, consultation and sign-off (section 8). |
| 3 | Age-appropriate application | Not met | No age check or assurance by owner decision; 13+ stated; under-13 account deletion on discovery. Risk accepted by owner; solicitor to advise. |
| 4 | Transparency | Partly | Plain-English policy with "short version"; one-time analytics and co-op notices (pending merge). No age-banded or just-in-time notices for every feature; policy reading level untested. |
| 5 | Detrimental use of data | Met (as designed) | No ads, no selling, no use against wellbeing known. Streak reminders and XP may count as engagement features: see 13. |
| 6 | Policies and community standards | Partly | Terms contain conduct rules, reporting, appeals and takedown. Enforcement is by one person; response times are not committed; no moderation log or documented process (OPEN ITEM 16). |
| 7 | Default settings | Partly | Profile visibility defaults to friends; Google photo hidden by default (pending merge); session recording off. Analytics is on by default (contrary to high-privacy default unless justified); push is off until the player agrees. |
| 8 | Data minimisation | Partly | Minimal data; no identify in analytics; hashed IPs. Device ID retained for analytics; country captured at signup. Retention periods missing for several items (OPEN ITEMS 4, 6, 7). |
| 9 | Data sharing | Partly | No sales; processors listed. Peer IP sharing in co-op is disclosed and gated by a notice (pending merge). Transfer mechanisms unconfirmed (OPEN ITEM 12). |
| 10 | Geolocation | Partly | No precise location. Country at signup from the host's geo header; co-op IP reveals approximate location to peers (notice pending merge). |
| 11 | Parental controls | Not met | None. Parents can only contact the operator; no parent dashboard. N/A to monitoring features (none). |
| 12 | Profiling | Partly | No profiling for ads or decisions. Analytics device ID is behavioural tracking by browser; opt-out available (pending merge). Personalisation (recents, favourites) is local. |
| 13 | Nudge techniques | Partly | Streaks, XP and rank, daily reminders and beta XP can nudge continued use. Not assessed against the Code; no nudges to weaken privacy settings known. OPEN ITEM 17. |
| 14 | Connected toys and devices | N/A | Browser-only. |
| 15 | Online tools | Partly | Block, report review, report profile, delete account, analytics switch (pending merge), email contact. No in-product way to exercise access/portability (OPEN ITEM 11). |

## 8. Sign-off

| Item | Name / role | Date | Notes |
|---|---|---|---|
| Measures approved by | OPEN ITEM (owner and parent/guardian) | | |
| Residual risks approved by | OPEN ITEM | | If high residual risk remains (R11), ICO prior consultation must be considered |
| DPO / advice | No DPO. Solicitor review: OPEN ITEM | | |
| Consultation with data subjects | OPEN ITEM | | |
| DPIA to be kept under review | OPEN ITEM (suggest on each new feature that touches data and at least yearly) | | |

## 9. Open items

1. Operator is a minor: capacity to contract and act as controller. Suggest a
   parent/guardian or company as legal operator. Solicitor.
2. Postal address for the policy and terms.
3. ICO registration and data protection fee: required or exempt?
4. Retention period for resolved REVIEW reports. (Profile reports: decided, 90 days after resolution.)
5. PECR position for analytics (statistical-purposes exemption added by the
   Data (Use and Access) Act 2025, only confirmed from secondary sources) versus
   an opt-in banner; Children's Code high-privacy-default implications.
6. PostHog data retention setting; confirm in project settings that session
   recording is also off server-side.
7. Vercel log retention and location.
8. Confirm production has no TURN configuration (`P2P_TURN_*`), so "no relay"
   is true; confirm `P2P_STUN_URLS` default.
9. Player and visitor volumes.
10. Consultation with children, parents and teachers.
11. Self-service data export (currently by email).
12. Regions and transfer mechanisms for Vercel, Neon, PostHog, Google,
    Cloudflare, GitHub; processor contracts (DPAs).
13. Test handle/username filters and review wordlist coverage.
14. Parental permission for under-18 beta testers (no step in code).
15. Neon backup retention and deletion behaviour.
16. Moderation process: response times, logging, escalation (including child
    safety concerns and who deals with them), Online Safety Act duties
    (illegal-content and children's risk assessments; whether the features are
    user-to-user in scope).
17. Assessment of streaks, XP and reminders as nudge techniques.
18. Incident and breach procedure and who reports to the ICO.
19. Re-verify every "(pending merge)" statement against the merged code.
