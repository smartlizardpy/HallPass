/**
 * HallPass — where a credentialed social request came from.
 *
 * Split out of `request-guard.ts` so it carries no `auth` import and can be unit
 * tested in the plain `node` environment. This is the "where", not the "who".
 *
 * WHY IT EXISTS. Games are served from `/game-html/<slug>/` on OUR OWN ORIGIN,
 * inside an iframe with no `sandbox` attribute, so a game's JavaScript runs with
 * the player's session cookie and can call the social endpoints directly. Today
 * every game is reviewed before upload and only two trusted people upload them,
 * so this is defence in depth rather than the primary control — but a review can
 * miss something and this costs a few lines.
 *
 * `Sec-Fetch-Site` cannot help: the iframe genuinely IS same-origin and sends
 * exactly what a legitimate page sends. The referrer is what separates them — a
 * fetch from inside the game frame carries `/game-html/…`, one from our own UI
 * carries the page the user is looking at.
 *
 * IT IS AN ALLOWLIST, NOT A DENYLIST, and that is the whole point: a game can set
 * `<meta name="referrer" content="no-referrer">` in its own HTML to suppress the
 * header entirely, which would sail straight past a "reject if it looks like a
 * game" rule. Requiring a referrer from a known app path fails closed instead.
 *
 * HONEST LIMITS. This closes the silent background-request path — the one that
 * scales to mass harassment. It does not stop a game that navigates the top frame
 * to a real page. The complete fix is an iframe sandbox with an opaque origin,
 * which would cost the 8 games using localStorage their saved progress and the
 * SDK its identity call; deliberately not paid here.
 */

/**
 * App paths a credentialed social mutation may legitimately originate from.
 *
 * Everything a user can actually press one of these buttons on. `/game-html/` is
 * conspicuously absent, which is the entire point.
 *
 * ── ADDING A PATH HERE IS ROUTINE; FORGETTING TO IS NOT ──────────────────────
 * The rule this list encodes is "a first-party page we render", and the only
 * thing it is really excluding is `/game-html/`. So any NEW app surface that
 * makes a credentialed write must be added, and the failure mode when it is not
 * is nasty: the write 403s with a deliberately vague body, the calling UI has no
 * `reason` to show, and it looks like the feature is broken rather than blocked.
 *
 * That is exactly what happened to `/beta/` — the tester session screen posts the
 * playtest review through the ordinary reviews endpoint, the referrer matched
 * nothing, and because a review is REQUIRED to finish an assignment, every
 * assignment on the programme was unfinishable. It was reported as "reviews are
 * broken", which is all the UI was able to say.
 */
const ALLOWED_REFERER_PREFIXES = [
  "/play/", // account, friends, sign-in flows
  "/u/", // profile pages
  "/game/", // store pages (friend chip, comment box)
  "/category/",
  "/beta/", // tester session screen — posts the required playtest review
];

/**
 * Whether a mutating request came from one of our own pages.
 *
 * Same-origin is required as well as path: a referrer from another site tells us
 * nothing useful, and cross-origin credentialed calls are already impossible here
 * (no wildcard CORS header is ever sent).
 */
export function isTrustedOrigin(req: Request): boolean {
  const referer = req.headers.get("referer");
  if (!referer) return false;

  let url: URL;
  try {
    url = new URL(referer);
  } catch {
    return false;
  }

  const self = new URL(req.url);
  if (url.origin !== self.origin) return false;

  // `/` alone is allowed explicitly — the catalog root has no trailing segment to
  // match a prefix against.
  if (url.pathname === "/") return true;
  return ALLOWED_REFERER_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}
