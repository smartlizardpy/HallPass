# Dashboard role seats — one super admin, one admin, three beta admins

## What this is

A hard cap on how many people may hold each dashboard role at once:

| Role | Seats |
|---|---|
| `super_admin` | 1 |
| `admin` | 1 |
| `beta_admin` | 3 |

Five holders in total. A grant that would take a role past its cap is REFUSED
with a banner naming the role and its count, not silently accepted and not
quietly downgraded to a lower rung.

The cap is a property of the ROLE, not of the person, so it belongs beside the
ladder in `app/lib/permissions.ts` — the module that already owns "what may this
rung do" and is read by both halves of every permission (the guard the action
enforces and the condition the page renders the control under). A second copy of
the numbers in the users page would drift exactly the way `ROLE_LABEL` drifted
across three files before it lived there.

## Why cap at all

`dashboard_users` is an allow-list, and an allow-list with no ceiling grows by
accretion: a colleague invited for one afternoon keeps `admin` for a year, and
nobody notices because nothing pushes back. A seat count makes the growth
deliberate — to add the fourth beta admin you must first decide which of the
three is done. It is the cheap half of access review, enforced at the moment the
grant is made rather than in a quarterly audit nobody runs.

The numbers are deliberately tight rather than "generous for now". A limit set
above actual use enforces nothing and is discovered to be wrong only when it
finally bites, which is the worst moment to find out.

## The numbers are editable, and 1/1/3 is where they start

The caps above are DEFAULTS, not constants. A super admin edits them at
`/dashboard/users/settings`, and each one is stored as a `role_seats:<role>` row
in `app_settings` — the table whose whole contract is already "a key that has
never been written simply is not there, and the reader supplies its default".
That is exactly the shape this needs: a database nobody has ever touched the
settings on behaves identically to a fresh one, and `DEFAULT_ROLE_SEATS` in
`permissions.ts` is what both of them mean by 1, 1 and 3.

It also means the seat check has to read the limit rather than close over it, so
every pure helper takes a `Seats` — the limits AND the counts together. Neither
half answers anything alone: "2 used" is not a state without knowing whether the
cap is 2 or 20.

When the settings read FAILS, the limits fall back to those defaults rather than
to "uncapped". `readAppSettings` is already fail-soft to an empty map, and the
tightest known caps are the reading of a failure that cannot hand anybody access
by accident.

Bounds: **1 to 50**. Not zero, because a cap of zero means a role nobody may ever
hold — a state better reached by deciding not to grant it than by a number that
silently makes a whole rung ungrantable. Not unbounded, because a mistyped
`100000` would read as a saved setting and behave as no cap at all.

Lowering a cap under the people already holding it is ALLOWED. Nobody is
demoted, nobody loses access, and the role simply cannot be granted again until
it is back within its seats — the same over-capacity state the env allow-list can
produce, reported the same way. Refusing the edit instead would mean a shrinking
team has to remove people in an order dictated by the form.

## Decisions

### The env allow-list consumes a seat but is never blocked by one


`SUPER_ADMIN_EMAILS` (see `isSuperAdminEmail`) grants `super_admin`
unconditionally, with or without a row, and `upsertUserOnLogin` re-asserts that
role on every login. That path is **exempt from the cap**, and the exemption is
load-bearing: a seat check on the sign-in path would let a full table lock the
last super admin out of the site with no way back in, which is a far worse
failure than one seat too many. Bootstrap and break-glass must not be capped.

Their ROW still counts. Seats are counted off `dashboard_users` rows by role —
whoever put them there — so once the env super admin has signed in once, the one
super-admin seat is taken and the Users screen will not grant a second. The cap
therefore means "one super admin", not "one super admin plus however many the
env names".

Two consequences, both accepted and both made visible rather than hidden:

* An env super admin who has never signed in holds no row and so takes no seat.
  Their first login can push a role one over its cap.
* Listing several addresses in `SUPER_ADMIN_EMAILS` puts the super-admin role
  over its cap by design of that env var.

Either way the Users page renders an over-capacity notice naming the role and
its numbers, and every further grant of that role is refused until it is back
within its seats. Over capacity is a state the screen reports; it is never a
state it creates.

### Refusal is one statement, not check-then-write

`addUser` and `setRole` do the counting and the writing in a single SQL
statement (a `WITH seat AS (SELECT count(*) …)` feeding a conditional
`INSERT`/`UPDATE`), and report back what happened. Counting in JS and then
writing would leave a whole round trip between the two in which the last seat
can be taken by somebody else's click.

This is honest about its limit: under `READ COMMITTED` two concurrent grants can
still each see a free seat, so the guarantee is "no window across a round trip",
not a schema-level invariant. The residual window is one statement wide, on a
screen used by at most a handful of people, and the failure it can produce is
one seat over — which the over-capacity notice surfaces and the next removal
clears.

### Not a database constraint

A `CHECK` cannot count other rows, and the trigger that could would also have to
fire on the sign-in path — where the env exemption above says it must not. The
cap is policy about who may be GRANTED a role, and policy that has an exemption
the schema cannot see belongs in the layer that can see it.

### The seat a grant would free is not counted against it

Re-asserting somebody who already holds the role, and moving somebody from one
role to another, both count seats EXCLUDING the person being written
(`email <> $target`). Otherwise re-saving the single admin's own role would fail
against the seat they themselves occupy.

## Shape of the change

1. `app/lib/permissions.ts` — `DEFAULT_ROLE_SEATS`, the `Seats` pair (limits +
   counts) and the pure questions the UI and the actions both ask: `seatsLeft`,
   `isRoleFull`, `isOverSeats`, `firstFreeRole`, `seatSummary`,
   `roleFullMessage`, plus the bounds and the narrowing the settings form needs.
2. `app/lib/role-seats.ts` — the stored limits over `app_settings`: read them
   (defaults where unwritten, defaults on failure) and write them.
3. `app/lib/dashboard-users.ts` — `countRoleSeats()`; `addUser`/`setRole` become
   seat-aware and return a `SeatResult` instead of `void`.
4. `app/dashboard/(app)/users/actions.ts` — turn a refusal into the usual
   `?error=` banner.
5. `app/dashboard/(app)/users/page.tsx` — the limits stated up front, seat usage
   on every role hint, full roles disabled in the invite select, an
   over-capacity notice, and the invite form closed when nothing is free.
6. `app/dashboard/(app)/users/UserRowActions.tsx` — the same disabling in the
   per-row modal, except for the row's own current role, which stays selectable
   so Save is a no-op rather than an impossibility.
7. `app/dashboard/(app)/users/settings/` — the page that edits the limits, and
   its action.
8. Tests in `permissions.test.ts`, `role-seats.test.ts` and
   `dashboard-users.test.ts`; README and `auth.sql` updated to describe the cap
   where the roles are described.

## Explicitly not in scope

* No change to what any rung may DO — this is how many may hold it, nothing else.
* No seat check on sign-in (see the exemption above).
* No automatic eviction, expiry, or "oldest admin loses their seat". A refusal
  tells a human to choose; it never chooses for them. Lowering a cap does not
  demote anybody either — for the same reason.
* No per-person overrides and no seats for anything but the three roles. The
  settings page edits three numbers; it is not a policy engine.
* `beta_testers` are not dashboard users and have no seats.
