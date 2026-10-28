import { createHash, randomBytes } from 'node:crypto';

/**
 * Opaque token helpers (TPRD 02 §2 "Refresh token", reused by 04 for invitations).
 *
 * A token is 32 random bytes rendered as base64url (43 chars, no padding). The raw
 * value is handed to the client exactly once; the database only ever stores
 * `hashToken(raw)` — the SHA-256 hex digest — so a leaked table cannot be replayed.
 *
 * Pure and synchronous on purpose: no DI, no Nest decorators, so seeds, services and
 * tests can all import it directly.
 */

/** Generate a new raw token: `base64url(randomBytes(32))`. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Hash a raw token for storage/lookup: `sha256(raw)` as a hex string. */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
