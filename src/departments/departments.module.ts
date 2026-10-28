// TPRD 01 §2 / §7 — Departments module (same shape as roles).
//
// `PrismaService` comes from the `@Global() PrismaModule`, so nothing is
// imported here. Registered in `app.module.ts` (later task).
import { Module } from '@nestjs/common';
import { DepartmentsController } from './departments.controller';
import { DepartmentsService } from './departments.service';

@Module({
  controllers: [DepartmentsController],
  providers: [DepartmentsService],
  exports: [DepartmentsService],
})
export class DepartmentsModule {}
