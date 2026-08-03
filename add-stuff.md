IDEA: HallPass. Mobile only  games. (Mobile only by using the  device screen thing as well as the device agent thing.)
Need to do to do this  ==>
- Add a  mobile toggle in the dashboard in the games  
- Booliean in the db and the .ts file holding game metadata.
- Change the add-game skill to add those as well as changing the metadata stuff you get me by looking at the game code. 

DECIDED: not a boolean. platform tag = desktop | mobile | both.
- if its not set = unknown, ie we havent checked it yet. dont backfill everything to desktop, thats
  just guessing. unknown renders exactly like now (no badge, no reorder) so nothing breaks til we
  actually tag stuff.
- text column + CHECK, NOT a postgres enum type. enums are a pain to change later.
- validate it on read (like toBoolOrNull / toTagsOrNull in games-store.ts) so a junk value in the db
  cant sneak into the ts union.

3 places it goeunknowns, not 2 ==>
- app/lib/games.ts -> Game type, optional. source of truth, add-game skill writes here.
- game_overrides -> nullable column (null = inherit). mapOverride + both SELECTs + the upsert.
- external_games -> its own NOT NULL column, no static row for those to inherit from. + the
  /dashboard/external-games/new form.
- migration = 014_game_platform.sql, run w/ npm run migrate. do NOT apply by hand, thats how 004 and
  005 went missing in prod.

dashboard toggle goes in updateGameAction (games/[slug]/actions.ts:87), or its own small action like
setGameTagsAction if we want it saving on its own.

add-game skill: grepping for touchstart vs keydown will lie, loads of games listen for both and are
still unplayable on a phone. actually load it at 390x844 w/ touch emulation and see if it responds.
whatever it picks is a GUESS -> dashboard toggle is the fix-it path.
- detection should be client side (pointer: coarse), NOT server side user agent. server side UA
  branching wrecks the caching (ISR + CDN + the cache-first sw) - desktop html ends up served to a
  phone.
- dont HIDE desktop games on mobile. sort mobile first + badge the rest "best on desktop" + warn on
  the play page. google crawls as a phone (mobile first indexing) so hiding = crawler stops seeing
  most of the catalogue.
- who goes and tags the ~14 existing games, and when.
