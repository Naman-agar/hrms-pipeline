// test/users.e2e.spec.ts — TPRD 03 §13 Acceptance criteria (AC-U1..AC-U11).
//
// One `describe` per AC id, one `it` per bullet/clause (tprd-conventions:
// "Turning an AC into a test"). Assertions check exactly what each bullet
// names (status code, `error.code`, field presence, ordering, counts,
// SQL-statement counts) — never values inferred from reading `src/users/`.
//
// Fixture users created directly via Prisma follow the same pattern as
// test/auth.e2e.spec.ts: create in the test (or a small scoped helper),
// clean up in a `finally`/`afterAll` so earlier ACs that assert an exact
// `meta.total` (AC-U1/AC-U3/AC-U4/AC-U5, which rely on the two seeded users
// only) are unaffected by fixtures created for later ACs. Describes run in
// AC-numeric order for exactly this reason.
import { createHash, randomBytes } from 'node:crypto';
import { UserStatus } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/common/crypto/password';
import { PrismaService } from '../src/prisma/prisma.service';
import { app, asUser, GLOBAL_PREFIX, getUserId, prisma, setupSuite, teardownSuite } from './setup';

/** Every path below the global prefix (`/api/v1`). */
const API = (path: string): string => `/${GLOBAL_PREFIX}${path}`;

const ASHA_EMAIL = 'asha.mehta@example.com';
const RAHUL_EMAIL = 'rahul.shah@example.com';

const newTokenHash = (): string => createHash('sha256').update(randomBytes(32)).digest('hex');

const login = (email: string, password: string) =>
  request(app.getHttpServer()).post(API('/auth/login')).send({ email, password });

beforeAll(setupSuite, 60_000);
afterAll(teardownSuite);

// Reference data shared by many tests below, fetched (never mutated) once.
let ashaId: string;
let rahulId: string;
let hrAdminRoleId: string;
let employeeRoleId: string;
let managerRoleId: string;
let engineeringId: string;
let humanResourcesId: string;
/** A non-HR-Admin role with `users.update`/`users.delete`/`users.read` — lets a
 * "last admin" scenario demote/delete the sole active HR Admin without the
 * actor being an HR Admin themselves (which would make the target not-last). */
let opsRoleId: string;

beforeAll(async () => {
  [ashaId, rahulId] = await Promise.all([getUserId(ASHA_EMAIL), getUserId(RAHUL_EMAIL)]);
  const [hrAdminRole, employeeRole, managerRole, engineering, humanResources] = await Promise.all([
    prisma.role.findUniqueOrThrow({ where: { name: 'HR Admin' } }),
    prisma.role.findUniqueOrThrow({ where: { name: 'Employee' } }),
    prisma.role.findUniqueOrThrow({ where: { name: 'Manager' } }),
    prisma.department.findUniqueOrThrow({ where: { name: 'Engineering' } }),
    prisma.department.findUniqueOrThrow({ where: { name: 'Human Resources' } }),
  ]);
  hrAdminRoleId = hrAdminRole.id;
  employeeRoleId = employeeRole.id;
  managerRoleId = managerRole.id;
  engineeringId = engineering.id;
  humanResourcesId = humanResources.id;

  const opsRole = await prisma.role.create({
    data: {
      name: 'Ops Admin (test fixture)',
      permissions: ['users.read', 'users.update', 'users.delete'],
      isSystem: false,
    },
  });
  opsRoleId = opsRole.id;
});

/**
 * Runs `callback` with Asha (the seeded HR Admin) temporarily set `inactive`,
 * so a freshly created, separately-authored HR Admin (`target`, created and
 * cleaned up by the caller) is briefly the *only* active HR Admin in the
 * system — the only way to exercise the LAST_ADMIN rule without the acting
 * HR Admin's own membership masking it. Always restores Asha's status.
 */
async function withAshaInactive<T>(callback: () => Promise<T>): Promise<T> {
  await prisma.user.update({ where: { id: ashaId }, data: { status: UserStatus.active } }); // sanity: start active
  await prisma.user.update({ where: { id: ashaId }, data: { status: UserStatus.inactive } });
  try {
    return await callback();
  } finally {
    await prisma.user.update({ where: { id: ashaId }, data: { status: UserStatus.active } });
  }
}

