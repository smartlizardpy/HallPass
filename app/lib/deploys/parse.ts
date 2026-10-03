/**
 * HallPass — turning what CI sends about a deploy into what the site trusts.
 *
 * PURE and free of `server-only`, like `alerts/rules.ts`: it narrows an
 * untrusted request body and derives the words, and touches nothing else, so
 * all of it unit-tests in the plain `node` environment.
 *
 * ── THE SERVER DERIVES THE TITLE, THE RUNNER SENDS THE RAW MESSAGE ─────────
 * `scripts/notify-deploy.mjs` posts the commit sha and the commit MESSAGE,
 * unmodified, and nothing else. Working out "what shipped" from a message — a
 * merge commit's subject is useless, its PR title is on the next line; a squash
 * merge carries `(#123)` — is judgement, and judgement lives here where there are
 * tests, not in a runner that would be a second, untestable copy (the same
 * argument `check-alerts.mjs` makes about thresholds).
 *
 * ── THIS IS CHOSEN TEXT FROM A CREDENTIAL IN A REPOSITORY'S SETTINGS ───────
 * `alerts/wording.ts` takes numbers, never words, because the secret can be read
 * by anyone who can edit a workflow. A deploy notification is the deliberate
 * exception — "something shipped" with no "what" is barely worth a buzz — so the
 * damage is bounded instead: control characters are stripped, the title is
 * length-limited, it appears only in the FULL copy (the discreet one names
 * nothing), and only admins ever receive it.
 *
 * ── THE SHA IS THE IDENTITY ────────────────────────────────────────────────
 * It must be a full 40-character hex id, and it becomes the dedupe key. A re-run
 * or a `workflow_dispatch` redeploy of the same commit therefore files nothing
 * and buzzes nobody.
 */

/** Longest title kept, before `copy.ts` bounds the finished body again. */
export const DEPLOY_TITLE_MAX = 120;

/** Longest raw commit message accepted from the runner, in characters. */
export const DEPLOY_MESSAGE_MAX = 4096;

/** What a deploy notification is built from. */
export type DeployInfo = {
  /** Lower-case 40-character commit sha. */
  sha: string;
  /** The PR title or commit subject, cleaned and bounded. */
  title: string;
  /** The pull request number, or `null` when the commit was not one. */
  pr: number | null;
};

const SHA = /^[0-9a-f]{40}$/;

/**
 * Remove control characters, keeping newlines so the message can still be
 * split into lines. Covers C0/C1, and the bidi/zero-width characters that let a
 * string read differently from how it is stored.
 */
function stripControls(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, "");
}

/** Collapse runs of whitespace and clip to `max` with an ellipsis. */
function tidy(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * Work out what shipped from a raw commit message.
 *
 *   "Merge pull request #129 from owner/branch\n\nAdd streak flames"
 *       → { title: "Add streak flames", pr: 129 }
 *   "Add streak flames (#130)"          → { title: "Add streak flames", pr: 130 }
 *   "Fix a typo"                        → { title: "Fix a typo", pr: null }
 *
 * A merge commit whose body is empty falls back to its own subject rather than
 * to nothing. Anything after the first matching line is ignored — the body of a
 * squash commit is a list of the squashed commits, which is not the title.
 */
export function deployInfoFromMessage(message: string): Pick<DeployInfo, "title" | "pr"> {
  const lines = stripControls(message)
    .split("\n")
    .map((line) => line.trim());
  const subject = lines.find((line) => line.length > 0) ?? "";

  const merge = /^Merge pull request #(\d+)\b/.exec(subject);
  if (merge) {
    const rest = lines.slice(lines.indexOf(subject) + 1).find((line) => line.length > 0);
    return { title: tidy(rest ?? subject, DEPLOY_TITLE_MAX), pr: Number(merge[1]) };
  }

  const squash = /^(.*\S)\s*\(#(\d+)\)$/.exec(subject);
  if (squash) {
    return { title: tidy(squash[1], DEPLOY_TITLE_MAX), pr: Number(squash[2]) };
  }

  return { title: tidy(subject, DEPLOY_TITLE_MAX), pr: null };
}

/**
 * Narrow an untrusted request body to a deploy, or `null`.
 *
 * Expects `{ sha: string, message?: string }`. `message` is optional on purpose:
 * a runner that could not read the commit message still announces the deploy,
 * with a sha and a generic line, rather than saying nothing.
 */
export function parseDeployBody(value: unknown): DeployInfo | null {
  if (typeof value !== "object" || value === null) return null;
  const { sha, message } = value as { sha?: unknown; message?: unknown };
  if (typeof sha !== "string") return null;
  const normalised = sha.trim().toLowerCase();
  if (!SHA.test(normalised)) return null;

  const raw = typeof message === "string" ? message.slice(0, DEPLOY_MESSAGE_MAX) : "";
  return { sha: normalised, ...deployInfoFromMessage(raw) };
}

/**
 * The dedupe key for one deployed commit.
 *
 * `deliver.ts` suffixes the recipient, so this means "this commit, this admin".
 */
export function deployDedupeKey(sha: string): string {
  return `deploy:${sha}`;
}
