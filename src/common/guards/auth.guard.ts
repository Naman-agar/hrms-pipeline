// TPRD 01 §7 — temporary authentication stub for the reference-data endpoints.
//
// TEMPORARY: TPRD 02-authentication replaces this with real JWT auth (JwtAuthGuard); do not build on it.
//
// §7 (last line): "guard these with a temporary AuthGuard stub that reads
// `x-user-id` header and loads that user". The loaded user — with `role` and
// `department` included so `PermissionsGuard` and later department scoping can
// read them — is attached to `request.user`, which is what `@CurrentUser()`
// (`src/common/decorators/current-user.decorator.ts`) returns.
//
// Routes marked `@Public()` (`GET /health`, later 02-auth's login/refresh/accept)
// bypass the guard entirely so they work once it is registered as `APP_GUARD`.
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Prisma } from '@prisma/client';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AppError } from '../errors/app-error';
import { PrismaService } from '../../prisma/prisma.service';

/** Header the stub reads the acting user's id from (§7). */
export const USER_ID_HEADER = 'x-user-id';

/** Shape `AuthGuard` attaches to the request: the User row plus its role and department. */
export type CurrentUserPayload = Prisma.UserGetPayload<{
  include: { role: true; department: true };
}>;

/**
 * The slice of the incoming HTTP request the guards and `@CurrentUser()` touch.
 * Typed structurally (not as Express `Request`) so `@types/express` is not required.
 */
export interface RequestWithUser {
  headers: Record<string, string | string[] | undefined>;
  user?: CurrentUserPayload;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // `@Public()` routes skip authentication entirely — no header read, no DB hit
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();

    // §7 — read the `x-user-id` header; missing → 401 UNAUTHENTICATED
    const rawHeader = request.headers[USER_ID_HEADER];
    const userId = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    if (!userId || userId.trim() === '') {
      throw new AppError(401, 'UNAUTHENTICATED', `missing ${USER_ID_HEADER} header`);
    }

    // §7 — load that user (with role + department); unknown or soft-deleted → 401 UNAUTHENTICATED
    const user = await this.prisma.user.findFirst({
      where: { id: userId.trim(), deletedAt: null },
      include: { role: true, department: true },
    });
    if (!user) {
      throw new AppError(401, 'UNAUTHENTICATED', 'unknown user');
    }

    // §7 — attach to the request for `@CurrentUser()` and `PermissionsGuard`
    request.user = user;
    return true;
  }
}
