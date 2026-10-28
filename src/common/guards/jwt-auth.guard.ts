// TPRD 02 §4.1 — `JwtAuthGuard` (global, applied to every route except those
// marked `@Public()`). Replaces the TPRD 01 §7 `x-user-id` stub guard (02 §9).
//
// Registered as the first `APP_GUARD` in `AppModule`; `PermissionsGuard` runs
// after it and reads the `request.user` this guard attaches (§4.2), as does
// `@CurrentUser()` (§4.3).
//
// §4.1 step 3 is explicit: **do not hit the DB here**. The user on the request
// is exactly the token's claims — `{ id: sub, role, perms }` — so a role or
// status change takes effect within `ACCESS_TOKEN_TTL` (15 min) or immediately
// via refresh-token revocation. Services that need `departmentId` (manager
// scoping, 03) load the row themselves.
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtTokenService } from '../../auth/jwt-token.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AppError } from '../errors/app-error';

/** Shape `JwtAuthGuard` attaches to `request.user` (§4.1 step 3): the JWT claims, no DB row. */
export interface CurrentUserPayload {
  id: string;
  role: string;
  perms: string[];
}

/**
 * The slice of the incoming HTTP request the guards and `@CurrentUser()` touch.
 * Typed structurally (not as Express `Request`) so `@types/express` is not required.
 */
export interface RequestWithUser {
  headers: Record<string, string | string[] | undefined>;
  user?: CurrentUserPayload;
}

/** Matches exactly `Bearer <token>` — one space, non-empty token, nothing else. */
const BEARER_PATTERN = /^Bearer (\S+)$/;

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtTokens: JwtTokenService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    // `@Public()` routes skip authentication entirely — no header read, no verify
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();

    // §4.1 step 1 — read `Authorization`; must be `Bearer <token>` else 401 UNAUTHENTICATED
    const rawHeader = request.headers.authorization;
    const header = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    const match = header === undefined ? null : BEARER_PATTERN.exec(header);
    if (!match) {
      throw new AppError(401, 'UNAUTHENTICATED', 'missing or malformed Authorization header');
    }
    const token = match[1];

    // §4.1 step 2 — jwt.verify(token, JWT_PUBLIC_KEY, { algorithms: ['RS256'] });
    // any failure (bad signature, wrong algorithm, malformed, expired) → 401 UNAUTHENTICATED
    let claims: ReturnType<JwtTokenService['verify']>;
    try {
      claims = this.jwtTokens.verify(token);
    } catch {
      throw new AppError(401, 'UNAUTHENTICATED', 'invalid or expired access token');
    }

    // §4.1 step 3 — attach req.user = { id: sub, role, perms }; no DB lookup
    request.user = { id: claims.sub, role: claims.role, perms: claims.perms };
    return true;
  }
}
