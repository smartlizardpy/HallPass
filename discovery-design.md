# Discovery & landing surfaces — design

Sibling of `marketing-design.md`, and its direct sequel. That document argued
that the honest first move was instrumentation, built it, and closed with §9 —
"not in this plan, but next" — plus §11, which said plainly that none of it
creates demand.

This is the follow-up ask: **"what can we add, for more users?"** The answer
here is the acquisition half — the surfaces a stranger can actually arrive on,
and the card the site wears when somebody passes it around. Nothing in it is
new infrastructure; every piece is a landing surface built from data the
catalogue already carries.

---

## 0. Scope, and what was deliberately left out

Four candidates were put to the user. Three were chosen:

1. **Social cards for the home grid and category pages** (§2)
2. **`/tag/<tag>` landing pages** (§3)
3. **FAQ content + `FAQPage` markup on game pages** (§4)
4. **An on-site `/new` page** fed by ShipNote (§5) — *chosen, and blocked on
   integration details the user is supplying. Built last; the other three do not
   depend on it.*

**A daily challenge was offered and NOT chosen.** It stays exactly where
`marketing-design.md` §9 left it: the `kind` discriminator on `challenges` is
still the seam it was built to be. Nothing here forecloses it.

Also still true, and still line item zero: **the catalogue is 30 games.** Every
surface below multiplies the demand a title creates; none of them substitutes
for another title.

## 1. Why these three, in this order

They are ordered by how much existing work they unlock rather than by size.

**The cards come first because the link builder already ships.**
`/dashboard/growth` mints tagged links to `/`, to a game, or to a category, with
a preview of the card that link will render as. For a game that card is real —
`app/game/[slug]/page.tsx` puts a screenshot in `openGraph.images`. For the home
grid and every category it is nothing at all: `app/layout.tsx` declares
`openGraph` with **no `images` key**, and `public/` holds no OG asset, so the
most-shared URL on the site arrives in a group chat as a grey rectangle. The
tooling to publish those links is finished; the thing it publishes is not.

**Tag pages come second because the data is already curated.** `resolveTags()`
returns every distinct tag with its game count, the dashboard has a whole
tag-curation page with `renameTag()` behind it, and `/category/[category]` is a
working, ranking template on a neighbouring axis. Thirty-eight tags currently
render as **plain text on one page each** — `GameStore`'s spec sheet says so in
a docblock, and says why: *"there is no /tag/[tag] route … Do not turn them into
links without a route to land on."* This builds the route that comment is
waiting for. `Shooter` (8 games), `Roguelike` (6), `Multiplayer` (4) and
`Local Co-op` (3) are queries in their own right, and broader ones than any
single title.

**The FAQ comes third because it is the cheapest, and because it is honest.**
"Does this work on a school Chromebook?" is a real query, and this site has a
genuinely unusual answer to it: the whole arcade is precached by a service
worker and keeps working with no network. That answer is currently written down
only in `README.md`.

## 2. Cards for the home grid and category pages

`app/c/[code]/opengraph-image.tsx` is already a fully-worked `ImageResponse`
card, and its header documents the Satori constraints the hard way — explicit
`display: flex` on every multi-child element, no Fragments as flex children,
real font data or no font weights. That knowledge is not re-derived here; the
palette, the Nunito loader and the cover reader move into `app/lib/og/brand.tsx`
and both cards import them.

**One renderer serves the home grid, categories and tags.** They are the same
object — a titled listing of games — and three hand-copied card files would be
three chances for the brand to drift. The listing card takes a kicker, a
headline, a subhead and up to four covers, and the three routes differ only in
what they pass.

Rules carried over from the challenge card, because they were right there:

- **Every ingredient is optional.** A missing cover file, an empty category, an
  unreadable font: each degrades to a simpler card, never to an error. A chat
  platform caches a failed preview and keeps showing the grey box long after the
  link works again.
- **No photographs of children, ever.** These cards carry game art and type.
  Nothing about the person sharing them appears — the same argument the
  challenge card's header makes about avatars.
- **The palette is inlined and hand-synced** with `globals.css`. An OG route
  renders outside the app's CSS entirely.

**Precache watch.** `scripts/build-sw-manifest.mjs` sweeps `prerender-manifest.json`
and precaches every prerendered public route. Generated OG images are statically
optimised, so they may land there — a 1200×630 PNG per category is real weight
on every visitor's service-worker install, for an asset only crawlers fetch.
**Verified against the built manifest, not assumed**; excluded by prefix if it
shows up.

## 3. `/tag/<tag>` landing pages

### The URL, and the fact that tags are editable

Tags are dashboard-editable and renameable, so a tag is not a stable identifier
and the URL cannot pretend otherwise. `app/lib/tags.ts` owns one pure mapping in
both directions — `Local Co-op` ⇄ `local-co-op`, `Bullet Hell` ⇄ `bullet-hell`,
`3D` ⇄ `3d` — and resolution is **case-insensitive against the live tag list**,
exactly as `resolveCategory()` already does for categories. Two tags that
collide on one slug resolve to the first by count; the pure part is unit tested.

**Renaming a tag changes its URL and 404s the old one.** Stated here so it is a
known cost rather than a surprise: the dashboard's rename is a curation tool
that now has an SEO consequence. No redirect table is built for it — that is a
`marketing_links`-shaped problem, and §6 of `marketing-design.md` already argues
why we do not open that until real usage demands it.

