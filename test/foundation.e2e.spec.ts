// test/foundation.e2e.spec.ts — TPRD 01 §8 Acceptance criteria (AC-F1..AC-F6).
//
// One `describe` per AC id, one `it` per bullet/clause (tprd-conventions:
// "Turning an AC into a test"). Assertions check exactly what each bullet
// names (status code, `error.code`, field presence, ordering, counts) — never
// values inferred from reading the implementation.
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ConfigError, ConfigSchema, CONFIG, loadConfig, parseConfig } from '../src/config/config';
import { ConfigModule } from '../src/config/config.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { HealthModule } from '../src/health/health.module';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { MailService, MAIL_JOB_OPTIONS } from '../src/mail/mail.service';
import { MAIL_PROVIDER } from '../src/mail/providers/mail-provider.interface';
import { ConsoleMailProvider } from '../src/mail/providers/console.provider';
import {
  app,
  asUser,
  bearerFor,
  GLOBAL_PREFIX,
  getUserId,
  prisma,
  runSeed,
  setupSuite,
  teardownSuite,
  waitFor,
} from './setup';

/** Every path below the global prefix (`/api/v1`, §6.5 step 4). */
const API = (path: string): string => `/${GLOBAL_PREFIX}${path}`;

/** Exactly the twelve env vars `ConfigSchema` requires (§3 `.env.example`). */
const REQUIRED_ENV_VARS = Object.keys(ConfigSchema.shape);

beforeAll(setupSuite, 60_000);
afterAll(teardownSuite);

describe('AC-F1 Local environment', () => {
  it.each(REQUIRED_ENV_VARS)(
    'AC-F1 a missing %s exits with a message naming the variable',
    (missingVar) => {
      // parseConfig() is the pure function main.ts's bootstrap() step 1 calls
      // via loadConfig(); it is what throws (and names the variable) before
      // the app ever starts (AC-F1's "exits with a message naming the
      // variable"). main.ts's own job is just to print `err.message` and
      // `process.exit(1)` when this throws — plain wiring, verified by
      // reading `src/main.ts`'s `bootstrap().catch(...)` rather than by
      // spawning a real child process here.
      const env = { ...process.env };
      delete env[missingVar];

      expect(() => parseConfig(env)).toThrow(ConfigError);
      try {
        parseConfig(env);
        expect.unreachable('parseConfig should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError);
        expect((err as ConfigError).message).toContain(missingVar);
      }
    },
  );

  it('AC-F1 the running app serves GET /api/docs (Swagger) with no errors', async () => {
    // "starts with no errors" (first half of AC-F1's first bullet) is proven
    // by every test in this file: `test/setup.ts`'s `beforeAll` builds the
    // real `AppModule` via `createTestApp()`, which would throw and fail the
    // whole suite before a single test ran if boot were broken. The
    // "/api/docs opens" half is asserted directly here.
    const res = await request(app.getHttpServer()).get('/api/docs');
    expect(res.status).toBe(200);
    expect(res.text).toContain('swagger');
  });

  // Not asserted here: literally running `docker compose up -d && npm run
  // prisma:migrate && npm run seed && npm run dev` end-to-end requires
  // spawning a real OS process bound to a real port, outside what an e2e
  // suite running inside the same test process should do. Already verified
  // manually (per the task brief) and is TPRD §9's literal "Done criteria"
  // smoke check, not an e2e assertion.
  it.skip('AC-F1 docker compose up -d && npm run prisma:migrate && npm run seed && npm run dev starts cleanly (manual smoke check, TPRD §9)', () => {
    // intentionally empty — see comment above.
  });
});

describe('AC-F2 Health', () => {
  it('AC-F2 GET /health returns 200 {status:"ok",db:"ok",redis:"ok"} when DB and Redis are up', async () => {
    const res = await request(app.getHttpServer()).get(API('/health'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'ok', redis: 'ok' });
  });

  it('AC-F2 GET /health returns 503 with redis:"down" when Redis is unreachable', async () => {
    // Dedicated test module with CONFIG overridden to an unreachable
    // REDIS_URL, rather than stopping the shared `hrms-redis` container that
    // every other test in this suite depends on.
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, PrismaModule, HealthModule],
    })
      .overrideProvider(CONFIG)
      .useValue({ ...loadConfig(), REDIS_URL: 'redis://127.0.0.1:1' })
      .compile();
    const brokenApp = moduleRef.createNestApplication();
    brokenApp.setGlobalPrefix(GLOBAL_PREFIX);
    await brokenApp.init();

    try {
      const res = await request(brokenApp.getHttpServer()).get(API('/health'));
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ status: 'error', db: 'ok', redis: 'down' });
    } finally {
      await brokenApp.close();
    }
  });
});

