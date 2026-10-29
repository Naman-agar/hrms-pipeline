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
// The detail-only `invitation` block (`GET /users/{id}`, 03 §3 / §5 step 5) is
// produced by `toUserDetailDto` below, which widens `toUserDto` rather than
// changing it, so login / `GET /me` / the list keep calling `toUserDto` with a
// plain `include: { role: true, department: true }` result.
import type { Department, Invitation, Role, User, UserStatus } from '@prisma/client';

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

/**
 * 03 §3 — the detail-only `invitation` block: `{ expires_at, resent_count }`.
 * `expires_at` is the open invitation's expiry as ISO-8601 UTC; `resent_count`
 * follows 04 §8 step 6 (`total invitations for user − 1`).
 */
export interface UserInvitationDto {
  expires_at: string;
  resent_count: number;
}

/** 03 §3 / §5 step 5 — `UserDto` plus `invitation`, `null` unless status is `invited`. */
export interface UserDetailDto extends UserDto {
  invitation: UserInvitationDto | null;
}

/**
 * Input for `toUserDetailDto`: the 03 §5 step 2 row. `invitations` is the
 * `include: { invitations: { where: { revokedAt: null, acceptedAt: null }, take: 1 } }`
 * result (only `expiresAt` is read), and `_count.invitations` is the per-user
 * total from `_count: { select: { invitations: true } }` in the same `include`,
 * which `resent_count` is derived from without a second query.
 */
export type UserWithRefsAndInvitation = UserWithRefs & {
  invitations: Pick<Invitation, 'expiresAt'>[];
  _count: { invitations: number };
};

export const toUserDetailDto = (user: UserWithRefsAndInvitation): UserDetailDto => {
  // §3 / §5 step 5 — `invitation` only when status is `invited` and an open invitation exists
  const open = user.status === 'invited' ? user.invitations[0] : undefined;
  return {
    ...toUserDto(user),
    invitation: open
      ? {
          expires_at: open.expiresAt.toISOString(),
          // 04 §8 step 6 — resent_count = total invitations for user − 1
          resent_count: user._count.invitations - 1,
        }
      : null,
  };
};
