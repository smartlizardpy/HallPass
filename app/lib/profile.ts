/**
 * HallPass — the PUBLIC PROFILE read model behind `/u/[username]`.
 *
 * This module exists to be the ONLY way a profile page learns anything about a
 * player, and it is shaped by one rule: the page must not be *able* to render
 * something it should not. Every safeguard below is structural — a type that has
 * no field for the dangerous value, or a query that never selects it — because
 * "remember not to render that" is not a safeguard, it is a promise, and promises
 * do not survive the next component.
 *
 * WHAT IS STRUCTURALLY IMPOSSIBLE HERE, and why each one matters:
 *
 *   * NO EMAIL, EVER. {@link PublicProfile} has no `email` field in either of its
 *     shapes, and {@link PROFILE_IS_EMAIL_FREE} is a compile-time proof of that —
 *     add one and this file stops building. Concretely, this is why a page must
 *     never reach `getPlayerById()` from `players.ts`: that function returns a
 *     `Player`, which carries the address, and a `Player` handed to a component is
 *     one `{profile.email}` away from publishing a child's school email address.
 *     Nothing in here returns one, and no SELECT below lists the column.
 *
 *   * NO `players.id`. That column is the GOOGLE SUBJECT ID — a stable,
 *     cross-service correlation identifier for a minor (see the note on
 *     `public_id` in `migrations/007_social_graph.sql`). It appears in exactly one
 *     place below: a local `const` used to key the two follow-up queries. The
 *     returned type has `publicId` (a UUID) and no field the subject could be
 *     assigned to.
 *
 *   * NO GOOGLE NAME. Display names come from `publicDisplayName()`, which falls
 *     back to `@username` and never to `players.name`. For a school Google account
 *     `name` is the child's full real name, and this page is at a guessable URL.
 *
 *   * NO FRIEND LIST — only a count. A list of a pupil's friends, at a public URL,
 *     keyed by a guessable username, is a map of a school's social graph
 *     assembled from outside it. The count carries the part that is actually
 *     social ("this person is real and connected") and none of the part that is
 *     surveillance.
 *
 *   * NO PRECISE TIMESTAMPS. Everything time-shaped goes through
 *     {@link coarsenActivity} into one of four buckets. "Last active 14:52" is a
 *     presence signal wearing a different hat: it says who is at a screen right
 *     now, and in a school that is used to work out who is in which lesson, who is
 *     off timetable, and who is online at 1am. Four buckets are enough to answer
 *     "is this account alive" and useless for tracking a person's day.
 *
 * BLOCKED VIEWERS GET A MINIMAL PROFILE — not a 404, not an error. This is the
 * one decision here that looks wrong at first, so: an explicit "you have been
 * blocked" is itself a social event, and among 13-year-olds it escalates the same
 * afternoon. A hard 404 is no better and is also incoherent, because the profile
 * reappears the moment the viewer signs out — which advertises the block to
 * anyone who tries it once. Minimal-and-quiet is the only outcome that is
 * deniable: it looks exactly like a private profile, which looks exactly like the
 * default. The block still bites, via {@link PublicProfile.canSendFriendRequest}
 * being false, so the page simply has no button to press.
 *
 * SHAPE: a `createProfileReader(sql)` FACTORY, like `social/store.ts` and
 * `reviews/store.ts`, with the live binding at the bottom of the file. The seam
 * matters more here than usual — the visibility matrix has 24 cases and the
 * blocked path is defined by which queries it DOESN'T run, which only a fake
 * tagged template can assert.
 *
 * SQL SAFETY, carried from every other store: the `neon()` tagged template
 * parameterises interpolated VALUES and does NOT reliably splice SQL fragments.
 * Nothing below interpolates a fragment; the viewer/anonymous difference is two
 * fully-written templates chosen in JS, exactly as `selectTopRows` does.
 *
 * Naming note: `social/store.ts` also exports a `PublicProfile`. That one is a
 * ROW — the four fields a friends list or a search result needs. This one is a
 * PAGE. A module that needs both should alias one on import.
 */

import "server-only";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { isMissingColumnError, sql } from "@/app/lib/db";
import { publicDisplayName } from "@/app/lib/players";
import { createSocialStore } from "@/app/lib/social/store";
import {
  earnedBadges,
  lockedBadges,
  type Badge,
  type BadgeStats,
} from "@/app/lib/badges";
import { mapFlairRow, type Flair } from "@/app/lib/flair";
import { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH } from "@/app/lib/username";

