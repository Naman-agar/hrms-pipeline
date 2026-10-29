// TPRD 03 §2 — User routes. Paths are relative to the global `api/v1` prefix
// set in main.ts (01 §6.5 step 4).
//
// The controller carries no prefix of its own because the §2 table puts
// `PATCH /me` at the API root (`/api/v1/me`, beside 02's `GET /me`), not under
// `/users`; the six user-table routes therefore name their `users` segment
// explicitly — the same explicit-path style as `AuthController` (docs/decisions.md).
//
// Authentication is the global `JwtAuthGuard` (02 §4.1); each `/users` route
// carries the `@Permissions()` string from the §2 endpoints table, checked by the
// global `PermissionsGuard` against the caller's JWT `perms`. `PATCH /me` is
// "any authenticated" and so has no `@Permissions()`.
//
// `@CurrentUser()` is the JWT payload `{ id, role, perms }` only — no
// `departmentId`. The service loads that itself when manager scoping applies.
//
// Routes hold no logic: each calls exactly one service method and returns its result.
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { Paginated } from '../common/dto/pagination.dto';
import type { CurrentUserPayload } from '../common/guards/jwt-auth.guard';
import {
  CreateUserDto,
  CreateUserSchema,
  ListUsersQueryDto,
  ListUsersQuerySchema,
  UpdateMeDto,
  UpdateMeSchema,
  UpdateUserDto,
  UpdateUserSchema,
  UserIdSchema,
} from './dto';
import { UserDetailDto, UserDto } from './user.mapper';
import { UsersService } from './users.service';

@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** `GET /users` — `users.read`; §4 list with search/filter/sort/pagination (+ manager scoping). */
  @Get('users')
  @Permissions('users.read')
  list(
    @Query(new ZodValidationPipe(ListUsersQuerySchema)) query: ListUsersQueryDto,
    @CurrentUser() actor: CurrentUserPayload,
  ): Promise<Paginated<UserDto>> {
    return this.users.list(query, actor);
  }

  /** `GET /users/{id}` — `users.read`; §5 detail (+ `invitation` block, manager-scoped). */
  @Get('users/:id')
  @Permissions('users.read')
  getById(
    // §5 step 1 — `id` must be a uuid → 400 VALIDATION_ERROR
    @Param('id', new ZodValidationPipe(UserIdSchema)) id: string,
    @CurrentUser() actor: CurrentUserPayload,
  ): Promise<UserDetailDto> {
    return this.users.getById(id, actor);
  }

  /** `POST /users` — `users.create`; §6 direct create with password. 201 (Nest's POST default). */
  @Post('users')
  @Permissions('users.create')
  create(
    @Body(new ZodValidationPipe(CreateUserSchema)) body: CreateUserDto,
    @CurrentUser() actor: CurrentUserPayload,
  ): Promise<UserDto> {
    return this.users.create(body, actor);
  }

  /** `PATCH /users/{id}` — `users.update`; §7 partial update (transition table, last-admin rule). 200. */
  @Patch('users/:id')
  @Permissions('users.update')
  update(
    // `id` must be a uuid → 400 VALIDATION_ERROR (docs/decisions.md: uniform on every users/:id route)
    @Param('id', new ZodValidationPipe(UserIdSchema)) id: string,
    @Body(new ZodValidationPipe(UpdateUserSchema)) body: UpdateUserDto,
    @CurrentUser() actor: CurrentUserPayload,
  ): Promise<UserDto> {
    return this.users.update(id, body, actor);
  }

  /** `DELETE /users/{id}` — `users.delete`; §8 soft delete. 204 with no body. */
  @Delete('users/:id')
  @HttpCode(204)
  @Permissions('users.delete')
  remove(
    // `id` must be a uuid → 400 VALIDATION_ERROR (docs/decisions.md: uniform on every users/:id route)
    @Param('id', new ZodValidationPipe(UserIdSchema)) id: string,
    @CurrentUser() actor: CurrentUserPayload,
  ): Promise<void> {
    return this.users.remove(id, actor);
  }

  /** `POST /users/{id}/restore` — `users.delete`; §9 undo soft delete. 200 (not Nest's POST 201). */
  @Post('users/:id/restore')
  @HttpCode(200)
  @Permissions('users.delete')
  restore(
    // `id` must be a uuid → 400 VALIDATION_ERROR (docs/decisions.md: uniform on every users/:id route)
    @Param('id', new ZodValidationPipe(UserIdSchema)) id: string,
    @CurrentUser() actor: CurrentUserPayload,
  ): Promise<UserDto> {
    return this.users.restore(id, actor);
  }

  /** `PATCH /me` — bearer, any authenticated role (§2/§10), no `@Permissions()`; 200 with own UserDto. */
  @Patch('me')
  updateMe(
    @Body(new ZodValidationPipe(UpdateMeSchema)) body: UpdateMeDto,
    @CurrentUser() actor: CurrentUserPayload,
  ): Promise<UserDto> {
    return this.users.updateMe(actor.id, body);
  }
}