### The page

It renders inside `ArcadeShell` — the same host `app/game/[slug]/page.tsx` uses
— rather than through `Arcade`. `Arcade` is an 865-line client component whose
filter state is internal, and threading a tag axis through it would put the
featured banner, the personalised rows and the category chips on a page that is
meant to answer one query. A small client listing beside `GameStore`'s "More
like this" rail is the honest shape.

It must stay **statically prerenderable** for the same reason the game page must:
no `auth()`, no `cookies()`, no `searchParams`. A dynamic tag page is a tag page
that is not in the service-worker precache.

Carried through: `generateStaticParams` over the resolved tag list, a canonical,
`BreadcrumbList` + `CollectionPage`/`ItemList` JSON-LD, sitemap entries beside
the categories, and the `GameStore` spec-sheet tags becoming links at last.

## 4. FAQ on game pages

**The answers are rendered on the page.** This is not decoration on top of
markup: Google requires `FAQPage` content to be visible to the user, and
synthesising markup for text nobody can read is how a domain earns a structured
data manual action. This is the same argument the game page's own docblock makes
about `aggregateRating` and about the absent `uploadDate` on `trailer` — the
precedent is set, and it is followed rather than re-argued.

`app/lib/faq.ts` builds the questions from facts the game row already asserts,
so every answer is true by construction and none is written by hand per game:

- **Is `<game>` free?** — yes, and no account is needed. True catalogue-wide.
- **Can I play `<game>` at school?** — the honest answer, which is that the site
  is built for filtered networks and the arcade is precached to keep working
  without one. Not a promise about anybody's specific filter.
- **Does `<game>` work on a phone?** — reads `game.platform`, which is a
  three-value capability with a **load-bearing absent case**. A game whose
  platform is unknown gets **no question at all** rather than a guess; that is
  the whole reason `platform` is not a boolean.
- **Do I need to download anything?** — no, and it is installable as a PWA.

Pure, and unit tested against the platform cases.

## 5. `/new` — the drops page (blocked, built last)

`WhatsNewLink` currently points every visitor and every admin at
`https://useshipnote.vercel.app/c/hallpass`: off-site, unindexable, and it sends
traffic away from the site it is advertising. An on-site `/new` keeps that
traffic, gains a URL that can rank for "hallpass update", and gives the growth
page's link builder a destination that is neither the home grid nor a game.

**What is needed before it can be built** — the user is supplying it:

- how the changelog is read (a public JSON endpoint, an RSS/Atom feed, or an API
  with a key), and the exact response shape;
- whether a key exists and therefore whether an env var is required;
- whether ShipNote stays the source of truth (this page renders it) or whether
  entries move in-repo.

Two constraints are already known and will shape it whatever the answer is:
**there is no cron in this project by explicit design** (`notifications-design.md`
§7), so freshness comes from a cached read with a TTL, not a scheduler; and the
page must fail soft — an unreachable ShipNote renders an empty state, never an
error, because `/new` will be in the service-worker precache.

## 6. Deliberately absent

- **A daily challenge** — offered, not chosen. §0.
- **Redirects for renamed tags** — §3, with its cost stated.
- **Tag pages for one-off tags** — a tag on a single game is that game's page
  with extra steps. A floor applies, and the tags below it stay unlinked rather
  than becoming thin duplicates of a store page.
- **Hand-written FAQ copy per game** — thirty hand-written answer sets is thirty
  chances to assert something that is not true of that game.
- **`aggregateRating`, review counts, or any other invented markup** — unchanged
  from the game page's existing position.
- **Third-party pixels** — `marketing-design.md` §2, unchanged and permanent.

## 7. Phasing

Each commit leaves the tree working; tests and lint run before each.

| # | Commit | Files |
|---|--------|-------|
| 1 | This plan | `discovery-design.md` |
| 2 | Shared OG brand kit | `app/lib/og/brand.tsx`, `app/c/[code]/opengraph-image.tsx` |
| 3 | The listing card renderer | `app/lib/og/listing-card.tsx` |
| 4 | Home grid card | `app/opengraph-image.tsx` |
| 5 | Category cards | `app/category/[category]/opengraph-image.tsx` |
| 6 | Tag slugs, both directions | `app/lib/tags.ts` + test |
| 7 | The tag listing | `app/components/TagListing.tsx` |
| 8 | The tag page | `app/tag/[tag]/page.tsx`, tag card |
| 9 | Wire tags in | `app/sitemap.ts`, `app/components/GameStore.tsx` |
| 10 | The FAQ model | `app/lib/faq.ts` + test |
| 11 | FAQ on the page, and its markup | `GameStore.tsx`, `app/game/[slug]/page.tsx` |
| 12 | `/new` | pending §5 |

## 8. What this does NOT solve

The same thing `marketing-design.md` §11 did not solve. These are landing
surfaces for demand that exists: a tag page ranks only if somebody searches the
tag, and a social card only converts a share somebody was already going to make.
**Thirty games is still thirty queries.** The content-health panel names which of
those thirty pages are too thin to compete, and `/add-game` automates the
thirty-first. That remains the highest-value thing anyone can do to this
repository, and none of the work below is a substitute for it.
