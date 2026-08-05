/**
 * HallPass — issues a client-upload token for a beta replay clip.
 *
 * WHY THE CLIP DOES NOT GO THROUGH A SERVER ACTION like every other upload in
 * this codebase. Vercel caps a function's REQUEST BODY at 4.5 MB, and that cap
 * is the platform's — `experimental.serverActions.bodySizeLimit: "25mb"` in
 * `next.config.ts` raises Next's own limit underneath it and cannot lift it. A
 * 30-second clip is 3–6 MB, i.e. straddling that line: it would work in testing
 * and fail on the reports that matter, which are the long, eventful ones.
 *
 * `@vercel/blob/client` solves it by having the BROWSER PUT straight to Blob
 * storage using a short-lived token this route mints. The bytes never traverse a
 * function, so the size cap does not apply — and per Vercel's pricing docs,
 * client uploads also incur no data-transfer charge, which server uploads do.
 *
 * ── THE TOKEN IS THE SECURITY BOUNDARY ──────────────────────────────────────
 * Because the browser uploads directly, `onBeforeGenerateToken` is the ONLY
 * place authorisation can happen. It runs before a token exists and therefore
 * before any bytes can be written. It checks programme membership, pins the
 * pathname prefix so a token cannot be repurposed to overwrite something else,
 * and restricts the accepted content types.
 *
 * NOTHING IS WRITTEN TO THE DATABASE HERE. `onUploadCompleted` cannot be
 * reached by Vercel on localhost, so making the row depend on it would mean the
 * feature silently never works in development. The client reports the finished
 * URL back through `submitReportAction` instead, which re-derives the player
 * from the session — so a forged callback can attach a clip to nothing.
 */

import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { auth } from "@/app/lib/auth";
import { beta } from "@/app/lib/beta";
import { isResolvedSlug } from "@/app/lib/games-store";

const NO_STORE: Record<string, string> = { "Cache-Control": "private, no-store" };

/** Containers a replay may be. Mirrors `pickMimeType()` in `replay-buffer.ts`. */
const ALLOWED = ["video/webm", "video/mp4"];

export async function POST(request: Request): Promise<Response> {
  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400, headers: NO_STORE });
  }

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        // Authorisation, and the only chance to do it — see the docblock.
        const session = await auth();
        const playerId = session?.user?.playerId;
        if (!playerId) throw new Error("Not signed in");

        const allowed =
          Boolean(session?.user?.role) || (await beta.isActiveTester(playerId));
        if (!allowed) throw new Error("Not a beta tester");

        // The slug is the second path segment: beta-clips/<slug>/<id>.webm.
        // Validating it stops a token being minted for a path that no game owns.
        const slug = pathname.split("/")[1] ?? "";
        if (!pathname.startsWith("beta-clips/") || !(await isResolvedSlug(slug))) {
          throw new Error("Bad path");
        }

        return {
          allowedContentTypes: ALLOWED,
          // Pins the prefix into the token itself, so it cannot be replayed to
          // write over `games/` or `game-media/`.
          allowedPathPrefix: `beta-clips/${slug}/`,
          addRandomSuffix: false,
          // A clip is evidence attached to one report and is never re-fetched
          // after triage resolves it, so there is nothing to gain from a long
          // cache and something to lose from a stale one.
          cacheControlMaxAge: 3600,
          tokenPayload: JSON.stringify({ playerId, slug }),
        };
      },
      onUploadCompleted: async () => {
        // Intentionally empty. Vercel cannot reach a localhost callback, so any
        // logic here would work in production and silently not in development.
        // The client tells us the URL via submitReportAction instead.
      },
    });
    return Response.json(result, { headers: NO_STORE });
  } catch (error) {
    // handleUpload throws for a refused token as well as a malformed body; both
    // are a 400 to the caller, and the reason is logged rather than returned so
    // a probe learns nothing about why it was refused.
    console.error("beta clip-token failed:", error);
    return Response.json({ error: "Upload not allowed" }, { status: 400, headers: NO_STORE });
  }
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
