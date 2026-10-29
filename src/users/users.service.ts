// TPRD 03 — User management flows, one method per §2 endpoint.
//
// Implemented so far:
//   GET /users        §4  list — search / filter / sort / paginate, manager-scoped
//   GET /users/{id}   §5  detail — + `invitation` block, manager-scoped (404, not 403)
//   POST /users       §6  direct create with password (no email), audited `user.created`
//   PATCH /users/{id} §7  partial update — transition table, last-admin rule, diff audit
//   DELETE /users/{id} §8 soft delete — revokes tokens + open invitations, audited `user.deleted`
//   POST /users/{id}/restore §9 undo soft delete — comes back as `inactive`, audited `user.restored`
//   PATCH /me         §10 own first/last name + avatar_url, audited `user.updated`
//
// All filtering, ordering and paging happens in SQL (AC-U11: exactly two
// statements, no JS post-processing). Rows leave through `toUserDto` only, so
// `passwordHash` / `deletedAt` never reach the wire (AC-U1).
import { Injectable } from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { ClockService } from '../common/clock/clock.service';
import { hashPassword } from '../common/crypto/password';
import { escapeLike } from '../common/db/escape-like';
import { Paginated, paginate, toSkipTake } from '../common/dto/pagination.dto';
import { AppError } from '../common/errors/app-error';
import type { CurrentUserPayload } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateUserDto,
  ListUsersQueryDto,
  SortOrder,
  UPDATE_USER_FIELDS,
  UpdateMeDto,
  UpdateUserDto,
  UpdateUserField,
  UserSortField,
} from './dto';
import { toUserDetailDto, toUserDto, UserDetailDto, UserDto } from './user.mapper';

/** Role name whose members are department-scoped (§4.2 "Manager scoping (from 02)"). */
const MANAGER_ROLE = 'Manager';

/** Role name protected by the last-admin rule (§7 step 4, §8 step 2). Unique in `Role.name`. */
const HR_ADMIN_ROLE = 'HR Admin';

/**
 * §7 step 3 — the status transition table, verbatim. Anything not listed
 * (incl. `→ invited` and `invited → active`, which only 04 performs) is
 * 409 INVALID_TRANSITION.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<UserStatus, readonly UserStatus[]>> = {
  invited: ['inactive'],
  active: ['inactive', 'suspended'],
  inactive: ['active'],
  suspended: ['active'],
};

/** §7 step 4 / step 6 — statuses that remove an admin from the active pool and revoke sessions. */
const DEACTIVATING_STATUSES: readonly UserStatus[] = ['inactive', 'suspended'];

