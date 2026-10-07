/**
 * Tests for the survey store factory.
 *
 * The same fake-`sql` seam as `tracker/store.test.ts`: a function matching the
 * tagged-template signature records every call and returns canned rows, so the
 * SHAPE of the emitted SQL can be asserted without a database. The load-bearing
 * property of each mutation is that it is ONE statement (the `neon()` HTTP
 * driver cannot make two calls transactional), so `calls.length` is the check.
 */

import { describe, expect, it } from "vitest";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { QUESTIONS_MAX } from "./config";
import { createSurveyStore } from "./store";

interface RecordedCall {
  text: string;
  values: unknown[];
}

/** Each call pops the next canned result, or repeats the last. */
function makeFakeSql(...results: Record<string, unknown>[][]) {
  const calls: RecordedCall[] = [];
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("?"), values });
    const rows = results.length > 1 ? results.shift()! : (results[0] ?? []);
    return Promise.resolve(rows);
  };
  return { sql: fn as unknown as NeonQueryFunction<false, false>, calls };
}

describe("createSurvey", () => {
  it("inserts a draft and returns the id", async () => {
    const { sql, calls } = makeFakeSql([{ id: "9" }]);
    const id = await createSurveyStore(sql).createSurvey({
      slug: "winter",
      title: "Winter",
      intro: "",
      actor: "a@b.c",
    });
    expect(id).toBe(9);
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain("INSERT INTO surveys");
    expect(calls[0].text).toContain("ON CONFLICT (slug) DO NOTHING");
  });

  it("returns null when the slug is taken (no row comes back)", async () => {
    const { sql } = makeFakeSql([]);
    expect(
      await createSurveyStore(sql).createSurvey({ slug: "x", title: "t", intro: "", actor: "a" }),
    ).toBeNull();
  });
});

describe("setStatus", () => {
  it("is one statement and reports a change", async () => {
    const { sql, calls } = makeFakeSql([{ from_status: "draft", qn: "3", changed: true }]);
    const result = await createSurveyStore(sql).setStatus(1, "live");
    expect(result).toEqual({ from: "draft", changed: true, blocked: false });
    expect(calls).toHaveLength(1);
  });

  it("guards going live on having a live question in the SQL itself", async () => {
    const { sql, calls } = makeFakeSql([{ from_status: "draft", qn: "0", changed: false }]);
    const result = await createSurveyStore(sql).setStatus(1, "live");
    expect(result).toEqual({ from: "draft", changed: false, blocked: true });
    expect(calls[0].text).toContain("prev.qn > 0");
  });

  it("treats re-selecting the current status as a no-op, not blocked or missing", async () => {
    const { sql } = makeFakeSql([{ from_status: "live", qn: "2", changed: false }]);
    expect(await createSurveyStore(sql).setStatus(1, "live")).toEqual({
      from: "live",
      changed: false,
      blocked: false,
    });
  });

  it("returns null when there is no live survey row", async () => {
    const { sql } = makeFakeSql([]);
    expect(await createSurveyStore(sql).setStatus(1, "live")).toBeNull();
  });
});

describe("addQuestion", () => {
  it("assigns option ids and caps the survey at QUESTIONS_MAX in one statement", async () => {
    const { sql, calls } = makeFakeSql([{ id: "4" }]);
    const id = await createSurveyStore(sql).addQuestion({
      surveyId: 2,
      kind: "single",
      prompt: "Genre?",
      required: true,
      optionLabels: ["Racing", "Puzzle"],
    });
    expect(id).toBe(4);
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain("live.qn <");
    expect(calls[0].values).toContain(QUESTIONS_MAX);
    expect(calls[0].values).toContain(
      JSON.stringify([
        { id: "o1", label: "Racing" },
        { id: "o2", label: "Puzzle" },
      ]),
    );
  });

  it("returns null when the survey is missing, archived or full", async () => {
    const { sql } = makeFakeSql([]);
    expect(
      await createSurveyStore(sql).addQuestion({
        surveyId: 1,
        kind: "text",
        prompt: "p",
        required: false,
        optionLabels: [],
      }),
    ).toBeNull();
  });
});