describe('AC-F3 Seed data', () => {
  it('AC-F3 the seed produces exactly 2 departments, 3 roles, 2 users', async () => {
    const [departments, roles, users] = await Promise.all([
      prisma.department.count(),
      prisma.role.count(),
      prisma.user.count(),
    ]);
    expect(departments).toBe(2);
    expect(roles).toBe(3);
    expect(users).toBe(2);
  });

  it('AC-F3 Rahul has exactly one open invitation', async () => {
    const rahulId = await getUserId('rahul.shah@example.com');
    const invitations = await prisma.invitation.findMany({ where: { userId: rahulId } });
    expect(invitations).toHaveLength(1);
    expect(invitations[0].acceptedAt).toBeNull();
    expect(invitations[0].revokedAt).toBeNull();
  });

  it('AC-F3 running the seed a second time creates no duplicates', async () => {
    runSeed();
    const [departments, roles, users, invitations] = await Promise.all([
      prisma.department.count(),
      prisma.role.count(),
      prisma.user.count(),
      prisma.invitation.count(),
    ]);
    expect(departments).toBe(2);
    expect(roles).toBe(3);
    expect(users).toBe(2);
    expect(invitations).toBe(1);
  }, 30_000);
});

describe('AC-F4 Reference data', () => {
  let ashaId: string;
  let rahulId: string;

  beforeAll(async () => {
    ashaId = await getUserId('asha.mehta@example.com');
    rahulId = await getUserId('rahul.shah@example.com');
  });

  it('AC-F4 GET /roles returns the seeded roles sorted by name, with permissions not exposed', async () => {
    const res = await (await asUser(ashaId)).get(API('/roles'));
    expect(res.status).toBe(200);
    expect(res.body.map((r: { name: string }) => r.name)).toEqual([
      'Employee',
      'HR Admin',
      'Manager',
    ]);
    for (const role of res.body as Record<string, unknown>[]) {
      expect(role).not.toHaveProperty('permissions');
      expect(Object.keys(role).sort()).toEqual(['id', 'isSystem', 'name']);
    }
  });

  it('AC-F4 GET /departments returns the seeded departments sorted by name', async () => {
    const res = await (await asUser(ashaId)).get(API('/departments'));
    expect(res.status).toBe(200);
    expect(res.body.map((d: { name: string }) => d.name)).toEqual([
      'Engineering',
      'Human Resources',
    ]);
    for (const department of res.body as { isActive: boolean }[]) {
      expect(department.isActive).toBe(true);
    }
  });

  it('AC-F4 an HR Admin POSTing /departments {name:"Finance"} gets 201', async () => {
    const res = await (await asUser(ashaId)).post(API('/departments')).send({ name: 'Finance' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Finance');
  });

  it('AC-F4 posting the same department name again returns 409 NAME_TAKEN', async () => {
    const res = await (await asUser(ashaId)).post(API('/departments')).send({ name: 'Finance' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NAME_TAKEN');
  });

  it('AC-F4 deleting a department with users returns 409 IN_USE', async () => {
    const humanResources = await prisma.department.findUniqueOrThrow({
      where: { name: 'Human Resources' },
    });
    const res = await (await asUser(ashaId)).delete(API(`/departments/${humanResources.id}`));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IN_USE');
  });

  it('AC-F4 deleting a department whose only user is soft-deleted returns 409 IN_USE, not 500', async () => {
    // "any non-deleted user" — a soft-deleted user does not count for the
    // pre-check, but the FK (ON DELETE RESTRICT) still references the row;
    // that path must surface as the same clean 409, never INTERNAL.
    const employeeRole = await prisma.role.findUniqueOrThrow({ where: { name: 'Employee' } });
    const archive = await prisma.department.create({ data: { name: 'Archive' } });
    const ghost = await prisma.user.create({
      data: {
        firstName: 'Ghost',
        lastName: 'Former',
        email: 'ghost.former@example.com',
        departmentId: archive.id,
        roleId: employeeRole.id,
        status: 'inactive',
        deletedAt: new Date(),
      },
    });
    try {
      const res = await (await asUser(ashaId)).delete(API(`/departments/${archive.id}`));
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('IN_USE');
      expect(res.body.error).not.toHaveProperty('stack');
    } finally {
      await prisma.user.delete({ where: { id: ghost.id } });
      await prisma.department.delete({ where: { id: archive.id } });
    }
  });

  it('AC-F4 deleting a system role returns 409 SYSTEM_ROLE', async () => {
    const hrAdminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'HR Admin' } });
    const res = await (await asUser(ashaId)).delete(API(`/roles/${hrAdminRole.id}`));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SYSTEM_ROLE');
  });

  it('AC-F4 renaming a system role returns 409 SYSTEM_ROLE', async () => {
    const employeeRole = await prisma.role.findUniqueOrThrow({ where: { name: 'Employee' } });
    const res = await (
      await asUser(ashaId)
    )
      .patch(API(`/roles/${employeeRole.id}`))
      .send({ name: 'Renamed Employee' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SYSTEM_ROLE');
  });

  it('AC-F4 a role-less employee (Rahul) still receives the seeded reference data on GET /roles', async () => {
    // "Given an authenticated user of any role" — Rahul (Employee, permissions: [])
    // has no @Permissions() requirement on GET /roles, only AuthGuard applies.
    const res = await (await asUser(rahulId)).get(API('/roles'));
    expect(res.status).toBe(200);
    expect(res.body.map((r: { name: string }) => r.name)).toEqual([
      'Employee',
      'HR Admin',
      'Manager',
    ]);
  });
});

describe('AC-F5 Error envelope', () => {
  it('AC-F5 a 401 (missing x-user-id header) is { error: { code, message } } with no stack trace', async () => {
    const res = await request(app.getHttpServer()).get(API('/roles'));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(typeof res.body.error.message).toBe('string');
    expect(res.body.error).not.toHaveProperty('stack');
    expect(JSON.stringify(res.body)).not.toMatch(/\bat .*:\d+:\d+/);
  });

  it('AC-F5 a 404 (unknown route) is { error: { code, message } } with no stack trace', async () => {
    const res = await request(app.getHttpServer()).get(API('/this-route-does-not-exist'));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error).not.toHaveProperty('stack');
  });

  it('AC-F5 a 403 (role-less employee on a departments.manage route) is { error: { code, message } } with no stack trace', async () => {
    const rahulId = await getUserId('rahul.shah@example.com');
    const res = await (
      await asUser(rahulId)
    )
      .post(API('/departments'))
      .send({ name: 'Should Not Exist' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.body.error).not.toHaveProperty('stack');
  });

  it('AC-F5 invalid input returns 400 VALIDATION_ERROR with a fields object naming each bad field', async () => {
    const ashaId = await getUserId('asha.mehta@example.com');
    const res = await (await asUser(ashaId)).post(API('/departments')).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.fields).toHaveProperty('name');
    expect(res.body.error).not.toHaveProperty('stack');
  });

  it('AC-F5 a 500 (uncaught exception) is { error: { code: "INTERNAL" } }, message hidden, no stack trace', async () => {
    // Fault injection without touching `src/`: build a second, independent
    // copy of the real app and monkeypatch the one Prisma call `GET /roles`
    // makes (`role.findMany`; the 02 §4.1 `JwtAuthGuard` itself never touches
    // the DB) so an unplanned error reaches the global filter — exactly the
    // "anything else → 500 INTERNAL, message hidden" path of §6.1, which no
    // currently-wired endpoint can be made to hit through valid HTTP input
    // alone (every realistic failure in roles/departments is already mapped
    // to an AppError).
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const faultyApp = moduleRef.createNestApplication();
    const logger = faultyApp.get(Logger);
    faultyApp.useLogger(logger);
    faultyApp.setGlobalPrefix(GLOBAL_PREFIX);
    faultyApp.useGlobalFilters(new HttpExceptionFilter(logger));
    await faultyApp.init();

    const prismaInFaultyApp = faultyApp.get(PrismaService);
    const original = prismaInFaultyApp.role.findMany;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prismaInFaultyApp.role as any).findMany = () => {
      throw new Error('boom: injected failure, must never reach the client');
    };

    try {
      const ashaId = await getUserId('asha.mehta@example.com');
      // The bearer is minted by the shared app's JwtTokenService; both apps load
      // the same JWT_PUBLIC_KEY from config, so the faulty app verifies it too.
      const res = await request(faultyApp.getHttpServer())
        .get(API('/roles'))
        .set('Authorization', await bearerFor(ashaId));
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL');
      expect(res.body.error.message).not.toMatch(/boom/);
      expect(res.body.error).not.toHaveProperty('stack');
      expect(JSON.stringify(res.body)).not.toContain('boom');
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prismaInFaultyApp.role as any).findMany = original;
      await faultyApp.close();
    }
  });
});

