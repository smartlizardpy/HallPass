/**
 * HallPass — the browser-to-Blob path for a game's SOURCE upload.
 *
 * ── WHY A GAME'S FILE NO LONGER GOES THROUGH THE SERVER ACTION ─────────────
 * Vercel caps a function's REQUEST BODY at 4.5 MB, and that cap is the
 * platform's — `experimental.serverActions.bodySizeLimit` in `next.config.ts`
 * raises Next's own limit underneath it and cannot lift it. Posting the file to
 * `uploadBundleAction` therefore failed with a 413 for any zip over 4.5 MB, long
 * before the bundle's own 50 MB cap was reachable, and a single HTML file was
 * held to 2 MB by a check that predated the problem.
 *
 * So the browser PUTs the file straight to Blob, into a TEMPORARY path under
 * {@link UPLOAD_PREFIX}, with a short-lived token minted by
 * `api/v1/admin/game-upload-token` — the same shape the beta replay clips use
 * (`api/v1/beta/clip-token`). The upload action then receives only that path,
 * fetches the bytes server-side (a response, which streams, not a request body),
 * runs exactly the validation it always ran, publishes to `games/<slug>/` as
 * before, and deletes the temporary file.
 *
 * The temporary file is NOT the published copy and is never served: it lives
 * outside `games/`, so the serving index, the reindex sweep and `sync-games`
 * (every one of them scoped to `games/`) never see it.
 *
 * ONLY A FILE TOO BIG FOR THE FORM TAKES THIS ROUTE. The trip through Blob is a
 * billed `put` (an advanced operation) plus a read back, and it buys nothing for
 * a file the action could have received directly — which is every game in the
 * catalogue today. So a file up to {@link DIRECT_UPLOAD_MAX_BYTES} is still
 * posted in the form, as it always was, and only a bigger one goes via Blob.
 *
 * Deliberately imports NOTHING, like `game-html-blob.ts`: the token route, the
 * upload actions and the browser form all share these helpers, and the browser
 * must not drag a blob client or `server-only` along with them.
 */

/** Which of the two source forms an upload came from. */
export type SourceUploadKind = "html" | "zip";

/** Where a source upload waits between the browser's PUT and the publish. */
export const UPLOAD_PREFIX = "game-uploads/";

const MB = 1024 * 1024;

/**
 * The largest file each form accepts, in bytes. Enforced twice: by the token
 * (`maximumSizeInBytes`, so the store itself refuses a bigger PUT) and again by
 * the action on the bytes it actually fetched.
 *
 * HTML matches a bundle's per-file cap — a single-file game is a one-file
 * bundle, so it gets the same room as one file inside a zip. The zip matches the
 * bundle's UNZIPPED total: an archive is never larger than what it inflates to
 * by more than its headers, so a zip well over 50 MB could only fail that check
 * after costing the upload.
 */
export const MAX_UPLOAD_BYTES: Record<SourceUploadKind, number> = {
  html: 10 * MB,
  zip: 50 * MB,
};

/**
 * The largest file the form posts DIRECTLY to the action, skipping Blob.
 *
 * Below Vercel's 4.5 MB request cap with room to spare for the multipart
 * envelope around the file and the form's other fields, so a file at exactly
 * this size still reaches the action. Anything larger goes via Blob.
 */
export const DIRECT_UPLOAD_MAX_BYTES = 4 * MB;

/** The cap as an admin reads it in a banner: "10 MB". */
export function uploadLimitLabel(kind: SourceUploadKind): string {
  return `${MAX_UPLOAD_BYTES[kind] / MB} MB`;
}

/**
 * The content type the browser sends and the token accepts, one per kind.
 *
 * Set explicitly by the form rather than read off `File.type`, which is
 * whatever the OS says — Windows labels a zip `application/x-zip-compressed`,
 * and an HTML file saved without its extension has no type at all. The bytes
 * are validated server-side anyway; this only has to agree with the token.
 */
export const UPLOAD_CONTENT_TYPE: Record<SourceUploadKind, string> = {
  html: "text/html",
  zip: "application/zip",
};

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const UPLOAD_PATH_RE = /^game-uploads\/([a-z0-9][a-z0-9-]*)\/([a-z0-9-]{8,64})\.(html|zip)$/;

/**
 * A fresh temporary path for one upload: `game-uploads/<slug>/<id>.<ext>`.
 *
 * The id is time plus randomness rather than `crypto.randomUUID()`, which only
 * exists in a secure context — and the dev server is also opened over a LAN IP
 * (`allowedDevOrigins`), which is not one. It only has to keep two concurrent
 * uploads apart; it is not a secret, because the token is what authorises.
 */
export function newUploadPath(slug: string, kind: SourceUploadKind): string {
  if (!SLUG_RE.test(slug)) throw new Error(`Not a game slug: "${slug}"`);
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${UPLOAD_PREFIX}${slug}/${id}.${kind}`;
}

/**
 * Read a temporary path back into the game and form it belongs to, or `null`
 * when it is not one.
 *
 * Both the token route and the upload actions take the path from the browser,
 * so this is the gate that stops one game's upload being published as another's
 * and a token being minted for anywhere but this prefix. The pattern is exact —
 * one slug segment, one id, a known extension — so there is no traversal or
 * nesting for a caller to smuggle through it.
 */
export function parseUploadPath(
  pathname: string,
): { slug: string; kind: SourceUploadKind } | null {
  const match = UPLOAD_PATH_RE.exec(pathname);
  if (!match) return null;
  return { slug: match[1], kind: match[3] as SourceUploadKind };
}
