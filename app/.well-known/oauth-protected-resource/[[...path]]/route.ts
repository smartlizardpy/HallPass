/**
 * `GET /.well-known/oauth-protected-resource` — RFC 9728 metadata for
 * `/api/mcp`.
 *
 * A CATCH-ALL segment, and that is the whole reason this file is shaped the way
 * it is. RFC 9728 locates a resource's metadata by appending the resource's
 * PATH to the well-known prefix, so the spec-correct URL for `/api/mcp` is
 * `/.well-known/oauth-protected-resource/api/mcp` — but clients differ, and
 * several probe the bare prefix first. Both answer the same document here,
 * because the failure mode of answering only one is a client that reports
 * "unauthorized" with no explanation and never opens a browser.
 *
 * The trailing path is deliberately NOT validated against `/api/mcp`. There is
 * exactly one protected resource on this deployment, the document is public and
 * identical whatever was asked for, and 404ing a near-miss would trade a
 * working connection for a pedantry nobody benefits from.
 *
 * Public and uncredentialed, so `Access-Control-Allow-Origin: *` is correct:
 * discovery is fetched from a browser by web-based MCP clients, and there is
 * nothing here that is not already public.
 */

import { originOf, protectedResourceMetadata } from "@/app/lib/mcp/oauth/metadata";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  return Response.json(protectedResourceMetadata(originOf(req.url)), {
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
