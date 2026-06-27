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
 * POST creates (or idempotently updates) a board; the slug must name a real
 * game. A brand-new board answers 201, an idempotent update answers 200, so a
 * caller can tell whether provisioning actually happened.
 */

import { games } from "@/app/lib/games";
import { store, verifyAdminSecret } from "@/app/lib/scoreboard";
import type {
  ApiError,
  BoardConfig,
  CreateBoardRequest,
  CreateBoardResponse,
  SortDir,
} from "@/sdk/src/contract";

function isKnownGame(slug: string): boolean {
  return games.some((game) => game.slug === slug);
}

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

  const body = (payload ?? {}) as Partial<CreateBoardRequest>;
  if (
    typeof body.slug !== "string" ||
    body.slug.trim().length === 0 ||
    typeof body.title !== "string" ||
    body.title.trim().length === 0
  ) {
    return Response.json(
      { error: "slug and title are required" } satisfies ApiError,
      { status: 400 },
    );
  }

  if (!isKnownGame(body.slug)) {
    return Response.json({ error: "Unknown game" } satisfies ApiError, { status: 404 });
  }

  const sort: SortDir | undefined =
    body.sort === "asc" ? "asc" : body.sort === "desc" ? "desc" : undefined;
  const input: CreateBoardRequest = {
    slug: body.slug,
    title: body.title,
    sort,
    scoreLabel: typeof body.scoreLabel === "string" ? body.scoreLabel : undefined,
    maxScore:
      body.maxScore === null
        ? null
        : typeof body.maxScore === "number"
          ? body.maxScore
          : undefined,
  };

  try {
    const { board, created } = await store.createBoard(input);
    const response: CreateBoardResponse = { ok: true, created, board };
    return Response.json(response, { status: created ? 201 : 200 });
  } catch (error) {
    console.error(`admin createBoard failed for ${body.slug}:`, error);
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
