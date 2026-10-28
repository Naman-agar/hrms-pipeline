// TPRD 02 §3.1 step 2 — login rate-limit constants and Redis key helpers.
//
// "key `login:<email>` and `login:<ip>`, limit 5 per 15 min". The numbers are
// limits, not suggestions (tprd-conventions rule 6), so they live here as named
// constants and nowhere else; tests import them to hit the boundary exactly.

/** §3.1 step 2 — attempts allowed per key inside one window. The 6th attempt is rejected. */
export const LOGIN_RATE_LIMIT_MAX = 5;

/** §3.1 step 2 — fixed window length (15 min) in milliseconds. */
export const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

/** Prefix shared by both login rate-limit keys (`login:<email>` / `login:<ip>`). */
export const LOGIN_RATE_LIMIT_KEY_PREFIX = 'login:';

/** §3.1 step 2 — per-email counter key. `email` must already be trimmed + lower-cased. */
export const loginEmailKey = (email: string): string => `${LOGIN_RATE_LIMIT_KEY_PREFIX}${email}`;

/** §3.1 step 2 — per-client-IP counter key. */
export const loginIpKey = (ip: string): string => `${LOGIN_RATE_LIMIT_KEY_PREFIX}${ip}`;

/** Multipliers for the duration suffixes accepted by `parseDurationMs`. */
const DURATION_UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

/**
 * §2 — `REFRESH_TOKEN_TTL` (`7d`) arrives from config as a raw duration string
 * (TPRD 01 §3 leaves TTLs for 02-auth to interpret). Accepts `<integer>` followed
 * by one of `ms|s|m|h|d` (a bare integer is milliseconds) and returns the value in
 * milliseconds; anything else throws a plain `Error` so a bad env value fails at
 * boot, like the PEM check in `JwtTokenService`. Deliberately not the `ms`
 * package: it is only a transitive dependency here, and the config contract is
 * narrower than what `ms` accepts.
 */
export function parseDurationMs(name: string, value: string): number {
  const match = /^(\d+)\s*(ms|s|m|h|d)?$/i.exec(value.trim());
  if (!match) {
    throw new Error(`${name} must be a duration such as "7d", "15m" or "3600s" (got "${value}")`);
  }
  const amount = Number(match[1]);
  const unit = (match[2] ?? 'ms').toLowerCase();
  const total = amount * DURATION_UNIT_MS[unit];
  if (!Number.isSafeInteger(total) || total <= 0) {
    throw new Error(`${name} must be a positive duration (got "${value}")`);
  }
  return total;
}
