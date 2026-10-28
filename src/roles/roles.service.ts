// TPRD 01 §7 — Roles reference-data endpoints, one method per table row:
//
//   GET    /roles       any authenticated  all roles ordered by name, permissions omitted
//   POST   /roles       roles.manage       {name, permissions[]}; 409 NAME_TAKEN on duplicate
//   PATCH  /roles/{id}  roles.manage       409 SYSTEM_ROLE if isSystem and name changes
//   DELETE /roles/{id}  roles.manage       409 SYSTEM_ROLE if system; 409 IN_USE if any user has it
//
// Duplicate names are detected from the database's own unique constraint on
// `Role.name` (§4) rather than a pre-check, so two concurrent creates cannot both
// succeed. An unknown `{id}` is 404 NOT_FOUND, the code the later TPRDs use for
// missing rows (docs/decisions.md).
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError } from '../common/errors/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoleDto, UpdateRoleDto } from './dto';
import { RoleDto, RoleListDto, toRoleDto, toRoleListDto } from './roles.mapper';

/** Prisma error code for a unique-constraint violation. */
const UNIQUE_VIOLATION = 'P2002';

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  /** `GET /roles` — all roles ordered by name; permissions omitted. */
  async list(): Promise<RoleListDto[]> {
    // §7 GET /roles — ordering in SQL, mapper drops `permissions`
    const roles = await this.prisma.role.findMany({ orderBy: { name: 'asc' } });
    return roles.map(toRoleListDto);
  }

  /** `POST /roles` — create; 409 NAME_TAKEN on duplicate name. */
  async create(dto: CreateRoleDto): Promise<RoleDto> {
    // §7 POST /roles — insert; the unique index on `name` reports duplicates
    try {
      const role = await this.prisma.role.create({
        data: { name: dto.name, permissions: dto.permissions },
      });
      return toRoleDto(role);
    } catch (err) {
      // §7 POST /roles — 409 NAME_TAKEN on duplicate
      throw mapNameTaken(err);
    }
  }

  /** `PATCH /roles/{id}` — 409 SYSTEM_ROLE if `isSystem` and the name changes. */
  async update(id: string, dto: UpdateRoleDto): Promise<RoleDto> {
    // §7 PATCH /roles/{id} — load the role; unknown id → 404 NOT_FOUND
    const existing = await this.loadOr404(id);

    // §7 PATCH /roles/{id} — 409 SYSTEM_ROLE if isSystem and name changes
    const nameChanges = dto.name !== undefined && dto.name !== existing.name;
    if (nameChanges && existing.isSystem) {
      throw new AppError(409, 'SYSTEM_ROLE', 'system roles cannot be renamed');
    }

    // §7 PATCH /roles/{id} — apply the partial update; a renamed-to-duplicate
    // name surfaces through the same unique index as create → 409 NAME_TAKEN
    const data: Prisma.RoleUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.permissions !== undefined) data.permissions = dto.permissions;
    try {
      const role = await this.prisma.role.update({ where: { id }, data });
      return toRoleDto(role);
    } catch (err) {
      throw mapNameTaken(err);
    }
  }

  /** `DELETE /roles/{id}` — 409 SYSTEM_ROLE if system; 409 IN_USE if any user has it. */
  async remove(id: string): Promise<void> {
    // §7 DELETE /roles/{id} — load the role; unknown id → 404 NOT_FOUND
    const existing = await this.loadOr404(id);

    // §7 DELETE /roles/{id} — 409 SYSTEM_ROLE if system (checked before IN_USE)
    if (existing.isSystem) {
      throw new AppError(409, 'SYSTEM_ROLE', 'system roles cannot be deleted');
    }

    // §7 DELETE /roles/{id} — 409 IN_USE if any user has it (soft-deleted users included:
    // the FK still points at this role, so the row cannot be removed)
    const users = await this.prisma.user.count({ where: { roleId: id } });
    if (users > 0) {
      throw new AppError(409, 'IN_USE', 'role is assigned to one or more users');
    }

    // §7 DELETE /roles/{id} — delete
    await this.prisma.role.delete({ where: { id } });
  }

  private async loadOr404(id: string) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) throw new AppError(404, 'NOT_FOUND', 'role not found');
    return role;
  }
}

/**
 * Translate a Prisma unique-constraint violation on `Role.name` into
 * 409 NAME_TAKEN; anything else is returned unchanged so the caller rethrows it
 * and the global filter reports 500 INTERNAL.
 */
function mapNameTaken(err: unknown): unknown {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_VIOLATION) {
    const target = (err.meta as { target?: unknown } | undefined)?.target;
    const onName = !Array.isArray(target) || target.includes('name');
    if (onName) {
      return new AppError(409, 'NAME_TAKEN', 'a role with this name already exists', {
        name: 'already taken',
      });
    }
  }
  return err;
}