/** §7 step 6 — `diff = { field: { from, to } }`, snake_case keys as in the request body (AC-U9). */
type UpdateDiff = Partial<Record<UpdateUserField, { from: string | null; to: string | null }>>;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly clock: ClockService,
  ) {}

  /** `GET /users` — §4. `q` is already parsed/defaulted by `ListUsersQuerySchema` (§4.1). */
  async list(q: ListUsersQueryDto, actor: CurrentUserPayload): Promise<Paginated<UserDto>> {
    // §4.2 — build `where`: soft-deleted rows are always excluded
    const where: Prisma.UserWhereInput = { deletedAt: null };
    if (q.status) where.status = q.status;
    if (q.role_id) where.roleId = q.role_id;
    if (q.department_id) where.departmentId = q.department_id;
    if (q.search) {
      where.OR = buildSearchClauses(q.search);
    }

    // §4.2 — manager scoping (from 02): a Manager only ever sees their own department
    if (actor.role === MANAGER_ROLE) {
      const { departmentId } = await this.loadActorDepartment(actor.id);
      // an explicit `department_id` for a different department → 403 FORBIDDEN
      if (q.department_id !== undefined && q.department_id !== departmentId) {
        throw new AppError(403, 'FORBIDDEN', 'managers can only list their own department');
      }
      where.departmentId = departmentId;
    }

    // §4.3 — build `orderBy` from `sort`/`order`, always with `{ id: 'asc' }` as tiebreaker
    const orderBy = buildOrderBy(q.sort, q.order);

    // §4.4 — one round-trip: findMany + count in a single $transaction, role/department included.
    // `relationLoadStrategy: 'join'` (relationJoins preview, docs/decisions.md) makes the
    // include a single joined SELECT rather than one extra SELECT per relation, so this
    // path is exactly 2 SQL statements as AC-U11 requires.
    const { skip, take } = toSkipTake(q);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        relationLoadStrategy: 'join',
        where,
        orderBy,
        skip,
        take,
        include: { role: true, department: true },
      }),
      this.prisma.user.count({ where }),
    ]);

    // §4.5 — `{ data: [...UserDto], meta: { page, page_size, total, total_pages } }`
    return paginate(rows.map(toUserDto), total, q.page, q.page_size);
  }

  /**
   * `GET /users/{id}` — §5. Step 1 (uuid check) is done by `UserIdSchema` in
   * the controller's `@Param` pipe, so `id` is already a well-formed uuid here.
   */
  async getById(id: string, actor: CurrentUserPayload): Promise<UserDetailDto> {
    // §5 step 2 — non-deleted row with role/department, the open invitation (unrevoked,
    // unaccepted; at most one) and the per-user invitation total for `resent_count`
    // (docs/decisions.md) — a single query
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      include: {
        role: true,
        department: true,
        invitations: { where: { revokedAt: null, acceptedAt: null }, take: 1 },
        _count: { select: { invitations: true } },
      },
    });

    // §5 step 3 — not found → 404 NOT_FOUND
    if (!user) throw new AppError(404, 'NOT_FOUND', 'user not found');

    // §5 step 4 — manager scoping: another department → 404 (not 403) so existence
    // is not leaked; same `departmentId` lookup as the §4.2 list path
    if (actor.role === MANAGER_ROLE) {
      const { departmentId } = await this.loadActorDepartment(actor.id);
      if (user.departmentId !== departmentId) {
        throw new AppError(404, 'NOT_FOUND', 'user not found');
      }
    }

    // §5 step 5 — DTO plus `invitation` block (null unless status is `invited`)
    return toUserDetailDto(user);
  }

  /**
   * `POST /users` — §6 direct create. `body` is already validated by
   * `CreateUserSchema` (field rules, password policy, `status` defaulted and never
   * `invited`), so only the DB-dependent checks happen here, in §6 order.
   */
  async create(body: CreateUserDto, actor: CurrentUserPayload): Promise<UserDto> {
    // §6 step 1 — load role and department; missing → 404 NOT_FOUND naming the
    // field(s) that did not resolve (`fields.role_id` / `fields.department_id`)
    const [role, department] = await Promise.all([
      this.prisma.role.findUnique({ where: { id: body.role_id }, select: { id: true } }),
      this.prisma.department.findUnique({
        where: { id: body.department_id },
        select: { id: true },
      }),
    ]);
    if (!role || !department) {
      const fields: Record<string, string> = {};
      if (!role) fields.role_id = 'role not found';
      if (!department) fields.department_id = 'department not found';
      throw new AppError(404, 'NOT_FOUND', 'role or department not found', fields);
    }

    // §6 step 2 — email uniqueness (includes soft-deleted: no `deletedAt` filter);
    // exists → 409 EMAIL_TAKEN with `details.deleted` telling the admin whether a
    // restore (§9) is the way forward
    const existing = await this.prisma.user.findUnique({
      where: { email: body.email },
      select: { deletedAt: true },
    });
    if (existing) {
      throw new AppError(409, 'EMAIL_TAKEN', 'email already in use', undefined, {
        deleted: existing.deletedAt != null,
      });
    }

    // §6 step 3 — passwordHash = argon2.hash(password)
    const passwordHash = await hashPassword(body.password);

    // §6 step 4 — one transaction: create the user (with role/department so the row maps
    // directly) and the `user.created` audit row
    const created = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          firstName: body.first_name,
          lastName: body.last_name,
          email: body.email,
          passwordHash,
          roleId: body.role_id,
          departmentId: body.department_id,
          status: body.status,
        },
        include: { role: true, department: true },
      });
      await this.audit.log(
        {
          actorId: actor.id,
          action: 'user.created',
          targetUserId: user.id,
          metadata: {
            role_id: body.role_id,
            department_id: body.department_id,
            status: body.status,
          },
        },
        tx,
      );
      return user;
    });

    // §6 step 5 — 201 (Nest's POST default) with the DTO
    return toUserDto(created);
  }

  /**
   * `PATCH /users/{id}` — §7 partial update. `body` is already validated by
   * `UpdateUserSchema` (field rules, at least one field, `email` rejected), so only
   * the DB-dependent checks happen here, in §7 order — the order is the error
   * precedence when several conditions hold at once.
   */
  async update(id: string, body: UpdateUserDto, actor: CurrentUserPayload): Promise<UserDto> {
    // §7 step 1 — load target (non-deleted) with role → 404 NOT_FOUND if missing
    const target = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      include: { role: true },
    });
    if (!target) throw new AppError(404, 'NOT_FOUND', 'user not found');

    // §7 step 2 — self-protection: own `role_id` / `status` cannot be changed → 409 SELF_EDIT_FORBIDDEN
    if (target.id === actor.id && (body.role_id !== undefined || body.status !== undefined)) {
      throw new AppError(409, 'SELF_EDIT_FORBIDDEN', 'you cannot change your own role or status');
    }

    // §7 step 3 — status transition check (only if `status` present and different) against
    // the §7 table; anything else (incl. `→ invited`, `invited → active`) → 409 INVALID_TRANSITION
    const statusChanges = body.status !== undefined && body.status !== target.status;
    if (statusChanges && !ALLOWED_TRANSITIONS[target.status].includes(body.status as UserStatus)) {
      throw new AppError(
        409,
        'INVALID_TRANSITION',
        `cannot change status from ${target.status} to ${body.status}`,
      );
    }

    // §7 step 4 — last-admin rule. Per docs/decisions.md the supplied `role_id` /
    // `department_id` are resolved here (before the rule) but a failed resolution is
    // only thrown at step 5's position, so LAST_ADMIN wins over NOT_FOUND.
    const [role, department] = await Promise.all([
      body.role_id !== undefined
        ? this.prisma.role.findUnique({ where: { id: body.role_id }, select: { id: true } })
        : undefined,
      body.department_id !== undefined
        ? this.prisma.department.findUnique({
            where: { id: body.department_id },
            select: { id: true },
          })
        : undefined,
    ]);
    // "role change away from HR Admin": `Role.name` is unique, so any other `roleId` is
    // by definition not the HR Admin role — no name lookup needed for this decision
    const roleLeavesAdmin = body.role_id !== undefined && body.role_id !== target.roleId;
    const statusDeactivates =
      statusChanges && DEACTIVATING_STATUSES.includes(body.status as UserStatus);
    if (target.role.name === HR_ADMIN_ROLE && (roleLeavesAdmin || statusDeactivates)) {
      // count active HR Admins excluding target; 0 → 409 LAST_ADMIN
      await this.assertNotLastAdmin(
        target.id,
        'cannot demote or deactivate the last active HR Admin',
      );
    }

    // §7 step 5 — validate new `role_id` / `department_id` exist → 404 NOT_FOUND naming
    // the field(s) that did not resolve (same shape as §6 step 1)
    if (role === null || department === null) {
      const fields: Record<string, string> = {};
      if (role === null) fields.role_id = 'role not found';
      if (department === null) fields.department_id = 'department not found';
      throw new AppError(404, 'NOT_FOUND', 'role or department not found', fields);
    }

    // §7 step 6 — one transaction: diff of changed fields only, `user.update`, revoke
    // refresh tokens when the status moves to inactive/suspended, and the audit row
    // (`user.status_changed` if status is in the diff, else `user.updated`; metadata = diff)
    const { diff, data } = buildUpdateDiff(target, body);
    const updated = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: target.id },
        data,
        include: { role: true, department: true },
      });
      if (diff.status && DEACTIVATING_STATUSES.includes(diff.status.to as UserStatus)) {
        await this.auth.revokeAllForUser(target.id, tx);
      }
      await this.audit.log(
        {
          actorId: actor.id,
          action: diff.status ? 'user.status_changed' : 'user.updated',
          targetUserId: target.id,
          metadata: diff,
        },
        tx,
      );
      return user;
    });

    // §7 step 7 — 200 with the DTO
    return toUserDto(updated);
  }

  /**
   * `DELETE /users/{id}` — §8 soft delete. The uuid check is done by `UserIdSchema`
   * in the controller's `@Param` pipe. Steps run in §8 order, which is the error
   * precedence when several conditions hold at once.
   */
  async remove(id: string, actor: CurrentUserPayload): Promise<void> {
    // §8 step 1 — load target (non-deleted) with role → 404 NOT_FOUND if missing
    const target = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      include: { role: true },
    });
    if (!target) throw new AppError(404, 'NOT_FOUND', 'user not found');

    // §8 step 2 — self → 409 SELF_EDIT_FORBIDDEN
    if (target.id === actor.id) {
      throw new AppError(409, 'SELF_EDIT_FORBIDDEN', 'you cannot delete yourself');
    }
    // §8 step 2 — last active HR Admin → 409 LAST_ADMIN (same count as §7 step 4; applies to
    // an HR Admin target regardless of their own status, matching the §7 decision)
    if (target.role.name === HR_ADMIN_ROLE) {
      await this.assertNotLastAdmin(target.id, 'cannot delete the last active HR Admin');
    }

    // §8 step 3 — one transaction: `deletedAt = now`, revoke all refresh tokens, revoke
    // open invitations (unrevoked, unaccepted → `revokedAt = now`), audit `user.deleted`
    const now = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: target.id }, data: { deletedAt: now } });
      await this.auth.revokeAllForUser(target.id, tx);
      await tx.invitation.updateMany({
        where: { userId: target.id, revokedAt: null, acceptedAt: null },
        data: { revokedAt: now },
      });
      await this.audit.log(
        { actorId: actor.id, action: 'user.deleted', targetUserId: target.id },
        tx,
      );
    });

    // §8 step 4 — 204 (controller sets `@HttpCode(204)`), no body
  }

  /**
   * `POST /users/{id}/restore` — §9 undo soft delete. The uuid check is done by
   * `UserIdSchema` in the controller's `@Param` pipe.
   */
  async restore(id: string, actor: CurrentUserPayload): Promise<UserDto> {
    // §9 step 1 — `findFirst({ id, deletedAt: { not: null } })` → 404 NOT_FOUND if none
    // (an unknown id and a user that is not soft-deleted both 404 here)
    const target = await this.prisma.user.findFirst({
      where: { id, deletedAt: { not: null } },
      select: { id: true, status: true },
    });
    if (!target) throw new AppError(404, 'NOT_FOUND', 'deleted user not found');

    // §9 step 2 — one transaction: `deletedAt = null`, `status = inactive` (the admin must
    // explicitly re-activate via §7), and the `user.restored` audit row recording the
    // status the row had before restoring (docs/decisions.md)
    const restored = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: target.id },
        data: { deletedAt: null, status: UserStatus.inactive },
        include: { role: true, department: true },
      });
      await this.audit.log(
        {
          actorId: actor.id,
          action: 'user.restored',
          targetUserId: target.id,
          metadata: { status: { from: target.status, to: UserStatus.inactive } },
        },
        tx,
      );
      return user;
    });

    // §9 step 3 — 200 with the DTO (controller sets `@HttpCode(200)`, overriding Nest's POST 201)
    return toUserDto(restored);
  }

  /**
   * `PATCH /me` — §10 own profile. `body` is already validated by `UpdateMeSchema`,
   * whose only keys are `first_name` / `last_name` / `avatar_url`, so none of the
   * §7 role/status/last-admin checks can apply here. Actor and target are the same
   * row (`actorId` from the JWT `sub`).
   */
  async updateMe(actorId: string, body: UpdateMeDto): Promise<UserDto> {
    // §10 — load self (non-deleted). A `sub` that no longer resolves (deleted after the
    // token was issued) → 401 UNAUTHENTICATED, mirroring 02 `GET /me` / `loadActorDepartment`
    const self = await this.prisma.user.findFirst({ where: { id: actorId, deletedAt: null } });
    if (!self) throw new AppError(401, 'UNAUTHENTICATED', 'user no longer exists');

    // §10 — "Update, audit `user.updated`": one transaction, diff of changed fields only
    // (same `{ field: { from, to } }` shape and helper as §7 step 6; `UpdateMeDto` is a
    // strict subset of `UpdateUserDto`, so `status` can never be in the diff here)
    const { diff, data } = buildUpdateDiff(self, body);
    const updated = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: self.id },
        data,
        include: { role: true, department: true },
      });
      await this.audit.log(
        { actorId: self.id, action: 'user.updated', targetUserId: self.id, metadata: diff },
        tx,
      );
      return user;
    });

    // §10 — "return DTO": 200 with the caller's own UserDto
    return toUserDto(updated);
  }

  /**
   * §7 step 4 / §8 step 2 — the last-admin rule: count active, non-deleted HR Admins
   * other than `targetId`; none left → 409 LAST_ADMIN with the caller's message.
   */
  private async assertNotLastAdmin(targetId: string, message: string): Promise<void> {
    const otherActiveAdmins = await this.prisma.user.count({
      where: {
        id: { not: targetId },
        deletedAt: null,
        status: UserStatus.active,
        role: { name: HR_ADMIN_ROLE },
      },
    });
    if (otherActiveAdmins === 0) {
      throw new AppError(409, 'LAST_ADMIN', message);
    }
  }

  /**
   * §4.2 manager scoping — the JWT carries no `departmentId` (02 §4.1 step 3), so
   * the caller's own row is read for it. A `sub` that no longer resolves (deleted
   * after the token was issued) → 401 UNAUTHENTICATED, mirroring 02 `GET /me`.
   */
  private async loadActorDepartment(actorId: string): Promise<{ departmentId: string }> {
    const actor = await this.prisma.user.findFirst({
      where: { id: actorId, deletedAt: null },
      select: { departmentId: true },
    });
    if (!actor) throw new AppError(401, 'UNAUTHENTICATED', 'user no longer exists');
    return actor;
  }
}

