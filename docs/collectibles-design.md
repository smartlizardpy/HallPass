# HallPass Collectibles — design

Sibling of `championship-design.md`. A permanent digital sticker/card system:
free packs earned by playing, a Pack Room to open them, and a binder to keep
them in. Fright Fest 2026 is its first event collection, but nothing here is
Halloween-specific, and nothing expires with the haunted skin.

---

## 1. Decisions

1. **Free and earned only.** No purchases, no currency, no rerolls, no trading,
   no cash value, no marketplace. Odds are published and never depend on who you
   are, what you own, or how you play.
2. **The catalogue is code; ownership is data.** Collections, collectibles, packs
   and drop tables are typed, reviewed TypeScript in
   `app/lib/collectibles/catalogue/`, like the static game catalogue. Players'
   packs and pulls are rows. A definition never lives in a player's row, only its
   stable id.
3. **Pack versions are immutable.** A pack definition has numbered versions. A
   grant pins the version current at grant time, and the opening uses that
   version even if a newer one exists. A committed lock file
   (`catalogue.lock.json`) holds a hash of every published version and the list
   of published collectible ids, and a test fails if either changes or
   disappears. Changing odds means adding a version. Retiring a card means
   marking it unavailable, never deleting it.
4. **Contents are rolled at opening time, on the server, from the pinned
   version**, inside the same transaction that marks the pack opened. Rationale:
   - The grant stays a cheap, idempotent insert, so the reward backend works
     even with no opening UI.
   - The result exists in exactly one place, the pulls written by the opening,
     so there is nothing to peek at or leak beforehand.
   - Recovery is trivial: an opened pack *is* its pulls.

   The cost is that admins cannot pre-inspect a sealed pack's contents. That
   is the point.
5. **Three collectibles per standard pack**, configurable per pack (`size`).
6. **Demo art now, real art later** (owner, 26 Oct). Every collectible carries
   `art.status: 'demo' | 'final'`. Demo cards show a small "demo art" tag. Real
   art replaces the file at the same path (no code change) and flips the status
   in the catalogue data.
7. **Five collections at launch**, all with demo art: Fright Fest 2026, HallPass
   Originals, Internet Culture, Brainrot, Turkish Internet Culture. Card
   concepts for the last three are original characters and situations, not
   reproductions of real memes or real people, and they need a human content
   sign-off before final art (school audience).

---

## 2. Catalogue

```ts
Collection   { id, name, description, kind: 'event'|'permanent', theme: {colours, wrapper}, availableFrom?, availableUntil?, sort }
Collectible  { id, collection, number, name, caption, rarity, kind: 'sticker'|'card',
               finish: 'standard'|'foil'|'holo'|'animated', frame: 'standard'|'event'|'champion',
               pool: 'standard'|'commemorative', art: { src, status, alt } }
Pack         { id, collection, name, description, wrapper, versions: [{ v, size, slots: Slot[] }] }
Slot         = { kind: 'fixed', collectible } | { kind: 'random', pool, rarityWeights }
```

- Ids are stable, lowercase, prefixed by collection (`ff26-caretaker`).
- `pool: 'commemorative'` cards are **never** in a random slot. A test asserts it.
  They only come from `fixed` slots, so champion keepsakes cannot be pulled by
  chance.
- Rarities: common, uncommon, rare, epic, legendary. Every rarity a random slot
  can roll must have at least one eligible card (tested).

### Odds (published on every pack)

| Slot | Common | Uncommon | Rare | Epic | Legendary |
|---|---:|---:|---:|---:|---:|
| Standard random | 60% | 25% | 10% | 4% | 1% |
| "Rare or better" | — | — | 75% | 20% | 5% |
| "Epic or better" | — | — | — | 80% | 20% |

Within a rarity every eligible card is equally likely. Duplicates are possible
and are shown as such ("Already in your binder").

### Packs at launch

| Pack | Granted for | Slot 1 | Slot 2 | Slot 3 |
|---|---|---|---|---|
| Fright Fest Participation | accepted result on every board in the final lineup | **Survivor 2026** sticker (fixed) | standard random | standard random |
| Last Bell / Shadow Core / Survive Till Dawn Champion | 1st on that board, finalised | that game's **Champion** card (fixed) | rare-or-better | standard random |
| Fright Fest Overall Champion | top eligible player, finalised | **Overall Champion 2026** card (fixed, champion frame) | **The Last Bell** legendary (fixed) | epic-or-better |
| HallPass Originals / Internet Culture / Brainrot / Turkish Internet standard packs | admin grants and future triggers | standard random | standard random | standard random |

A player who wins a game and the overall title receives both packs.

---

## 3. Ownership model (migration `049_collectibles.sql`)

