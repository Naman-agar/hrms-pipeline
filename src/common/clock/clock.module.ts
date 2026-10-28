import { Global, Module } from '@nestjs/common';
import { ClockService } from './clock.service';

/**
 * TPRD 02 §3 — exposes `ClockService` application-wide so feature modules
 * (02-auth, 03 users, 04 invites) inject it without importing this module each
 * time, mirroring `ConfigModule` / `PrismaModule` from TPRD 01. Tests reach the
 * singleton with `app.get(ClockService)` to freeze or advance time.
 */
@Global()
@Module({
  providers: [ClockService],
  exports: [ClockService],
})
export class ClockModule {}
