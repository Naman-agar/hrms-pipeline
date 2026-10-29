// TPRD 03 §2 — Users module (`/users` table and row-level CRUD, plus `PATCH /me`).
//
// `PrismaService` comes from the `@Global() PrismaModule`. `AuditModule` provides
// `AuditService` for the `user.created` / `user.updated` / … rows written inside
// the service transactions (§6 step 4, §7 step 6, …). `AuthModule` exports
// `AuthService` for `revokeAllForUser` (02 §3.4; used at §7 step 6 / §8 step 3);
// the dependency stays one-directional `UsersModule → AuthModule` (docs/decisions.md).
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [AuditModule, AuthModule],
  controllers: [UsersController],
  // No exports: nothing outside this module injects `UsersService` (04's invite
  // flow has its own module); add an export only when a consumer appears.
  providers: [UsersService],
})
export class UsersModule {}
