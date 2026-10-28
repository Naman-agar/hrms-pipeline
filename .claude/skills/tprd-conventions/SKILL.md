---
name: tprd-conventions
description: How to read and apply the HRMS TPRD documents in docs/tprd/ (foundation, authentication, user-management, user-invite). Load this whenever you are reading a TPRD, implementing a numbered flow step, mapping an acceptance criterion (AC-xx) to a test, or deciding what an unspecified detail should be. Use it even for small tasks like "add the resend endpoint" — the TPRD, not memory, is the source of truth.
---

# tprd-conventions

Each TPRD in `docs/tprd/` has the same skeleton. Knowing what each part is *for* tells you how literally to treat it.

## Document anatomy

| Section | What it is | How to treat it |
| --- | --- | --- |
| Header: Scope / Depends on | Boundaries and build order | Binding. Do not build outside scope; do not start before dependencies are done. |
| Endpoints table | Method, path, permission, success shape | Exact. Paths are under `/api/v1`. Permission strings map to `@Permissions()`. |
| "Flow — step by step" (numbered) | The algorithm for one endpoint, in execution order | Implement steps **in that order**. Each numbered step usually becomes one block of code; the order of checks determines which error wins when several apply. |
| Code snippets inside flows | Prisma calls, transaction bodies | Use as written unless they would not compile; then keep the semantics. |
| Error codes section | The complete set of `code` values for this feature | Closed list. Throw `AppError(status, code)`; never invent a new code. |
| Tests required | Hints from the author | Useful, but the ACs are the real contract. |
| Acceptance criteria (AC-F1, AC-A3, AC-U9, AC-I4 …) | Given / When / Then, observable from outside | Each bullet is one test. The AC id is the test name prefix. |
| Done criteria | Manual smoke check | Run it literally at the end. |

## Reading rules

1. **Step order is semantics.** In TPRD 02 §3.1, the `invited` status check (step 6) comes *after* password verification (step 5). That means a wrong password on an invited account returns 401, not 403. Keep the order.
2. **Error precedence follows numbering.** When two conditions are true, the earlier numbered step's error is returned.
3. **"Includes soft-deleted"** on a lookup means query without `deletedAt: null`; everywhere else, user queries exclude soft-deleted rows.
4. **Transaction blocks are atomic.** If a flow lists several writes under "Transaction", they share one `prisma.$transaction(async tx => …)` and the audit row is inside it. Mail enqueue is always *after* commit (TPRD 04 §4.7 explains why).
5. **Snake_case in, snake_case out.** Request bodies and responses use the names in the TPRD (`first_name`, `role_id`). Prisma fields are camelCase. Only the mapper and zod schemas translate.
6. **Numbers are limits, not suggestions.** 72 h, 15 min, 5 attempts, 43-char tokens, 100-char search, page sizes 10/25/50/100 — hard-code via config constants, test the boundary.

## Turning an AC into a test

```
AC-U5 Pagination
- When page_size=1&page=2, then one row (Rahul) and meta.total=2, total_pages=2.
```
becomes
```ts
it('AC-U5 page_size=1&page=2 returns Rahul with total=2,total_pages=2', …)
```
One `it` per bullet (or per clause if a bullet has several "then"s). Name starts with the AC id so the reviewer and the user can grep coverage. Assertions check exactly the values the AC names — status code, `error.code`, field presence, ordering — not internal implementation.

## When the TPRD is silent

Pick the simplest behaviour consistent with the rest of the document, implement it, and append one line to `docs/decisions.md`:

```
- TPRD 03 §7: `avatar_url` validated as https URL ≤ 2048 chars (not specified).
```

Do not ask the user mid-build for details like this; do ask if two sections of the TPRD contradict each other.

## Cross-TPRD references

Flows often say "as in 02 §3.1 steps 7–8" or "(03 handles)". Open the referenced TPRD and reuse the existing helper (`authService.issueTokens`, `authService.revokeAllForUser`, `toUserDto`) rather than re-implementing it.
