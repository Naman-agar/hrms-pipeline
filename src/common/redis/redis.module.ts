// TPRD 02 §3.1 step 2 — one long-lived ioredis client for application code
// that talks to Redis directly (the login rate-limit counters).
//
// BullMQ (`MailModule`) owns its own connection internally and `HealthService`
// deliberately uses a throw-away client per probe, so neither can be reused
// here. This module is the minimal shared alternative: a single `Redis`
// instance built from `config.REDIS_URL` (never `process.env`, CLAUDE.md),
// exposed under the `REDIS_CLIENT` token and closed on shutdown. Tests reach
// it with `app.get(REDIS_CLIENT)` to clear `login:*` keys between cases.
//
// Not `@Global()`: `AuthModule` (and any later feature that needs raw Redis)
// imports it explicitly, like `MailModule` imports `ConfigModule`.
import { Inject, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { CONFIG, type Config } from '../../config/config';
import { ConfigModule } from '../../config/config.module';

/** Injection token for the shared ioredis client: `@Inject(REDIS_CLIENT) redis: Redis`. */
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/** Build the shared client. Exported so tests can construct one against another URL if needed. */
export function createRedisClient(config: Config): Redis {
  const client = new Redis(config.REDIS_URL, {
    // Fail a command after one reconnect attempt instead of parking it in the
    // offline queue for ioredis's default 20 retries; a login request must not
    // hang for seconds when Redis is down (the error surfaces as 500 INTERNAL).
    maxRetriesPerRequest: 1,
  });
  // ioredis emits 'error' on every failed (re)connect; an unhandled 'error'
  // event would crash the process, so log it and let ioredis keep reconnecting.
  const logger = new Logger('RedisClient');
  client.on('error', (err: Error) => logger.error(`redis error: ${err.message}`));
  return client;
}

@Module({
  imports: [ConfigModule],
  providers: [{ provide: REDIS_CLIENT, inject: [CONFIG], useFactory: createRedisClient }],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnModuleDestroy {
  // `onModuleDestroy` on a factory-provided value is not called by Nest, so the
  // module itself owns the shutdown hook (`app.close()` / `enableShutdownHooks`).
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
