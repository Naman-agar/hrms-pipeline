// TPRD 02 §3.1 step 7 (`lastLoginAt: now`), §3.2 step 4 (`expiresAt: now + 7d`),
// §3.1 step 2 (15 min rate-limit window) — the single source of "now" for every
// time-dependent rule, so e2e tests advance time instead of sleeping
// (nest-prisma-patterns "e2e tests"). Services inject `ClockService` and call
// `now()`; nothing in `src/` should call `new Date()` for business logic once
// this exists. Reused by 03 (status changes) and 04 (invite expiry).
import { Injectable } from '@nestjs/common';

@Injectable()
export class ClockService {
  /** When set, `now()` is frozen at this instant; `null` means real wall-clock time. */
  private fixed: Date | null = null;

  /** Current time: the frozen instant if one is set, otherwise `new Date()`. */
  now(): Date {
    return this.fixed ? new Date(this.fixed.getTime()) : new Date();
  }

  /** Test hook — freeze `now()` at `date` (a copy is kept, so the caller may mutate its own). */
  set(date: Date): void {
    this.fixed = new Date(date.getTime());
  }

  /** Test hook — move `now()` forward by `ms` from the current `now()` (freezes if it was real time). */
  advance(ms: number): void {
    this.fixed = new Date(this.now().getTime() + ms);
  }

  /** Test hook — return to real wall-clock time. */
  reset(): void {
    this.fixed = null;
  }
}
