/**
 * HallPass — what the bug MCP endpoint says to a caller it will not serve.
 *
 * Sibling of `alerts/http.ts`, and pure of the database and of `server-only` for
 * the same reason: it reads headers and builds responses, so it unit-tests in
 * the plain `node` environment and the route handler stays thin.
 *
 * ── WHY THESE ARE PLAIN JSON AND NOT JSON-RPC ERRORS ───────────────────────
 * Every reply the MCP protocol itself makes is a JSON-RPC envelope, and the SDK
 * builds those. Nothing here is one, deliberately: an auth failure happens
 * BEFORE the protocol is engaged — there is no negotiated session, and on a
 * malformed or unauthenticated request there may not even be a parseable
 * request id to answer. HTTP status codes are the layer that carries "you may
 * not do this at all", and an MCP client reads a 401 as a credential problem
 * rather than as a tool that failed. Wrapping it in a JSON-RPC error would tell
 * the client the opposite: that the call was accepted and the SERVER broke.
 */

import type { ApiError } from "@/sdk/src/contract";
import { verifyMcpSecret } from "./guard";

/**
 * Gate the endpoint, mapping the three auth outcomes to an early `Response` —
 * or `null` to continue into the protocol.
 *
 * `unconfigured` is a 503 and not a 401 on purpose, exactly as the alerts gate
 * argues: "this deploy has no secret set" is a server condition, and an operator
 * staring at a client that will not connect needs to tell it apart from "my key
 * is wrong". The message names the variable to set, because the alternative is
 * reading the source to find out.
 *
 * The 401 carries `WWW-Authenticate: Bearer`. That is what the status code is
 * defined to require, and it is the difference between a client reporting "not
 * authorised" and a client reporting nothing useful at all.
 */
export function mcpAuthGate(headers: Headers): Response | null {
  const result = verifyMcpSecret(headers);
  if (result === "unconfigured") {
    return Response.json(
      {
        error:
          "The bug MCP is not configured. Set MCP_SECRET on the deployment to enable it.",
      } satisfies ApiError,
      { status: 503 },
    );
  }
  if (result === "unauthorized") {
    return Response.json({ error: "Unauthorized" } satisfies ApiError, {
      status: 401,
      headers: { "www-authenticate": "Bearer" },
    });
  }
  return null;
}

/** One error body, shaped like every other error this API answers. */
export function mcpError(message: string, status: number): Response {
  return Response.json({ error: message } satisfies ApiError, { status });
}
