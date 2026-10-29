// TPRD 03 §4.2 — `escapeLike(term)` for the `GET /users` search filter.
//
// Prisma's `contains` compiles to SQL `LIKE '%' || term || '%'` (`ILIKE` with
// `mode: 'insensitive'`), so a user-supplied `%` or `_` would act as a wildcard
// instead of a literal character. AC-U2 requires `search=%` to return zero rows.
//
// Pure and framework-free on purpose (like `crypto/tokens.ts`): services and
// tests import it directly.

/** Characters that have meaning inside a SQL `LIKE` pattern (PostgreSQL default escape `\`). */
const LIKE_SPECIALS = /[\\%_]/g;

/**
 * Escape `%`, `_` and `\` so the term matches literally inside a Prisma `contains` filter.
 *
 * All three are escaped in one pass, so a backslash already present in the input is
 * doubled exactly once and never re-escapes the `%`/`_` that follow it
 * (`a\%` → `a\\\%`, not `a\\\\%`).
 */
export function escapeLike(term: string): string {
  return term.replace(LIKE_SPECIALS, '\\$&');
}
