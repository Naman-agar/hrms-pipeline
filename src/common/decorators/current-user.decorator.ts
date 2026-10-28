// TPRD 02 §4.3 — `@CurrentUser()` param decorator returns `req.user`.
//
// `req.user` is what `JwtAuthGuard` attached (§4.1 step 3): the JWT claims
// `{ id, role, perms }` — no DB row. Returns `undefined` on a `@Public()` route
// where the guard did not run. Load the full user in the service only when the
// flow needs more (e.g. `departmentId` for manager scoping in 03).
//
//   @Get('me')
//   me(@CurrentUser() actor: CurrentUserPayload) { … }
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { CurrentUserPayload, RequestWithUser } from '../guards/jwt-auth.guard';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CurrentUserPayload | undefined => {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    return request.user;
  },
);
