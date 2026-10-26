# Fright Fest event hub: UX research (b)

**Evidence caveat.** Fetches of publisher pages (Fortnite news, gov.uk, ICO) returned 403/404, and Wikipedia pages were thin on UI detail. Items are labelled **[fetched]** (backed by a page I read) or **[unverified]** (my recall of how games present; test before relying on it).

## 1. Hub information architecture
- **First screen (recommended, unverified):** event title and skin; one phase chip ("LIVE, closes Sun 1 Nov"); one primary button ("Play a ranked game"); a "your status" strip (rank per board, points, packs unlocked). Below the fold: the three boards, rewards/packs, Candy Hunt, rules/odds/FAQ.
- **One main action:** one filled pixel button; everything else is text links or ghost buttons. Splatfest centres on one join/pick decision [fetched: Splatoon 3 article says players join one of three teams and earn points over three days, https://en.wikipedia.org/wiki/Splatoon_3; the UI itself is unverified].
- **Phase without a giant countdown:** a four-step stepper (Upcoming, Live, Closed, Results) with the current step lit, plus one date line ("Ends 1 Nov, results by 5 Nov"). Show days-left only in the last 48h, small. Destiny 2's Faction Rally is framed as a week-long event where factions compete for points, not as a timer [fetched: https://en.wikipedia.org/wiki/Destiny_2].
- **Results pending:** primary button becomes "See provisional standings"; chip reads "Verifying, results by 5 Nov".

## 2. Arcade leaderboards
- **Top 3:** larger rows, gold/silver/bronze pixel medals, rank as big arcade digits; ranks 4-10 plain. Trackmania Nations put the top five on its homepage and awards medals for set times [fetched: https://en.wikipedia.org/wiki/Trackmania]. Arcade initials tables: unverified.
- **You outside the top 10:** pin a "YOU: #37, 215 pts" row under the top 10 behind a dotted divider, plus "N pts to reach #36". [unverified: Clash Royale, Tetris 99]
- **Empty state:** "No scores yet. First place is open." showing 100/80/65 points. **Provisional:** a visible PROVISIONAL stamp on the table header and one line, "Checked after close, final by 5 Nov"; do not rely on colour alone.
- **Kid-safe names:** show only the existing moderated display name or a 3-10 char handle; no uploaded avatars, no profile links; offer "hide me" (shown as "Player 1234"). State the tie-break in one sentence.

## 3. Quest board (Candy Hunt, not built)
- **Card anatomy:** icon + verb-first title ("Beat 300 in Crypt Run"); game tag; one-line condition; reward chip (candy); difficulty as 1-3 pumpkins; progress bar with numbers ("120/300"); DONE stamp overlay. Order: in progress, not started, done (collapsed).
- **Scaling:** easy 1-3 candy, medium 5, hard 10 (illustrative, mine). Hades' opt-in Pact of Punishment: harder settings yield rarer rewards [fetched: https://en.wikipedia.org/wiki/Hades_(video_game)].
- **Not homework:** show at most ~6 cards; all optional, tied to games already played; no daily reset, no penalty for skipping; candy never gates ranking. Monster Hunter / Destiny bounty boards as models: unverified (bounties absent from the fetched Destiny article).

## 4. Two currencies at a glance
- One two-column panel: **"Fright Points = your rank. Earned by placing on boards. Can't be spent."** vs **"Candy = your shopping. Earned by challenges. Spend on packs."** Different icons, colours and places (points on boards, candy on the shop).
- Precedent for separation: Destiny 2 keeps faction points (rivalry) apart from Glimmer/Trials tokens spent on gear [fetched: Destiny page above]; Hades separates run-only from permanent currency [fetched: Hades page above].
- Rules: candy is never purchasable, and the page says so; points never convert to candy.

## 5. Guaranteed vs random rewards
- Two shelves: **Guaranteed** (Participation Pack, Champion Packs, with exactly what earns each) and **Random contents** (3 cards; odds table beside the pack, not behind a link).
- Norms: UK industry principles (Ukie, July 2023) say disclose loot-box presence before purchase and publish probabilities, with parental consent for under-18 purchases; they apply to paid boxes, including those bought with purchased virtual currency [fetched via search summary: https://www.lewissilkin.com/insights/2023/07/24/new-uk-principles-and-guidance-on-loot-boxes-published-102ik8a]. UK law has not classed loot boxes as gambling; the 2022 DCMS review asked industry for odds transparency and spend controls; South Korea and China mandate odds [fetched: https://en.wikipedia.org/wiki/Loot_box].
- Position (my reading, not legal advice): free, non-tradable packs probably fall outside these rules, but publishing odds, "no purchase ever" and "cards have no cash value" is cheap and protective. Get legal confirmation.

## 6. Dark patterns to avoid
- **Fake urgency:** the UK CMA found Wowcher's countdown timers and "running out" claims created a false impression of urgency [fetched: https://en.wikipedia.org/wiki/Dark_pattern]. Real deadlines are fine; state them calmly, once.
- **Lopsided nudges:** ICO Children's Code nudge standard (numbered 12 or 13 depending on version) bars nudging children toward weaker privacy or unneeded data; its example is a big green "yes" beside a small "no" [fetched via search: https://ico.org.uk/media/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services-2-1.pdf]. Whether it covers streaks: not confirmed.
- **Streak pressure / loss framing:** no streak counters, no "you'll lose progress" copy [unverified as regulation; strong design consensus].
- **Currency obfuscation:** Fortnite prices items in purchased V-Bucks [fetched: https://en.wikipedia.org/wiki/Fortnite]; avoid that model. Candy must be earn-only.
- **Also avoid:** confirmshaming copy, rank shaming, real names on boards, push notifications about ending timers.

## Gaps
Not retrieved: Fortnitemares, Roblox, Pokemon GO, Genshin, Poki/CrazyGames hubs, Clash Royale, Tetris 99, Monster Hunter, Apple/Google loot-box rules. A manual browser look at two or three would add screenshots and confirm the unverified items.
