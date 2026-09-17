# Dark mode — design

The site has exactly one palette, hard-wired to a light page. This is the plan
for a second one, the switch that chooses between them, and the handful of
surfaces that must NOT follow it.

Written before any code, per `AGENTS.md`: what is being built and why, then every
file that changes and in what order.

---

## 1. What is being built

A three-way appearance preference — **System / Light / Dark** — that repaints the
whole arcade, the account pages and the dashboard, persists per device, follows
the OS while it is on System, and never flashes the wrong theme on a cold load.

**In scope**

- A dark palette for every design token (`--background`, `--surface`,
  `--surface-2`, `--border`, `--muted`, `--foreground`, the brand ramp).
- The preference itself: store, boot script, live controller, two entry points
  (the sidebar hatch that every visitor can reach, and the Settings tab).
- Converting the light-hardwired utility classes that stand in for tokens
  (`bg-white`, `text-zinc-900`, `text-zinc-700`) to the tokens they were always
  describing, so one palette swap reaches them.
- Dark twins for the status palettes (red / emerald / amber / rose / sky), which
  are pale-tint-plus-dark-ink pairs and become the reverse.
- The painted surfaces in `globals.css` that name a colour directly: the store
  page's per-game hero tint, the scrollbar, the selection colour.

**Deliberately excluded**

- **The panic disguises** (`components/stealth/screens/*`, `PanicScreen.tsx`).
  They impersonate Google Docs, Classroom and Search, which are white products.
  A dark Google Docs is not a disguise, it is a tell. They are already written in
  literal hex and `bg-white` with no design token anywhere in them, so they stay
  light by construction — the rule for these files is simply DO NOT TOKENIZE.
- **Game artwork and the games themselves.** Covers, screenshots and the game
  iframe are the author's pixels; a theme does not get to filter them. The chrome
  that floats ON artwork (gallery arrows, the lightbox close, the favourite
  heart) stays light for the same reason: its background is the picture, not the
  page.
- **Loud accent fills** — `--accent-yellow`, `--accent-pink`, `--accent-cyan`,
  `--accent-pink-ink`, and the solid status fills (`bg-red-600`, `bg-emerald-500`
  …). They are signal colours read against their own ink, not against the page,
  and they work as well on a dark background as on a light one.
- Recharts series colours in the dashboard's analytics widgets (they are data
  colours on their own plotted surface, and sit behind an admin login).

**Assumptions** (stated, not verified with anyone): System is the default, so a
player who has never opened the control gets whatever their Chromebook already
does; the preference is per device (`localStorage`), like every other preference
in this app; and no signed-in sync — dark mode is a property of the screen you
are looking at, not of the account.

---

## 2. How it is built

### 2.1 The switch

`data-theme="light" | "dark"` on `<html>`, always the RESOLVED theme, never the
word "system". Three writers, one contract:

| When | Who sets it |
| --- | --- |
| During head parse, before first paint | `themeBootScript()` via `next/script` `beforeInteractive` |
| On change, in this tab | `setTheme()` in the store |
| On an OS change (while System) or a change in another tab | `ThemeController` |

This is the same shape as the tab cloak (`lib/stealth/boot.ts` +
`StealthController`), and for the same reason: a preference that decides what the
first paint looks like has to be applied before the first paint, and React mounts
too late. The key holds the CHOICE (`system` / `light` / `dark`); the attribute
holds the RESOLUTION. Keeping "system" out of the DOM means CSS never has to ask
what "system" meant.

No-JS and the instant before the boot script runs are covered in CSS by
`@media (prefers-color-scheme: dark)` scoped to `:root:not([data-theme])` — the
attribute, once present, always wins.

### 2.2 The CSS

`globals.css` gains, in order:

1. `@custom-variant dark` — matches `[data-theme="dark"]` and its subtree, AND
   `prefers-color-scheme: dark` while no attribute is set, so a `dark:` utility
   and the token blocks agree in all four states (attribute × media).
2. The dark palette as a single `:root[data-theme="dark"]` block, plus the same
   assignments under the no-attribute media query. The VALUES are written once,
   as `--hp-dark-*` constants in `:root`, so the two blocks can only ever assign
   the same thing.
3. `color-scheme: light` / `dark` alongside, so form controls, the caret and the
   inset UA widgets follow.

Painted surfaces that name `#fff` (`.game-hero`, `.game-tinted`) switch to
`var(--surface)`, which IS `#fff` in light — a no-op there and correct in dark.
The scrollbar thumb and `::selection` get tokens of their own.

**The dark palette.** Contrast checked against WCAG AA (the numbers are the
computed ratios, not vibes):

| Token | Light | Dark | Checks |
| --- | --- | --- | --- |
| `--background` | `#f4f4f7` | `#0f0f16` | page |
| `--surface` | `#ffffff` | `#17171f` | `--foreground` on it: 15.3 |
| `--surface-2` | `#ececf3` | `#21212c` | `--foreground` on it: 13.7 |
| `--border` | `#e4e4ec` | `#2e2e3b` | visible against both surfaces |
| `--muted` | `#6b6b7b` | `#9c9cb0` | 7.1 on background, 5.9 on surface-2 |
| `--foreground` | `#1c1c28` | `#ededf2` | 16.4 on background |
| `--brand` | `#7c2eef` | `#8b5cf6` | white on it 4.2; it on surface 4.2 |
| `--brand-600` | `#6920d6` | `#9a74f8` | hover/emphasis twin: 5.3 on surface |
| `--brand-50` | `#f1e9ff` | `#1e1633` | `--brand` on it: 4.1 |
| `--brand-100` | `#e4d4ff` | `#2a1f47` | rules and chips |

