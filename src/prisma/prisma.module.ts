import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { PrismaService } from './prisma.service';

/**
 * TPRD 01 §2 — exposes `PrismaService` application-wide so feature modules
 * (roles, departments, audit, 02-auth, 03/04 users) inject it without
 * importing this module each time. `ConfigModule` is imported for the
 * `CONFIG` token the service's constructor depends on.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
