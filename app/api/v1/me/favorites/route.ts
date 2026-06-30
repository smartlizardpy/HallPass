/**
 * HallPass per-player favorites endpoint — `GET|POST|DELETE|PUT|OPTIONS
 * /api/v1/me/favorites`.
 *
 * The signed-in sync backend for the browser favorites store
 * (`app/lib/personalization.ts`). Like `/api/v1/me/handle`, every mutation is a
 * CREDENTIALED action keyed by the Auth.js SESSION COOKIE, so it is SAME-ORIGIN
 * only (our own client calls it). The player is derived ENTIRELY from the session
 * — never from the request body — so a player can only ever read or mutate THEIR
 * OWN favorites.
 *
 * CORS, deliberately minimal (mirrors `/api/v1/me/handle`): a same-origin,
 * cookie-credentialed surface emits NO wildcard `Access-Control-Allow-Origin` (a
 * wildcard origin cannot legally carry credentials). Every response is
 * `private, no-store` — it is per-user and must never be cached by a shared CDN.
 *
 * Methods:
 *   GET    → { signedIn, favorites }   (guest: { signedIn:false, favorites:[] })
 *   POST   { slug }        → add a favorite for the signed-in player
 *   DELETE { slug }        → remove a favorite for the signed-in player
 *   PUT    { slugs:[] }    → merge (union) a batch, returns { favorites }
 *
 * FAIL-SOFT: reading `auth()` and every DB call is wrapped so a hiccup degrades
 * gracefully — a failed identity read looks like "not signed in", and the
 * favorites helpers already return `[]`/no-op on a DB error (mirrors `/api/v1/me`).
 */

import { auth } from "@/app/lib/auth";
import {
  addFavorite,
  listFavorites,
  mergeFavorites,
  removeFavorite,
} from "@/app/lib/favorites";
import type { Session } from "next-auth";

const NO_STORE: Record<string, string> = { "Cache-Control": "private, no-store" };

/**
 * The signed-in player's id, or `null` for a guest. Reading `auth()` must never
 * throw to the caller: any failure → no session → treated exactly like "not
 * signed in" (the same answer a cross-origin/cookie-less call gets).
 */
async function currentPlayerId(): Promise<string | null> {
  let session: Session | null = null;
  try {
    session = await auth();
  } catch (error) {
    console.error("me/favorites auth() failed:", error);
    session = null;
  }
  return session?.user?.playerId ?? null;
}

/** Parse a non-empty `slug` string from the JSON body, or `null` if absent/invalid. */
async function readSlug(req: Request): Promise<string | null> {
  try {
    const body = (await req.json()) as { slug?: unknown };
    return typeof body?.slug === "string" && body.slug.length > 0 ? body.slug : null;
  } catch {
    return null;
  }
}

export async function GET(): Promise<Response> {
  const playerId = await currentPlayerId();
  if (!playerId) {
    return Response.json({ signedIn: false, favorites: [] }, { headers: NO_STORE });
  }
  // listFavorites is already fail-soft (→ []); the wrapper is belt-and-braces so
  // an unexpected throw still degrades to an empty list rather than a 500.
  let favorites: string[] = [];
  try {
    favorites = await listFavorites(playerId);
  } catch (error) {
    console.error("me/favorites GET listFavorites failed:", error);
  }
  return Response.json({ signedIn: true, favorites }, { headers: NO_STORE });
}

export async function POST(req: Request): Promise<Response> {
  const playerId = await currentPlayerId();
  if (!playerId) {
    return Response.json({ ok: false }, { status: 401, headers: NO_STORE });
  }
  const slug = await readSlug(req);
  if (!slug) {
    return Response.json({ ok: false }, { status: 400, headers: NO_STORE });
  }
  try {
    await addFavorite(playerId, slug);
  } catch (error) {
    console.error("me/favorites POST addFavorite failed:", error);
  }
  return Response.json({ ok: true }, { headers: NO_STORE });
}

export async function DELETE(req: Request): Promise<Response> {
  const playerId = await currentPlayerId();
  if (!playerId) {
    return Response.json({ ok: false }, { status: 401, headers: NO_STORE });
  }
  const slug = await readSlug(req);
  if (!slug) {
    return Response.json({ ok: false }, { status: 400, headers: NO_STORE });
  }
  try {
    await removeFavorite(playerId, slug);
  } catch (error) {
    console.error("me/favorites DELETE removeFavorite failed:", error);
  }
  return Response.json({ ok: true }, { headers: NO_STORE });
}

export async function PUT(req: Request): Promise<Response> {
  const playerId = await currentPlayerId();
  if (!playerId) {
    return Response.json({ ok: false }, { status: 401, headers: NO_STORE });
  }
  let slugs: string[] = [];
  try {
    const body = (await req.json()) as { slugs?: unknown };
    if (Array.isArray(body?.slugs)) {
      slugs = body.slugs.filter((s): s is string => typeof s === "string");
    }
  } catch {
    slugs = [];
  }
  // mergeFavorites validates + de-dupes the batch and is itself fail-soft (→ []).
  let favorites: string[] = [];
  try {
    favorites = await mergeFavorites(playerId, slugs);
  } catch (error) {
    console.error("me/favorites PUT mergeFavorites failed:", error);
  }
  return Response.json({ favorites }, { headers: NO_STORE });
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Methods": "GET, POST, DELETE, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