type Sql = NeonQueryFunction<false, false>;
type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/**
 * Recently-played games shown on a profile.
 *
 * Small on purpose. This is a "what are they into" signal, not a history: a long
 * list of everything someone has opened, timestamped even coarsely, starts to
 * describe when they use a computer and for how long. Six fills a row of cards
 * and stops.
 */
export const PROFILE_RECENT_PLAYS = 6;

// ---------------------------------------------------------------------------
// Coarse time
// ---------------------------------------------------------------------------

/** The only granularity this module will ever report a time at. */
export type ActivityRecency = "today" | "this-week" | "this-month" | "a-while-ago";

const DAY_MS = 86_400_000;

/**
 * Coarsen an instant to one of four buckets. `null` in (never played, no such
 * row) or an unparseable value gives `null` out, which the page renders as
 * nothing at all rather than as a guess.
 *
 * ELAPSED TIME, NOT CALENDAR DAYS, and that is deliberate on both counts. A
 * calendar-day version ("was it today?") is sharper than it looks: it flips at
 * midnight in whatever zone the server happens to be in, so "today" becoming
 * "this week" pins an event to a window far narrower than a day, and the zone
 * itself leaks. Elapsed time has no timezone and degrades gracefully.
 *
 * A FUTURE timestamp reads as "today" rather than falling through to
 * "a-while-ago": clock skew between Neon and the runtime is real and small, and
 * the failure mode of the alternative — someone who just played showing as
 * inactive for a month — is the one people notice and disbelieve.
 *
 * The month bucket is 31 days, not 30 and not a real month. Anything that tracks
 * actual month boundaries would have the same midnight-flip problem as the
 * calendar-day version, one boundary further out.
 *
 * Pure, with `now` injected so it is testable without freezing the clock.
 */
export function coarsenActivity(
  date: Date | string | number | null | undefined,
  now: Date = new Date(),
): ActivityRecency | null {
  if (date == null) return null;
  const at = date instanceof Date ? date : new Date(date);
  const ms = at.getTime();
  if (Number.isNaN(ms)) return null;

  const elapsed = now.getTime() - ms;
  if (elapsed < DAY_MS) return "today";
  if (elapsed < 7 * DAY_MS) return "this-week";
  if (elapsed < 31 * DAY_MS) return "this-month";
  return "a-while-ago";
}

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

/** The stored `players.profile_visibility` setting. */
export type ProfileVisibility = "public" | "friends" | "private";

/** How much of a profile a particular viewer is entitled to see. */
export type ProfileDetail = "full" | "minimal";

/**
 * Coerce the stored visibility string to the union, FAILING CLOSED.
 *
 * The `players_profile_visibility_chk` CHECK constraint makes an unrecognised
 * value unreachable today, so this only ever fires if that constraint is relaxed
 * or a column is added by hand. The costs are asymmetric — publishing a profile
 * that was meant to be private is not recoverable, hiding one that was meant to
 * be public is a bug report — so the unreachable branch picks `private`, not the
 * schema default.
 */
export function toProfileVisibility(raw: unknown): ProfileVisibility {
  if (raw === "public" || raw === "friends" || raw === "private") return raw;
  return "private";
}

/**
 * The whole access decision, as a pure function of four booleans-and-a-setting.
 *
 * Separated from the query for one reason: this is the part that must be right,
 * and it is 24 cases. Testing it through the database would test three of them.
 *
 * Precedence, and why it is this way round:
 *   1. OWNER WINS. You always see your own profile in full, including when it is
 *      private — otherwise the privacy setting reads as broken to the only person
 *      who can change it, and they turn it off.
 *   2. BLOCKED LOSES, even against `public`. A public setting is a statement to
 *      the world in general; a block is a statement about one person, and the
 *      specific beats the general. (Owner-and-blocked is unreachable —
 *      `player_blocks_self_chk` forbids blocking yourself — but the order is
 *      defined rather than left to argument order.)
 *   3. Otherwise the setting decides, with `friends` — the DEFAULT for every new
 *      account — resolving on the accepted friendship only.
 */
export function resolveVisibility(input: {
  visibility: ProfileVisibility;
  isOwner: boolean;
  isFriend: boolean;
  isBlocked: boolean;
}): ProfileDetail {
  if (input.isOwner) return "full";
  if (input.isBlocked) return "minimal";
  if (input.visibility === "public") return "full";
  if (input.visibility === "friends") return input.isFriend ? "full" : "minimal";
  return "minimal";
}

