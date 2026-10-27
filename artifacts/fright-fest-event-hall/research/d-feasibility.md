# /fright-fest event hall: feasibility

Verdict: feasible, low risk. The scene stays static server HTML; everything live is a small client island. Build on the championship branch, not main.

## 1. Page structure and caching
- main `app/fright-fest/page.tsx:30-50`: async server component, `resolveGames()` for the shell only. Static (header comment lines 1-7). Islands: `FrightFestPhase.tsx` (`useSyncExternalStore`, server snapshot "neutral", client refines to preview/live/ended/off) and `FrightFestCountdown.tsx`. `FrightFestGames.tsx` is not used by the page.
- Championship branch page: `SUMMARY = championshipEnabled(FRIGHT_FEST_2026.id) ? championshipSummary(...) : null` is a module constant, so still static. `FrightFestSections` is a server component (rules, points table from the same object the ranker uses) mounting three client islands: `PhaseBanner`, `ChampionshipStandings` (`id="standings"`, tabs), `MyChampionship`.
- `components/championship/data.ts` fetches `/api/v1/championship/<id>` (CDN-cached 30 s) and `/me` (cookies, `no-store`), sharing one 30 s promise cache; an island can pass `active:false` until scrolled into view.
- #131 (`app/lib/cache-lifetimes.ts:11`): one short-lived read in a prerendered page sets the whole page's ISR interval. So: no short-lived server reads. PNG, hotspot geometry and copy are server output; standings, progress and pack count are client fetches. No clock or cookies in the page.

## 2. Theme and championship state
- Theme: `lib/events/fright-fest.ts` (`enabled`, start 25 Oct, opens 28 Oct, end 1 Nov). `phaseAt()` (`phase.ts`) gives off/live/ended. `boot.ts:22-36` inline script sets `data-hp-event`, `data-hp-event-phase="live"`, `data-hp-skin="haunted"` before paint; sets nothing if disabled, out of window, on an excluded path, or look is "normal" in localStorage.
- Championship flag: on main `lib/events/championship.ts` (`enabled:false`, deliberately separate). On the branch that file is deleted and replaced by `lib/championship/config.ts` `championshipEnabled(id)`.
- The five states today:

| State | Existing behaviour |
|---|---|
| Theme on, championship off | Skin paints; scene says "to be announced"; no standings or buttons; phase line says preview before 28 Oct. |
| Theme on, live | `FrightFestSections`: banner, standings, my progress. Phase comes from the server (knows suspension, early close), clock as fallback. |
| Theme off, live | Sections use base tokens, so they work unskinned. But the current scene art depends on `.ff-*` skin CSS; a hall needs a skin-independent PNG or plain fallback. |
| Ended | `FrightFestPhase` says "has ended"; Standings has a `final` flag and "provisional" line. Page must not 404; show the final board. |
| API failing | `getJson` returns null on any error; Standings says unavailable instead of an empty table (Standings.tsx:11); PhaseBanner falls back to the clock. |

The hall must also work with JS off (hotspots are real links) and in the "neutral" snapshot.

## 3. Assets and performance
- Existing sprites in `public/events/fright-fest` are 78-620 bytes (`school.png` largest, `cabinet.png` 304 B), all drawn with `image-rendering: pixelated` (`haunted.css:126`, `header.css:16-17,95-96,134`, `catalogue.css:31`); technique is proven. Pack Room desk PNGs are about 22 KB, loop strips 112-450 B.
- 434x230 at 3x is about 0.9 MP: cheap as one composited layer. Use integer CSS width/height, not `transform: scale`; avoid `filter` and blend modes over it.
- `steps()` on `background-position` repaints only a tiny box; precedent `ha-rise`/`ha-halo`/`ha-sign` (`header.css:26-100`). Canvas needs JS, a ticker and manual pausing, so not worth it.
- Pausing: none exists in the haunted CSS. Add one IntersectionObserver toggling `animation-play-state`, plus `visibilitychange`. A `useInView` hook is referenced in `data.ts`'s docblock.
- Reduced motion: `globals.css:473` block disables keyframes by name and the comment (442-471) claims exhaustiveness. Every new keyframe name must be added there; static first frame is the fallback.

## 4. Responsive
Pack Room doc section 2 (`docs/collectibles-pack-room.md:79-91`): content width >= 1302 px gives exactly 3x; 868-1301 px scales uniformly 2x-3x (not pixel-perfect); below 868 px the phone composition at 2x (195x358, capped 2.5x on portrait tablets). HTML on top is unscaled, positioned in scene coordinates, 44 px targets; fixed aspect ratio so nothing shifts on data arrival. Reuse its pure `room/geometry.ts` (prize-counter branch). Phone conventions: `MobileTabBar` (HIDDEN_PREFIXES; line ~310 caveat on coarse hoverless tablets), `globals.css:265` `@media (hover: none)`. I found no whiteboard behaviour in these files; unresolved.

## 5. Accessibility
- Hotspots as real `<a>` (cabinets to `/game/<slug>`, counter to `/packs`) or `<button>` over a decorative `alt=""` PNG. DOM order equals visual order (cabinets, board, quests, counter).
- `:focus-visible` outline of 2-3 px, offset, high contrast on dark art.
- Standings tabs already use `role=tablist` with arrow keys (`Standings.tsx:183-209`) and a `motion-reduce` skeleton; no `aria-live` present. Add a small polite status line only, not the whole table. Use real HTML text for the board, plus the text rules for screen readers.

## 6. Stealth
`components/stealth/` (`PanicScreen.tsx` full-viewport disguise covering everything and locking scroll, `StealthController.tsx`, `StealthSettings.tsx`). Constraints: no scene layer above the overlay (watch z-index and fixed layers), pause loops while panic is active, no distinctive title or favicon leaks. `MobileTabBar.tsx:77-83`: shake-to-panic depends on the `/play/you/settings` stealth row; leave it.

## 7. Reuse and conflicts
- Reuse unchanged: `ArcadeShell`, `resolveGames`, `eventDateLabels`, `FRIGHT_FEST_THEME`, `phaseAt`, `FrightFestPhase`, `FrightFestCountdown`, `championship/data.ts` hooks, `lib/championship/*`, `Standings`/`MyProgress`/`PhaseBanner` as the full below-scene sections.
- Touch: `app/fright-fest/page.tsx`, new `components/events/fright-fest/hall/*` and `public/events/fright-fest/hall/*`, `globals.css` (reduced-motion names), maybe a compact `Standings` variant.
- `git diff --stat origin/main collectibles-prize-counter` (269 files, mostly collectibles) overlaps on `app/fright-fest/page.tsx`, `HauntedHero.tsx`, `registry.ts`, `lib/events/{championship,fright-fest,labels}.ts`, `events.test.ts`, plus the whole championship component set. Certain conflict: `page.tsx`; likely: `registry.ts`, `labels.ts`, `events.test.ts` if built from main. Rebase onto the branch instead. `/api/v1/collection` and `useMyCollection` exist only there.

## 8. Effort (one developer, excluding art)
- Static scene + hotspots (both compositions, scaling, focus, loops, reduced motion, skin-off fallback): 2-3 days.
- Live board in scene (compact top-N, five states, loading/error, live region, in-view fetch): 1.5-2 days.
- Quest board, static preview only (no backend; label as preview): 0.5 day.
- Prize-counter teaser with sealed pack count from `/api/v1/collection`: 1 day, depends on that branch landing; a plain link without a count is 0.25 day.
Total about 5-7 days.
