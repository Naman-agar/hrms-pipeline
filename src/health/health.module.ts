// TPRD 01 §2 — Health module: `GET /health` (AC-F2).
//
// `PrismaService` comes from the `@Global() PrismaModule`; `ConfigModule` is
// imported explicitly for the `CONFIG` token the service uses to reach Redis.
import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [ConfigModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