// ---------------------------------------------------------------------------
// The profile shapes
// ---------------------------------------------------------------------------

/** The viewer's relationship to the profile's owner. */
export type FriendshipState =
  | "none"
  | "pending-out"
  | "pending-in"
  | "friends"
  | "self";

/** One recently-played game. Coarse recency only — see {@link coarsenActivity}. */
export type RecentPlay = {
  /**
   * The slug as recorded in `player_plays`. NOT resolved against the catalogue
   * here, deliberately: `isResolvedSlug()` means `resolveGames()`, i.e. pulling
   * the whole catalogue resolver (and its own database reads) into a profile
   * view to answer six booleans. The renderer already has to resolve each slug to
   * get a title and a thumbnail, so it is the layer that drops the ones that no
   * longer exist — one resolution instead of two.
   */
  slug: string;
  recency: ActivityRecency | null;
};

/**
 * What every viewer of an existing profile gets, at any visibility.
 *
 * The avatar survives into the minimal shape on purpose. Minimal exists to let a
 * stranger confirm they found the right person and send a request; without a face
 * the add-friend flow becomes "is @sam_h the Sam I know?", which people resolve
 * by sending requests to all of them.
 */
type ProfileBase = {
  /** `players.public_id` — a UUID. NEVER `players.id`. */
  publicId: string;
  /** Always present: this shape is only ever built from a username lookup. */
  username: string;
  /** From `publicDisplayName()`. Never the Google `name`. */
  displayName: string;
  image: string | null;
  friendship: FriendshipState;
  /**
   * Whether the "add friend" button should exist at all.
   *
   * It answers "would `social.sendRequest` accept this", so the page never
   * renders a control that is guaranteed to fail. False when: nobody is signed
   * in, the viewer is the owner, a relationship already exists in either
   * direction, or EITHER PARTY HAS BLOCKED THE OTHER — that last one being the
   * entire mechanism by which a block is enforced on this page, with no message
   * and no error to notice.
   *
   * Deliberately independent of visibility. A private profile can still receive
   * requests; that is what makes a shared link work, and it is why `friends` is a
   * usable default for a brand-new account (see the note in
   * `007_social_graph.sql`).
   */
  canSendFriendRequest: boolean;
};

/**
 * The reduced profile: a name, a face, and a way to ask.
 *
 * Carries no counts, no badges, no plays and NO ACTIVITY — a "last seen" on an
 * otherwise-hidden profile would leak the one field people actually want from
 * someone who is hiding from them.
 */
export type MinimalProfile = ProfileBase & { visibility: "minimal" };

/** The full profile: everything a friend (or the owner) is entitled to. */
export type FullProfile = ProfileBase & {
  visibility: "full";
  /** Coarse. `null` when they have never played anything. */
  lastActive: ActivityRecency | null;
  /** A COUNT. There is no list, at any visibility — see the module docblock. */
  friendCount: number;
  /** The counts every badge rule is derived from; also fine as stat tiles. */
  stats: BadgeStats;
  badges: Badge[];
  /**
   * Empty for everyone but the owner, per the note on `lockedBadges()` in
   * `badges.ts`: on someone else's profile, a list of what they have not achieved
   * is a list of their shortcomings, which is a strange thing to publish about a
   * child.
   */
  lockedBadges: Badge[];
  /**
   * Admin-granted flair ("custom perks"). Unlike `badges` (derived) these are
   * conferred by an admin from the dashboard and STORED in `player_flair`. They
   * live only on the full shape, so a blocked or unentitled viewer never receives
   * them — the same structural guarantee that keeps counts and plays out of the
   * minimal profile.
   */
  flair: Flair[];
  recentPlays: RecentPlay[];
};

/**
 * A profile as seen by another player. Email-free by construction, in both
 * shapes, enforced by {@link PROFILE_IS_EMAIL_FREE}.
 *
 * The `visibility` tag is repeated here even though {@link ProfileLookup} already
 * carries it, and that redundancy is the point: a component that receives only
 * `profile` can still narrow to {@link FullProfile} on its own, so the badge wall
 * cannot be handed a minimal profile and quietly render an empty one.
 */
export type PublicProfile = MinimalProfile | FullProfile;