describe('AC-F6 Mail queue', () => {
  it('AC-F6 with MAIL_PROVIDER=console, an enqueued mail job is rendered and logged within 5s', async () => {
    const mailService = app.get(MailService);
    const provider = app.get(MAIL_PROVIDER) as ConsoleMailProvider;
    const sendSpy = vi.spyOn(provider, 'send');
    const callsBefore = sendSpy.mock.calls.length;

    await mailService.send({
      template: 'invite',
      to: 'new.hire@example.com',
      vars: {
        firstName: 'Priya',
        inviteUrl: 'http://localhost:5173/accept?token=abcdef',
        expiresInHours: 72,
      },
    });

    // Real BullMQ/Redis processing, not a business-rule delay, so this polls
    // bounded by the AC's own "within 5 s" instead of using the injectable
    // Clock (which has nothing to advance here — there is no fake timer to
    // move forward; the job is actually being processed over Redis).
    await waitFor(() => sendSpy.mock.calls.length > callsBefore, 5000);

    const lastCall = sendSpy.mock.calls[sendSpy.mock.calls.length - 1][0];
    expect(lastCall.to).toBe('new.hire@example.com');
    expect(lastCall.html).toContain('Priya');
    expect(lastCall.html).toContain('http://localhost:5173/accept?token=abcdef');
  });

  it('AC-F6 a job is configured to retry 3 times with exponential backoff before being marked failed', () => {
    // Waiting out real backoff delays (5s, then 10s, per §6.4) to observe a
    // `failed` BullMQ event end-to-end would add ~15s of real wall-clock time
    // per run for no extra confidence that MAIL_JOB_OPTIONS itself does not
    // already give: asserted directly against the job options MailService
    // attaches to every job, per the task brief's explicit suggestion.
    expect(MAIL_JOB_OPTIONS.attempts).toBe(3);
    expect(MAIL_JOB_OPTIONS.backoff).toEqual({ type: 'exponential', delay: 5000 });
  });
});
