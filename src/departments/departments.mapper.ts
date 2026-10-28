// TPRD 01 §7 — Prisma `Department` (§4) → response DTO.
//
// The §7 table gives the roles' shape as `[{id,name,isSystem}]`; departments
// mirror it as `{id, name, isActive}`. Timestamps and the `users` relation are
// not part of the dropdown contract and are dropped here. There is nothing
// sensitive on this model (unlike `Role.permissions`), so this is a pure
// projection. Mapping lives only here (CLAUDE.md).
import { Department } from '@prisma/client';

export interface DepartmentDto {
  id: string;
  name: string;
  isActive: boolean;
}

export const toDepartmentDto = (department: Department): DepartmentDto => ({
  id: department.id,
  name: department.name,
  isActive: department.isActive,
});