/**
 * Compile-time proof that no profile shape can carry an email.
 *
 * If either shape ever grows an `email` field, its assertion collapses to `never`
 * and this line stops compiling. That is the enforcement the module docblock
 * promises — a type, not a habit.
 */
type AssertEmailFree<T> = "email" extends keyof T ? never : true;
export const PROFILE_IS_EMAIL_FREE: AssertEmailFree<MinimalProfile> &
  AssertEmailFree<FullProfile> = true;

/**
 * The page's whole decision tree in one value.
 *
 * `{ found: false }` is returned for a name nobody holds, a name that could never
 * be held, AND a schema gap (see the fail-soft note on the reader). Those are
 * deliberately indistinguishable to the caller: every one of them means "there is
 * nothing to show here", and the differences between them are only interesting to
 * someone probing.
 */
export type ProfileLookup =
  | { found: false }
  | { found: true; visibility: "full"; profile: FullProfile }
  | { found: true; visibility: "minimal"; profile: MinimalProfile };

// ---------------------------------------------------------------------------
// Row decoding
// ---------------------------------------------------------------------------

function toInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Could this string be a username AT ALL?
 *
 * Deliberately LAXER than `validateUsernameFormat()`, which is the claim-time
 * validator: that one also rejects reserved words, double underscores and
 * all-digit names. Applying it here would mean that tightening the claim rules
 * retroactively 404s the profiles of everyone who claimed a name under the old
 * ones. This checks only what the `players_username_format_chk` CHECK constraint
 * makes structurally impossible to have in the column, so a `false` here is
 * genuinely "no row can match" and not "no row *should* have matched".
 *
 * The point is to skip the round trip on `/u/<garbage>`, which is most of the
 * traffic a guessable URL space gets.
 */
function couldBeUsername(username: string): boolean {
  return (
    username.length >= USERNAME_MIN_LENGTH &&
    username.length <= USERNAME_MAX_LENGTH &&
    /^[a-z0-9_]+$/.test(username)
  );
}

/**
 * Decide the viewer's relationship from the joined friendship row.
 *
 * `requestedByViewer` is computed in SQL rather than by comparing ids in JS,
 * which keeps `friendships.requested_by` — another player's Google subject id —
 * out of this process entirely.
 */
function toFriendshipState(input: {
  isOwner: boolean;
  status: string | null;
  requestedByViewer: boolean;
}): FriendshipState {
  if (input.isOwner) return "self";
  if (input.status === "accepted") return "friends";
  if (input.status === "pending") {
    return input.requestedByViewer ? "pending-out" : "pending-in";
  }
  return "none";
}

// ---------------------------------------------------------------------------
// The reader
// ---------------------------------------------------------------------------

