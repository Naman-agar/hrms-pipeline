# HRMS API — project rules

This repository is the backend for the HRMS User-management screen. It is built feature by feature from the Technical PRDs in `docs/tprd/`, in numeric order:

| # | TPRD | Status |
| --- | --- | --- |
| 01 | docs/tprd/01-foundation.md | done |
| 02 | docs/tprd/02-authentication.md | pending |
| 03 | docs/tprd/03-user-management.md | pending |
| 04 | docs/tprd/04-user-invite.md | pending |

Update the Status column (`pending` → `in progress` → `done`) as `/build-feature` completes each one.

## How to build

- Run `/build-feature <nn>` (e.g. `/build-feature 01`). It runs the planner → implementer → tester → reviewer pipeline defined in `.claude/skills/build-feature/SKILL.md`.
- A TPRD's "Depends on" line is binding: never start 03 before 01 and 02 are marked done.
- The TPRD is the source of truth. If something is not specified there, prefer the simplest option and record the decision in `docs/decisions.md`; do not invent new endpoints, fields, or error codes.

## Stack (fixed, from TPRD 01 §1)

Node 22 · TypeScript strict · NestJS 10 · PostgreSQL 16 + Prisma 5 · BullMQ/Redis · Zod via nestjs-zod · argon2 · pino · Vitest + Supertest.

## Conventions

- Every error passes through the global filter and returns `{ error: { code, message, fields? } }`. Throw `AppError` with a code listed in the relevant TPRD; never a bare string.
- Writes that must be consistent (user + audit log, user + invitation, token rotate) happen inside one `prisma.$transaction`.
- No service reads `process.env`; everything comes from `src/config/config.ts`.
- API responses use the snake_case DTOs from TPRD 03 §3; Prisma models stay camelCase. Mapping happens only in `*.mapper.ts`.
- Each acceptance-criterion id (`AC-F1`, `AC-U4` …) has a test whose name starts with that id, in `test/<feature>.e2e.spec.ts`.

## Commands

```
npm run dev              # watch mode
npm run prisma:migrate   # prisma migrate dev
npm run seed             # prisma/seed.ts
npm test                 # vitest run (uses DATABASE_URL_TEST)
npm run lint
```
