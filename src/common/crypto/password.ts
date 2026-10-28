import * as argon2 from 'argon2';

/**
 * Password hashing helpers (TPRD 02 §3.1 steps 4–5).
 *
 * Login must not reveal whether an email exists, whether the account has a
 * password yet (invited users have `passwordHash = null`), or whether the
 * password was simply wrong. Each of those outcomes is 401 `INVALID_CREDENTIALS`,
 * and — to keep response timing indistinguishable — the "no hash" branch still
 * performs a full `argon2.verify` against a constant hash before returning false.
 *
 * Pure and framework-free on purpose (like `tokens.ts`): services, seeds and
 * tests can import it directly.
 */

/**
 * Precomputed argon2id hash (default `argon2` options) of the arbitrary string
 * `"dummy-password-for-constant-time-comparison"`. Hardcoded so there is no
 * startup cost and no async initialisation race. Its only purpose is to be
 * verified against when there is no real hash to compare with; the result of
 * that verification is always discarded.
 */
export const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$5+RqX0C5veCLO+6xeW4X0A$O8F7lkIxh4FMibPwwCUYT1/k6Mil+5v3d8Ab6YrpfZ0';

/** Hash a plaintext password for storage with the `argon2` defaults (argon2id). */
export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain);
}

/**
 * Constant-time password check that also covers the "nothing to compare with" case.
 *
 * - `hash === null` (no user found, or user has no password yet): run
 *   `argon2.verify(DUMMY_HASH, plain)`, ignore the result, return `false`
 *   (§3.1 step 4).
 * - otherwise: return `argon2.verify(hash, plain)` (§3.1 step 5).
 *
 * Caller pattern:
 * ```ts
 * const ok = await verifyPassword(user?.passwordHash ?? null, password);
 * if (!ok) throw new AppError(401, 'INVALID_CREDENTIALS');
 * ```
 */
export async function verifyPassword(hash: string | null, plain: string): Promise<boolean> {
  if (hash === null) {
    // §3.1 step 4 — dummy verify so timing matches the real-hash path; result discarded
    await argon2.verify(DUMMY_HASH, plain);
    return false;
  }
  // §3.1 step 5 — real comparison
  return argon2.verify(hash, plain);
}
