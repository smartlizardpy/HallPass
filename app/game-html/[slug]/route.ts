import { head } from "@vercel/blob";
import { notFound } from "next/navigation";
import { blobPathForSlug } from "@/app/lib/game-html-blob";
import { games } from "@/app/lib/games";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!games.some((g) => g.slug === slug)) notFound();

  const origin = new URL(req.url).origin;

  let blobUrl: string | null = null;
  try {
    const meta = await head(blobPathForSlug(slug));
    blobUrl = meta.url;
  } catch {
    blobUrl = null;
  }

  if (!blobUrl) {
    return Response.redirect(`${origin}/games/${slug}/index.html`, 307);
  }

  const upstream = await fetch(blobUrl, { cache: "no-store" });
  if (!upstream.ok || !upstream.body) {
    return Response.redirect(`${origin}/games/${slug}/index.html`, 307);
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-disposition": "inline",
      "cache-control": "public, max-age=60, s-maxage=60",
      "x-content-type-options": "nosniff",
    },
  });
}
