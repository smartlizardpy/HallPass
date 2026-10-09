/**
 * HallPass — issues a client-upload token for a game's SOURCE (an `.html` or a
 * `.zip` bundle) from the dashboard's game control center.
 *
 * WHY THE FILE DOES NOT GO THROUGH THE SERVER ACTION. Vercel caps a function's
 * REQUEST BODY at 4.5 MB whatever `bodySizeLimit` says, so posting the file to
 * `uploadBundleAction` 413'd every zip over 4.5 MB. The browser now PUTs it to a
 * temporary `game-uploads/<slug>/…` path with a token from here, and the action
 * is handed only that path. See `app/lib/game-upload.ts` for the whole flow and
 * `api/v1/beta/clip-token` for the same pattern applied to replay clips.
 *
 * ── THE TOKEN IS THE SECURITY BOUNDARY ──────────────────────────────────────
 * Once a token exists the browser writes to the store directly, so this is the
 * only place the upload itself can be authorised:
 *   - the caller is a dashboard ADMIN — the same `requireRole("admin")` floor the
 *     upload actions apply, checked against the live session;
 *   - the path is exactly `game-uploads/<slug>/<id>.(html|zip)` for a game in the
 *     catalogue (`parseUploadPath`), and `handleUpload` signs the token for that
 *     one pathname, so it cannot be replayed to write anywhere else — least of
 *     all over a live `games/` file;
 *   - the content type and the size cap are the ones for that kind of file, so
 *     the store refuses an oversized PUT before it costs anything.
 *
 * ── THE TOKEN IS ALSO THE KILL SWITCH ───────────────────────────────────────
 * The browser's PUT is an advanced Blob operation like any other, so refusing to
 * mint the token is the only place `game_source` can stop it. The action checks
 * the switch again before publishing, as it always has.
 *
 * NOTHING IS PUBLISHED HERE, and `onUploadCompleted` is empty: Vercel cannot
 * reach a localhost callback, so anything done there would work in production
 * and silently not in development. The form calls the upload action itself once
 * the PUT resolves, and that action re-checks the role before it reads a byte.
 */

import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { auth } from "@/app/lib/auth";
import { isBlobOpEnabled } from "@/app/lib/blob-ops";
import {
  MAX_UPLOAD_BYTES,
  UPLOAD_CONTENT_TYPE,
  parseUploadPath,
} from "@/app/lib/game-upload";
import { games } from "@/app/lib/games";
import { atLeast } from "@/app/lib/permissions";

const NO_STORE: Record<string, string> = { "Cache-Control": "private, no-store" };

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
        const role = (await auth())?.user?.role;
        if (!role || !atLeast(role, "admin")) throw new Error("Not an admin");

        // The same static-catalogue check the upload actions make, so a token is
        // never minted for an upload its action would refuse as "Unknown game".
        const target = parseUploadPath(pathname);
        if (!target || !games.some((g) => g.slug === target.slug)) {
          throw new Error("Bad path");
        }

        if (!(await isBlobOpEnabled("game_source"))) {
          throw new Error("Game source publishing is switched off");
        }

        return {
          allowedContentTypes: [UPLOAD_CONTENT_TYPE[target.kind]],
          maximumSizeInBytes: MAX_UPLOAD_BYTES[target.kind],
          addRandomSuffix: false,
          allowOverwrite: false,
          // Read once, by the action, then deleted — the store's minimum.
          cacheControlMaxAge: 60,
        };
      },
      onUploadCompleted: async () => {
        // Intentionally empty — see the docblock.
      },
    });
    return Response.json(result, { headers: NO_STORE });
  } catch (error) {
    // A refused token and a malformed body are both a 400. The reason is logged,
    // not returned: `upload()` in the browser discards the body anyway, and the
    // form says what to do next from its own side.
    console.error("game upload-token failed:", error);
    return Response.json({ error: "Upload not allowed" }, { status: 400, headers: NO_STORE });
  }
}
