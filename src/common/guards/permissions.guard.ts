// TPRD 01 §7 — permission check for routes marked with `@Permissions(...)`.
//
// Runs after the auth guard (`AuthGuard` now; `JwtAuthGuard` once TPRD 02 lands)
// and compares the handler's required permission strings with the current
// user's `role.permissions` (Role.permissions String[], §4). The user must hold
// every required permission; otherwise 403 FORBIDDEN. Routes without
// `@Permissions()` metadata (e.g. `GET /roles` — "any authenticated") pass
// straight through, so the guard is a no-op for them.
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { AppError } from '../errors/app-error';
import type { RequestWithUser } from './auth.guard';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // §7 — read required permissions from the handler (falls back to the controller class)
    const required = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }

    // §7 — the auth guard must have attached a user; none → 401 UNAUTHENTICATED
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    if (!user) {
      throw new AppError(401, 'UNAUTHENTICATED', 'authentication required');
    }

    // §7 — every required permission must be in the user's role.permissions; else 403 FORBIDDEN
    const granted = new Set(user.role.permissions);
    const missing = required.filter((perm) => !granted.has(perm));
    if (missing.length > 0) {
      throw new AppError(403, 'FORBIDDEN', `missing permission: ${missing.join(', ')}`);
    }

    return true;
  }
}
