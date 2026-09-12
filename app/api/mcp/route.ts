/**
 * HallPass bug MCP — `POST /api/mcp`.
 *
 * The endpoint a coding agent connects to in order to work the playtest bug
 * queue: list reports, read one in full (with the game's own JavaScript errors),
 * then triage, fix or close it. `bug-mcp-design.md` is the whole argument;
 * `README.md` says how to point a client at it.
 *
 * ── TWO CREDENTIALS SINCE THE ANALYTICS TOOLS LANDED ───────────────────────
 * `MCP_SECRET` still opens the bug tools and behaves exactly as it did. Beside
 * it, a dashboard account can sign in through OAuth and gets the read-only
 * analytics tools — and ONLY those. `analytics-mcp-design.md` §3 has the
 * argument; `app/lib/mcp/actor.ts` resolves which of the two is calling, and
 * `server.ts` decides what that caller may see.
 *
 * Operator surface, like `admin/alerts`: every request is gated before the
 * protocol is touched at all. CORS is answered for an ALLOW-LISTED origin only
 * (`mcpCorsHeaders`), which is what lets a web-based MCP client reach it at
 * all; a caller with no `Origin` — every CLI and every agent process — is
 * unaffected either way.
 *
 * ── WHY IT LIVES UNDER `/api/` ─────────────────────────────────────────────
 * Two protections come free and neither needed editing. `app/robots.ts`
 * disallows `/api/`, so no crawler follows it. `public/sw.js` never intercepts
 * `/api/` either, so the service worker cannot cache a tool call or serve a
 * stale one — which for a surface whose answers change on every write would be a
 * genuinely confusing bug.
 *
 * The path is `/api/mcp` rather than `/api/v1/admin/mcp` because MCP negotiates
 * its own protocol version per connection. Putting it behind the SDK's `v1`
 * namespace — which describes the shapes the game SDK and the client islands
 * consume — would assert a second, conflicting version story about an endpoint
 * whose versioning is already handled.
 *
 * ── ONE SERVER AND ONE TRANSPORT PER REQUEST ───────────────────────────────
 * Both are constructed inside the handler and neither is closed, which is the
 * shape the SDK's own web-standard example uses. It is also what this runtime
 * requires: the transport is stateless (no session id is minted, so nothing has
 * to be resolved on a later request — there may not BE a later request on the
 * same instance), and a module-level singleton shared across concurrent requests
 * in one warm Vercel instance would be a single server with several transports
 * attached to it. Closing the transport before the returned `Response` has been
 * read would risk truncating the very body being returned, so the per-request
 * objects are simply left to the garbage collector when the invocation ends.
 *
 * `enableJsonResponse` is the other half of the same argument. The transport
 * defaults to opening an SSE stream, and a long-lived event stream is not a
 * thing a serverless function should hold open; a complete JSON body per request
 * is.
 */

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateMcp, type McpActor } from "@/app/lib/mcp/actor";
import { mcpCorsHeaders, mcpDenialResponse } from "@/app/lib/mcp/http";
import { mcpResource, originOf } from "@/app/lib/mcp/oauth/metadata";
import { createMcpServer } from "@/app/lib/mcp/server";
import { readAppSetting } from "@/app/lib/app-settings";
import {
  OUTPUT_MODE_KEY,
  clientHintFrom,
  shouldSendWidgets,
  toOutputMode,
} from "@/app/lib/mcp/analytics/output-mode";

/**
 * Never prerender, never cache. `POST` is uncached by default in Next 16, but
 * this is stated rather than assumed because the handler also answers `GET`, and
 * an MCP endpoint served from a cache would replay one agent's answer to
 * another.
 */
export const dynamic = "force-dynamic";

/**
 * A JSON-RPC error for the HTTP-level refusals, matching what the SDK's own
 * stateless example answers for a method it does not serve.
 *
 * `id: null` is the honest value: these refusals happen without a request having
 * been parsed, so there is no id to correlate against.
 */
function methodNotAllowed(): Response {
  return Response.json(
    { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null },
    { status: 405, headers: { allow: "POST" } },
  );
}

export async function POST(req: Request): Promise<Response> {
  const origin = originOf(req.url);
  const cors = mcpCorsHeaders(req.headers);
  const auth = await authenticateMcp(req.headers, mcpResource(origin));
  if (!auth.ok) return withCors(mcpDenialResponse(auth.denial, origin), cors);

  const transport = new WebStandardStreamableHTTPServerTransport({
    // Stateless: no session id is minted, because nothing on this runtime would
    // be able to resolve one on the next request.
    sessionIdGenerator: undefined,
    // Answer with a complete JSON body rather than opening an SSE stream.
    enableJsonResponse: true,
  });

  // Whether this answer carries a rendered card is an operator setting, read
  // per request so flipping it in the dashboard takes effect on the next call
  // rather than the next deploy — which is the whole point of it being a
  // setting (`analytics/output-mode.ts`). Fail-soft: `readAppSetting` returns
  // null on an unreachable database, and `toOutputMode` reads that as the
  // default, so a Neon blip costs a card and never an answer.
  const mode = toOutputMode(await readAppSetting(OUTPUT_MODE_KEY));
  const sendWidgets = shouldSendWidgets(mode, clientHintFrom(req.headers));

  const server = createMcpServer(auth.actor satisfies McpActor, { sendWidgets });
  await server.connect(transport);
  return withCors(await transport.handleRequest(req), cors);
}

/**
 * Copy CORS headers onto a response the SDK built.
 *
 * A new `Response` around the original body rather than mutating `res.headers`,
 * which is immutable on a constructed `Response`. The body is passed through
 * untouched, so a streamed answer stays streamed.
 */
function withCors(res: Response, cors: Record<string, string>): Response {
  if (Object.keys(cors).length === 0) return res;
  const headers = new Headers(res.headers);
  for (const [key, value] of Object.entries(cors)) headers.set(key, value);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/** Preflight, for the browser-based clients the allow-list admits. */
export async function OPTIONS(req: Request): Promise<Response> {
  const cors = mcpCorsHeaders(req.headers);
  if (Object.keys(cors).length === 0) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: cors });
}

/**
 * The GET half of Streamable HTTP opens a server-to-client event stream, which a
 * stateless serverless endpoint has nothing to put on and no way to hold open.
 * Refused explicitly so a client discovers it at connection time rather than
 * waiting on a stream that will never carry anything.
 *
 * Gated first regardless: an unauthenticated caller learns whether the endpoint
 * exists, not which methods it implements.
 */
export async function GET(req: Request): Promise<Response> {
  const denied = await gate(req);
  return denied ?? methodNotAllowed();
}

/** DELETE ends a session, and there are no sessions to end. */
export async function DELETE(req: Request): Promise<Response> {
  const denied = await gate(req);
  return denied ?? methodNotAllowed();
}

/**
 * Authenticate without building a server, for the two methods that only ever
 * refuse. Kept so an unauthenticated caller learns whether the endpoint exists,
 * not which methods it implements.
 */
async function gate(req: Request): Promise<Response | null> {
  const origin = originOf(req.url);
  const auth = await authenticateMcp(req.headers, mcpResource(origin));
  return auth.ok ? null : mcpDenialResponse(auth.denial, origin);
}
