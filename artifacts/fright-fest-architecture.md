# Fright Fest 2026: seasonal event architecture (recommendation)

Written 25 Oct 2026. **Recommendation only. Nothing here is implemented.** It applies to
whichever homepage concept (A–D in `fright-fest-homepage-explorations.html`) is approved,
and to later events (Christmas, Easter).

## Goals

- The regular homepage stays the default, and returns by itself at the end time.
- One change switches an event off early.
- No event styling leaks into ordinary components, and no shared token is rewritten.
- Search, sort, For-you ordering, the platform guard and the phone tab bar are untouched.
- Direct links and history keep working after the event (ended state, not a 404).
- No hydration mismatch and no layout shift, even though `/` is prerendered and precached.

## Shape

```
app/lib/events/
  types.ts          SeasonalEvent, EventPhase
  registry.ts       EVENTS: one entry per event (UTC windows, theme, games by slug)
  phase.ts          phaseAt(event, nowMs): pure, shared by server, islands and tests
  boot.ts           eventBootScript(event): before-paint inline script (mirrors lib/theme/boot.ts)
  override.ts       cached admin kill-switch reader (CATALOGUE_TTL, own tag)
  *.test.ts
app/components/events/
  EventSlot.tsx     wrapper that marks markup as event-only / regular-only
  EventBadge.tsx    chip rendered inside GameCard / GameListRow's existing badge overlay
  fright-fest/      theme folder: hero/strip/pass components + scoped tokens
app/fright-fest/page.tsx   upcoming / live / ended states; permanent archive
```

### Registry

```ts
export const EVENTS: SeasonalEvent[] = [
  {
    id: "fright-fest-2026",             // permanent key for scores, points, collectibles
    theme: "fright-fest",
    enabled: true,                      // code default; admin override can switch it off
    teaserFrom: "2026-10-26T00:00:00Z", // optional "upcoming" phase (decision pending)
    startAt: "2026-10-28T00:00:00Z",    // inclusive
    endAt: "2026-11-01T00:00:00Z",      // exclusive
    href: "/fright-fest",
    games: [
      { slug: "last-bell", mode: "The Halloween Shift" },
      { slug: "shadow-core-halloween-dash", mode: "Cursed Dash" },
      { slug: "survive-till-dawn-pixel-edition", mode: "Blood Moon" },
    ],
  },
];
```

Competition games are referenced by slug here, not by a new `Game` field, so dashboard
overrides and the catalogue schema are untouched.

### Phases

| Phase | When | Homepage | /fright-fest |
|---|---|---|---|
| off | before the teaser | regular | not linked |
| upcoming | 26 Oct 00:00 → 28 Oct 00:00 | concept's "before" state | how it works, rules, terms |
| live | 28 Oct 00:00 → 1 Nov 00:00 | the approved concept | live boards |
| ended | from 1 Nov 00:00 | **regular, automatically** | "has ended", final standings (provisional until verified) |

## How the switch works without breaking prerendering

`/` is static HTML in the service-worker precache. If render code checked the clock, one
moment would be baked into the HTML, and a client rendering later would mismatch.

1. **Server render.** If an event is enabled in the registry, its slot markup is rendered
   *next to* the regular slot, both in the HTML. The server never chooses by clock.
2. **Before paint.** A tiny inline script (`next/script` `beforeInteractive`, beside
   `hp-theme-boot` in `app/layout.tsx`) compares `Date.now()` with the window and sets
   `data-hp-event-phase` and `data-hp-event` on `<html>`.
3. **CSS decides.** Event slots are `display:none` unless the phase attribute says
   otherwise; the regular hero hides only while live. No JS → regular homepage
   (fails closed).

```css
[data-event-slot] { display: none; }
html[data-hp-event-phase="live"]     [data-event-slot~="live"],
html[data-hp-event-phase="upcoming"] [data-event-slot~="upcoming"] { display: revert; }
html[data-hp-event-phase="live"]     [data-regular-slot="home-hero"] { display: none; }
```

Consequences:

- Identical HTML for every visitor at every moment, so the page stays prerenderable and
  cannot mismatch on hydration. The decision lands before first paint, so nothing jumps.
- A precached copy opened offline on 3 November still runs the script against the real
  clock, and shows the regular homepage.
- While an event hero is enabled, render the hidden FeaturedBanner's cover with
  `loading="lazy"` so it does not compete with the event's image for bandwidth.

## Scoped styling

```css
[data-event="fright-fest"] {
  --ff-night: #1b1026; --ff-bone: #f2e8d5; --ff-pumpkin: #ff7a1a;
  --ff-pumpkin-text: #a83c08;   /* 5.77:1 on #f4f4f7 */
}
:root[data-theme="dark"] [data-event="fright-fest"] { --ff-pumpkin-text: #ff8a3d; } /* 7.6:1 on #17171f */
/* repeat inside the no-attribute prefers-color-scheme block, as globals.css does */
```

- Only **new** `--ff-*` tokens, set only on event wrappers. Never redefine `--brand`,
  `--surface` or `--background` on a wrapper: Tailwind utilities read them at use time,
  so that would re-theme every ordinary component inside.
- Base components gain optional slots that render nothing when no event is enabled:
  `<EventBadge slug>` in GameCard's badge overlay, `EventSlot name="home-hero"` around
  FeaturedBanner (`Arcade.tsx:371`), a header slot after the `PRIMARY_NAV` list (so
  `MobileTabBar` keeps 3 tabs).
- Every new `@keyframes` is named in the reduced-motion block in `globals.css`.
- Stealth: event layers never set the title or favicon, play sound, sit above `z-[60]`
  or swallow keydown.

