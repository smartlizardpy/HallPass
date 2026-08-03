# HallPass — mobile platform tagging

Every game in the catalogue is tagged `desktop` / `mobile` / `both`, and the site
uses that tag to stop serving people games they physically cannot play.

> **Status — all phases done except the prod migration.**
>
> Built and committed on `feat/mobile-platform-tag`, rebased onto current `main`
> (which by then included the Blob work through PR #36).
>
> - **Phase 6 backfill is DONE**: Pixel Slicer and Depths of Aethelgard are
>   `both`; the other 25 are `desktop`. Written into `app/lib/games.ts` so the
>   tags ship with a deploy rather than living in one Neon branch.
> - Migration `014` is applied to the branch `.env.local` points at
>   (`ep-raspy-waterfall-a6sp6ijx`). **Production still needs `npm run migrate`**
>   — that is the one remaining step (Phase 7, step 5).
> - Corrections go through the dashboard: `/dashboard/games/<slug>` → "Plays on".
>   Native games write a sparse `game_overrides` column, external games write
>   their own row; both use the same control, and "Unknown" is selectable so any
>   tag here can be taken back off.

Right now a phone visitor sees the same grid a desktop visitor sees, taps a
WASD-controlled runner, gets a game that does not respond to touch, and leaves.
That is the entire problem. The tag is the fix; everything below is plumbing it
into the three places game metadata lives and the four places it gets rendered.

---

## Scope

**In:** a `platform` field on the `Game` type, a column in `game_overrides` and
`external_games`, a dashboard control, a client-side device hook, a badge + sort
on the catalogue, an interstitial on the play path, and platform inference in the
`add-game` skill.

**Out — deliberately:**

- **No server-side user-agent branching.** See _Gotcha 1_. It breaks the caching
  model, and this site is ISR + CDN + a cache-first service worker.
- **No hiding of desktop games on mobile.** See _Gotcha 2_. Google crawls as a
  phone; hiding is how you delete most of your catalogue from the index.
- **No new "mobile" category or separate mobile route.** The tag is a property of
  a game, not a place. A `/mobile` page can be added later off the same data if
  it turns out people want one.

---

## The data model

```ts
export type GamePlatform = "desktop" | "mobile" | "both";

// on Game:
platform?: GamePlatform;
```

Four states, and the fourth one matters:

| value | meaning |
|---|---|
| `"desktop"` | keyboard/mouse only — unplayable on touch |
| `"mobile"` | touch/gyro/portrait only — unplayable (or pointless) on desktop |
| `"both"` | genuinely works on either |
| absent / `NULL` | **unknown — nobody has checked this game yet** |

`undefined` is not a bug to be defaulted away, it is the honest state for all 27
existing games until somebody actually tests them. Unknown renders **exactly as
today**: no badge, no reordering, no warning. That means every phase below can
ship before a single game is tagged, and nothing changes until we start tagging.
It also means an admin looking at the dashboard can see the gap.

Backfilling everything to `desktop` on day one would assert something unverified
and wrongly demote any game that does work on touch. Backfilling to `both`
asserts the opposite. Neither is free — leaving it null is.

**Storage: `TEXT` + a `CHECK`, not a Postgres `ENUM` type.** Altering a PG enum
later is painful (you cannot remove a value, adding one has transaction
caveats); a CHECK constraint is a one-line migration to change. It also matches
what is already in these tables — `category` is `TEXT`, `tags` is `TEXT[]`.

---

## Phase 1 — data layer

### 1a. Type

`app/lib/games.ts` — add `GamePlatform` and the optional `platform` field to
`Game` (near `externalUrl` / `coverUrl`). Document *why it is optional* right
there, in the style of the existing `author` comment, so the next person does not
"tidy it up" by giving it a default.

### 1b. Migration — `014_game_platform.sql`

New file in `app/lib/scoreboard/migrations/`. Follow `013_game_videos.sql`
exactly: prose header explaining the decision, every statement guarded, whole
file in one `BEGIN; … COMMIT;`.

```sql
BEGIN;

ALTER TABLE game_overrides ADD COLUMN IF NOT EXISTS platform TEXT;
ALTER TABLE game_overrides DROP CONSTRAINT IF EXISTS game_overrides_platform_valid;
ALTER TABLE game_overrides ADD CONSTRAINT game_overrides_platform_valid
  CHECK (platform IS NULL OR platform IN ('desktop', 'mobile', 'both'));

ALTER TABLE external_games ADD COLUMN IF NOT EXISTS platform TEXT;
ALTER TABLE external_games DROP CONSTRAINT IF EXISTS external_games_platform_valid;
ALTER TABLE external_games ADD CONSTRAINT external_games_platform_valid
  CHECK (platform IS NULL OR platform IN ('desktop', 'mobile', 'both'));

COMMIT;
```

`external_games.platform` is **nullable**, breaking that table's
every-column-NOT-NULL convention (only `cover_url` is nullable today). That is on
purpose: `NOT NULL DEFAULT 'both'` would make every pre-existing external game
silently claim mobile support, which is the exact failure this whole change
exists to prevent. Unknown has to be representable in both tables or the two
halves of the catalogue disagree about what "untagged" means.

### 1c. Keep the fresh-install DDL in lockstep

`app/lib/games.sql` (defines `game_overrides`) and `app/lib/external-games.sql`
(defines `external_games`) are the canonical fresh-install DDL — the migration is
the *upgrade* path, those files are the *from-scratch* path. `013_game_videos.sql`
says this in its header for a reason. Add the column + CHECK to both. A database
created from `.sql` and one migrated to `014` must end up identical.

### 1d. Read path — `app/lib/games-store.ts`

1. Add `platform: GamePlatform | null` to the `GameOverride` type (~L49).
2. Add a `toPlatformOrNull(value: unknown)` coercion helper next to
   `toStringOrNull` / `toBoolOrNull` / `toTagsOrNull` (~L68-84). It must
   **validate against the union**, not `String(row.platform)` — otherwise a bad
   row hands a value into a TS type that swears it cannot exist. Anything not in
   the three-value set returns `null` (unknown), same fail-soft spirit as the
   rest of the module.
3. Add `platform` to `mapOverride` (~L88).
4. Add `platform` to **both** `SELECT` lists — `readOverridesCached` (~L112) and
   `getOverride` (~L252). Missing one gives you a field that works on the public
   site and is blank in the dashboard.
5. Add `platform: o.platform ?? game.platform` to the spread in `resolveGames`
   (~L152).

### 1e. External games — `app/lib/external-games-store.ts`

Add `platform` to `ExternalGameRow` (~L50), to `mapRow` (~L84, through the same
validating coercion — export it from `games-store.ts` or lift it to a shared
spot), to the three `SELECT` lists (~L113, ~L149, ~L160), and to
`createExternalGame`'s `INSERT` (~L200).

### 1f. Sparse write helper — `setGamePlatform`

In the CURATION section of `games-store.ts`, modelled **exactly** on `setGameNew`:

```ts
export async function setGamePlatform(
  slug: string,
  value: GamePlatform | null,
): Promise<void> {
  await sql`
    INSERT INTO game_overrides (slug, platform)
    VALUES (${slug}, ${value})
    ON CONFLICT (slug) DO UPDATE SET
      platform = EXCLUDED.platform,
      updated_at = now()
  `;
}
```

Do **not** route this through `upsertOverride` — see _Gotcha 3_.

---

## Phase 2 — dashboard

### 2a. The control

`app/dashboard/(app)/games/[slug]/page.tsx` — a small section with its own
`<form>`, sitting near the tags editor (~L407) rather than inside the details
form at ~L198. Four radios: **Unknown / Desktop / Mobile / Both**. Unknown is a
real, selectable option — an admin must be able to say "actually I do not know"
and undo a bad guess.

It gets its own form and its own action rather than joining `updateGameAction`
because platform is a *capability*, not editorial copy: it is set once after
testing the game, not edited alongside the tagline. Same reasoning that put
`is_new` / `is_featured` on the Curation page instead of in the details form.

### 2b. The action

`app/dashboard/(app)/games/[slug]/actions.ts` — `setGamePlatformAction`,
copying the shape of `setGameTagsAction` (~L136): `requireRole("admin")` →
validate slug against the static catalogue → parse the field to
`GamePlatform | null`, rejecting anything unrecognised → single fallible write in
a `try` → `revalidateGame(slug)` → `redirect()` **outside** the try (redirect
signals by throwing; a catch-all swallows it).

### 2c. External game creation

`app/dashboard/(app)/external-games/new/page.tsx` — add a `platform` select
alongside `category` (~L122); wire it through `createExternalGameAction`
(`app/dashboard/(app)/external-games/actions.ts:152`) into `createExternalGame`.
Default the select to Unknown, not to Both.

### 2d. Surface the gap

On `app/dashboard/(app)/games/page.tsx`, show an "untagged" marker next to any
game with no platform (near the existing `isNew` / `isFeatured` badges at
~L131-134). Phase 6 is a manual pass over 27 games; make the list of what is
left visible instead of something to be remembered.

---

## Phase 3 — device detection (client only)

New `app/lib/use-device-platform.ts`:

```ts
"use client";

export type DevicePlatform = "desktop" | "mobile";

/** `null` until mounted — see the hydration note. */
export function useDevicePlatform(): DevicePlatform | null {
  const [device, setDevice] = useState<DevicePlatform | null>(null);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse) and (max-width: 900px)");
    const apply = () => setDevice(mq.matches ? "mobile" : "desktop");
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return device;
}
```

**Why `pointer: coarse` AND a width bound.** `pointer: coarse` alone is true on a
touchscreen laptop, which is a keyboard machine. Width alone is true for a narrow
desktop window, which is also a keyboard machine. Both together is a decent proxy
for "phone". No UA sniffing: iPads report a desktop UA, and every UA string is a
lie eventually.

**Why it returns `null` before mount.** The server render and the first client
render must produce identical HTML. `null` means "device unknown, render the
neutral catalogue" — which is precisely what the prerendered HTML contains. The
platform-aware render happens on the second paint. See _Gotcha 4_.

Companion pure helper (unit-testable, no DOM):

```ts
export function playsOn(game: Game, device: DevicePlatform): boolean | null {
  if (!game.platform) return null;              // unknown — assert nothing
  return game.platform === "both" || game.platform === device;
}
```

Three-valued on purpose. `null` propagates "we do not know" all the way to the
UI, where it renders as silence rather than as a guess.

---

## Phase 4 — public surfaces

### 4a. Badge — `app/components/GameCard.tsx`

The badges overlay already exists at ~L43. Add a platform badge next to the NEW
pill:

- device is `mobile`, game is `desktop` → **"Desktop"** (muted, not alarming)
- device is `desktop`, game is `mobile` → **"Mobile"**
- match, or either side unknown → nothing

Nothing is ever removed from the DOM. The card still links to `/game/<slug>`, is
still crawlable, still works.

### 4b. Sort — `app/components/Arcade.tsx`

Already `"use client"` (L1), so the hook drops straight in. In the `useMemo` that
builds the filtered list, apply a **stable partition** when `device` is non-null:
playable-here first, unknown next, known-unplayable-here last. Relative order
within each bucket is preserved so the existing ranking is not thrown away.

While `device` is `null` (server render, first paint) the order is untouched —
which is exactly the order in the prerendered HTML.

Optional, if it looks good: on mobile, a "Made for your phone" row above the grid
built from `platform === "mobile" | "both"`, following the existing personalized
rows (~L171-261).

### 4c. Play path — the interstitial

`GameStore.tsx`'s "Play now" (~L260) and `GameCard`'s hover ▶ both funnel into
`openGame(slug)` from `useOpenGame` (`ArcadeShell.tsx:44`). Gate at the **call
sites**, not inside `ArcadeShell` — the shell's job is owning the overlay, not
adjudicating playability.

On a phone, tapping a `desktop` game shows a small confirm sheet: _"This one is
built for a keyboard. Play anyway?"_ with **Play anyway** and **Back**. Never a
hard block — the tag can be wrong, and the user is allowed to overrule it.
**Do not use `window.confirm`** — a native modal blocks everything; use the same
in-page component pattern the rest of the app uses.

Also worth adding: the platform mismatch as a property on the existing
`posthog.capture` play event, so "how often do people play anyway" becomes a
number instead of an argument.

### 4d. Store page

`app/game/[slug]/page.tsx` — one line in the metadata rail ("Best on desktop" /
"Made for mobile") next to the category and tags (~L237-246). Server-rendered
from `game.platform`, no device check, so it is the same for every visitor and
for the crawler. It is a fact about the game, not about who is looking.

---

## Phase 5 — `add-game` skill

`.claude/skills/add-game/SKILL.md` — Step 4 (~L117) lists the `Game` fields and
how to infer each. Add `platform`, and **do not make it a grep**.

Grepping for `touchstart` vs `keydown` will lie constantly: plenty of games
register both listeners and remain completely unplayable on a phone (tiny hit
targets, a keyboard-only pause menu, a landscape-locked canvas). It is exactly
the kind of inference that looks fine in review and is wrong in a third of cases.

Instead, the skill should **actually test it** — it already drives a browser to
take the cover screenshot. Load the game at 390×844 with touch emulation, tap
around the play area, and check whether anything moves. Report the result as a
*proposal* and say so in the summary: _"tagged `desktop` — no touch response at
390×844; correct it in the dashboard if that's wrong."_

The dashboard toggle from Phase 2 is the correction path, so a wrong guess is
cheap. But it should be labelled as a guess, and if the check cannot run,
`platform` is **omitted** (unknown) rather than guessed.

---

## Phase 6 — backfill

Manual pass, 27 static games plus whatever external games exist. For each: open
it on a real phone (or
emulation), try to play for 30 seconds, set the tag in the dashboard. Tag
external games too.

This is the phase that makes the feature real — everything before it is
scaffolding that renders as nothing. Do not skip it, and do not automate it: the
whole point of the tag is that a human confirmed the game is playable.

---

## Phase 7 — ship

1. `npm run migrate -- --status` against the **dev** Neon branch first. Confirm
   `.env.local` points at `dashboard-dev`, never at prod.
2. `npm run migrate`, then `--status` again to confirm `014` is recorded.
3. `npm run test`, `npm run lint`, `npm run build`.
4. Manual: desktop grid unchanged; phone grid re-sorted; interstitial appears and
   "Play anyway" works; a game with no tag looks precisely like it does today.
5. Deploy, then migrate prod **before** the code that reads the column goes live
   (adding a nullable column is backwards-compatible, so the order is safe either
   way — but reading a column that does not exist is not).
6. Verify prod with `--status`. Migrations 004 and 005 once went missing in prod
   while the code was live and nothing errored, because every read here is
   fail-soft. The ledger exists so that cannot happen silently again.

---

## Gotchas

### 1. Server-side UA branching would break the cache

The tempting version of this feature reads the user-agent header on the server
and renders a different catalogue. Do not.

The moment the HTML depends on the request, it stops being one cacheable payload.
This site has ISR, Vercel's CDN, `unstable_cache` over the override read, **and**
a cache-first service worker in `public/sw.js`. The failure mode is not an error,
it is a desktop-rendered page cached and served to a phone (and vice versa) —
and the SW keeps serving whichever variant it saw first, so it persists across
reloads. That stale-HTML-in-dev confusion from before was the same mechanism.

Client-side detection sidesteps all of it: one HTML payload for everyone, cached
once, correct for everyone, and the device-specific bit happens after hydration.

### 2. Mobile-first indexing means hiding is expensive

Google crawls with a smartphone user-agent. If the mobile render hides desktop
games, Googlebot — a mobile client — sees a catalogue with most of it missing.
For a site whose traffic is organic search for game names, that is a direct hit
to the thing that brings people here at all.

Rank and badge; never remove. Every game stays in the DOM on every device.

### 3. `upsertOverride` full-replaces the row

`upsertOverride` (`games-store.ts:266`) defaults every missing key to `null` and
writes all of them — a partial patch through it **nulls the title, tagline,
description, category and tags**. That is documented and intentional, and it is
why `setGameNew` / `setIsFeatured` / `setDetailsOverride` / `setGameTags` exist
as single-column sparse writes. `setGamePlatform` must be one of those. Getting
this wrong wipes an admin's copy edits the first time somebody sets a platform.

### 4. Hydration + the service worker precache

`Arcade` is prerendered and precached by the SW. If the platform sort ran during
the first client render, it would not match the server HTML — a hydration
mismatch, and one that only shows up on phones.

This exact trap is already documented in `Arcade.tsx:36-52`, where seeding the
search box from `?q=` is deliberately done in a `useEffect` with an
`eslint-disable-next-line react-hooks/set-state-in-effect` and a comment saying
the extra render *is the point*. Follow that pattern precisely. The hook
returning `null` before mount is what makes it work.

### 5. `pointer: coarse` is not "is a phone"

Touchscreen laptops match it. Chrome DevTools device emulation matches it while
the machine has a keyboard. Hence the `max-width` conjunct — and hence the
interstitial being a confirm rather than a block. The detection is a heuristic
and the UI should treat it as one.

### 6. Fail-soft means an outage reads as "unknown"

Every read in `games-store.ts` returns `[]` on failure rather than throwing
(`readOverrides`, ~L127). During a Neon outage the platform tags all resolve to
unknown — which renders as the current, un-tagged site. That is the correct
degradation and it comes for free from the existing architecture, but it is worth
knowing so nobody debugs "the badges disappeared" as a frontend issue.

### 7. `mapRow` in `external-games-store.ts` fakes some fields

External games get `art: "void"` as a hardcoded constant because the `Game` type
demands an `ArtStyle` they never use. `platform` is **not** in that category — it
is a real fact about an external game and must come from the column. Do not
follow the `art` precedent when adding it.

---

## Open questions

- **Naming.** `platform` singular reads slightly odd when the value is `both`.
  Alternatives: `playsOn`, `devices`. Not worth much argument, but it is a schema
  name that sticks — decide before the migration, not after.
- **Does a `/mobile` landing page follow?** Same data, but it is a content and
  SEO decision ("unblocked games on your phone" is a real search query), not part
  of this change.
- **Is the real ambition a phone app?** `InstallPrompt` + `PWA.tsx` already exist.
  "HallPass is a PWA full of games built for touch" is a materially stronger
  product than "some games have a mobile badge", and it runs on this exact data
  model. Worth knowing which one this is a step toward before Phase 6 decides how
  much effort tagging deserves.

---

## Appendix — the original note

```
IDEA: HallPass. Mobile only games. (Mobile only by using the device screen thing
as well as the device agent thing.)
Need to do to do this ==>
- Add a mobile toggle in the dashboard in the games
- Booliean in the db and the .ts file holding game metadata.
- Change the add-game skill to add those as well as changing the metadata stuff
  you get me by looking at the game code.
```

Changed since: the boolean became a three-value tag plus an explicit unknown
state, and "mobile only by user-agent" became client-side detection with ranking
instead of hiding — for the reasons in _Gotchas 1 and 2_.
