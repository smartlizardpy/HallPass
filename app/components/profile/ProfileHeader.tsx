import Link from "next/link";
import { Avatar } from "@/app/components/friends/Avatar";
import type { PublicProfile } from "@/app/lib/profile";
import { RecencyChip } from "./Recency";

/**
 * The identity card at the top of `/u/<username>` — the only part of the page
 * that renders at BOTH visibilities.
 *
 * It takes the whole {@link PublicProfile} union rather than a minimal one, so
 * the narrowing happens here, once, on the `visibility` tag. Everything that is
 * full-only (friend count, activity, relationship) sits inside that branch, which
 * is what makes "minimal shows a face, a name, and a way to ask — nothing else" a
 * property of the code rather than of a checklist. A component that took loose
 * props could be handed a friend count for a private profile by a future caller;
 * this one cannot, because the type it narrows to has no such field.
 *
 * THE AVATAR IS `components/friends/Avatar`, not a local copy. That component
 * carries `referrerPolicy="no-referrer"`, which is not decoration:
 * `players.image` is a Google-hosted URL, and without it every avatar render
 * tells Google which profile page the viewer is looking at. One avatar renderer
 * means one place that rule can be forgotten, so its fixed fallback type scale is
 * a price worth paying at hero size.
 *
 * THE NAME IS `publicDisplayName()`'s output, computed upstream in
 * `app/lib/profile.ts`. The Google `name` field is a child's full real name on a
 * school account and is never SELECTed, so there is nothing here to leak.
 *
 * FRIEND COUNT, NEVER A FRIEND LIST — see the module docblock in `profile.ts`. A
 * list of a pupil's friends at a guessable public URL is a map of a school's
 * social graph assembled from outside it; the count carries the useful half
 * ("this account is real and connected") and none of the surveillance.
 */

/** Static relationship pills. Full profiles only — see the branch below. */
const RELATIONSHIP_PILL = "rounded-full px-3 py-1 text-[12px] font-black";

export function ProfileHeader({
  profile,
  action,
}: {
  profile: PublicProfile;
  /**
   * The friend button, injected by the page so this stays a server component.
   * Absent — not disabled — whenever `canSendFriendRequest` is false.
   */
  action?: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl bg-white p-5 sm:p-8">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <div className="shrink-0">
          <Avatar person={profile} size={96} />
        </div>

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-black tracking-tight text-zinc-900 sm:text-3xl">
            {profile.displayName}
          </h1>
          {/* The @username is shown even when it IS the display name (a player
              with no handle renders as "@sam" above). It is the address people
              type to find each other, so it is worth repeating as a stable,
              copyable line rather than hiding when the two happen to match. */}
          <p className="mt-0.5 truncate text-[15px] font-bold text-muted">
            @{profile.username}
          </p>

          {profile.visibility === "full" && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-[12px] font-black text-brand">
                {profile.friendCount}{" "}
                {profile.friendCount === 1 ? "friend" : "friends"}
              </span>
              <RecencyChip recency={profile.lastActive} prefix="Active" />
            </div>
          )}

          {/* The relationship, stated once, statically. Deliberately NOT on a
              minimal profile: "Friends" on an otherwise-hidden page would tell a
              blocked viewer that the block is the reason the page is empty.

              `pending-in` links to /play/friends rather than offering Accept
              here. Accepting is a decision about a person, and the place to make
              it is the screen that shows you every request at once — not a page
              you may have landed on from a link they sent you. */}
          {profile.visibility === "full" && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {profile.friendship === "self" && (
                <span className={`${RELATIONSHIP_PILL} bg-surface-2 text-zinc-700`}>
                  This is you
                </span>
              )}
              {profile.friendship === "friends" && (
                <span className={`${RELATIONSHIP_PILL} bg-emerald-50 text-emerald-900`}>
                  Friends
                </span>
              )}
              {profile.friendship === "pending-out" && (
                <span className={`${RELATIONSHIP_PILL} bg-surface-2 text-muted`}>
                  Request sent
                </span>
              )}
              {profile.friendship === "pending-in" && (
                <Link
                  href="/play/friends"
                  className={`${RELATIONSHIP_PILL} bg-accent-pink text-white transition hover:opacity-90`}
                >
                  Wants to be friends →
                </Link>
              )}
            </div>
          )}
        </div>

        {action && <div className="shrink-0 sm:self-center">{action}</div>}
      </div>
    </section>
  );
}
