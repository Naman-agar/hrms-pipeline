// TPRD 01 §2 / §6.5 — root module: composes every feature module and registers
// the global guards.
//
// What is wired here
//   - `LoggerModule` (nestjs-pino, §1 "pino via nestjs-pino") so `Logger` /
//     `PinoLogger` are in the DI graph: `main.ts` does
//     `app.useGlobalFilters(new HttpExceptionFilter(app.get(Logger)))` (§6.5
//     step 5) and `app.useLogger(app.get(Logger))`.
//   - `ConfigModule` / `PrismaModule` / `ClockModule` — all `@Global()`, imported once here.
//   - `AuditModule`, `MailModule` (owns `BullModule.forRootAsync` + the `mail`
//     queue — do not call `BullModule.forRoot*` again), `RolesModule`,
//     `DepartmentsModule`, `HealthModule`.
//   - Global guards via `APP_GUARD` (02 §4): `JwtAuthGuard` first, then
//     `PermissionsGuard`. Nest runs multiple `APP_GUARD` providers in
//     registration order, and `PermissionsGuard` reads `request.user`, which
//     `JwtAuthGuard` attaches — so this order is load-bearing.
//   - `AuthModule` (02) — owns and exports `JwtTokenService`, which the
//     `APP_GUARD` `JwtAuthGuard` below injects. An `APP_GUARD` is instantiated
//     in this module's context, so the dependency must be visible here; it is,
//     through the import, exactly like `PrismaService` reaches the other guards.
//
// What is deliberately NOT wired here
//   - `HttpExceptionFilter` is registered in `main.ts` with `useGlobalFilters`
//     (§6.5 step 5), not as `APP_FILTER`.
//   - The global Zod validation pipe, CORS, helmet, the `api/v1` prefix and
//     Swagger are all `main.ts` concerns (§6.5 steps 2–6).
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { ClockModule } from './common/clock/clock.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { ConfigModule } from './config/config.module';
import { DepartmentsModule } from './departments/departments.module';
import { HealthModule } from './health/health.module';
import { MailModule } from './mail/mail.module';
import { PrismaModule } from './prisma/prisma.module';
import { RolesModule } from './roles/roles.module';

@Module({
  imports: [
    // §1 — pino-http request logging; `Logger` is a singleton so `app.get(Logger)` works in main.ts.
    // No `Config` field concerns logging, so the module is registered statically.
    LoggerModule.forRoot({
      pinoHttp: {
        // Never log credentials; `authorization` arrives with 02-auth's bearer tokens.
        redact: ['req.headers.authorization', 'req.headers.cookie'],
      },
    }),
    // §3 — typed config (@Global, exports CONFIG)
    ConfigModule,
    // §4 — Prisma client (@Global, exports PrismaService)
    PrismaModule,
    // 02 §3 — injectable "now" for expiry / rate-limit rules (@Global, exports ClockService)
    ClockModule,
    // §6.3 — audit log writer
    AuditModule,
    // §6.4 — BullMQ root connection + `mail` queue + worker
    MailModule,
    // 02 — login/refresh/logout/me; exports JwtTokenService for the guard below and AuthService for 03/04
    AuthModule,
    // §7 — reference data
    RolesModule,
    DepartmentsModule,
    // AC-F2 — GET /health (marked @Public, honoured by JwtAuthGuard)
    HealthModule,
  ],
  providers: [
    // 02 §4.1 — authentication first: verifies the bearer JWT and attaches `{ id, role, perms }`
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // 02 §4.2 — then authorisation: compares @Permissions() with `request.user.perms`
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