/**
 * §4.2 — the `where.OR` clauses for `search`.
 *
 * The term is lower-cased and LIKE-escaped (`%`, `_`, `\`) so `search=%` matches
 * literally and returns zero rows (AC-U2); `mode: 'insensitive'` makes the
 * comparison case-insensitive on the column side.
 *
 * Full-name match ("asha me", AC-U2): per docs/decisions.md, a search containing
 * whitespace is split at its first whitespace run into two terms and both
 * orderings (`firstName~A AND lastName~B`, and swapped) are added as extra
 * clauses in the same `OR` — no raw SQL, no extra round trip.
 */
function buildSearchClauses(search: string): Prisma.UserWhereInput[] {
  const term = escapeLike(search.toLowerCase()); // escape % _ \
  const clauses: Prisma.UserWhereInput[] = [
    { email: { contains: term, mode: 'insensitive' } },
    { firstName: { contains: term, mode: 'insensitive' } },
    { lastName: { contains: term, mode: 'insensitive' } },
  ];

  const whitespace = /\s+/;
  if (whitespace.test(search)) {
    const [first, ...rest] = search.toLowerCase().split(whitespace);
    const a = escapeLike(first);
    const b = escapeLike(rest.join(' '));
    clauses.push(
      {
        AND: [
          { firstName: { contains: a, mode: 'insensitive' } },
          { lastName: { contains: b, mode: 'insensitive' } },
        ],
      },
      {
        AND: [
          { firstName: { contains: b, mode: 'insensitive' } },
          { lastName: { contains: a, mode: 'insensitive' } },
        ],
      },
    );
  }
  return clauses;
}

