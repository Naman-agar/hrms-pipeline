// TPRD 01 §7 — Prisma `Role` → public DTOs.
//
// `GET /roles` returns `[{id,name,isSystem}]` with permissions omitted (§7 table,
// AC-F4 "role permissions are not exposed"). Create/update responses go only to
// callers holding `roles.manage`, so they additionally carry `permissions`
// (docs/decisions.md). The key names are exactly those in the §7 table.
import type { Role } from '@prisma/client';

/** Shape of one row in `GET /roles` (§7): permissions deliberately absent. */
export interface RoleListDto {
  id: string;
  name: string;
  isSystem: boolean;
}

/** Shape returned by `POST /roles` and `PATCH /roles/{id}`. */
export interface RoleDto extends RoleListDto {
  permissions: string[];
}

export const toRoleListDto = (role: Role): RoleListDto => ({
  id: role.id,
  name: role.name,
  isSystem: role.isSystem,
});

export const toRoleDto = (role: Role): RoleDto => ({
  ...toRoleListDto(role),
  permissions: role.permissions,
});
