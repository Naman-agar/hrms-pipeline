// TPRD 01 §2 — `src/health/health.controller.ts`: `GET /health` (AC-F2).
//
// The `api/v1` prefix is applied globally in `main.ts` (§6.5 step 4), so the
// route is registered as plain `health` here and served at `/api/v1/health`.
//
// This endpoint MUST stay publicly reachable once an auth guard is registered
// globally (APP_GUARD): it is marked `@Public()` and the global guard has to
// honour `IS_PUBLIC_KEY` (see `src/common/decorators/public.decorator.ts`).
import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { HealthReport, HealthService } from './health.service';

/** The one method of the response object the controller touches (keeps `@types/express` optional). */
interface StatusSettable {
  status(code: number): unknown;
}

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /**
   * AC-F2 — 200 `{ status:"ok", db:"ok", redis:"ok" }` when everything is up;
   * 503 with the same shape (`redis:"down"` and/or `db:"down"`) otherwise.
   */
  @Get()
  @Public()
  async check(@Res({ passthrough: true }) res: StatusSettable): Promise<HealthReport> {
    const report = await this.health.check();
    // AC-F2 — any dependency down → 503; body still carries the per-dependency fields
    if (report.status !== 'ok') res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return report;
  }
}
