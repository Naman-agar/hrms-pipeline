// TPRD 01 §7 — Role routes. Paths are relative to the global `api/v1` prefix
// set in main.ts (§6.5 step 4).
//
// Authentication is enforced by the globally registered `AuthGuard` (§7, wired
// as APP_GUARD in app.module.ts), so `GET /roles` needs no decorator for "any
// authenticated". Mutations carry `@Permissions('roles.manage')`, which the
// global `PermissionsGuard` checks against the caller's role.
//
// Routes hold no logic: each calls exactly one service method and returns its result.
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import { Permissions } from '../common/decorators/permissions.decorator';
import {
  CreateRoleDto,
  CreateRoleSchema,
  RoleIdSchema,
  UpdateRoleDto,
  UpdateRoleSchema,
} from './dto';
import { RoleDto, RoleListDto } from './roles.mapper';
import { RolesService } from './roles.service';

@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  /** `GET /roles` — any authenticated user. */
  @Get()
  list(): Promise<RoleListDto[]> {
    return this.roles.list();
  }

  /** `POST /roles` — `roles.manage`; 201 with the created role. */
  @Post()
  @Permissions('roles.manage')
  create(@Body(new ZodValidationPipe(CreateRoleSchema)) dto: CreateRoleDto): Promise<RoleDto> {
    return this.roles.create(dto);
  }

  /** `PATCH /roles/{id}` — `roles.manage`. */
  @Patch(':id')
  @Permissions('roles.manage')
  update(
    @Param('id', new ZodValidationPipe(RoleIdSchema)) id: string,
    @Body(new ZodValidationPipe(UpdateRoleSchema)) dto: UpdateRoleDto,
  ): Promise<RoleDto> {
    return this.roles.update(id, dto);
  }

  /** `DELETE /roles/{id}` — `roles.manage`; 204 with no body. */
  @Delete(':id')
  @HttpCode(204)
  @Permissions('roles.manage')
  remove(@Param('id', new ZodValidationPipe(RoleIdSchema)) id: string): Promise<void> {
    return this.roles.remove(id);
  }
}
