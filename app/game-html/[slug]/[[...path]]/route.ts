import { head } from "@vercel/blob";
import { notFound } from "next/navigation";
import {
  blobPathForAsset,
  contentTypeForPath,
  isSafeSegment,
} from "@/app/lib/game-html-blob";
import { games } from "@/app/lib/games";

const MAX_PATH_SEGMENTS = 10;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string; path?: string[] }> },
) {
  const { slug, path } = await params;
  if (!games.some((g) => g.slug === slug)) notFound();

  const segments = path ?? [];
  if (segments.length > MAX_PATH_SEGMENTS || !segments.every(isSafeSegment)) {
    return new Response("Bad path", { status: 400 });
  }
  // Empty path = the game document itself; non-empty = a bundled asset.
  const relPath = segments.length === 0 ? "index.html" : segments.join("/");

  const origin = new URL(req.url).origin;
  const staticUrl = `${origin}/games/${slug}/${
    segments.length === 0
      ? "index.html"
      : segments.map(encodeURIComponent).join("/")
  }`;

  let meta: { url: string; contentType?: string } | null = null;
  try {
    meta = await head(blobPathForAsset(slug, relPath));
  } catch {
    meta = null;
  }

  if (!meta) {
    return Response.redirect(staticUrl, 307);
  }

  const upstream = await fetch(meta.url, { cache: "no-store" });
  if (!upstream.ok || !upstream.body) {
    return Response.redirect(staticUrl, 307);
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type":
        relPath === "index.html"
          ? "text/html; charset=utf-8"
          : meta.contentType || contentTypeForPath(relPath),
      "content-disposition": "inline",
      "cache-control": "public, max-age=60, s-maxage=60",
      "x-content-type-options": "nosniff",
    },
  });
}