## Time

- All windows are absolute UTC instants. The UK leaves BST on 25 Oct 2026, so UTC is UK
  time for the whole event and "ends 23:59 on 31 October" is literally true.
- No render path calls `new Date()` to pick content. Countdown digits come from a client
  island: the server and first paint show the static date (via `useSyncExternalStore`
  with a null server snapshot), then digits appear in the same fixed-width
  `tabular-nums` box.
- Format dates with `Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London" })` on
  both sides.
- Anything that counts (accepting a score, awarding a collectible) is decided on the
  server at write time. A wrong device clock can only show a banner early or late.

## Turning it off early (and the #131 trap)

- Code: `enabled: false` (needs a merge).
- No deploy: an `event:fright-fest-2026` row in `app_settings`.
- **Do not read that row through `readAppSettings()` from the homepage.** Its 1-hour
  cache lifetime would quietly make `/` regenerate hourly (incident #131 in
  `cache-lifetimes.ts`). Use a dedicated reader on `CATALOGUE_TTL_SECONDS` with its own
  tag; the toggle calls `updateTag` plus `revalidatePath("/")` and
  `revalidatePath("/fright-fest")`.
- Online players see it on their next load (the SW is network-first for pages). An
  offline precached copy keeps the event until the end time, then hides it.

## After the event

- `/fright-fest` never 404s: an ended banner and final standings, provisional until the
  champion is verified.
- Scores, points and collectibles are stored against `fright-fest-2026` and never deleted.
- Homepage slots disappear by themselves. A later tidy-up commit removes the registry
  entry to drop the hidden bytes; that is cleanup, not a requirement.

## Future events

Add a registry entry (`christmas-2026`, theme `winter`) and a theme folder implementing
only the slots it wants. Each theme gets its own token prefix. A unit test asserts no two
enabled events overlap.

## Tests

- `phase.test.ts`: one millisecond either side of each boundary; disabled events.
- `boot.test.ts`: run the generated script at fixed clocks and assert the attributes
  (mirrors `theme.test.ts`).
- GameCard renders identical markup with and without an event, apart from the badge slot.
- Every new keyframe appears in the reduced-motion block.

## Production changes per concept

**Shared foundation (all four):** `app/lib/events/*` with tests; one boot `<Script>` in
`app/layout.tsx`; `EventSlot`, `EventBadge` and the `fright-fest/` theme folder;
`Arcade.tsx` hero-slot wrapper; badge slot in `GameCard` and `GameListRow`;
`app/fright-fest/page.tsx`; visibility rules + reduced-motion names in `globals.css`;
published prize terms (eligibility, parent or guardian consent, delivery).

| | Adds | Backend | Effort |
|---|---|---|---|
| **A Subtle Haunting** | optional Wordmark dot slot; header event tab; strip above the hero (desktop) and the Games heading (phone); FeaturedBanner wash prop; fog keyframes | none | 2–3 days |
| **B Takeover** | EventHero with the three games inside it (3.5:1 cards); StandingsPreview island with reserved height and empty state; Countdown island; header tab; MobileCatalog top slot (needs sign-off) | standings API | 4–6 days |
| **C Haunted Arcade** | HauntedArcadeHero (canvas after mount, reserved box; HTML cabinets); commissioned pixel art; Silkscreen via next/font, event-only; torch island (paused off-screen); easter-egg island incl. a SiteHeader search hook | optional (egg collectible) | 7–10 days + art |
| **D Fright Pass** | FrightPass (desktop + phone); PassChip beside StreakChip; guest stamps on device until sign-in; profile keepsake after the event | progress API `/api/v1/events/fright-fest-2026/me` | 5–8 days |

## C2 · Haunted Arcade, after dark (round 2)

C2 grows C from a hero into a site-wide skin. It uses the same registry, phases, boot
script and kill switch as above. Three details differ because the skin reaches beyond one
slot:

- **Tokens on `<html>`, still new names only.** The header, sidebar, cards and footer
  all take part, so the `--ha-*` tokens sit on `html[data-hp-event="fright-fest"]`, not
  on a wrapper. The rule above still holds: no base token (`--brand`, `--surface`,
  `--background`) is redefined, and a proposed grep test would enforce that.
- **Both phases in one slot.** Inside an event slot, `data-phase="upcoming"` and
  `data-phase="live"` children are switched by CSS from `data-hp-event-phase`, so the
  prerendered page flips at 00:00 on 28 Oct without a rebuild. Countdown digits still
  come from the client island.
- **Shared-component touches are attribute-gated.** GameCard gets `data-event-game` for
  registry slugs only. The frame CSS matches only under `html[data-hp-event]`, so without
  the attribute the card is today's card. The same pattern applies to the sidebar's active
  marker and the footer restyle.

Mock evidence: with the attribute removed, the C2 markup renders today's homepage, and
the first cover row returns to exactly 391px at 1366×768 (473px with the skin on).

| | Adds | Backend | Effort |
|---|---|---|---|
| **C2 After Dark** | Stage 1 (about 3 days): foundation; Wordmark moon-dot slot; header tab; one Sidebar destination; GameCard/GameListRow frame + mode chip; ChampionshipBoard (static, Countdown island) in Arcade + MobileCatalog; SiteFooter sky band; 1× sprites (~4 KB). Stage 2 (about 3–4 days): HauntedArcadeHero (canvas at unit resolution, HTML cabinets, floor fade), phone hero, torch island, ghost hunt, AfterDarkShelf | championship API for live standings (optional; the board works without it) | 7–9 days in two stages |

The full file list, commit order, test list and reversibility audit are in the artifact's
**C2 plan** tab.
