/**
 * Which deploy a running page came from, and whether it has been left behind.
 *
 * `NEXT_PUBLIC_BUILD_ID` is stamped in `next.config.ts` from the commit being
 * built, so it is INLINED into the client bundle at build time: a page that has
 * been open for days still carries the id of the deploy that served it, while
 * `/games-version` answers with the id of the deploy running NOW. The gap
 * between the two is the stale-installed-app condition — an app resumed from the
 * background on old JavaScript — that left the tab bar accepting taps its router
 * would never finish.
 */

export const CLIENT_BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";

/** The deploy answering requests now. Server-only in practice. */
export function serverBuildId(): string {
  return (
    process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_BUILD_ID ?? "dev"
  );
}

/**
 * Is the page behind the server? `dev` on either side, or a missing id, is
 * "unknown", and unknown is never stale: a local build or an older server that
 * does not report an id must not put every client into a reload loop.
 */
export function isStaleBuild(client: string, server: string | undefined): boolean {
  if (!server || server === "dev" || client === "dev") return false;
  return client !== server;
}
