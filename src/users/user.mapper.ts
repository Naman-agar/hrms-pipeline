// TPRD 03 §3 — Prisma `User` (01 §4) → the snake_case `UserDto` that every
// user-returning response uses: 02 §3.1 step 9 (login), 02 §1 `GET /me`
// ("same shape as 03 list item"), and all of 03's list/detail/create/update.
//
// This is the only place the camelCase model becomes the snake_case API shape
// (CLAUDE.md). It is a pure projection: `passwordHash`, `deletedAt`,
// `departmentId`/`roleId` foreign keys, `role.permissions`, and the token
// relations are never copied out (03 §3, AC-U1).
//
// The §3 shape nests `department: { id, name }` and `role: { id, name }`, so
// callers must load the user with `include: { role: true, department: true }`
// (03 §4.4). 02 §3.1 step 3 only writes `include: { role: true }`; it needs
// `department: true` added for this mapper (docs/decisions.md).
//
// Detail-only extras (`invitation` block on `GET /users/{id}`, 03 §5) are out
// of scope here and belong to 03.
import type { Department, Role, User, UserStatus } from '@prisma/client';

/** Nested reference-data block as written in 03 §3: only `id` and `name`. */
export interface UserRefDto {
  id: string;
  name: string;
}

/** 03 §3 — the user object. Key names and order follow the §3 JSON verbatim. */
export interface UserDto {
  id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
  department: UserRefDto;
  role: UserRefDto;
  status: UserStatus;
  /** ISO-8601 UTC, or `null` when the user has never logged in (03 §1 "Never"). */
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Minimum input the mapper needs: the `User` row plus the `role` and
 * `department` relations. Only `id`/`name` are read off the relations, so a
 * full `include: { role: true, department: true }` result satisfies this.
 */
export type UserWithRefs = User & {
  role: Pick<Role, 'id' | 'name'>;
  department: Pick<Department, 'id' | 'name'>;
};

export const toUserDto = (user: UserWithRefs): UserDto => ({
  id: user.id,
  first_name: user.firstName,
  last_name: user.lastName,
  full_name: `${user.firstName} ${user.lastName}`,
  email: user.email,
  avatar_url: user.avatarUrl,
  department: { id: user.department.id, name: user.department.name },
  role: { id: user.role.id, name: user.role.name },
  status: user.status,
  last_login_at: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
  created_at: user.createdAt.toISOString(),
  updated_at: user.updatedAt.toISOString(),
});
