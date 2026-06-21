import type { NextRequest } from "next/server";
import { games } from "@/app/lib/games";
import {
  appendScore,
  boardExists,
  clampLimit,
  getBoard,
  type Period,
  type ScoreEntry,
} from "@/app/lib/scoreboard";
import {
  allowSubmit,
  clientKeyFromHeaders,
  isValidScore,
  MAX_SCORE,
  sanitizeHandle,
} from "@/app/lib/scoreboard-guard";

// Read-only board data is safe to expose cross-origin so any embedded/standalone
// game can fetch its scores. The board read itself is cached in the data layer.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(body, {
    status,
    headers: { ...CORS_HEADERS, ...extra },
  });
}

function isKnownSlug(slug: string): boolean {
  return games.some((g) => g.slug === slug);
}

function parsePeriod(value: string | null): Period {
  return value === "day" ? "day" : "all";
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  if (!isKnownSlug(slug)) {
    return json({ error: "Unknown game" }, 404);
  }

  const sp = req.nextUrl.searchParams;
  const limit = clampLimit(Number(sp.get("limit") ?? 10));
  const period = parsePeriod(sp.get("period"));

  const board = await getBoard(slug, { limit, period });
  return json(
    { game: board.game, scores: board.scores },
    200,
    // Allow the CDN/browser to reuse the response briefly; the data layer also
    // caches the upstream Pantry read.
    { "Cache-Control": "public, max-age=15, s-maxage=45" }
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  if (!isKnownSlug(slug)) {
    return json({ error: "Unknown game" }, 404);
  }

  // Soft origin check: if an Origin header is present and is clearly a different
  // site, reject. Same-origin and missing-origin (server-to-server) are allowed.
  // This is a weak signal (Origin can be spoofed by non-browser clients) — the
  // real protection is the TODO'd HMAC session token. See scoreboard-guard.ts.
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      const reqHost = req.nextUrl.host;
      const originHost = new URL(origin).host;
      if (originHost !== reqHost) {
        return json({ error: "Cross-origin submissions are not allowed" }, 403);
      }
    } catch {
      // Unparseable Origin — let it through; the rate limiter still applies.
    }
  }

  // Best-effort per-IP rate limit (non-durable in serverless; see guard module).
  const key = clientKeyFromHeaders(req.headers);
  if (!allowSubmit(key)) {
    return json({ error: "Too many submissions, slow down" }, 429);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { score, handle } = (body ?? {}) as {
    score?: unknown;
    handle?: unknown;
  };

  if (!isValidScore(score)) {
    return json(
      { error: `score must be a finite number in [0, ${MAX_SCORE}]` },
      400
    );
  }

  // The board must already be initialized — PUT can't create a basket, and we
  // don't let arbitrary callers spawn boards for un-curated slugs.
  if (!(await boardExists(slug))) {
    return json(
      {
        error:
          "Board not initialized. Ask the site owner to run POST /api/v1/scoreboard/init.",
      },
      409
    );
  }

  const entry: ScoreEntry = {
    h: sanitizeHandle(handle),
    s: score,
    t: Date.now(),
  };

  const result = await appendScore(slug, entry);
  if (!result.ok) {
    return json({ error: "Could not record score, try again" }, 502);
  }

  return json({ ok: true, rank: result.rank });
}
