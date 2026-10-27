# Curated catalogue import (27 Oct 2026)

Source: `hallpass-card/manifests/curated.json` (63 cards). Tool: `node scripts/catalogue-import.mjs` (dry run) / `--apply`.
The catalogue is **code** (`app/lib/collectibles/catalogue/`); player rows reference card ids and pack `pack_version`, so there are
**no card-definition database migrations**. Nothing here touches the Neon `main` (production) branch.

## Counts

| Collection | Cards | Prize-only | Droppable C/U/R/E/L |
|---|---|---|---|
| `ff26` Fright Fest 2026 | 20 | 5 | 7/3/3/2/0 |
| `legends` Internet Legends | 12 | 0 | 4/3/2/0/3 |
| `brainrot` Brainrot & Reactions | 13 | 0 | 6/3/2/2/0 |
| `turkish` Turkish Internet | 9 | 0 | 2/3/2/1/1 |
| `gaming` Gaming Legends | 9 | 0 | 3/3/2/1/0 |

63 curated cards. `inet-05` (Rigsby Moment) is a `draft` in the manifest and is imported as Common: confirm it.

## Mapping rules

* Ids are explicit: `<collection>-<manifest id>` (`legends-inet-03`), recorded in `curated-map.json` with the manifest status, rights text, `was_rarity` and `was_catalogue_id`. Display names are never used to match.
* The five prize cards keep their existing ids (`ff26-survivor`, `ff26-champion-last-bell|shadow-core|survive-till-dawn`, `ff26-overall-champion`) and numbers 16-20, so packs and `championship-rewards` are unchanged.
* Rarities are the manifest's. 38 differ from the manifest's own earlier rarity (`was_rarity`):

| Manifest id | Catalogue id | Change |
|---|---|---|
| `inet-03` | `legends-inet-03` | epic → legendary |
| `dolphin-quote` | `legends-dolphin-quote` | epic → rare |
| `dafoe` | `legends-dafoe` | rare → uncommon |
| `inet-08` | `legends-inet-08` | epic → common |
| `park-friend` | `legends-park-friend` | rare → common |
| `evil-chad` | `brainrot-evil-chad` | legendary → epic |
| `tung` | `brainrot-tung` | epic → rare |
| `aura` | `brainrot-aura` | legendary → uncommon |
| `dagestan` | `brainrot-dagestan` | epic → uncommon |
| `this-is-fine` | `brainrot-this-is-fine` | rare → common |
| `oh-no` | `brainrot-oh-no` | rare → common |
| `boyfriend` | `brainrot-boyfriend` | rare → common |
| `suit-smirk` | `brainrot-suit-smirk` | epic → uncommon |
| `sweat` | `brainrot-sweat` | rare → common |
| `mega-burger` | `turkish-mega-burger` | epic → uncommon |
| `baklava` | `turkish-baklava` | rare → uncommon |
| `masallah-cat` | `turkish-masallah-cat` | epic → common |
| `mario` | `gaming-mario` | legendary → epic |
| `pg-subject00` | `gaming-pg-subject00` | legendary → rare |
| `pacman` | `gaming-pacman` | epic → uncommon |
| `pg-ozzy` | `gaming-pg-ozzy` | epic → uncommon |
| `pg-hollow` | `gaming-pg-hollow` | legendary → uncommon |
| `pg-jester` | `gaming-pg-jester` | rare → common |
| `pg-mavros` | `gaming-pg-mavros` | epic → common |
| `pg-abomination` | `ff26-pg-abomination` | legendary → epic |
| `pg-watcher` | `ff26-pg-watcher` | epic → rare |
| `pg-reaper` | `ff26-pg-reaper` | epic → rare |
| `pg-caretaker` | `ff26-pg-caretaker` | rare → uncommon |
| `h-pumpkin` | `ff26-h-pumpkin` | new → common |
| `h-oiia` | `ff26-h-oiia` | new → common |
| `h-tahta` | `ff26-h-tahta` | new → common |
| `h-goblin` | `ff26-h-goblin` | new → common |
| `h-3am` | `ff26-h-3am` | new → common |
| `h-candy` | `ff26-h-candy` | new → common |
| `h-bat` | `ff26-h-bat` | new → common |
| `tibbi-terim` | `turkish-tibbi-terim` | new → rare |
| `cografi-terim` | `turkish-cografi-terim` | new → common |
| `sabit-terim` | `turkish-sabit-terim` | new → uncommon |

