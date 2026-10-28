// TPRD 01 §2 / AC-F2 — health check: probes PostgreSQL (through PrismaService)
// and Redis (through a short-lived ioredis client built from `config.REDIS_URL`).
//
// Neither probe ever throws out of `check()`: a failure or a timeout turns into
// `"down"` for that dependency so the controller can answer 503 instead of the
// global filter answering 500 `INTERNAL`.
import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { CONFIG, type Config } from '../config/config';
import { PrismaService } from '../prisma/prisma.service';

/** Per-dependency state in the health response (AC-F2 pins `"ok"` / `"down"`). */
export type DependencyStatus = 'ok' | 'down';

/** Body of `GET /health`: `{ status:"ok", db:"ok", redis:"ok" }` when healthy (AC-F2). */
export interface HealthReport {
  status: 'ok' | 'error';
  db: DependencyStatus;
  redis: DependencyStatus;
}

/** Upper bound for each probe so a hung dependency reports `"down"` instead of stalling the request. */
export const HEALTH_PROBE_TIMEOUT_MS = 2000;

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  /** Run both probes concurrently and fold them into one report. */
  async check(): Promise<HealthReport> {
    // AC-F2 — probe DB and Redis in parallel; each resolves to "ok" | "down", never rejects
    const [db, redis] = await Promise.all([this.checkDb(), this.checkRedis()]);

    // AC-F2 — overall status is "ok" only when every dependency is up
    return { status: db === 'ok' && redis === 'ok' ? 'ok' : 'error', db, redis };
  }

  /** AC-F2 — DB probe: the cheapest round-trip Postgres can answer. */
  private async checkDb(): Promise<DependencyStatus> {
    try {
      await withTimeout(this.prisma.$queryRaw`SELECT 1`, HEALTH_PROBE_TIMEOUT_MS);
      return 'ok';
    } catch {
      return 'down';
    }
  }

  /**
   * AC-F2 — Redis probe: open a fresh connection, PING, close.
   *
   * A throw-away client (no reconnects, no offline queue) is used rather than a
   * long-lived one so a Redis outage neither spams reconnect errors between
   * health calls nor leaves a PING parked in an offline queue.
   */
  private async checkRedis(): Promise<DependencyStatus> {
    const client = new Redis(this.config.REDIS_URL, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      connectTimeout: HEALTH_PROBE_TIMEOUT_MS,
      retryStrategy: () => null, // never reconnect; this client lives for one probe
    });
    // Swallow async 'error' events; the awaited connect()/ping() below already surface the failure.
    client.on('error', () => undefined);

    try {
      await withTimeout(
        client.connect().then(() => client.ping()),
        HEALTH_PROBE_TIMEOUT_MS,
      );
      return 'ok';
    } catch {
      return 'down';
    } finally {
      client.disconnect();
    }
  }
}

/** Reject if `promise` has not settled within `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`health probe timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
