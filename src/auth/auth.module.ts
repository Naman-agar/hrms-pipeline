// TPRD 02 — Authentication module: assembles the login/refresh/logout/me
// routes (§1), the flows (§3), the RS256 token service (§2) and the login rate
// limit guard (§3.1 step 2).
//
// Imports
//   - `AuditModule` — `AuthService` writes the `auth.login` row (§3.1 step 7).
//     Not `@Global()`, so it is imported explicitly like 03/04 will.
//   - `RedisModule` — `LoginThrottleGuard` injects `REDIS_CLIENT` for the
//     `login:<email>` / `login:<ip>` counters. Not `@Global()` by design.
//   `PrismaService`, `ClockService` and `CONFIG` come from the `@Global()`
//   modules registered once in `AppModule`.
//
// Exports
//   - `AuthService` — §3.4 `revokeAllForUser` is "used by 03 and 04" on status
//     change, delete and password set.
//   - `JwtTokenService` — the global `JwtAuthGuard` (`APP_GUARD` in `AppModule`)
//     injects it; because `AppModule` imports this module, the export lands in
//     `AppModule`'s own provider graph, the same way `PrismaService` reaches the
//     other global guards. This replaces the stopgap direct registration that
//     `AppModule` carried before this module existed.
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { RedisModule } from '../common/redis/redis.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtTokenService } from './jwt-token.service';
import { LoginThrottleGuard } from './login-throttle.guard';

@Module({
  imports: [AuditModule, RedisModule],
  controllers: [AuthController],
  providers: [AuthService, JwtTokenService, LoginThrottleGuard],
  exports: [AuthService, JwtTokenService],
})
export class AuthModule {}