| Table | Purpose |
|---|---|
| `player_packs` | One row per granted pack: `public_id` (the only id on the wire), `player_id`, `pack_id`, `pack_version`, **`grant_key` UNIQUE** (idempotency), `source`, `source_ref`, `granted_by`, `granted_at`, `opened_at`, `revoked_at/_by/_reason`. |
| `collectible_pulls` | Append-only ownership ledger: `player_id`, `collectible_id`, `pack_id` + `slot` (**UNIQUE together**), `was_new`, `source` (`pack`/`admin`), `revoked_at/_by/_reason`. |
| `player_collectible_prefs` | `favourite`, `featured_position` (unique per player, 1–6), `seen_at` (clears the NEW dot). |
| `collectibles_log` | Admin grants, revocations and corrections, with actor email and reason. |

Quantities, duplicates and collection progress are derived from the ledger
(`count(*) … WHERE revoked_at IS NULL`). There is no counter that can drift.

### Opening (the atomic step)

`POST /api/v1/collection/packs/<public_id>/open`:

1. Read the pack. If not this player's, 404. If revoked, 410.
2. If already opened, return its stored pulls (`alreadyOpened: true`). This is
   what makes refresh, retry, a closed tab, skipping and a second device all
   safe.
3. Roll the slots from the pinned version with `crypto.getRandomValues`
   (rejection-sampled, no modulo bias).
4. One HTTP transaction (`sql.transaction`):
   - `pg_advisory_xact_lock` on the player, so two packs opened at once by the
     same player cannot both call a card NEW;
   - one statement: `UPDATE player_packs SET opened_at = now() WHERE … AND
     opened_at IS NULL AND revoked_at IS NULL RETURNING …`, then insert the
     pulls from that RETURNING. `was_new` is computed in SQL: never owned
     before **and** the first occurrence within this pack. If the UPDATE
     matched nothing (a concurrent open won), nothing is inserted.
5. If our transaction inserted nothing, re-read and return the winner's pulls.

A pack can never be marked opened without its pulls, and pulls never exist
without an opened pack: both happen in one statement.

### Grants

`grantPack({ playerId, packId, grantKey, source, sourceRef, grantedBy })` is
`INSERT … ON CONFLICT (grant_key) DO NOTHING`. Calling it twice grants once.
Callers own their key scheme:

- `fright-fest-2026:participation:<player>`
- `fright-fest-2026:champion:<game>:<player>`
- `fright-fest-2026:overall:<player>`
- `admin:<uuid>` (one per admin form submission)

No client event can trigger a grant. Grants come from server code paths
(championship finalisation and qualification) and admin actions only.

---

## 4. API

| Route | Auth | Purpose |
|---|---|---|
| `GET /api/v1/collection` | session | sealed packs, recent openings, owned counts, prefs |
| `POST /api/v1/collection/packs/<id>/open` | session | idempotent open, returns 3 pulls with NEW/DUPLICATE |
| `POST /api/v1/collection/prefs` | session | favourite / feature / mark seen |
| `GET /api/v1/collection/showcase/<username>` | public | a player's featured cards, only if their profile is public |

The catalogue itself needs no API: it is static data, imported by the pages.

---

## 5. Interface

Routes: **`/packs`** (the Pack Room, a prize counter; a pack opens over the
room at **`/packs?pack=<id>`**, the id in the query string read only by the
client, so an opening never costs a server render and an unknown id cannot
fill a cache; the opening's code loads only when a pack is pointed at or
opened, see `collectibles-pack-room.md`), **`/packs/open?pack=<id>`** (the old
address, kept for links already out there: the room with that opening
playing), **`/collection`** (binder), and
**`/collectibles/<id>`** (a public, static page per card for sharing, with no
owner information).

### Identity: "stickers slapped on a locker"

Collectibles are die-cut stickers and cards with a cream peel border, in a
clean HallPass shell (Nunito 800–900, pills, rounded corners), with pixel art
inside. Rarity is a *material*, never colour alone:

| Rarity | Shape | Pattern | Finish | Motion |
|---|---|---|---|---|
| Common | round-cornered die-cut sticker | none | flat | none |
| Uncommon | sticker with a notched corner | dashed inner line | one static glint | none |
| Rare | card, stepped corners | diagonal hatch | sheen band | sheen follows tilt |
| Epic | card, scalloped top edge | dot grid | holo | holo follows tilt |
| Legendary | card, crown notch | sunburst | prism foil + sparkles | follows tilt, plus one slow loop, paused off-screen |

Where a card is the focus (the reveal, the detail page) it tilts toward a
hovering mouse or a pressed finger, and the foil follows (`useCardTilt.ts`,
`holo.css`). Grids stay still.

Each card also carries a text rarity pill and a 1–5 pip row, readable in
greyscale. Tokens are new `--hc-*` names on a `.hc-root` wrapper. No base token
is reassigned, and dark values come in both the attribute and media forms.

### Pack wrappers

Every pack is the same crimped foil booster; each collection keeps its own
print (`opening/pack/art.ts`), with its colours, pixel emblem and motif:

