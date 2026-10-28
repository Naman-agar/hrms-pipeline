// TPRD 02 §1 — Authentication routes.
//
// | Method & path        | Auth   | Success                                   |
// | `POST /auth/login`   | none   | 200 `{ accessToken, refreshToken, user }` |
// | `POST /auth/refresh` | none   | 200 `{ accessToken, refreshToken }`       |
// | `POST /auth/logout`  | bearer | 204                                       |
// | `GET /me`            | bearer | 200 user object (03 §3 shape)             |
//
// The `api/v1` prefix is applied globally in `main.ts` (01 §6.5 step 4). The
// controller carries no prefix of its own because the §1 table puts `GET /me`
// at the API root (`/api/v1/me`, as §9 and AC-A6 also spell it), not under
// `/auth`; the three auth routes therefore name their `auth/` segment explicitly.
//
// `@Public()` exempts login and refresh from the global `JwtAuthGuard` (§4.1);
// logout and `GET /me` need a bearer (§3.3 step 1, §5 "any authenticated") and
// no `@Permissions()`. `LoginThrottleGuard` is §3.1 step 2, scoped to login only.
// Body validation (§3.1 step 1, §3.2 step 1) is the per-route zod pipe, matching
// the roles/departments controllers.
//
// Routes, guards and decorators only — every handler calls exactly one service
// method and returns its result (nest-prisma-patterns).
import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import type { CurrentUserPayload, RequestWithUser } from '../common/guards/jwt-auth.guard';
import type { UserDto } from '../users/user.mapper';
import { AuthService, LoginContext, LoginResult, TokenPair } from './auth.service';
import { LoginDto, LoginSchema, LogoutDto, LogoutSchema, RefreshDto, RefreshSchema } from './dto';
import { clientIp, LoginRequest, LoginThrottleGuard } from './login-throttle.guard';

/**
 * The slice of the raw request the login route reads for the §3.1 step 7 audit
 * metadata `{ ip, userAgent }`. Structural (not Express `Request`) like the
 * other request types in this repo.
 */
type LoginHttpRequest = LoginRequest & Pick<RequestWithUser, 'headers'>;

/** `{ ip, userAgent }` for the `auth.login` audit row; same IP resolution as the rate-limit key. */
function loginContext(request: LoginHttpRequest): LoginContext {
  const rawUserAgent = request.headers['user-agent'];
  const userAgent = Array.isArray(rawUserAgent) ? rawUserAgent[0] : rawUserAgent;
  return { ip: clientIp(request), userAgent };
}

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** §1 `POST /auth/login` — public, rate-limited (§3.1 step 2); 200 `{ accessToken, refreshToken, user }`. */
  @Public()
  @UseGuards(LoginThrottleGuard)
  @Post('auth/login')
  @HttpCode(200)
  login(
    @Body(new ZodValidationPipe(LoginSchema)) dto: LoginDto,
    @Req() request: LoginHttpRequest,
  ): Promise<LoginResult> {
    return this.auth.login(dto, loginContext(request));
  }

  /** §1 `POST /auth/refresh` — public; 200 `{ accessToken, refreshToken }`. */
  @Public()
  @Post('auth/refresh')
  @HttpCode(200)
  refresh(@Body(new ZodValidationPipe(RefreshSchema)) dto: RefreshDto): Promise<TokenPair> {
    return this.auth.refresh(dto);
  }

  /** §1 `POST /auth/logout` — bearer (§3.3 step 1); always 204 with no body (§3.3 step 3). */
  @Post('auth/logout')
  @HttpCode(204)
  logout(
    @Body(new ZodValidationPipe(LogoutSchema)) dto: LogoutDto,
    @CurrentUser() actor: CurrentUserPayload,
  ): Promise<void> {
    return this.auth.logout(dto, actor.id);
  }

  /** §1 `GET /me` — bearer, any authenticated role (§5); 200 with the caller's own UserDto (AC-A6). */
  @Get('me')
  me(@CurrentUser() actor: CurrentUserPayload): Promise<UserDto> {
    return this.auth.getMe(actor.id);
  }
}
