# SEO measurement

From the 15 Oct 2026 SEO audit. The audit had no valid Lighthouse/CrUX numbers
(the PageSpeed API returned a quota error), so performance is unmeasured.

## Performance baseline (do before and after any launch)
Run mobile and desktop on: the homepage, one category (`/category/arcade`), and
two game pages. Record LCP, INP and CLS. Real-user targets at the 75th
percentile: LCP <= 2.5 s, INP <= 200 ms, CLS <= 0.1. Search Console's Core Web
Vitals report needs more traffic before it shows data. Fix the measured
bottleneck, not guessed ones.

## Acquisition definitions
- Google search clicks and impressions: Search Console only.
- "Organic session": a session whose first referrer is a search engine results
  page, excluding Google account/login referrers. Do not count Google-domain
  referrals as organic.
- Conversion: organic landing page -> game launch, on the same session and
  device basis. Never mix device totals from different reports.
- Separate branded ("hallpass", "hall pass game") from non-branded queries.

## Comparing changes
Compare like-for-like periods (4-8 weeks after the change) by page and query.
Avoid repeated indexing requests for already indexed pages. Tag URLs that now
redirect to a category (`/tag/<x>` -> `/category/<x>`) will drop out of the
index over time; that is expected.
