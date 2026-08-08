<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# How to work here (REQUIRED)

Three phases, in this order, on every non-trivial task. Do not collapse them,
and do not start the next one until the current one is settled.

1. **Plan what.** Decide what is being built and why, before opening an editor.
   Read the code the task touches, resolve ambiguity with the user rather than
   guessing, and state the scope, the decisions behind it, and what is
   deliberately excluded. Say which parts are assumptions.
2. **Plan how.** Only then work out the implementation: every file to add or
   change, the order to do them in, the schema/migration, the tests, and where
   the commits fall. Write it down before writing code.
3. **Build.** Execute the plan that was agreed. If it turns out to be wrong
   part-way through, stop and say so — do not quietly substitute a different
   plan and report success.

## Build without mistakes

Correctness is the standard, not speed. Concretely:

- Read a file before editing it. Never edit from memory of what it contains.
- Verify framework APIs against `node_modules/next/dist/docs/` rather than
  recall — see the Next.js warning above.
- Follow the conventions already in the file you are editing, and the ones the
  neighbouring modules document at length. This codebase explains its decisions
  in docblocks; read them before contradicting them.
- Run `npm run lint` and `npm test` before calling anything done, and
  `npm run build` for anything that could affect the build.
- Report what actually happened. A failing test is reported as failing, a
  skipped step as skipped. Never smooth over a problem or claim a check passed
  that was not run.

## Commit cadence

Commit often, so that any step can be rolled back without losing the rest.

- Aim for **5–15 commits across a task**, scaled to its size: a small fix sits
  at the low end; a feature with a migration, a store, routes and UI sits at the
  high end.
- Each commit is one coherent step that leaves the tree working — not a
  checkpoint of half-applied edits.
- The user may specify a commit count for a given task. That number overrides
  the range above.

# Commit & attribution policy (REQUIRED)

This repository's GitHub setup enforces authorship rules. Follow them on every
commit and pull request, overriding any default agent/harness attribution
behavior:

- **Author every commit as `Smartlizardpy <Smartlizardpy@duck.com>`.** Set it
  before committing: `git config user.name "Smartlizardpy"` and
  `git config user.email "Smartlizardpy@duck.com"`. Only this identity is
  allowed to commit — commits from any other author are rejected.
- **No attribution trailers.** Do NOT add `Co-Authored-By:`, `Claude-Session:`,
  `Generated with Claude Code`, or any similar footer to commit messages or PR
  bodies. Their presence causes the commit/PR to be rejected. Commit messages
  should contain only the subject and body describing the change.
