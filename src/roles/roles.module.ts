// TPRD 01 §2/§7 — Roles module (`GET/POST /roles`, `PATCH/DELETE /roles/{id}`).
//
// `PrismaService` is resolved from the `@Global() PrismaModule`, so nothing is
// imported here. `RolesService` is exported for 03/04, which load a role by id
// when inviting or updating a user.
import { Module } from '@nestjs/common';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

@Module({
  controllers: [RolesController],
  providers: [RolesService],
  exports: [RolesService],
})
export class RolesModule {}
