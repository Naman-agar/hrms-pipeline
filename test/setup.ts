// test/setup.ts — vitest setupFiles entry (nest-prisma-patterns "e2e tests").
//
// Runs once before the whole suite (fileParallelism:false, one shared test DB).
// Order mirrors the skill's example: reset the DB, seed it, then boot the real
// Nest app on top of the now-seeded data.
//
// TPRD 01 has no `login()` yet (that is 02-authentication) — tests that need an
// authenticated caller build a supertest agent with the temporary `x-user-id`
// header the §7 `AuthGuard` stub reads, using `asUser(id)` below.
import 'reflect-metadata';
import { execSync } from 'node:child_process';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { ZodValidationPipe } from 'nestjs-zod';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { USER_ID_HEADER } from '../src/common/guards/auth.guard';

export const GLOBAL_PREFIX = 'api/v1';

// vitest.config.ts maps DATABASE_URL_TEST onto DATABASE_URL in this process's
// env before anything (including `src/config/config.ts`'s `dotenv/config`)
// runs, so a plain `new PrismaClient()` here already talks to `hrms_test`.
export const prisma = new PrismaClient();

/** The real Nest app, built once in `beforeAll` and shared by every spec file. */
export let app: INestApplication;

/**
 * Boots the real Nest app with the same middleware main.ts wires in §6.5 steps
 * 2–6 (CORS, helmet, global prefix, zod pipe + error filter, Swagger) — minus
 * step 1 (config is already loaded by the DI graph) and step 7 (`app.listen`,
 * irrelevant to supertest, which talks to the HTTP server directly).
 */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const nestApp = moduleRef.createNestApplication();

  const logger = nestApp.get(Logger);
  nestApp.useLogger(logger);
  nestApp.use(helmet());
  nestApp.setGlobalPrefix(GLOBAL_PREFIX);
  nestApp.useGlobalPipes(new ZodValidationPipe());
  nestApp.useGlobalFilters(new HttpExceptionFilter(logger));

  // §6.5 step 6 — Swagger at /api/docs (not under the api/v1 prefix), so
  // `GET /api/docs` is a real e2e assertion for AC-F1's "/api/docs opens".
  const swaggerConfig = new DocumentBuilder()
    .setTitle('HRMS API')
    .setDescription('Backend for the HRMS User-management screen')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(nestApp, swaggerConfig);
  SwaggerModule.setup('api/docs', nestApp, document);

  await nestApp.init();
  return nestApp;
}

/**
 * Deletes every row from every table, respecting FK order (children before
 * parents), inside one transaction. Keeps `_prisma_migrations` untouched.
 */
export async function resetDb(): Promise<void> {
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.invitation.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.user.deleteMany(),
    prisma.role.deleteMany(),
    prisma.department.deleteMany(),
  ]);
}

/**
 * Runs `prisma/seed.ts` (§5) against the test database by shelling out to
 * `npm run seed` with `DATABASE_URL` overridden to `DATABASE_URL_TEST` — the
 * same script `npm run seed` runs in dev, so this is the real seed, not a
 * reimplementation of it (AC-F3).
 */
export function runSeed(): void {
  const databaseUrl = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL;
  execSync('npm run seed', {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });
}

/** Looks up a seeded user's id by email — tests never hardcode ids. */
export async function getUserId(email: string): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return user.id;
}

/**
 * A supertest agent that sends `x-user-id: <id>` on every request — the §7
 * temporary auth stub. Stands in for 02-authentication's `as(user)` helper.
 */
export function asUser(userId: string): ReturnType<typeof request.agent> {
  return request.agent(app.getHttpServer()).set(USER_ID_HEADER, userId);
}

/** Poll `predicate` until it returns true or `timeoutMs` elapses (for real async queue processing, not business-rule timing — no fake Clock applies to BullMQ/Redis). */
export async function waitFor(
  predicate: () => boolean,
  timeoutMs = 5000,
  intervalMs = 25,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/**
 * Called from the spec file's own `beforeAll` (importing `beforeAll` from
 * 'vitest' inside this non-test module, rather than the `.e2e.spec.ts` file
 * vitest recognises as a test file, trips vitest's "cannot require() vitest
 * from a CJS module" guard once this file is compiled to CommonJS by the
 * swc plugin — so the hook registration itself lives in the spec file).
 */
export async function setupSuite(): Promise<void> {
  await resetDb();
  runSeed();
  app = await createTestApp();
}

export async function teardownSuite(): Promise<void> {
  await app?.close();
  await prisma.$disconnect();
}