describe('AC-U1 Default list', () => {
  it('AC-U1 GET /users with no params returns 200 with Asha first, Rahul second, meta={page:1,page_size:25,total:2,total_pages:1}', async () => {
    const res = await (await asUser(ashaId)).get(API('/users'));
    expect(res.status).toBe(200);
    expect(res.body.data.map((u: { email: string }) => u.email)).toEqual([ASHA_EMAIL, RAHUL_EMAIL]);
    expect(res.body.meta).toEqual({ page: 1, page_size: 25, total: 2, total_pages: 1 });
  });

  it('AC-U1 no item contains passwordHash, deletedAt, or token fields', async () => {
    const res = await (await asUser(ashaId)).get(API('/users'));
    for (const user of res.body.data as Record<string, unknown>[]) {
      expect(user).not.toHaveProperty('passwordHash');
      expect(user).not.toHaveProperty('deletedAt');
      expect(user).not.toHaveProperty('refreshTokens');
      expect(user).not.toHaveProperty('tokens');
    }
  });
});

describe('AC-U2 Search', () => {
  it('AC-U2 search=rah returns only Rahul', async () => {
    const res = await (await asUser(ashaId)).get(API('/users')).query({ search: 'rah' });
    expect(res.status).toBe(200);
    expect(res.body.data.map((u: { email: string }) => u.email)).toEqual([RAHUL_EMAIL]);
  });

  it('AC-U2 search=EXAMPLE.COM returns both users (case-insensitive)', async () => {
    const res = await (await asUser(ashaId)).get(API('/users')).query({ search: 'EXAMPLE.COM' });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  it('AC-U2 search="asha me" returns Asha (full-name match)', async () => {
    const res = await (await asUser(ashaId)).get(API('/users')).query({ search: 'asha me' });
    expect(res.status).toBe(200);
    expect(res.body.data.map((u: { email: string }) => u.email)).toEqual([ASHA_EMAIL]);
  });

  it('AC-U2 search=% returns zero rows (escaped, not wildcard)', async () => {
    const res = await (await asUser(ashaId)).get(API('/users')).query({ search: '%' });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('AC-U2 search longer than 100 chars returns 400 VALIDATION_ERROR', async () => {
    const res = await (await asUser(ashaId)).get(API('/users')).query({ search: 'a'.repeat(101) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('AC-U3 Filters', () => {
  it('AC-U3 status=invited returns only Rahul', async () => {
    const res = await (await asUser(ashaId)).get(API('/users')).query({ status: 'invited' });
    expect(res.status).toBe(200);
    expect(res.body.data.map((u: { email: string }) => u.email)).toEqual([RAHUL_EMAIL]);
  });

  it('AC-U3 role_id=<HR Admin id> returns only Asha', async () => {
    const res = await (await asUser(ashaId)).get(API('/users')).query({ role_id: hrAdminRoleId });
    expect(res.status).toBe(200);
    expect(res.body.data.map((u: { email: string }) => u.email)).toEqual([ASHA_EMAIL]);
  });

  it('AC-U3 department_id=<Engineering id> returns only Rahul', async () => {
    const res = await (
      await asUser(ashaId)
    )
      .get(API('/users'))
      .query({ department_id: engineeringId });
    expect(res.status).toBe(200);
    expect(res.body.data.map((u: { email: string }) => u.email)).toEqual([RAHUL_EMAIL]);
  });

  it('AC-U3 combined filters are ANDed (status=active&department_id=<Human Resources> returns only Asha)', async () => {
    const res = await (
      await asUser(ashaId)
    )
      .get(API('/users'))
      .query({ status: 'active', department_id: humanResourcesId });
    expect(res.status).toBe(200);
    expect(res.body.data.map((u: { email: string }) => u.email)).toEqual([ASHA_EMAIL]);
  });

  it('AC-U3 status=foo returns 400', async () => {
    const res = await (await asUser(ashaId)).get(API('/users')).query({ status: 'foo' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('AC-U3 role_id=not-a-uuid returns 400', async () => {
    const res = await (await asUser(ashaId)).get(API('/users')).query({ role_id: 'not-a-uuid' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('AC-U4 Sort', () => {
  it('AC-U4 sort=name&order=desc returns Rahul before Asha', async () => {
    const res = await (
      await asUser(ashaId)
    )
      .get(API('/users'))
      .query({ sort: 'name', order: 'desc' });
    expect(res.status).toBe(200);
    expect(res.body.data.map((u: { email: string }) => u.email)).toEqual([RAHUL_EMAIL, ASHA_EMAIL]);
  });

  it('AC-U4 sort=last_login&order=desc puts Asha first and null last', async () => {
    const res = await (
      await asUser(ashaId)
    )
      .get(API('/users'))
      .query({ sort: 'last_login', order: 'desc' });
    expect(res.status).toBe(200);
    expect(res.body.data.map((u: { email: string }) => u.email)).toEqual([ASHA_EMAIL, RAHUL_EMAIL]);
    expect(res.body.data[1].last_login_at).toBeNull();
  });

  it('AC-U4 sort=department orders by department name (Engineering before Human Resources)', async () => {
    const res = await (await asUser(ashaId)).get(API('/users')).query({ sort: 'department' });
    expect(res.status).toBe(200);
    expect(res.body.data.map((u: { email: string }) => u.email)).toEqual([RAHUL_EMAIL, ASHA_EMAIL]);
  });

  it('AC-U4 an unknown sort value returns 400', async () => {
    const res = await (await asUser(ashaId)).get(API('/users')).query({ sort: 'bogus' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('AC-U4 given two users with identical sort keys, their relative order is stable across pages', async () => {
    const passwordHash = await hashPassword('Fixture#2026!');
    const makeTieUser = (email: string) =>
      prisma.user.create({
        data: {
          firstName: 'Tie',
          lastName: 'Fixture',
          email,
          passwordHash,
          roleId: employeeRoleId,
          departmentId: engineeringId,
          status: UserStatus.active,
        },
      });
    const tieA = await makeTieUser('tie.a@example.com');
    const tieB = await makeTieUser('tie.b@example.com');
    try {
      // Full list, sorted by status asc (Asha + the two ties are all 'active' —
      // a genuine tie on the sort key; Rahul is 'invited' and sorts after).
      const full = await (
        await asUser(ashaId)
      )
        .get(API('/users'))
        .query({ sort: 'status', order: 'asc', page_size: 10 });
      expect(full.status).toBe(200);
      const fullIds = (full.body.data as { id: string }[]).map((u) => u.id);

      // Same query split across single-row pages must reproduce the exact same order.
      const paged: string[] = [];
      for (let page = 1; page <= fullIds.length; page += 1) {
        const res = await (
          await asUser(ashaId)
        )
          .get(API('/users'))
          .query({ sort: 'status', order: 'asc', page_size: 1, page });
        expect(res.body.data).toHaveLength(1);
        paged.push(res.body.data[0].id);
      }
      expect(paged).toEqual(fullIds);
      // And the tie-break itself is ascending-id order among the two tied rows.
      const tieIndexA = fullIds.indexOf(tieA.id);
      const tieIndexB = fullIds.indexOf(tieB.id);
      expect(tieIndexA).toBeGreaterThanOrEqual(0);
      expect(tieIndexB).toBeGreaterThanOrEqual(0);
      const [first, second] = tieA.id < tieB.id ? [tieIndexA, tieIndexB] : [tieIndexB, tieIndexA];
      expect(first).toBeLessThan(second);
    } finally {
      await prisma.user.deleteMany({ where: { id: { in: [tieA.id, tieB.id] } } });
    }
  });
});

describe('AC-U5 Pagination', () => {
  it('AC-U5 page_size=1&page=2 returns one row (Rahul) and meta.total=2,total_pages=2', async () => {
    const res = await (await asUser(ashaId)).get(API('/users')).query({ page_size: 1, page: 2 });
    expect(res.status).toBe(200);
    expect(res.body.data.map((u: { email: string }) => u.email)).toEqual([RAHUL_EMAIL]);
    expect(res.body.meta.total).toBe(2);
    expect(res.body.meta.total_pages).toBe(2);
  });

  it('AC-U5 page=5 beyond range returns 200 with empty data and correct meta', async () => {
    const res = await (await asUser(ashaId)).get(API('/users')).query({ page: 5 });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta).toEqual({ page: 5, page_size: 25, total: 2, total_pages: 1 });
  });

  it('AC-U5 page_size=30 returns 400 (only 1/10/25/50/100 allowed)', async () => {
    const res = await (await asUser(ashaId)).get(API('/users')).query({ page_size: 30 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('AC-U6 Manager scoping', () => {
  let managerId: string;

  beforeAll(async () => {
    const passwordHash = await hashPassword('Fixture#2026!');
    const manager = await prisma.user.create({
      data: {
        firstName: 'Mason',
        lastName: 'Manager',
        email: 'mason.manager@example.com',
        passwordHash,
        roleId: managerRoleId,
        departmentId: engineeringId,
        status: UserStatus.active,
      },
    });
    managerId = manager.id;
  });

  it('AC-U6 a Manager in Engineering sees only Engineering users on GET /users', async () => {
    const res = await (await asUser(managerId)).get(API('/users'));
    expect(res.status).toBe(200);
    for (const user of res.body.data as { department: { name: string } }[]) {
      expect(user.department.name).toBe('Engineering');
    }
    expect(res.body.data.map((u: { email: string }) => u.email)).toContain(RAHUL_EMAIL);
    expect(res.body.data.map((u: { email: string }) => u.email)).not.toContain(ASHA_EMAIL);
  });

  it('AC-U6 a Manager passing department_id=<Human Resources> gets 403 FORBIDDEN', async () => {
    const res = await (
      await asUser(managerId)
    )
      .get(API('/users'))
      .query({ department_id: humanResourcesId });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('AC-U6 a Manager calling GET /users/<Asha id> (a different department) gets 404', async () => {
    const res = await (await asUser(managerId)).get(API(`/users/${ashaId}`));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('AC-U7 Detail', () => {
  it('AC-U7 GET /users/<Rahul id> returns 200 with status:"invited" and invitation.expires_at present', async () => {
    const res = await (await asUser(ashaId)).get(API(`/users/${rahulId}`));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('invited');
    expect(typeof res.body.invitation.expires_at).toBe('string');
  });

  it('AC-U7 GET /users/<Asha id> returns invitation: null', async () => {
    const res = await (await asUser(ashaId)).get(API(`/users/${ashaId}`));
    expect(res.status).toBe(200);
    expect(res.body.invitation).toBeNull();
  });

  it('AC-U7 an unknown id returns 404', async () => {
    const res = await (
      await asUser(ashaId)
    ).get(API('/users/00000000-0000-0000-0000-000000000000'));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('AC-U7 a soft-deleted id returns 404', async () => {
    const passwordHash = await hashPassword('Fixture#2026!');
    const ghost = await prisma.user.create({
      data: {
        firstName: 'Ghost',
        lastName: 'Deleted',
        email: 'ghost.deleted@example.com',
        passwordHash,
        roleId: employeeRoleId,
        departmentId: engineeringId,
        status: UserStatus.active,
        deletedAt: new Date(),
      },
    });
    try {
      const res = await (await asUser(ashaId)).get(API(`/users/${ghost.id}`));
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    } finally {
      await prisma.user.delete({ where: { id: ghost.id } });
    }
  });
});

describe('AC-U8 Create', () => {
  it('AC-U8 a valid body returns 201, the user can log in with the given password, and audit user.created exists', async () => {
    const body = {
      first_name: 'Nina',
      last_name: 'Created',
      email: 'nina.created@example.com',
      password: 'Created#2026',
      role_id: employeeRoleId,
      department_id: engineeringId,
    };
    const res = await (await asUser(ashaId)).post(API('/users')).send(body);
    expect(res.status).toBe(201);
    expect(res.body.email).toBe(body.email);

    const loginRes = await login(body.email, body.password);
    expect(loginRes.status).toBe(200);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'user.created', targetUserId: res.body.id },
    });
    expect(audit).not.toBeNull();
  });

  it('AC-U8 an email already in use (active) returns 409 EMAIL_TAKEN with details.deleted=false', async () => {
    const res = await (await asUser(ashaId)).post(API('/users')).send({
      first_name: 'Dup',
      last_name: 'Active',
      email: RAHUL_EMAIL,
      password: 'Whatever#2026',
      role_id: employeeRoleId,
      department_id: engineeringId,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
    expect(res.body.error.details.deleted).toBe(false);
  });

  it('AC-U8 an email already in use (soft-deleted) returns 409 EMAIL_TAKEN with details.deleted=true', async () => {
    const email = 'temp.softdeleted@example.com';
    const createRes = await (await asUser(ashaId)).post(API('/users')).send({
      first_name: 'Temp',
      last_name: 'Softdeleted',
      email,
      password: 'Whatever#2026',
      role_id: employeeRoleId,
      department_id: engineeringId,
    });
    expect(createRes.status).toBe(201);
    const deleteRes = await (await asUser(ashaId)).delete(API(`/users/${createRes.body.id}`));
    expect(deleteRes.status).toBe(204);

    const res = await (await asUser(ashaId)).post(API('/users')).send({
      first_name: 'Dup',
      last_name: 'Deleted',
      email,
      password: 'Whatever#2026',
      role_id: employeeRoleId,
      department_id: engineeringId,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
    expect(res.body.error.details.deleted).toBe(true);
  });

  it('AC-U8 a password of "short1!" returns 400 with fields.password', async () => {
    const res = await (await asUser(ashaId)).post(API('/users')).send({
      first_name: 'Weak',
      last_name: 'Password',
      email: 'weak.password@example.com',
      password: 'short1!',
      role_id: employeeRoleId,
      department_id: engineeringId,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.fields).toHaveProperty('password');
  });
});

describe('AC-U9 Update', () => {
  it('AC-U9 PATCH {first_name} changes only that field; audit user.updated metadata contains {first_name:{from,to}}', async () => {
    const passwordHash = await hashPassword('Fixture#2026!');
    const mia = await prisma.user.create({
      data: {
        firstName: 'Mia',
        lastName: 'Patchable',
        email: 'mia.patchable@example.com',
        passwordHash,
        roleId: employeeRoleId,
        departmentId: engineeringId,
        status: UserStatus.active,
      },
    });
    const res = await (
      await asUser(ashaId)
    )
      .patch(API(`/users/${mia.id}`))
      .send({ first_name: 'Mia2' });
    expect(res.status).toBe(200);
    expect(res.body.first_name).toBe('Mia2');
    expect(res.body.last_name).toBe('Patchable');

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'user.updated', targetUserId: mia.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
    expect(audit?.metadata).toMatchObject({ first_name: { from: 'Mia', to: 'Mia2' } });
  });

  it('AC-U9 a body including email returns 400', async () => {
    const res = await (
      await asUser(ashaId)
    )
      .patch(API(`/users/${rahulId}`))
      .send({ email: 'changed@example.com' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.fields).toHaveProperty('email');
  });

  it("AC-U9 status active->inactive returns 200, audits user.status_changed, and that user's refresh tokens stop working", async () => {
    const passwordHash = await hashPassword('Fixture#2026!');
    const oscar = await prisma.user.create({
      data: {
        firstName: 'Oscar',
        lastName: 'Active',
        email: 'oscar.active@example.com',
        passwordHash,
        roleId: employeeRoleId,
        departmentId: engineeringId,
        status: UserStatus.active,
      },
    });
    const token = await prisma.refreshToken.create({
      data: {
        userId: oscar.id,
        tokenHash: newTokenHash(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const res = await (
      await asUser(ashaId)
    )
      .patch(API(`/users/${oscar.id}`))
      .send({ status: 'inactive' });
    expect(res.status).toBe(200);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'user.status_changed', targetUserId: oscar.id },
    });
    expect(audit).not.toBeNull();

    const refreshed = await prisma.refreshToken.findUniqueOrThrow({ where: { id: token.id } });
    expect(refreshed.revokedAt).not.toBeNull();
  });

  it('AC-U9 status invited->active via PATCH returns 409 INVALID_TRANSITION', async () => {
    const res = await (
      await asUser(ashaId)
    )
      .patch(API(`/users/${rahulId}`))
      .send({ status: 'active' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('AC-U9 role-changing the only active HR Admin away from HR Admin returns 409 LAST_ADMIN', async () => {
    await withAshaInactive(async () => {
      const passwordHash = await hashPassword('Fixture#2026!');
      const soleAdmin = await prisma.user.create({
        data: {
          firstName: 'Sole',
          lastName: 'Admin',
          email: 'sole.admin.role@example.com',
          passwordHash,
          roleId: hrAdminRoleId,
          departmentId: humanResourcesId,
          status: UserStatus.active,
        },
      });
      const opsActor = await prisma.user.create({
        data: {
          firstName: 'Ops',
          lastName: 'Actor',
          email: 'ops.actor.role@example.com',
          passwordHash,
          roleId: opsRoleId,
          departmentId: humanResourcesId,
          status: UserStatus.active,
        },
      });
      try {
        const res = await (
          await asUser(opsActor.id)
        )
          .patch(API(`/users/${soleAdmin.id}`))
          .send({ role_id: employeeRoleId });
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('LAST_ADMIN');
      } finally {
        await prisma.user.deleteMany({ where: { id: { in: [soleAdmin.id, opsActor.id] } } });
      }
    });
  });

  it('AC-U9 deactivating the only active HR Admin returns 409 LAST_ADMIN', async () => {
    await withAshaInactive(async () => {
      const passwordHash = await hashPassword('Fixture#2026!');
      const soleAdmin = await prisma.user.create({
        data: {
          firstName: 'Sole',
          lastName: 'Admin',
          email: 'sole.admin.status@example.com',
          passwordHash,
          roleId: hrAdminRoleId,
          departmentId: humanResourcesId,
          status: UserStatus.active,
        },
      });
      const opsActor = await prisma.user.create({
        data: {
          firstName: 'Ops',
          lastName: 'Actor',
          email: 'ops.actor.status@example.com',
          passwordHash,
          roleId: opsRoleId,
          departmentId: humanResourcesId,
          status: UserStatus.active,
        },
      });
      try {
        const res = await (
          await asUser(opsActor.id)
        )
          .patch(API(`/users/${soleAdmin.id}`))
          .send({ status: 'inactive' });
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('LAST_ADMIN');
      } finally {
        await prisma.user.deleteMany({ where: { id: { in: [soleAdmin.id, opsActor.id] } } });
      }
    });
  });

  it('AC-U9 a user changing their own role_id returns 409 SELF_EDIT_FORBIDDEN', async () => {
    const res = await (
      await asUser(ashaId)
    )
      .patch(API(`/users/${ashaId}`))
      .send({ role_id: employeeRoleId });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SELF_EDIT_FORBIDDEN');
  });

  it('AC-U9 a user changing their own status returns 409 SELF_EDIT_FORBIDDEN', async () => {
    const res = await (
      await asUser(ashaId)
    )
      .patch(API(`/users/${ashaId}`))
      .send({ status: 'inactive' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SELF_EDIT_FORBIDDEN');
  });
});

describe('AC-U10 Delete / restore', () => {
  it('AC-U10 DELETE returns 204; the user no longer appears in list or detail; their tokens and open invitations are revoked; audit user.deleted exists', async () => {
    const passwordHash = await hashPassword('Fixture#2026!');
    const dana = await prisma.user.create({
      data: {
        firstName: 'Dana',
        lastName: 'Delete',
        email: 'dana.delete@example.com',
        passwordHash,
        roleId: employeeRoleId,
        departmentId: engineeringId,
        status: UserStatus.active,
      },
    });
    const token = await prisma.refreshToken.create({
      data: {
        userId: dana.id,
        tokenHash: newTokenHash(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    const invitation = await prisma.invitation.create({
      data: {
        userId: dana.id,
        tokenHash: newTokenHash(),
        invitedById: ashaId,
        expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      },
    });

    const res = await (await asUser(ashaId)).delete(API(`/users/${dana.id}`));
    expect(res.status).toBe(204);
    expect(res.body).toEqual({});

    const listRes = await (await asUser(ashaId)).get(API('/users')).query({ page_size: 100 });
    expect(listRes.body.data.map((u: { id: string }) => u.id)).not.toContain(dana.id);

    const detailRes = await (await asUser(ashaId)).get(API(`/users/${dana.id}`));
    expect(detailRes.status).toBe(404);

    const refreshedToken = await prisma.refreshToken.findUniqueOrThrow({ where: { id: token.id } });
    expect(refreshedToken.revokedAt).not.toBeNull();

    const refreshedInvitation = await prisma.invitation.findUniqueOrThrow({
      where: { id: invitation.id },
    });
    expect(refreshedInvitation.revokedAt).not.toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'user.deleted', targetUserId: dana.id },
    });
    expect(audit).not.toBeNull();
  });

  it('AC-U10 re-inviting (re-creating) the deleted email returns 409 EMAIL_TAKEN with details.deleted=true', async () => {
    const res = await (await asUser(ashaId)).post(API('/users')).send({
      first_name: 'Dana',
      last_name: 'Reinvited',
      email: 'dana.delete@example.com',
      password: 'Whatever#2026',
      role_id: employeeRoleId,
      department_id: engineeringId,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
    expect(res.body.error.details.deleted).toBe(true);
  });

  it('AC-U10 POST /users/{id}/restore returns 200 with status:"inactive" and the user appears in lists again', async () => {
    const dana = await prisma.user.findUniqueOrThrow({
      where: { email: 'dana.delete@example.com' },
    });
    const res = await (await asUser(ashaId)).post(API(`/users/${dana.id}/restore`));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('inactive');

    const listRes = await (await asUser(ashaId)).get(API('/users')).query({ page_size: 100 });
    expect(listRes.body.data.map((u: { id: string }) => u.id)).toContain(dana.id);
  });

  it('AC-U10 deleting yourself returns 409 (SELF_EDIT_FORBIDDEN)', async () => {
    const res = await (await asUser(ashaId)).delete(API(`/users/${ashaId}`));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SELF_EDIT_FORBIDDEN');
  });

  it('AC-U10 deleting the last HR Admin returns 409 (LAST_ADMIN)', async () => {
    await withAshaInactive(async () => {
      const passwordHash = await hashPassword('Fixture#2026!');
      const soleAdmin = await prisma.user.create({
        data: {
          firstName: 'Sole',
          lastName: 'Admin',
          email: 'sole.admin.delete@example.com',
          passwordHash,
          roleId: hrAdminRoleId,
          departmentId: humanResourcesId,
          status: UserStatus.active,
        },
      });
      const opsActor = await prisma.user.create({
        data: {
          firstName: 'Ops',
          lastName: 'Actor',
          email: 'ops.actor.delete@example.com',
          passwordHash,
          roleId: opsRoleId,
          departmentId: humanResourcesId,
          status: UserStatus.active,
        },
      });
      try {
        const res = await (await asUser(opsActor.id)).delete(API(`/users/${soleAdmin.id}`));
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('LAST_ADMIN');
      } finally {
        await prisma.user.deleteMany({ where: { id: { in: [soleAdmin.id, opsActor.id] } } });
      }
    });
  });
});

describe('AC-U11 Performance', () => {
  // Scoped-down but real version of "given 10,000 seeded users": this still
  // bulk-inserts 10,000 synthetic rows via a single `createMany`, in a
  // dedicated department/role so it cannot change any other AC's row counts,
  // and cleans them up afterwards. The "exactly 2 SQL statements" half is
  // checked against the *real* SQL the app's PrismaService emits via its
  // `query` log events during one request — not Prisma delegate-call counts,
  // which say nothing about how many statements an `include` compiles to
  // (docs/decisions.md: §4.4 uses `relationLoadStrategy: 'join'` so the
  // non-manager-scoped path is one joined SELECT + one COUNT; the Manager path
  // adds one more `findFirst` and is explicitly excluded from this AC).
  const BULK_USER_COUNT = 10_000;
  let bulkDeptId: string;
  let bulkRoleId: string;

  beforeAll(async () => {
    const [bulkDept, bulkRole] = await Promise.all([
      prisma.department.create({ data: { name: 'Bulk QA Dept (test fixture)' } }),
      prisma.role.create({
        data: { name: 'Bulk QA Role (test fixture)', permissions: [], isSystem: false },
      }),
    ]);
    bulkDeptId = bulkDept.id;
    bulkRoleId = bulkRole.id;

    const statuses = [
      UserStatus.active,
      UserStatus.inactive,
      UserStatus.suspended,
      UserStatus.invited,
    ];
    const rows = Array.from({ length: BULK_USER_COUNT }, (_, i) => ({
      firstName: `Bulk${i}`,
      lastName: `User${i}`,
      email: `bulk-user-${i}@example.com`,
      roleId: bulkRoleId,
      departmentId: bulkDeptId,
      status: statuses[i % statuses.length],
    }));
    await prisma.user.createMany({ data: rows });
  }, 120_000);

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { departmentId: bulkDeptId } });
    await prisma.department.delete({ where: { id: bulkDeptId } });
    await prisma.role.delete({ where: { id: bulkRoleId } });
  }, 60_000);

  it('AC-U11 with 10,000 seeded users, GET /users with search+filter+sort executes exactly 2 SQL statements', async () => {
    const prismaService = app.get(PrismaService);
    // `asUser` mints the token through the test-only `prisma` client in
    // ./setup, so nothing it does can show up in the app client's log.
    const agent = await asUser(ashaId);
    const sqlStatements: string[] = [];
    let recording = false;
    prismaService.$on('query', (event) => {
      if (recording) sqlStatements.push(event.query);
    });

    recording = true;
    const res = await agent.get(API('/users')).query({
      search: 'Bulk',
      status: 'active',
      sort: 'name',
      order: 'desc',
      page: 2,
      page_size: 25,
    });
    recording = false;
    expect(res.status).toBe(200);

    // Transaction control (`BEGIN`/`COMMIT`) wraps the §4.4 `$transaction`
    // but is not a data statement; everything else that ran must be exactly
    // one joined SELECT (users + role + department) and one COUNT.
    const dataStatements = sqlStatements.filter(
      (sql) => !/^\s*(BEGIN|COMMIT|ROLLBACK|SET|DEALLOCATE)\b/i.test(sql),
    );
    expect(dataStatements).toHaveLength(2);
    const selects = dataStatements.filter(
      (sql) => /^\s*SELECT\b/i.test(sql) && !/COUNT\(/i.test(sql),
    );
    const counts = dataStatements.filter((sql) => /COUNT\(/i.test(sql));
    expect(selects).toHaveLength(1);
    expect(counts).toHaveLength(1);
    expect(selects[0]).toMatch(/\bJOIN\b/i);
  }, 30_000);

  it('AC-U11 with 10,000 seeded users, GET /users (varied search/filter/sort) has p95 latency < 200ms', async () => {
    const queries = [
      {},
      { search: 'Bulk1' },
      { status: 'active' },
      { sort: 'name', order: 'desc' },
      { sort: 'last_login', order: 'desc' },
      { department_id: bulkDeptId, sort: 'email' },
      { page: 50, page_size: 100 },
      { search: 'User999', status: 'inactive' },
      { sort: 'status', order: 'asc', page_size: 50 },
      { role_id: bulkRoleId, sort: 'department' },
    ];
    const samples: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const query = queries[i % queries.length];
      const start = performance.now();
      const res = await (await asUser(ashaId)).get(API('/users')).query(query);
      samples.push(performance.now() - start);
      expect(res.status).toBe(200);
    }
    samples.sort((a, b) => a - b);
    const p95Index = Math.min(samples.length - 1, Math.ceil(0.95 * samples.length) - 1);
    const p95 = samples[p95Index];
    expect(p95).toBeLessThan(200);
  }, 30_000);
});
