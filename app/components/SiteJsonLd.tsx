import { SITE_URL } from "@/app/lib/site";

/**
 * Site-wide structured data for the homepage: a `WebSite` and an `Organization`.
 *
 * This is the brand-entity signal the game pages cannot provide. Each game page
 * emits a `VideoGame`; nothing until now told Google what HALLPASS *is* — that
 * it is a site, with a name, a logo, and an internal search. Those are what earn
 * a brand result rather than a bare blue link, and the `SearchAction` is what can
 * earn the sitelinks search box under it.
 *
 * The `SearchAction` target points at `/?q={search_term_string}`, which is a real
 * URL — the home grid reads `q` from `window.location.search` and filters — so
 * the box Google renders actually works rather than 404ing, which is the mistake
 * that gets the feature ignored.
 *
 * A plain server component rendering one `<script>`. It touches no request state,
 * so the homepage stays static and stays in the precache. The `<` escape mirrors
 * the game page's JSON-LD: a stray `</script>` in data would otherwise close the
 * tag early.
 */
export function SiteJsonLd() {
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        url: SITE_URL,
        name: "HALLPASS",
        description:
          "A modern arcade of free, unblocked browser games — fast, neon, and ready to play at school or anywhere.",
        publisher: { "@id": `${SITE_URL}/#org` },
        potentialAction: {
          "@type": "SearchAction",
          target: {
            "@type": "EntryPoint",
            urlTemplate: `${SITE_URL}/?q={search_term_string}`,
          },
          "query-input": "required name=search_term_string",
        },
      },
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#org`,
        name: "HALLPASS",
        url: SITE_URL,
        logo: {
          "@type": "ImageObject",
          url: `${SITE_URL}/icon-512.png`,
          width: 512,
          height: 512,
        },
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(graph).replace(/</g, "\\u003c"),
      }}
    />
  );
}
