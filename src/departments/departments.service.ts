// TPRD 01 §7 — Department reference-data flows, one method per endpoint:
//
//   GET    /departments        → list()      all `isActive=true`, ordered by name
//   POST   /departments        → create()    409 NAME_TAKEN on duplicate name
//   PATCH  /departments/{id}   → update()    `{name?, isActive?}`
//   DELETE /departments/{id}   → remove()    409 IN_USE if any non-deleted user has it
//
// Error codes used: NAME_TAKEN, IN_USE (both from the §7 table) and NOT_FOUND
// for an unknown `{id}` (not named by TPRD 01 — see docs/decisions.md).
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError } from '../common/errors/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { DepartmentDto, toDepartmentDto } from './departments.mapper';
import { CreateDepartmentDto, UpdateDepartmentDto } from './dto';

/** Prisma error code for a unique-constraint violation (`Department.name @unique`, §4). */
const PRISMA_UNIQUE_VIOLATION = 'P2002';
/** Prisma error code for a foreign-key violation (`User.departmentId` ON DELETE RESTRICT, §4). */
const PRISMA_FK_VIOLATION = 'P2003';

@Injectable()
export class DepartmentsService {
  constructor(private readonly prisma: PrismaService) {}

  /** §7 `GET /departments` — all `isActive=true` departments ordered by name (AC-F4). */
  async list(): Promise<DepartmentDto[]> {
    // §7 GET — filter + order in SQL, never in JS
    const departments = await this.prisma.department.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    return departments.map(toDepartmentDto);
  }

  /** §7 `POST /departments` — `{name}`; 409 `NAME_TAKEN` on duplicate (AC-F4). */
  async create(dto: CreateDepartmentDto): Promise<DepartmentDto> {
    // §7 POST — insert; the `@unique` constraint on `name` is the duplicate check
    try {
      const department = await this.prisma.department.create({
        data: { name: dto.name },
      });
      return toDepartmentDto(department);
    } catch (err) {
      // §7 POST — unique violation on `name` → 409 NAME_TAKEN
      if (isUniqueViolation(err)) {
        throw new AppError(409, 'NAME_TAKEN', 'department name already in use', {
          name: 'already in use',
        });
      }
      throw err;
    }
  }

  /** §7 `PATCH /departments/{id}` — `{name?, isActive?}`. */
  async update(id: string, dto: UpdateDepartmentDto): Promise<DepartmentDto> {
    // §7 PATCH step 1 — load the department; unknown id → 404 NOT_FOUND
    await this.findOrFail(id);

    // §7 PATCH step 2 — apply `name` / `isActive` exactly as given (omitted keys untouched)
    const data: Prisma.DepartmentUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    try {
      const department = await this.prisma.department.update({ where: { id }, data });
      return toDepartmentDto(department);
    } catch (err) {
      // §7 PATCH step 3 — renaming to a name another department already uses → 409 NAME_TAKEN
      if (isUniqueViolation(err)) {
        throw new AppError(409, 'NAME_TAKEN', 'department name already in use', {
          name: 'already in use',
        });
      }
      throw err;
    }
  }

  /** §7 `DELETE /departments/{id}` — 409 `IN_USE` if any non-deleted user has it (AC-F4). */
  async remove(id: string): Promise<void> {
    // §7 DELETE step 1 — load the department; unknown id → 404 NOT_FOUND
    await this.findOrFail(id);

    // §7 DELETE step 2 — "any non-deleted user has it": count users with this department
    // and `deletedAt = null` (soft-deleted users do not block deletion)
    const usersInDepartment = await this.prisma.user.count({
      where: { departmentId: id, deletedAt: null },
    });
    if (usersInDepartment > 0) {
      throw new AppError(409, 'IN_USE', 'department is assigned to one or more users', undefined, {
        users: usersInDepartment,
      });
    }

    // §7 DELETE step 3 — hard delete the row
    try {
      await this.prisma.department.delete({ where: { id } });
    } catch (err) {
      // §7 DELETE step 3 (edge) — the pre-check deliberately ignores soft-deleted
      // users ("any non-deleted user"), but `User.departmentId` is ON DELETE RESTRICT,
      // so a department whose only users are soft-deleted still fails at the FK.
      // Map that P2003 to the same 409 IN_USE rather than leaking a 500 INTERNAL.
      if (isPrismaError(err, PRISMA_FK_VIOLATION)) {
        throw new AppError(409, 'IN_USE', 'department is still referenced by users', undefined, {
          users: usersInDepartment,
        });
      }
      throw err;
    }
  }

  /** Shared lookup for `{id}` routes: 404 `NOT_FOUND` when the department does not exist. */
  private async findOrFail(id: string): Promise<void> {
    const department = await this.prisma.department.findUnique({ where: { id } });
    if (!department) {
      throw new AppError(404, 'NOT_FOUND', 'department not found');
    }
  }
}

/** True when `err` is a Prisma known-request error with the given code (`P2002`, `P2003`, …). */
function isPrismaError(err: unknown, code: string): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === code;
}

/** True for Prisma's unique-constraint error (`P2002`). */
function isUniqueViolation(err: unknown): boolean {
  return isPrismaError(err, PRISMA_UNIQUE_VIOLATION);
}