- **Fright Fest 2026:** a night prize bag with a yellow moon.
- **HallPass Originals:** a hall-pass tag with a punched hole and lanyard.
- **Internet Culture:** a browser-window print.
- **Brainrot:** a loud snack-sachet print.
- **Turkish Internet Culture:** a tea-box print with tiled bands.

The opening draws the pack in WebGL (with a DOM fallback); the Pack Room shelf
draws the same print into a 2D canvas.

### Opening

Superseded by **`collectibles-opening.md`** (the physical redesign, Oct 2026):
the foil pack, the tear, the cards leaving the wrapper, the reveal and the
summary, with measurements and limitations. Two rules from the first design
changed:

- **The back of a card says nothing.** Every back has the same silhouette,
  pattern and timing; the rarity is staged only once the face shows. (It used
  to show the true rarity's glow before the flip.)
- **No rarity-timed hold before a flip.** The turn is identical for every card.

Still true from the first design:

- **Always available:** a Tear button and Enter/Space instead of dragging,
  Reveal all, Skip (Esc), keyboard focus order, and an `aria-live` line per
  reveal ("Card 2 of 3: Rare, The Caretaker, new").
- **Reduced motion** replaces movement with short fades and keeps every rarity
  cue.
- **Sound** is WebAudio-synthesised (no files), off by default, with one toggle
  remembered on the device.
- **No flashes:** glows ramp over ≥ 250 ms, nothing pulses more than twice a
  second, and there is no full-screen white.
- **Honest presentation:** no near-miss slowdowns, no fake tells, no "one more
  pack" nag, no countdowns. Reveal order is rarest last, fixed by the server's
  result before the animation starts.

### Binder

A grid per collection with completion %, owned cards in full, unowned as locked
silhouettes with their number, filters by collection and rarity, duplicate
counts, NEW dots until seen, favourites, up to six featured cards (shown on the
public profile only if it is public), a detail view with share. Sharing uses the
Web Share API or a copied link to `/collectibles/<id>`, and never includes the
player.

### Performance budget (school Chromebooks)

- Collectibles CSS and JS load only on collectibles routes. Nothing is added to
  the global bundle except a nav link.
- Card art: 32×32 or 48×48 PNG (≤ 2 KB each), drawn at integer scale with
  `image-rendering: pixelated`, lazy-loaded.
- Animate transform and opacity only. Foil repaints only on the focused card.
  The only idle loop is the legendary card's, on a focused card and paused
  off-screen; grids animate nothing, and there are no blur filters on large
  areas. The opening's WebGL pack draws only while
  something moves, pauses in a hidden tab, and lowers its resolution when
  frames run long.
- Pointer handling is throttled to one update per animation frame.

---

## 6. Administration (`/dashboard/collectibles`, role `super_admin`)

Catalogue browser (art status, odds, versions), grant a pack to a player (by
username or public id, reason required), revoke a sealed pack or a pull (reason
required), grant history, opening history, audit log. Definitions are not
editable from the dashboard. They change by commit, which keeps versions
immutable and reviewed. Only super admins can open the desk, grant or revoke;
site admins still pay championship rewards, which grant through the store directly.

## 7. Art pipeline

| Asset | Size | Format | Path |
|---|---|---|---|
| Card art | 32×32 (sticker), 48×48 (card) | transparent PNG, 1× | `public/collectibles/<collection>/<id>.png` |
| Pack emblem | 48×48 | PNG | `public/collectibles/packs/<collection>.png` |
| Collection symbol | 16×16 | PNG | `public/collectibles/symbols/<collection>.png` |
| Frames, wrappers, foil, backs, silhouettes | — | CSS/SVG | in components |

Demo art is drawn with the pixel-art tool. **Missing for launch-quality:** final
art for all 68 cards, 5 emblems and 5 symbols, plus a human content review of
the Internet Culture, Brainrot and Turkish concepts. The full list lives in
`public/collectibles/ART.md`.

## 8. Plan: files, order, commits (branch `hallpass-collectibles`, stacked on the championship branch)

1. Catalogue types, rarity/odds, validation and lock-file tests.
2. Catalogue data + demo art + `ART.md`.
3. `049_collectibles.sql` + fresh-install schema.
4. Store: grant, open (transaction), binder reads, prefs, admin corrections + tests.
5. Championship rewards: granted at finalisation from the frozen awards; "Grant rewards" re-runs safely.
6. Player API routes + tests.
7. Card and pack components + CSS design system.
8. Pack Room, binder, public card pages, nav links.
9. Opening flow (inspect, tear, emerge, reveal, summary), sound, reduced motion.
10. Admin page.
11. Profile showcase + sharing.
12. Docs.

## 9. Excluded

Trading, gifting, crafting/dust, purchases of any kind, pity timers, streak
pressure, NFTs, server-generated share images (a static card page is enough for
now), and a dashboard editor for definitions.
