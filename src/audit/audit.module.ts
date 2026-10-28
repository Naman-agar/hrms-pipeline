import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/**
 * TPRD 01 §2 / §6.3 — provides `AuditService` to feature modules (roles,
 * departments, 02-auth, 03/04 users). `PrismaService` comes from the
 * `@Global() PrismaModule`, so no import is needed here.
 */
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
