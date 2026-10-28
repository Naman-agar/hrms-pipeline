// TPRD 02 §3.1 step 2 — login rate limit.
//
// "Rate-limit check: key `login:<email>` and `login:<ip>`, limit 5 per 15 min
// (`@nestjs/throttler` with Redis store). Exceeded → 429 `RATE_LIMITED`."
//
// Implemented as a plain `CanActivate` guard rather than `@nestjs/throttler`'s
// `ThrottlerGuard` because the step requires TWO independent counters (email and
// IP) checked on one request, and the rejection must be an `AppError` so it goes
// through the global filter's `{ error: { code, message } }` envelope (AC-F5)
// instead of the library's own `ThrottlerException` body.
//
// Counting is the standard fixed-window counter: `INCR key`, and `PEXPIRE key
// <window>` only when the INCR created the key (count === 1). Both keys are
// handled in one Lua script so INCR + PEXPIRE are atomic (a crash between the
// two can never leave an immortal counter) and the check costs one round-trip.
// Every attempt counts — successful logins included — and attempts made while
// already over the limit keep counting but never extend the window.
//
// Window expiry is Redis TTL (wall-clock), not `ClockService`: Redis evaluates
// PEXPIRE against its own clock, so a frozen/advanced `ClockService` cannot
// influence it. Tests reset the window by deleting `login:*` keys through the
// shared `REDIS_CLIENT` instead of advancing time.
//
// The guard runs before the zod body validation of step 1 (guards precede
// pipes in Nest), so it reads `request.body.email` defensively: trimmed and
// lower-cased to match the normalisation step 1 applies, and skipped entirely
// when the body carries no usable string (step 1 will 400 that request anyway;
// it still counts against the IP key).
import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { AppError } from '../common/errors/app-error';
import { REDIS_CLIENT } from '../common/redis/redis.module';
import {
  LOGIN_RATE_LIMIT_MAX,
  LOGIN_RATE_LIMIT_WINDOW_MS,
  loginEmailKey,
  loginIpKey,
} from './auth.constants';

/**
 * The slice of the incoming HTTP request this guard touches. Typed structurally
 * (not as Express `Request`) so `@types/express` is not required, mirroring
 * `RequestWithUser` in `common/guards/jwt-auth.guard.ts`.
 */
export interface LoginRequest {
  body?: unknown;
  /** Express populates `req.ip` (honours `trust proxy` when configured). */
  ip?: string;
  socket?: { remoteAddress?: string };
}

/** Used when neither `req.ip` nor the socket address is available (e.g. unit tests with a bare object). */
const UNKNOWN_IP = 'unknown';

/**
 * Fixed-window counter for every key in KEYS: INCR, and PEXPIRE (ARGV[1] ms)
 * only on the increment that created the key. Returns the post-increment
 * counts in KEYS order.
 */
const INCREMENT_WINDOW_SCRIPT = `
local counts = {}
for i, key in ipairs(KEYS) do
  local count = redis.call('INCR', key)
  if count == 1 then
    redis.call('PEXPIRE', key, ARGV[1])
  end
  counts[i] = count
end
return counts
`;

@Injectable()
export class LoginThrottleGuard implements CanActivate {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<LoginRequest>();

    // §3.1 step 2 — derive the two keys: `login:<email>` (normalised as step 1 will) and `login:<ip>`
    const keys = [loginIpKey(clientIp(request))];
    const email = bodyEmail(request.body);
    if (email) {
      keys.push(loginEmailKey(email));
    }

    // §3.1 step 2 — INCR each key, PEXPIRE 15 min on first hit, atomically in one round-trip
    const counts = (await this.redis.eval(
      INCREMENT_WINDOW_SCRIPT,
      keys.length,
      ...keys,
      LOGIN_RATE_LIMIT_WINDOW_MS,
    )) as number[];

    // §3.1 step 2 — either counter past 5 in its window → 429 RATE_LIMITED
    if (counts.some((count) => count > LOGIN_RATE_LIMIT_MAX)) {
      throw new AppError(429, 'RATE_LIMITED', 'too many login attempts, try again later');
    }

    return true;
  }
}

/** `request.body.email`, trimmed + lower-cased like §3.1 step 1; `undefined` when absent or not a string. */
function bodyEmail(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const email = (body as { email?: unknown }).email;
  if (typeof email !== 'string') return undefined;
  const normalised = email.trim().toLowerCase();
  return normalised.length > 0 ? normalised : undefined;
}

/**
 * Client IP: Express's `req.ip`, else the raw socket address, else a fixed placeholder.
 * Exported so `AuthController` records the same value in the §3.1 step 7 audit row.
 */
export function clientIp(request: LoginRequest): string {
  return request.ip || request.socket?.remoteAddress || UNKNOWN_IP;
}
