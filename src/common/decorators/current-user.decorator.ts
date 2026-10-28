// TPRD 01 §2 — `src/common/decorators/current-user.decorator.ts`.
//
// `@CurrentUser()` hands a controller the user that the auth guard attached to
// `request.user` (TPRD 01 §7 stub: the User row with `role` and `department`
// included). Returns `undefined` on a route where no auth guard has run.
//
//   @Get()
//   list(@CurrentUser() actor: CurrentUserPayload) { … }
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { CurrentUserPayload, RequestWithUser } from '../guards/auth.guard';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CurrentUserPayload | undefined => {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    return request.user;
  },
);
