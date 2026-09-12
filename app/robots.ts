import type { MetadataRoute } from "next";
import { SITE_URL } from "@/app/lib/site";

/**
 * `robots.txt` for HALLPASS.
 *
 * The disallow list is short on purpose: it names only functional and private
 * surfaces that must never eat crawl budget or surface in results — the admin
 * dashboard, the JSON API, and the personal `/play/*` flow (sign-in, account,
 * friends). Everything that should rank — the home grid, `/game/*`, and
 * `/category/*` — is left open.
 *
 * `/oauth/*` IS LISTED and `/.well-known/*` DELIBERATELY IS NOT. The consent
 * screen is a mid-flow page that means nothing without its query string, so a
 * crawler following one wastes budget on a request that renders an error. The
 * OAuth discovery documents are the opposite: they are PUBLIC METADATA whose
 * entire purpose is to be fetched by anything that wants to find the
 * authorization server, and RFC 9728 puts them at a well-known path precisely
 * so they can be. Blocking them would be blocking the front door.
 *
 * `/u/*` IS DELIBERATELY NOT LISTED, and that is the subtle part. A profile URL
 * gets shared (kids paste them), so a crawler can discover one; the way to keep
 * it OUT of the index is the `X-Robots-Tag: noindex` header it already sends. A
 * `Disallow` here would be worse than nothing: it stops the crawler FETCHING the
 * page, so it never sees the `noindex`, and a discovered-but-unfetched URL can
 * still be listed as a bare link that can then never be removed. Crawlable +
 * noindex is the only combination that actually keeps minors' profiles out of
 * search.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/dashboard", "/admin", "/play/", "/auth/", "/oauth/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
