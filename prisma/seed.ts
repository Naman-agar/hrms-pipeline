// TPRD 01 §5 — Seed (`prisma/seed.ts`): must produce exactly what the UI shows.
//
// Runs standalone via `npm run seed` / `prisma db seed` (ts-node), outside Nest
// DI, so it uses `PrismaClient` directly. `new PrismaClient()` with no args lets
// Prisma resolve `DATABASE_URL` itself (its standard CLI behaviour); `.env` is
// loaded here because `ts-node prisma/seed.ts` does not load it on its own.
//
// Idempotent end-to-end (AC-F3): departments, roles and users are upserted on
// their unique keys, and the invitation is only created when Rahul has none,
// so running the seed twice creates no duplicate rows.
import 'dotenv/config';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaClient, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

/** Mirrors `.env.example` `INVITE_TTL_HOURS=72` (§3) — the invitation window in §5 step 4. */
const INVITE_TTL_HOURS = 72;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Token convention from nest-prisma-patterns ("Tokens & hashing"): opaque raw
 * token = base64url(randomBytes(32)); only sha256(raw) hex is stored. The raw
 * token is never persisted; the seed just needs a valid `tokenHash` row.
 */
const newToken = (): string => randomBytes(32).toString('base64url');
const hashToken = (raw: string): string => createHash('sha256').update(raw).digest('hex');

async function main(): Promise<void> {
  // §5 step 3 — passwordHash = argon2id("Admin#2026"), computed at run time.
  const ashaPasswordHash = await argon2.hash('Admin#2026', { type: argon2.argon2id });

  await prisma.$transaction(async (tx) => {
    // §5 step 1 — upsert departments (unique `name`).
    const humanResources = await tx.department.upsert({
      where: { name: 'Human Resources' },
      update: {},
      create: { name: 'Human Resources' },
    });
    const engineering = await tx.department.upsert({
      where: { name: 'Engineering' },
      update: {},
      create: { name: 'Engineering' },
    });

    // §5 step 2 — upsert roles (unique `name`); permissions/isSystem are
    // re-applied on update so the rows always match the spec exactly.
    const hrAdminPermissions = [
      'users.read',
      'users.create',
      'users.invite',
      'users.update',
      'users.delete',
      'roles.manage',
      'departments.manage',
    ];
    const hrAdmin = await tx.role.upsert({
      where: { name: 'HR Admin' },
      update: { permissions: hrAdminPermissions, isSystem: true },
      create: { name: 'HR Admin', permissions: hrAdminPermissions, isSystem: true },
    });
    await tx.role.upsert({
      where: { name: 'Manager' },
      update: { permissions: ['users.read'], isSystem: false },
      create: { name: 'Manager', permissions: ['users.read'], isSystem: false },
    });
    const employee = await tx.role.upsert({
      where: { name: 'Employee' },
      update: { permissions: [], isSystem: true },
      create: { name: 'Employee', permissions: [], isSystem: true },
    });

    // §5 step 3 — upsert user Asha Mehta (unique `email`, stored lower-case).
    const asha = await tx.user.upsert({
      where: { email: 'asha.mehta@example.com' },
      update: {
        firstName: 'Asha',
        lastName: 'Mehta',
        roleId: hrAdmin.id,
        departmentId: humanResources.id,
        status: UserStatus.active,
        passwordHash: ashaPasswordHash,
        lastLoginAt: new Date('2026-10-20T08:15:00Z'),
        deletedAt: null,
      },
      create: {
        firstName: 'Asha',
        lastName: 'Mehta',
        email: 'asha.mehta@example.com',
        roleId: hrAdmin.id,
        departmentId: humanResources.id,
        status: UserStatus.active,
        passwordHash: ashaPasswordHash,
        lastLoginAt: new Date('2026-10-20T08:15:00Z'),
      },
    });

    // §5 step 4 — upsert user Rahul Shah (invited, no password, never logged in).
    const rahul = await tx.user.upsert({
      where: { email: 'rahul.shah@example.com' },
      update: {
        firstName: 'Rahul',
        lastName: 'Shah',
        roleId: employee.id,
        departmentId: engineering.id,
        status: UserStatus.invited,
        passwordHash: null,
        lastLoginAt: null,
        deletedAt: null,
      },
      create: {
        firstName: 'Rahul',
        lastName: 'Shah',
        email: 'rahul.shah@example.com',
        roleId: employee.id,
        departmentId: engineering.id,
        status: UserStatus.invited,
        passwordHash: null,
        lastLoginAt: null,
      },
    });

    // §5 step 4 — one open Invitation row for Rahul (expiresAt = now + 72h).
    // Invitation has no natural unique key for an upsert, so create it only
    // when Rahul has none yet (AC-F3: seeding twice creates no duplicates).
    const existingInvitation = await tx.invitation.findFirst({
      where: { userId: rahul.id },
      select: { id: true },
    });
    if (!existingInvitation) {
      await tx.invitation.create({
        data: {
          userId: rahul.id,
          tokenHash: hashToken(newToken()),
          invitedById: asha.id, // the HR Admin — the only seeded user who can invite
          expiresAt: new Date(Date.now() + INVITE_TTL_HOURS * HOUR_MS),
        },
      });
    }
  });

  const [departments, roles, users, invitations] = await prisma.$transaction([
    prisma.department.count(),
    prisma.role.count(),
    prisma.user.count(),
    prisma.invitation.count(),
  ]);
  console.log(
    `Seed complete: ${departments} departments, ${roles} roles, ${users} users, ${invitations} invitations`,
  );
}

main()
  .catch((err: unknown) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
