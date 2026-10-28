import { Global, Module } from '@nestjs/common';
import { CONFIG, loadConfig } from './config';

/**
 * TPRD 01 §3 — exposes the parsed, typed `Config` object application-wide.
 *
 * Inject with `@Inject(CONFIG) private readonly config: Config`, or use
 * `inject: [CONFIG]` in `forRootAsync` factories (Prisma, BullMQ, JWT).
 */
@Global()
@Module({
  providers: [{ provide: CONFIG, useFactory: loadConfig }],
  exports: [CONFIG],
})
export class ConfigModule {}