describe("updateQuestion", () => {
  const stored = {
    id: "5",
    survey_id: "2",
    position: 0,
    kind: "single",
    prompt: "Old",
    required: true,
    options: [
      { id: "o1", label: "A" },
      { id: "o2", label: "B" },
    ],
    retired_at: null,
    answer_count: "0",
  };

  it("reads once, then writes ONE statement that retires-and-replaces an answered question", async () => {
    const { sql, calls } = makeFakeSql([{ ...stored, answer_count: "12" }], [{ id: "6", forked: true }]);
    const result = await createSurveyStore(sql).updateQuestion(5, { prompt: "New" });
    expect(result).toEqual({ id: 6, forked: true });
    expect(calls).toHaveLength(2);
    const write = calls[1].text;
    expect(write).toContain("SET retired_at = now()");
    expect(write).toContain("INSERT INTO survey_questions");
    // The branch is decided in SQL, from the live answer state, not from the read.
    expect(write).toContain("NOT prev.answered");
  });

  it("keeps existing option ids when a label survives the edit", async () => {
    const { sql, calls } = makeFakeSql([stored], [{ id: "5", forked: false }]);
    await createSurveyStore(sql).updateQuestion(5, { optionLabels: ["B", "C"] });
    expect(calls[1].values).toContain(
      JSON.stringify([
        { id: "o2", label: "B" },
        { id: "o3", label: "C" },
      ]),
    );
  });

  it("refuses a retired question without writing", async () => {
    const { sql, calls } = makeFakeSql([{ ...stored, retired_at: "2026-01-01" }]);
    expect(await createSurveyStore(sql).updateQuestion(5, { prompt: "x" })).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("returns null when the question does not exist", async () => {
    const { sql } = makeFakeSql([]);
    expect(await createSurveyStore(sql).updateQuestion(5, { prompt: "x" })).toBeNull();
  });
});

describe("removeQuestion", () => {
  it("deletes an unanswered question and retires an answered one, in one statement", async () => {
    const a = makeFakeSql([{ answered: false }]);
    expect(await createSurveyStore(a.sql).removeQuestion(1)).toBe("deleted");
    expect(a.calls).toHaveLength(1);
    expect(a.calls[0].text).toContain("DELETE FROM survey_questions");

    const b = makeFakeSql([{ answered: true }]);
    expect(await createSurveyStore(b.sql).removeQuestion(1)).toBe("retired");
  });

  it("returns null when there is nothing to remove", async () => {
    expect(await createSurveyStore(makeFakeSql([]).sql).removeQuestion(1)).toBeNull();
  });
});

describe("submitResponse", () => {
  const answers = [
    { questionId: 1, choiceIds: ["o1"], scale: null, body: null },
    { questionId: 2, choiceIds: null, scale: 4, body: null },
  ];

  it("writes the response and its answers in ONE statement", async () => {
    const { sql, calls } = makeFakeSql([{ is_open: "1", is_fresh: "1", created: "1" }]);
    const outcome = await createSurveyStore(sql).submitResponse({
      surveyId: 3,
      playerId: "p1",
      answers,
    });
    expect(outcome).toBe("ok");
    expect(calls).toHaveLength(1);
    const { text, values } = calls[0];
    expect(text).toContain("INSERT INTO survey_responses");
    expect(text).toContain("INSERT INTO survey_answers");
    // One response per player is the database's job, not a pre-check's.
    expect(text).toContain("survey_responses_one_per_player DO NOTHING");
    expect(values).toContain("p1");
    // Choice ids ride as comma-joined text; the payload is one JSON scalar.
    expect(values).toContain(
      JSON.stringify([
        { question_id: 1, choice_ids: "o1", scale: null, body: null },
        { question_id: 2, choice_ids: null, scale: 4, body: null },
      ]),
    );
  });

  it("reports closed, stale and duplicate distinctly", async () => {
    const outcome = async (row: Record<string, string>) =>
      createSurveyStore(makeFakeSql([row]).sql).submitResponse({
        surveyId: 1,
        playerId: "p",
        answers,
      });
    expect(await outcome({ is_open: "0", is_fresh: "0", created: "0" })).toBe("closed");
    expect(await outcome({ is_open: "1", is_fresh: "0", created: "0" })).toBe("stale");
    expect(await outcome({ is_open: "1", is_fresh: "1", created: "0" })).toBe("duplicate");
  });

  it("only inserts when every answered question is still a live question of the survey", async () => {
    const { sql, calls } = makeFakeSql([{ is_open: "1", is_fresh: "1", created: "1" }]);
    await createSurveyStore(sql).submitResponse({ surveyId: 1, playerId: "p", answers });
    expect(calls[0].text).toContain("q.retired_at IS NULL");
    expect(calls[0].text).toContain("NOT EXISTS");
  });
});

describe("moveQuestion", () => {
  it("swaps positions in one statement and reports whether anything moved", async () => {
    const moved = makeFakeSql([{ moved: "1" }]);
    expect(await createSurveyStore(moved.sql).moveQuestion(1, "up")).toBe(true);
    expect(moved.calls).toHaveLength(1);

    const edge = makeFakeSql([{ moved: "0" }]);
    expect(await createSurveyStore(edge.sql).moveQuestion(1, "up")).toBe(false);
  });
});

describe("results never identify a player", () => {
  it("selects no player id or email in any results query", async () => {
    const { sql, calls } = makeFakeSql([
      { id: "1", slug: "s", title: "t", status: "live", created_by: "a", created_at: "2026-01-01", updated_at: "2026-01-01" },
    ]);
    await createSurveyStore(sql).getResults(1);
    expect(calls.length).toBeGreaterThan(1);
    for (const call of calls.slice(1)) {
      expect(call.text).not.toMatch(/player_id|email/);
    }
  });
});