/**
 * §7 step 6 — `diff = { field: { from, to } }` for changed fields only, compared
 * against the step-1 row, plus the matching camelCase `data` for `user.update`.
 * Keys are the snake_case request names (AC-U9 `{ first_name: { from, to } }`);
 * a supplied value equal to the current one is neither written nor audited.
 */
function buildUpdateDiff(
  current: Pick<
    Prisma.UserGetPayload<object>,
    'firstName' | 'lastName' | 'roleId' | 'departmentId' | 'status' | 'avatarUrl'
  >,
  body: UpdateUserDto,
): { diff: UpdateDiff; data: Prisma.UserUncheckedUpdateInput } {
  // snake_case field → [camelCase column, current value]
  const columns: Record<UpdateUserField, [keyof Prisma.UserUncheckedUpdateInput, string | null]> = {
    first_name: ['firstName', current.firstName],
    last_name: ['lastName', current.lastName],
    role_id: ['roleId', current.roleId],
    department_id: ['departmentId', current.departmentId],
    status: ['status', current.status],
    avatar_url: ['avatarUrl', current.avatarUrl],
  };

  const diff: UpdateDiff = {};
  const data: Prisma.UserUncheckedUpdateInput = {};
  for (const field of UPDATE_USER_FIELDS) {
    const to = body[field];
    if (to === undefined) continue; // not supplied
    const [column, from] = columns[field];
    if (to === from) continue; // supplied but unchanged → not in the diff
    diff[field] = { from, to };
    (data as Record<string, unknown>)[column] = to;
  }
  return { diff, data };
}

/** §4.3 — `orderBy` table, verbatim, plus the `{ id: 'asc' }` tiebreaker for stable pagination. */
function buildOrderBy(
  sort: UserSortField,
  order: SortOrder,
): Prisma.UserOrderByWithRelationInput[] {
  const primary: Prisma.UserOrderByWithRelationInput[] = (() => {
    switch (sort) {
      case 'name':
        return [{ firstName: order }, { lastName: order }];
      case 'email':
        return [{ email: order }];
      case 'department':
        return [{ department: { name: order } }];
      case 'role':
        return [{ role: { name: order } }];
      case 'status':
        return [{ status: order }];
      case 'last_login':
        return [{ lastLoginAt: { sort: order, nulls: 'last' } }];
    }
  })();
  return [...primary, { id: 'asc' }];
}