export function createProfileReader(sqlClient: Sql) {
  // Composed rather than reimplemented: `badgeStats` is eight scalar subqueries
  // tuned to eight existing indexes, and a second copy of it here would drift
  // from the badge rules the first time a threshold moves.
  const social = createSocialStore(sqlClient);

  /**
   * The profile row plus everything about the VIEWER's relationship to it, in one
   * round trip.
   *
   * TWO FULLY-WRITTEN TEMPLATES, chosen in JS — the house rule, since the
   * `neon()` tagged template parameterises values and not fragments. The
   * signed-out shape is not the signed-in one with nulls bound into it: it has no
   * friendship join and no block lookup at all, because there is no viewer for
   * either to be about.
   *
   * `p.id` IS SELECTED and it is the only place the Google subject enters this
   * module. It is needed to key the two follow-up queries, it lives in a local
   * `const` in {@link getPublicProfileByUsername}, and there is no field on any
   * exported type it could be assigned to.
   *
   * `WHERE p.username = ${username}` with a lowercased binding, and NOT
   * `lower(p.username) = ...`: usernames are STORED lowercase precisely so that a
   * plain UNIQUE btree (`players_username_key`) IS the case-insensitive index —
   * see the CHECK-constraint comment in `007_social_graph.sql`. Wrapping the
   * column in `lower()` would make that index unusable and turn every profile
   * view into a sequential scan of the players table.
   */
  function selectProfileRow(username: string, viewerId: string | null) {
    if (viewerId === null) {
      return sqlClient`
        SELECT
          p.id,
          p.public_id,
          p.username,
          p.handle,
          p.image,
          p.profile_visibility,
          (SELECT count(*)::int FROM friendships fc
            WHERE fc.status = 'accepted'
              AND (fc.player_a = p.id OR fc.player_b = p.id))          AS friend_count,
          (SELECT max(pp.last_played) FROM player_plays pp
            WHERE pp.player_id = p.id)                                 AS last_active
        FROM players p
        WHERE p.username = ${username}
      `;
    }
    return sqlClient`
      SELECT
        p.id,
        p.public_id,
        p.username,
        p.handle,
        p.image,
        p.profile_visibility,
        (p.id = ${viewerId})                                           AS is_owner,
        f.status                                                       AS friend_status,
        (f.requested_by = ${viewerId})                                 AS requested_by_viewer,
        EXISTS (
          SELECT 1 FROM player_blocks b
          WHERE (b.blocker_id = p.id AND b.blocked_id = ${viewerId})
             OR (b.blocker_id = ${viewerId} AND b.blocked_id = p.id)
        )                                                              AS is_blocked,
        (SELECT count(*)::int FROM friendships fc
          WHERE fc.status = 'accepted'
            AND (fc.player_a = p.id OR fc.player_b = p.id))            AS friend_count,
        (SELECT max(pp.last_played) FROM player_plays pp
          WHERE pp.player_id = p.id)                                   AS last_active
      FROM players p
      LEFT JOIN friendships f
        ON (f.player_a = p.id AND f.player_b = ${viewerId})
        OR (f.player_a = ${viewerId} AND f.player_b = p.id)
      WHERE p.username = ${username}
    `;
  }

  /**
   * The most recent games this player opened, newest first.
   *
   * Served by `player_plays_recent_idx (player_id, last_played DESC)`. No recency
   * window: an old row is not wrong, it just coarsens to "a while ago", and
   * filtering by a window would make the ABSENCE of a game informative — an empty
   * shelf on an account with plays would say "this person has not been on in a
   * month", which is exactly the presence signal the coarsening removes.
   */
  function selectRecentPlays(playerId: string) {
    return sqlClient`
      SELECT pp.slug, pp.last_played
      FROM player_plays pp
      WHERE pp.player_id = ${playerId}
      ORDER BY pp.last_played DESC
      LIMIT ${PROFILE_RECENT_PLAYS}
    `;
  }

  /**
   * Admin-granted flair for this player, newest first.
   *
   * Inlined here rather than reached through the live `flair-store.ts` for the
   * same reason `badgeStats` is composed in: the reader is bound to a swappable
   * `sqlClient` so its whole result — flair included — is testable through the
   * fake-tagged-template seam, and importing the live store would tie it back to
   * the shared connection. The row shape is decoded by the shared `mapFlairRow`,
   * so the profile and the dashboard cannot drift on what a flair row means.
   *
   * Served by `player_flair_player_idx (player_id, created_at DESC)`.
   */
  function selectFlair(playerId: string) {
    return sqlClient`
      SELECT id, label, icon, tone
      FROM player_flair
      WHERE player_id = ${playerId}
      ORDER BY created_at DESC
    `;
  }

  /**
   * {@link selectFlair}, degraded to `[]` if and only if the `player_flair` table
   * is missing. `try/catch` rather than `.catch()` so it is robust to a driver
   * that throws SYNCHRONOUSLY as well as one that rejects — the same shape as the
   * outer guard in {@link getPublicProfileByUsername}. Every other error rethrows,
   * so a real outage stays loud (see the note where this is awaited).
   */
  async function safeFlair(playerId: string): Promise<Row[]> {
    try {
      return await selectFlair(playerId);
    } catch (error) {
      if (isMissingColumnError(error)) return [];
      throw error;
    }
  }

  return {
    /**
     * Resolve `/u/<username>` for `viewerId` (null when signed out).
     *
     * FAIL-SOFT ON A SCHEMA GAP. Migrations here are applied BY HAND (see
     * `scoreboard/migrations/`), so there is always a window where this code is
     * live against a database with no `username` column, no `friendships` and no
     * `player_plays`. `isMissingColumnError` turns that window into "no such
     * profile" instead of a 500 on a public page.
     *
     * Everything else RETHROWS, and that asymmetry is the point. `db.ts` is
     * explicit that this check must never be used to swallow errors generally,
     * and here the consequence is concrete: a Neon outage quietly rendering "no
     * such profile" would tell every viewer that their friend's account is gone.
     * A 500 is honest; a fabricated absence is not.
     */
    async getPublicProfileByUsername(
      username: string,
      viewerId: string | null,
    ): Promise<ProfileLookup> {
      // Lowercased in JS, never with `lower()` in the WHERE — see
      // `selectProfileRow`. `toLowerCase()` rather than `normalizeUsername()`
      // (which also NFKC-folds and trims) is enough because the charset gate
      // below rejects everything NFKC could have produced anyway, and this way
      // the value bound into the query is a plain substring of the URL.
      const wanted = username.trim().toLowerCase();
      if (!couldBeUsername(wanted)) return { found: false };

      let rows: Row[];
      try {
        rows = await selectProfileRow(wanted, viewerId);
      } catch (error) {
        if (isMissingColumnError(error)) return { found: false };
        throw error;
      }
      if (rows.length === 0) return { found: false };
      const row = rows[0];

      // The single point at which the Google subject id exists in this module.
      const playerId = String(row.id);
      const isOwner = Boolean(row.is_owner);
      const isBlocked = Boolean(row.is_blocked);
      const status = row.friend_status == null ? null : String(row.friend_status);
      const friendship = toFriendshipState({
        isOwner,
        status,
        requestedByViewer: Boolean(row.requested_by_viewer),
      });

      const base: ProfileBase = {
        publicId: String(row.public_id),
        username: String(row.username),
        displayName: publicDisplayName({
          handle: row.handle == null ? null : String(row.handle),
          username: row.username == null ? null : String(row.username),
        }),
        image: row.image == null ? null : String(row.image),
        friendship,
        canSendFriendRequest:
          viewerId !== null && !isOwner && !isBlocked && friendship === "none",
      };

      const detail = resolveVisibility({
        visibility: toProfileVisibility(row.profile_visibility),
        isOwner,
        isFriend: friendship === "friends",
        isBlocked,
      });

      if (detail === "minimal") {
        // Note what does NOT happen here: no badge query, no plays query. A
        // blocked or unentitled viewer costs one round trip, and the data they
        // are not allowed to see is never read, so it cannot be leaked by a
        // future refactor that widens the returned object.
        return {
          found: true,
          visibility: "minimal",
          profile: { ...base, visibility: "minimal" },
        };
      }

      // Independent statements, issued together. `neon()` is stateless
      // SQL-over-HTTP with no pooling and no cross-statement transaction, so
      // there is nothing to serialise them for: awaiting in sequence would just
      // add a network round trip to every full profile view.
      //
      // FLAIR FAILS SOFT ON A MISSING TABLE, and only that. `player_flair` is the
      // newest table here, so there is a deploy window where this code is live
      // against a database that has not run `014_player_flair.sql`. That must
      // degrade to "no flair" — an empty pill row — not a 500 on a public profile.
      // Every other error rethrows, exactly as `getPublicProfileByUsername`'s own
      // guard does: an outage has to stay loud, or a profile silently sheds its
      // flair during one and nobody can reproduce it.
      const [stats, playRows, flairRows] = await Promise.all([
        social.badgeStats(playerId),
        selectRecentPlays(playerId),
        safeFlair(playerId),
      ]);

      // One `now` for the whole render, so two games played minutes apart cannot
      // land in different buckets and imply an ordering finer than the buckets.
      const now = new Date();

      return {
        found: true,
        visibility: "full",
        profile: {
          ...base,
          visibility: "full",
          lastActive: coarsenActivity(row.last_active as string | null, now),
          friendCount: toInt(row.friend_count),
          stats,
          badges: earnedBadges(stats),
          lockedBadges: isOwner ? lockedBadges(stats) : [],
          flair: flairRows.map(mapFlairRow),
          recentPlays: playRows.map((play) => ({
            slug: String(play.slug),
            recency: coarsenActivity(play.last_played as string | null, now),
          })),
        },
      };
    },
  };
}

export type ProfileReader = ReturnType<typeof createProfileReader>;

/** The live reader, bound to the shared Neon client. */
const reader = createProfileReader(sql);

/**
 * Resolve `/u/<username>` for a viewer, or `{ found: false }`.
 *
 * THE ONLY function a profile page should call. `viewerId` is
 * `session.user.playerId` — never `session.user.id`, which `app/lib/auth.ts`
 * documents is a fresh random UUID on every login and would silently make every
 * viewer a stranger to every profile (and, worse, would make an owner look like
 * one, so their own private profile would render minimal to them).
 */
export function getPublicProfileByUsername(
  username: string,
  viewerId: string | null,
): Promise<ProfileLookup> {
  return reader.getPublicProfileByUsername(username, viewerId);
}
