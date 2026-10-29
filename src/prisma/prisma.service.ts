// TPRD 01 §2 — `src/prisma/prisma.service.ts`: the single Prisma client for the
// app, wrapping the client generated from `prisma/schema.prisma` (§4).
//
// The connection string comes from the typed `Config` object (§3), not from
// `process.env.DATABASE_URL`: `config.ts` is the only file that reads the
// environment (CLAUDE.md), so the datasource URL is passed explicitly here.
import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { CONFIG, type Config } from '../config/config';

@Injectable()
export class PrismaService
  extends PrismaClient<Prisma.PrismaClientOptions, 'query'>
  implements OnModuleInit, OnModuleDestroy
{
  constructor(@Inject(CONFIG) config: Config) {
    // `query` events are emitted (not printed) so callers can subscribe via
    // `$on('query', …)` — e.g. the AC-U11 test counts the real SQL statements
    // one `GET /users` issues. With no subscriber the events are a no-op.
    super({
      datasources: { db: { url: config.DATABASE_URL } },
      log: [{ emit: 'event', level: 'query' }],
    });
  }

  /** Open the connection pool eagerly so a bad DATABASE_URL fails at boot, not on first query. */
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  /** Release the pool on graceful shutdown (`app.close()` / `enableShutdownHooks`). */
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
