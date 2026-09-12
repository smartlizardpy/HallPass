/**
 * `GET /.well-known/oauth-authorization-server` — RFC 8414 metadata.
 *
 * Catch-all for the same reason as its sibling under
 * `oauth-protected-resource`: clients probe both the bare prefix and the
 * issuer-path-suffixed form, and answering only one produces a connection that
 * fails with nothing useful said.
 *
 * HallPass is its own authorization server. The document it serves is derived
 * from the REQUEST's origin rather than from `SITE_URL`, so localhost, a
 * preview deployment and production each advertise endpoints on themselves —
 * see `oauth/metadata.ts` for why mixing them is a failure that looks like a
 * protocol bug.
 */

import { authorizationServerMetadata, originOf } from "@/app/lib/mcp/oauth/metadata";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  return Response.json(authorizationServerMetadata(originOf(req.url)), {
    headers: {
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=0, must-revalidate",
    },
  });
}

/** Preflight, for the browser-based clients that fetch this cross-origin. */
export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "content-type, mcp-protocol-version",
      "access-control-max-age": "86400",
    },
  });
}