## Compatibility decisions

* **Old demo rows stay** (68 - 5 re-used prize ids). The 15 old droppable Fright Fest rows are `retired: true`; `hpo`, `inet`, `brr`, `tr` collections are `retired: true` and their packs `closed: true`. Owners keep and see their cards; nobody else sees those sets. All old pack versions (and lock hashes) are untouched.
* **New pack versions**: Fright Fest participation, three champion and overall packs get **v2**. New collections get new packs (`legends|brainrot|turkish|gaming` -standard and -rare), prices/slot shapes unchanged (Everyday 3 standard slots; Rare = 1 standard + 2 rare-or-better).
* **Missing tiers** (approved: move the weight one tier down, written into the pack version): `legends` has no Epic (4→Rare standard, 20→Rare on rare-or-better); `brainrot`, `gaming`, `ff26` droppable have no Legendary (1→Epic standard, 5→Epic). `turkish` keeps 60/25/10/4/1 and 75/20/5 exactly.
* **Overall Champion pack v2** is Golden Ticket + two Epics (v1's second card was the retired demo "The Last Bell" and the curated set has no other Legendary). The Fright Fest hall page test was updated to match. This is a visible reward change: confirm.
* **Sealed v1 packs**: opening resolves the pool at open time. If a sealed v1 Fright Fest pack rolls a tier the pool no longer has, the roller falls to the nearest lower tier then higher (`roll.ts`); current versions are validated to never need this.
* `Collectible.art` gains `layout: "full"` and `thumb`; full cards render edge to edge with no number/caption/peel over the art (foil and glare still on top). Names are the manifest's; captions are empty for full cards (the art carries them).
* Asset names carry a content hash (cache-safe). PNG→WebP q86; the animated `brainrot-whaaa` (6 MB, 158 frames) is re-encoded to 3.8 MB and its thumb is a still frame. Pack wrappers/emblems/symbols for the four new collections are **copies of the old wrappers** (inet→legends, brr→brainrot, tr→turkish, hpo→gaming): new wrapper art is still wanted.
* Rights: the manifest still says `needs_clearance` for most cards; the owner confirmed on 27 Oct that all curated cards are cleared. The text is kept in `curated-map.json` unchanged. No card is gated on it.

* **Candy shop**: `app/lib/candy/fright-fest-2026.ts` now prices the new `legends|brainrot|turkish|gaming` -standard (30) and -rare (100) packs and no longer the closed demo ones. Prices are unchanged.

## Balance (real roller, 400 simulated players per pack; odds not adjusted)

Packs to complete the whole pool: ff26 participation median 35 (p90 67); legends standard 160 (p90 354) / rare 46; brainrot 20 / 27; turkish 27 / 22; gaming 12 / 20. Legends is hard to complete because its 1% Legendary is split across three cards.

## Rollback

Everything is additive. To restore the old presentation: revert the two import commits' catalogue edits (`collections.ts`, `collectibles.ts`, `packs.ts` v2 entries cannot be removed once released, so instead stop granting v2 by pointing the championship config at v1 packs, or revert before release). Owned cards, `player_packs` and `collectible_pulls` are never modified; retired rows are only hidden. Do not delete rows from the lock.

## Verification status

Done: dry run, idempotent apply (second run writes nothing), catalogue/lock/roll/page tests, tsc, lint of changed files; binder desktop screenshot of the lab. 17 failures in `console-capture` and `streak-event` tests exist on the base branch too.
Not done: reveal animation and phone screenshots (a stealth-setup modal blocked headless capture), `npm run build`, a Neon `dev` opening against the real store, Sonnet review.
