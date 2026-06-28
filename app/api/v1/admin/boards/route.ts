/**
 * HallPass admin board provisioning — `POST|GET /api/v1/admin/boards`.
 *
 * Server-to-server / operator surface, NOT a browser endpoint: there are
 * deliberately NO CORS headers here. Every request is gated by
 * `verifyAdminSecret`, which distinguishes three outcomes:
 *   - unconfigured (no admin secret/password set) → 503, the feature is not
 *     provisioned (a server condition, not a client error);
 *   - unauthorized (missing/wrong secret) → 401;
 *   - ok → proceed.
 *
 * POST creates (or idempotently updates) a board. The board's own `slug` is its
 * free-form id and need not name a game; an optional `gameSlug` links it to one
 * (validation lives in the shared `parseCreateBoardInput`). A brand-new board
 * answers 201, an idempotent update answers 200, so a caller can tell whether
 * provisioning actually happened.
 */

import { games } from "@/app/lib/games";
import { store, verifyAdminSecret } from "@/app/lib/scoreboard";
import {
  parseCreateBoardInput,
  type RawBoardInput,
} from "@/app/lib/scoreboard/board-input";
import type {
  ApiError,
  BoardConfig,
  CreateBoardResponse,
} from "@/sdk/src/contract";

/** Games-list membership test injected into the shared board validator. */
const isKnownGame = (s: string): boolean => games.some((g) => g.slug === s);

/** Map the three auth outcomes to an early Response, or null to continue. */
function authGate(headers: Headers): Response | null {
  const result = verifyAdminSecret(headers);
  if (result === "unconfigured") {
    return Response.json(
      { error: "Scoreboard admin is not configured" } satisfies ApiError,
      { status: 503 },
    );
  }
  if (result === "unauthorized") {
    return Response.json({ error: "Unauthorized" } satisfies ApiError, { status: 401 });
  }
  return null;
}

export async function POST(req: Request): Promise<Response> {
  const denied = authGate(req.headers);
  if (denied) return denied;

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" } satisfies ApiError, {
      status: 400,
    });
  }

  // Single, shared normalisation path — the dashboard server actions validate
  // through the very same `parseCreateBoardInput`, so the two surfaces cannot
  // drift on what a valid board looks like. A `gameSlug` failure is a 404
  // (unknown game); every other field failure is a 400.
  const parsed = parseCreateBoardInput((payload ?? {}) as RawBoardInput, {
    isKnownGame,
  });
  if (!parsed.ok) {
    return Response.json({ error: parsed.error.message } satisfies ApiError, {
      status: parsed.error.field === "gameSlug" ? 404 : 400,
    });
  }

  try {
    const { board, created } = await store.createBoard(parsed.value);
    const response: CreateBoardResponse = { ok: true, created, board };
    return Response.json(response, { status: created ? 201 : 200 });
  } catch (error) {
    console.error(`admin createBoard failed for ${parsed.value.slug}:`, error);
    return Response.json({ error: "Failed to create board" } satisfies ApiError, {
      status: 503,
    });
  }
}

export async function GET(req: Request): Promise<Response> {
  const denied = authGate(req.headers);
  if (denied) return denied;

  try {
    const boards = await store.listBoards();
    return Response.json({ boards } satisfies { boards: BoardConfig[] }, { status: 200 });
  } catch (error) {
    console.error("admin listBoards failed:", error);
    return Response.json({ error: "Failed to list boards" } satisfies ApiError, {
      status: 503,
    });
  }
}
