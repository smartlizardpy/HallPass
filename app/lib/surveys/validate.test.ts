/**
 * Tests for answer validation. The survey's question set is the authority:
 * unknown ids, wrong shapes and unmet `required` all refuse, and refusals name
 * the question without echoing what was typed.
 */

import { describe, expect, it } from "vitest";
import { MAX_ANSWER_KEYS, validateAnswers, type AnswerableQuestion } from "./validate";

const options = [
  { id: "o1", label: "Racing" },
  { id: "o2", label: "Puzzle" },
];

const questions: AnswerableQuestion[] = [
  { id: 1, kind: "single", prompt: "Favourite genre?", required: true, options },
  { id: 2, kind: "multi", prompt: "Which would you play?", required: false, options },
  { id: 3, kind: "scale", prompt: "Rate the art", required: true, options: [] },
  { id: 4, kind: "text", prompt: "Anything else?", required: false, options: [] },
];

describe("validateAnswers", () => {
  it("accepts a complete submission and returns it in question order", () => {
    const result = validateAnswers(questions, {
      "4": "More racing games please",
      "3": 4,
      "2": ["o2", "o1"],
      "1": "o1",
    });
    expect(result).toEqual({
      ok: true,
      answers: [
        { questionId: 1, choiceIds: ["o1"], scale: null, body: null },
        { questionId: 2, choiceIds: ["o2", "o1"], scale: null, body: null },
        { questionId: 3, choiceIds: null, scale: 4, body: null },
        { questionId: 4, choiceIds: null, scale: null, body: "More racing games please" },
      ],
    });
  });

  it("lets an optional question be skipped (absent, empty array or blank text)", () => {
    const result = validateAnswers(questions, { "1": "o2", "2": [], "3": 1, "4": "   " });
    expect(result).toEqual({
      ok: true,
      answers: [
        { questionId: 1, choiceIds: ["o2"], scale: null, body: null },
        { questionId: 3, choiceIds: null, scale: 1, body: null },
      ],
    });
  });

  it("refuses a required question left blank, naming the question", () => {
    const result = validateAnswers(questions, { "1": "o1" });
    expect(result).toMatchObject({ ok: false, questionId: 3 });
    expect(result.ok === false && result.error).toContain("Rate the art");
  });

  it("refuses an option id that is not on the question", () => {
    expect(validateAnswers(questions, { "1": "o9", "3": 3 })).toMatchObject({
      ok: false,
      questionId: 1,
    });
    expect(validateAnswers(questions, { "1": "o1", "2": ["o1", "o9"], "3": 3 })).toMatchObject({
      ok: false,
      questionId: 2,
    });
  });

  it("deduplicates repeated multi-choice picks", () => {
    const result = validateAnswers(questions, { "1": "o1", "2": ["o1", "o1"], "3": 3 });
    expect(result.ok && result.answers[1].choiceIds).toEqual(["o1"]);
  });

  it("refuses wrong value types", () => {
    expect(validateAnswers(questions, { "1": ["o1"], "3": 3 }).ok).toBe(false);
    expect(validateAnswers(questions, { "1": "o1", "2": "o1", "3": 3 }).ok).toBe(false);
    expect(validateAnswers(questions, { "1": "o1", "3": "3" }).ok).toBe(false);
  });

  it("refuses a scale outside 1-5 or non-integer", () => {
    for (const bad of [0, 6, 2.5, Number.NaN]) {
      expect(validateAnswers(questions, { "1": "o1", "3": bad }).ok).toBe(false);
    }
  });

  it("runs free text through the contact-info and link checks without echoing it", () => {
    const phone = validateAnswers(questions, { "1": "o1", "3": 3, "4": "call me on 07700 900123" });
    expect(phone).toMatchObject({ ok: false, questionId: 4 });
    expect(JSON.stringify(phone)).not.toContain("07700");

    const link = validateAnswers(questions, { "1": "o1", "3": 3, "4": "see https://example.com" });
    expect(link).toMatchObject({ ok: false, questionId: 4 });
  });

  it("refuses a key that is not a live question (a stale form)", () => {
    const result = validateAnswers(questions, { "1": "o1", "3": 3, "99": "o1" });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("reload");
  });

  it("refuses a non-object body and an oversized one", () => {
    expect(validateAnswers(questions, null).ok).toBe(false);
    expect(validateAnswers(questions, []).ok).toBe(false);
    expect(validateAnswers(questions, "x").ok).toBe(false);
    const big = Object.fromEntries(Array.from({ length: MAX_ANSWER_KEYS + 1 }, (_, i) => [i, 1]));
    expect(validateAnswers(questions, big).ok).toBe(false);
  });
});
