/**
 * HallPass — the analytics catalogue as SEARCHABLE DOCUMENTS.
 *
 * PURE and free of `server-only`: this is the vocabulary and the ranking, and
 * `documents.ts` beside it is what actually reads a database.
 *
 * ── WHY AN ANALYTICS SERVER HAS "DOCUMENTS" AT ALL ────────────────────────
 * Because that is the shape the hosted assistants ask for. ChatGPT's connector
 * contract is two read-only tools called `search` and `fetch`: `search` returns
 * `{id, title, url}` and `fetch` returns `{id, title, text, url}`. It is a
 * document-retrieval interface, and a server that does not offer it is not
 * addable there at all, however good its other tools are.
 *
 * That constraint turns out to be a good fit rather than a tax. "What is going
 * on with Duskfall?" is a document-shaped question, and answering it by naming
 * a report the assistant can then pull is exactly how a person asks it on a
 * phone. So the catalogue below is genuinely the set of reports this site can
 * produce, and `run_analytics_sql` remains there for everything else.
 *
 * ── THE `url` FIELD IS FOR CITATION AND MUST BE REAL ──────────────────────
 * ChatGPT renders it as the source link under an answer. A made-up or
 * unreachable URL there produces a citation that 404s in front of whoever asked
 * the question, so every document points at a page that actually exists — the
 * game's own store page, or the dashboard screen that shows the same numbers.
 */

/** What `search` returns per hit, and the spine of what `fetch` returns. */
export type DocRef = {
  /** Stable identifier. `fetch` takes exactly this back. */
  id: string;
  title: string;
  /** A real, reachable page showing the same thing. Rendered as a citation. */
  url: string;
  /** Extra words `search` should match on but which are not in the title. */
  keywords: string[];
};

/**
 * The reports that always exist, independent of what is in the database.
 *
 * `metrics` is in here deliberately and ranks on words like "definition" and
 * "double count", because the failure this whole feature guards against is an
 * assistant confidently recomputing a metric its own way. Making the
 * definitions FINDABLE means a question like "how do you count a play" is
 * answered from the source rather than invented.
 */
export const FIXED_DOCS: readonly Omit<DocRef, "url">[] = [
  {
    id: "overview",
    title: "Arcade overview — plays, players, searches, retention",
    keywords: [
      "overview", "dashboard", "summary", "kpi", "plays", "visitors", "players",
      "scores", "traffic", "searches", "retention", "active", "how is the site doing",
      "busy", "growth", "today", "this month",
    ],
  },
  {
    id: "growth",
    title: "Growth — where players come from and whether they return",
    keywords: [
      "growth", "acquisition", "channels", "referrers", "referral", "entry pages",
      "returning", "first time", "share loop", "challenge links", "marketing",
      "where do players come from", "virality",
    ],
  },
  {
    id: "content-health",
    title: "Catalogue health — games missing art, video or description",
    keywords: [
      "content", "catalogue", "catalog", "health", "missing", "cover", "art",
      "screenshots", "media", "video", "trailer", "description", "reviews",
      "what should i work on", "todo",
    ],
  },
  {
    id: "alerts",
    title: "Alerts — traffic spikes, error spikes and dead games",
    keywords: [
      "alerts", "alarm", "spike", "errors", "exceptions", "broken", "down",
      "outage", "anomaly", "warning", "is anything wrong",
    ],
  },
  {
    id: "metrics",
    title: "How HallPass counts things — metric definitions",
    keywords: [
      "metrics", "definitions", "methodology", "how do you count", "what counts as",
      "play", "active", "returning", "double count", "posthog", "neon", "caveats",
      "glossary",
    ],
  },
  {
    id: "schema",
    title: "Analytics schema — the tables and event catalogue",
    keywords: [
      "schema", "tables", "columns", "views", "events", "properties", "data model",
      "what data do you have", "sql", "hogql",
    ],
  },
] as const;

/** `game:<slug>` and `board:<id>` are the two dynamic families. */
export const GAME_DOC_PREFIX = "game:";
export const BOARD_DOC_PREFIX = "board:";

/** The most hits `search` returns. */
export const MAX_SEARCH_RESULTS = 10;

/** Lowercase alphanumeric tokens, for both the query and the haystack. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);
}

/**
 * Score one document against a query.
 *
 * Deliberately simple — substring and token overlap, with a title match worth
 * more than a keyword match — because the alternative is a relevance model
 * nobody can debug from a bug report that says "it did not find the thing".
 * Two behaviours are worth naming:
 *
 *   * An EXACT id match wins outright. An assistant that has already seen
 *     `game:duskfall` in a previous answer and searches for it again must get
 *     it back first, not a fuzzy neighbour.
 *   * An EMPTY query scores everything equally rather than nothing. "What can
 *     you tell me about this site?" arrives as a bare `search` with no useful
 *     terms, and an empty result list reads as "there is no data".
 */
export function scoreDoc(doc: Omit<DocRef, "url">, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  if (doc.id.toLowerCase() === q) return 1000;

  const title = doc.title.toLowerCase();
  const haystack = `${title} ${doc.keywords.join(" ")} ${doc.id.toLowerCase()}`;
  let score = 0;

  // Whole-phrase hits first: "content health" should beat two loose words.
  if (title.includes(q)) score += 60;
  else if (haystack.includes(q)) score += 30;

  const queryTokens = tokenize(q);
  const titleTokens = new Set(tokenize(doc.title));
  const keywordTokens = new Set(tokenize(`${doc.keywords.join(" ")} ${doc.id}`));

  for (const token of queryTokens) {
    if (titleTokens.has(token)) score += 10;
    else if (keywordTokens.has(token)) score += 6;
    // A prefix hit, so "retent" finds "retention" and a half-typed slug works.
    else if ([...titleTokens, ...keywordTokens].some((h) => h.startsWith(token))) {
      score += 2;
    }
  }
  return score;
}

/**
 * Rank a catalogue against a query, keeping only what actually matched.
 *
 * Ties keep the ORIGINAL order, so the fixed reports — which callers list
 * first — stay ahead of an equally-scoring game. `peak()` in `insights.ts`
 * makes the same choice for the same reason: a stable answer is worth more than
 * a marginally better one that moves around.
 */
export function rankDocs<T extends Omit<DocRef, "url">>(
  docs: readonly T[],
  query: string,
  limit = MAX_SEARCH_RESULTS,
): T[] {
  return docs
    .map((doc, index) => ({ doc, index, score: scoreDoc(doc, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.max(1, limit))
    .map((entry) => entry.doc);
}