`--brand` is the one token that cannot be optimised, because it has two jobs at
once: `bg-brand` under `text-white` (100 uses) wants it DARK, and `text-brand`
on a dark surface (138 uses) wants it LIGHT. The two curves cross at a relative
luminance of ~0.21, which is `#8b5cf6` — 4.2 either way, and there is no value
that beats it on both sides. Both roles are bold ≥14px type in practice, where AA
asks 3:1, so 4.2 clears the bar with room; `--brand-600` then leans to the text
side (5.3) because its fill role is a transient hover.

The accents do not move. `--accent-yellow` is only ever given `text-zinc-900`
(10.8 on the yellow — unchanged in the dark, because the chip is still yellow),
and `--accent-pink-ink` was picked for white text at 5.0 on any background.

### 2.3 The classes that are secretly tokens

An audit of the app's 170 components found the palette split in two: ~1,400 uses
of the semantic tokens (`text-muted`, `border-border`, `bg-surface-2` …), and a
long tail of hard-wired neutrals that mean exactly the same things:

| Hard-wired | Uses | Means | Becomes |
| --- | --- | --- | --- |
| `bg-white` | 142 | a card/panel surface | `bg-surface` (identical in light) |
| `text-zinc-900` | 177 | body ink | `text-foreground` |
| `text-zinc-700` | 99 | secondary ink, one step lighter | `text-foreground-2` (NEW token, `#3f3f46` in light — the exact value it replaces) |
| `text-zinc-600/500/400` | 22 | quiet ink | `text-muted`, case by case |

So one new token is added, `--foreground-2`, precisely because `text-zinc-700` is
a real and heavily used tier between `--foreground` and `--muted`, and mapping it
onto either would change the light design. Its light value is zinc-700 to the
byte, so the sweep is invisible in light mode; its dark value is `#c6c6d4`.

The sweep is per-directory, in its own commits, and it SKIPS:

- the disguise files (§1);
- `text-zinc-900` sitting on `bg-accent-yellow` or on white-on-artwork chrome —
  the yellow chip and the gallery arrow do not change colour, so their ink must
  not either;
- every `bg-white/NN` and `text-white` — a translucent white over artwork or a
  brand fill is not a surface token, and each of the ~14 is judged individually.

### 2.4 The status palettes

`bg-red-50 / border-red-300 / text-red-900` and its emerald, amber, rose and sky
siblings are ~250 uses of the same three-part idiom: pale tint, mid border, dark
ink. In dark they invert, as explicit `dark:` twins at the call site rather than
by redefining Tailwind's scale — `bg-red-700` is a BUTTON here while
`text-red-700` is ink, so a scale-level swap would break one to fix the other.

The mapping (applied only to the tint/ink steps, never to the 400–700 fills):

```
bg-*-50   → dark:bg-*-950/40      text-*-900 → dark:text-*-200
bg-*-100  → dark:bg-*-950/60      text-*-800 → dark:text-*-200
border-*-200/300 → dark:border-*-900   text-*-700 → dark:text-*-300
ring-*-200/300   → dark:ring-*-900     text-*-950 → dark:text-*-100
```

### 2.5 Where the control lives

- **`ThemeMenuButton`**, next to `StealthMenuButton` in the sidebar's footer —
  the only auth-independent, phone-and-desktop door on the site (see the long
  note in `Sidebar.tsx` about why the stealth hatch lives there). It cycles
  System → Light → Dark and names the state it is in. It inherits the collapsed
  rail's `[&_button]` treatment for free by sharing that container.
- **An Appearance card** in `/play/you/settings`, in the Account group beside the
  stealth row: a proper three-way radio group, because that page has the room and
  is where a preference is looked for.

---

## 3. File plan, in commit order

1. `dark-mode-design.md` — this file.
2. `app/globals.css` — `@custom-variant dark`, `--hp-dark-*` constants, the two
   dark blocks, `--foreground-2`, `color-scheme`, scrollbar/selection/hero tokens.
3. `app/lib/theme/config.ts`, `app/lib/theme/boot.ts` + `app/lib/theme/boot.test.ts`
   — the key, the choices, the resolver, the before-paint script.
4. `app/lib/theme/store.ts` + `app/lib/theme/store.test.ts` — `useSyncExternalStore`
   over `localStorage`, modelled on `lib/stealth/store.ts`.
5. `app/components/theme/ThemeController.tsx` + wiring in `app/layout.tsx`.
6. `app/components/theme/ThemeMenuButton.tsx` + `Sidebar.tsx` (rail and drawer).
7. `app/play/you/_ui/AppearanceCard.tsx` + the Settings page.
8. — 11. The token sweep, by area: `app/components`, `app/play` + `app/u` +
   `app/c` + `app/embed`, `app/beta` + `app/oauth` + root pages, `app/dashboard`.
12. The status-palette twins.
13. The leftovers the sweep deliberately skipped: `bg-white/NN` pills, the
    `bg-zinc-900/NN` overlays, the game hero.
14. `npm run lint`, `npm test`, `npm run build`.

## 4. How it is verified

- `npm run lint`, `npm test`, `npm run build` — all three, before anything is
  called done.
- Unit tests for the two pure layers: the choice parser/resolver and the boot
  script's emitted source (same shape as `lib/stealth/*.test.ts`).
- A grep gate at the end: no `bg-white`, `text-zinc-900` or `text-zinc-700` left
  outside the documented exclusions.
