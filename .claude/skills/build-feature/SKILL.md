---
name: build-feature
description: Builds one HRMS backend feature end-to-end from its TPRD in docs/tprd/ by running the planner → implementer → tester → reviewer agents in sequence. Use this whenever the user says "/build-feature <nn>", "build TPRD 03", "implement the user-invite feature", "start the next feature", or asks to generate code for any numbered TPRD, even if they do not say the word "pipeline".
---

# build-feature

Usage: `/build-feature <nn>` where `<nn>` is `01`, `02`, `03` or `04`. If `$ARGUMENTS` is empty, build the first TPRD still marked `pending` in `CLAUDE.md`.

The reason this is a pipeline rather than "just write the code" is that a single pass tends to skip edge cases the TPRD spells out (last-admin rule, token reuse, escaped `%` in search). Separating planning, implementing, testing and reviewing into agents that each read the TPRD afresh catches those gaps.

## Step 0 — Resolve and check prerequisites

1. `tprd = docs/tprd/<nn>-*.md`. Read it fully.
2. Read its `Depends on:` line. For each dependency, confirm `CLAUDE.md` marks it `done`. If not, stop and tell the user which TPRD must be built first.
3. Load the `tprd-conventions` and `nest-prisma-patterns` skills so the agents you spawn inherit the same reading rules and code patterns.
4. Set the TPRD's row in `CLAUDE.md` to `in progress`.

## Step 1 — Plan

Spawn the `planner` agent with the TPRD path. It returns an ordered task list (one task per TPRD section that produces code) with the files each touches. Create those tasks with TaskCreate so the user can watch progress.

## Step 2 — Implement

For each task in order, spawn the `implementer` agent with: the TPRD path, the task, the section numbers it covers, and the planner's file list. Mark tasks in_progress / completed as they go. Do the tasks sequentially — each flow depends on helpers from earlier sections (error filter before controllers, mapper before list endpoint).

After the last task, run `npm run lint` and `npx tsc --noEmit`; feed any errors back to a fresh implementer run before moving on.

## Step 3 — Test

Spawn the `tester` agent with the TPRD path. It writes one test per acceptance-criterion id and runs `npm test`. It reports a table: AC id → pass / fail / not-testable-here. A failing AC goes back to the implementer with the test output and the exact TPRD sentence it violates; loop until green or three attempts, then surface what is still failing to the user rather than weakening the test.

## Step 4 — Review

Spawn the `reviewer` agent with the TPRD path. It compares the code against every flow step, error code and convention and lists gaps (it does not edit). Any gap marked **blocking** goes back to the implementer (max two review loops). Non-blocking notes are appended to `docs/review-notes.md`.

## Step 5 — Finish

1. Set the TPRD's row in `CLAUDE.md` to `done`.
2. Commit: `feat(<feature-slug>): implement TPRD <nn>` with the AC checklist in the body.
3. Print the AC table and a one-line "next: /build-feature <nn+1>" (or "all four done") to the user.

## What not to do

- Do not merge steps to save time; the tester must not be the same run that wrote the code.
- Do not add endpoints, fields, env vars or error codes the TPRD doesn't name. If something is genuinely unspecified, choose the simplest option and append a line to `docs/decisions.md` so the user can overrule it.
- Do not skip a dependency check because "it's probably fine".
