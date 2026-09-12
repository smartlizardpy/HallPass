/**
 * Tests for the analytics document catalogue's ranking.
 *
 * `search` is the first thing a hosted assistant calls and the only way it
 * discovers anything, so the cases below are the ones where a bad answer is
 * invisible: a query that finds nothing reads to the assistant as "this site
 * has no data", not as "the search is weak".
 */

import { describe, expect, it } from "vitest";
import {
  FIXED_DOCS,
  MAX_SEARCH_RESULTS,
  rankDocs,
  scoreDoc,
  tokenize,
} from "./doc-index";

const ids = (query: string, limit?: number) =>
  rankDocs(FIXED_DOCS, query, limit).map((doc) => doc.id);

describe("tokenize", () => {
  it("lowercases and splits on anything non-alphanumeric", () => {
    expect(tokenize("Content-Health: games!")).toEqual(["content", "health", "games"]);
  });

  it("drops single characters, which match everything and mean nothing", () => {
    expect(tokenize("a b retention")).toEqual(["retention"]);
  });
});

describe("scoreDoc", () => {
  const overview = FIXED_DOCS.find((doc) => doc.id === "overview")!;

  it("gives an exact id match an unbeatable score", () => {
    expect(scoreDoc(overview, "overview")).toBeGreaterThan(scoreDoc(overview, "plays"));
  });

  it("scores everything equally for an empty query, rather than nothing", () => {
    // "Tell me about this site" arrives as a bare search. Zero results would
    // read as "there is no data".
    for (const doc of FIXED_DOCS) expect(scoreDoc(doc, "")).toBeGreaterThan(0);
    expect(ids("")).toHaveLength(FIXED_DOCS.length);
  });

  it("prefers a title hit to a keyword hit", () => {
    const health = FIXED_DOCS.find((doc) => doc.id === "content-health")!;
    expect(scoreDoc(health, "catalogue health")).toBeGreaterThan(
      scoreDoc(overview, "catalogue health"),
    );
  });

  it("matches a prefix, so a half-typed word still finds the report", () => {
    expect(scoreDoc(overview, "retent")).toBeGreaterThan(0);
  });
});

describe("rankDocs — the questions a person actually asks", () => {
  it("finds the overview from plain language", () => {
    expect(ids("how is the site doing")[0]).toBe("overview");
    expect(ids("how many players")[0]).toBe("overview");
  });

  it("finds growth from acquisition language", () => {
    expect(ids("where do players come from")[0]).toBe("growth");
    expect(ids("referrers")[0]).toBe("growth");
  });

  it("finds alerts from failure language", () => {
    expect(ids("is anything broken")[0]).toBe("alerts");
    expect(ids("errors")[0]).toBe("alerts");
  });

  it("finds the definitions when asked how something is counted", () => {
    expect(ids("what counts as a play")).toContain("metrics");
    expect(ids("double count")[0]).toBe("metrics");
  });

  it("finds catalogue health from work language", () => {
    expect(ids("what should i work on")[0]).toBe("content-health");
    expect(ids("missing screenshots")[0]).toBe("content-health");
  });

  it("finds the schema when asked what data exists", () => {
    expect(ids("what data do you have")[0]).toBe("schema");
  });
});

describe("rankDocs — shape", () => {
  it("drops documents that did not match at all", () => {
    expect(ids("kubernetes helm chart")).toEqual([]);
  });

  it("respects the limit and never returns zero for a positive one", () => {
    expect(ids("", 2)).toHaveLength(2);
    expect(ids("", 0)).toHaveLength(1);
  });

  it("caps at MAX_SEARCH_RESULTS by default", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      id: `game:g${i}`,
      title: `Game ${i} — game report`,
      keywords: ["game", "report"],
    }));
    expect(rankDocs(many, "game report")).toHaveLength(MAX_SEARCH_RESULTS);
  });

  it("keeps the original order for ties, so answers are stable", () => {
    const tied = [
      { id: "a", title: "Report", keywords: ["x"] },
      { id: "b", title: "Report", keywords: ["x"] },
    ];
    expect(rankDocs(tied, "report").map((d) => d.id)).toEqual(["a", "b"]);
  });

  it("an exact id beats everything, so a follow-up search re-finds its subject", () => {
    expect(ids("metrics")[0]).toBe("metrics");
    expect(ids("schema")[0]).toBe("schema");
  });
});
