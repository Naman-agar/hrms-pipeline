// TPRD 01 §7 — Department reference-data routes.
//
// The `api/v1` prefix is applied globally in `main.ts` (§6.5 step 4), so the
// routes are registered as plain `departments` here. Authentication comes
// from the globally registered `AuthGuard` (`x-user-id` stub until 02-auth);
// `GET` is open to any authenticated user, the writes require
// `departments.manage` via `@Permissions()` + `PermissionsGuard`.
//
// Routes, guards and decorators only — every handler calls exactly one
// service method and returns its result (nest-prisma-patterns).
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import { Permissions } from '../common/decorators/permissions.decorator';
import { DepartmentDto } from './departments.mapper';
import { DepartmentsService } from './departments.service';
import {
  CreateDepartmentDto,
  CreateDepartmentSchema,
  UpdateDepartmentDto,
  UpdateDepartmentSchema,
} from './dto';

@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  /** §7 `GET /departments` — any authenticated user; `isActive=true` rows ordered by name. */
  @Get()
  list(): Promise<DepartmentDto[]> {
    return this.departments.list();
  }

  /** §7 `POST /departments` — `departments.manage`; `{name}` → 201, 409 `NAME_TAKEN`. */
  @Post()
  @Permissions('departments.manage')
  create(
    @Body(new ZodValidationPipe(CreateDepartmentSchema)) dto: CreateDepartmentDto,
  ): Promise<DepartmentDto> {
    return this.departments.create(dto);
  }

  /** §7 `PATCH /departments/{id}` — `departments.manage`; `{name?, isActive?}`. */
  @Patch(':id')
  @Permissions('departments.manage')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateDepartmentSchema)) dto: UpdateDepartmentDto,
  ): Promise<DepartmentDto> {
    return this.departments.update(id, dto);
  }

  /** §7 `DELETE /departments/{id}` — `departments.manage`; 409 `IN_USE` if any non-deleted user has it. */
  @Delete(':id')
  @Permissions('departments.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.departments.remove(id);
  }
}
