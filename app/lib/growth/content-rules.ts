/**
 * HallPass — what makes a game page THIN.
 *
 * Pure and dependency-free (no `server-only`), like `channels.ts` and
 * `config.ts`, so the rules can be unit-tested and the dashboard can reuse the
 * labels. `content-health.ts` is the half that reads the database.
 *
 * THIS IS NOT A RANK TRACKER. It cannot tell you what position anything holds —
 * that lives in Search Console, which is already verified for this property and
 * is a manual read by design (`marketing-design.md` §6). What it does instead is
 * turn "we should do more SEO" into a finite list of pages with something
 * specific missing, which is the version of the problem somebody can actually
 * finish.
 *
 * The rules are ordered by what a game page actually needs to compete for
 * "play <game> unblocked", and every one of them is a fact about OUR page, not a
 * guess about Google.
 */

/** How short a description has to be before the page counts as thin. */
export const THIN_DESCRIPTION_CHARS = 120;

export type IssueId =
  | "no-screenshots"
  | "thin-description"
  | "no-tags"
  | "no-video"
  | "no-reviews";

export type Issue = {
  id: IssueId;
  label: string;
  /** Why it costs us something. Rendered next to the count. */
  why: string;
  /**
   * `high` issues damage a page's ability to rank or to be shared at all;
   * `low` ones are upside we are leaving unclaimed. Sorting by this is what
   * stops the checklist reading as five equally urgent chores.
   */
  severity: "high" | "low";
};

/**
 * Ordered worst-first, which is also the order the dashboard renders them.
 *
 * Screenshots lead because they are load-bearing twice over: `generateMetadata`
 * in `app/game/[slug]/page.tsx` prefers a real screenshot for the social card and
 * falls back to the near-square cover, which `summary_large_image` then crops
 * badly. A game with no screenshots is a game whose shared link looks broken.
 */
export const ISSUES: readonly Issue[] = [
  {
    id: "no-screenshots",
    label: "No screenshots",
    why: "The social card falls back to the cover art, which gets cropped badly when shared.",
    severity: "high",
  },
  {
    id: "thin-description",
    label: "Thin description",
    why: `Under ${THIN_DESCRIPTION_CHARS} characters of body copy — the page has little to rank on.`,
    severity: "high",
  },
  {
    id: "no-tags",
    label: "No tags",
    why: "Tags are the game's long-tail keywords and its related-games links.",
    severity: "low",
  },
  {
    id: "no-video",
    label: "No video",
    why: "A trailer keeps people on the page and gives the listing something to show.",
    severity: "low",
  },
  {
    id: "no-reviews",
    label: "No reviews",
    why: "Player comments are the only copy on the page that keeps growing on its own.",
    severity: "low",
  },
] as const;

export function issueLabel(id: IssueId): string {
  return ISSUES.find((i) => i.id === id)?.label ?? id;
}

/** Everything the rules need to judge one game. */
export type GameContent = {
  slug: string;
  title: string;
  description: string;
  tags: readonly string[];
  screenshots: number;
  hasVideo: boolean;
  reviews: number;
};

/**
 * Every issue a game currently has, worst-first.
 *
 * Deliberately returns a LIST rather than a score. A single number would rank
 * the catalogue neatly and tell nobody what to actually go and do, and it would
 * average away the one high-severity gap that matters under four cosmetic ones.
 *
 * A missing description and a whitespace-only one are the same problem, so the
 * length test runs on the trimmed string.
 */
export function assessGame(game: GameContent): IssueId[] {
  const issues: IssueId[] = [];

  if (game.screenshots <= 0) issues.push("no-screenshots");
  if (game.description.trim().length < THIN_DESCRIPTION_CHARS) {
    issues.push("thin-description");
  }
  if (game.tags.length === 0) issues.push("no-tags");
  if (!game.hasVideo) issues.push("no-video");
  if (game.reviews <= 0) issues.push("no-reviews");

  // ISSUES is already ordered worst-first, so sorting by its index keeps the
  // per-game list consistent with the summary above it.
  const order = new Map(ISSUES.map((issue, i) => [issue.id, i]));
  return issues.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
}

/** How many games have each issue, in `ISSUES` order. */
export function summarize(
  assessed: ReadonlyMap<string, readonly IssueId[]>,
): { issue: Issue; count: number }[] {
  return ISSUES.map((issue) => ({
    issue,
    count: [...assessed.values()].filter((ids) => ids.includes(issue.id)).length,
  }));
}
