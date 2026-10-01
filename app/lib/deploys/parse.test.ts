/**
 * Tests for what the deploy endpoint trusts and what it derives.
 */

import { describe, expect, it } from "vitest";
import {
  DEPLOY_MESSAGE_MAX,
  DEPLOY_TITLE_MAX,
  deployDedupeKey,
  deployInfoFromMessage,
  parseDeployBody,
} from "./parse";

const SHA = "b2f3113a8c0d4e5f60718293a4b5c6d7e8f90123";

describe("deployInfoFromMessage", () => {
  it("takes the PR title from the body of a merge commit", () => {
    const message =
      "Merge pull request #129 from smartlizardpy/feature/gameplay-recorder\n\nAdd the gameplay recorder\n";
    expect(deployInfoFromMessage(message)).toEqual({
      title: "Add the gameplay recorder",
      pr: 129,
    });
  });

  it("falls back to the merge subject when the body is empty", () => {
    expect(deployInfoFromMessage("Merge pull request #7 from a/b")).toEqual({
      title: "Merge pull request #7 from a/b",
      pr: 7,
    });
  });

  it("strips the (#N) suffix of a squash merge", () => {
    expect(deployInfoFromMessage("Add streak flames (#130)\n\n* wip\n* more")).toEqual({
      title: "Add streak flames",
      pr: 130,
    });
  });

  it("leaves a plain commit alone", () => {
    expect(deployInfoFromMessage("Fix a typo")).toEqual({ title: "Fix a typo", pr: null });
  });

  it("does not mistake a mid-line #N for a PR", () => {
    expect(deployInfoFromMessage("Revert #5 handling (again)").pr).toBeNull();
  });

  it("copes with an empty message", () => {
    expect(deployInfoFromMessage("")).toEqual({ title: "", pr: null });
  });

  it("strips control and bidi characters and collapses whitespace", () => {
    const { title } = deployInfoFromMessage("Fix\u0007  the‮   thing\u0000");
    expect(title).toBe("Fix the thing");
  });

  it("bounds a huge title", () => {
    const { title } = deployInfoFromMessage("z".repeat(5000));
    expect(title.length).toBeLessThanOrEqual(DEPLOY_TITLE_MAX);
  });
});

describe("parseDeployBody", () => {
  it("accepts a full sha and normalises its case", () => {
    const info = parseDeployBody({ sha: SHA.toUpperCase(), message: "Fix a typo" });
    expect(info).toEqual({ sha: SHA, title: "Fix a typo", pr: null });
  });

  it("accepts a body with no message", () => {
    expect(parseDeployBody({ sha: SHA })).toEqual({ sha: SHA, title: "", pr: null });
  });

  it.each([
    ["not an object", "sha"],
    ["null", null],
    ["no sha", {}],
    ["a numeric sha", { sha: 123 }],
    ["a short sha", { sha: "b2f3113" }],
    ["a non-hex sha", { sha: "z".repeat(40) }],
    ["a sha with a suffix", { sha: `${SHA}0` }],
  ])("rejects %s", (_name, body) => {
    expect(parseDeployBody(body)).toBeNull();
  });

  it("ignores a message that is not a string", () => {
    expect(parseDeployBody({ sha: SHA, message: { evil: true } })?.title).toBe("");
  });

  it("only reads the first part of an enormous message", () => {
    const message = `${"a".repeat(DEPLOY_MESSAGE_MAX)}\nMerge pull request #9 from x/y`;
    expect(parseDeployBody({ sha: SHA, message })?.pr).toBeNull();
  });
});

describe("deployDedupeKey", () => {
  it("is stable per commit and distinct between commits", () => {
    expect(deployDedupeKey(SHA)).toBe(deployDedupeKey(SHA));
    expect(deployDedupeKey(SHA)).not.toBe(deployDedupeKey(SHA.replace(/^b/, "c")));
  });
});
