# HRMS backend build pipeline

Unzip this into the root of your (empty or new) `hrms-api` repo, then in Claude Code:

    /build-feature 01
    /build-feature 02
    /build-feature 03
    /build-feature 04

Each run: planner → implementer (per task) → tester (one test per AC-xx) → reviewer → commit.
Progress is tracked in CLAUDE.md; unspecified choices are logged in docs/decisions.md.

Layout
  CLAUDE.md                              project rules, TPRD status table
  docs/tprd/01..04-*.md                  the specs
  .claude/skills/build-feature/          the /build-feature command (pipeline)
  .claude/skills/tprd-conventions/       how to read a TPRD, AC → test
  .claude/skills/nest-prisma-patterns/   code patterns every agent follows
  .claude/agents/planner|implementer|tester|reviewer.md
