// `@Public()` marks a route exempt from the globally registered auth guard
// (nest-prisma-patterns "Guards & decorators"). Used by `GET /health` now and by
// 02-auth's login / refresh / accept-invite routes later.
//
// The global guard (`APP_GUARD`) must read this metadata via
// `reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [handler, class])` and
// return `true` before touching headers or the database.
//
//   @Get('health')
//   @Public()
//   check() { … }
import { SetMetadata } from '@nestjs/common';

/** Reflector metadata key that flags a route as publicly reachable. */
export const IS_PUBLIC_KEY = 'isPublic';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
