// TPRD 01 §6.3 — Audit service.
//
// `audit.log({ actorId, action, targetUserId?, metadata? })` inserts exactly one
// `AuditLog` row (§4). It is called explicitly by feature services from inside
// the same Prisma transaction as the write it records (`tx.auditLog.create`),
// never from an interceptor, so a failed write can never leave an orphan audit
// row. Nothing in TPRD 01 calls it yet; 02/03/04 call it for `user.invited`,
// `user.activated`, `user.updated`, `user.status_changed`, `user.deleted`,
// `auth.login`, …
import { Injectable } from '@nestjs/common';
import { AuditLog, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Input shape from §6.3; field names mirror the `AuditLog` model (§4). */
export interface AuditLogInput {
  /** User performing the action. `null` only when there is no authenticated actor (column is nullable). */
  actorId: string | null;
  /** e.g. `user.invited` | `user.activated` | `user.updated` | `user.status_changed` | `user.deleted` | `auth.login` */
  action: string;
  /** User the action was applied to, when there is one. */
  targetUserId?: string | null;
  /** Free-form JSON (e.g. the diff for `user.updated`). */
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * §6.3 — insert one `AuditLog` row.
   *
   * Pass the transaction client (`tx`) when calling from inside a
   * `prisma.$transaction(async (tx) => …)` block so the audit row commits or
   * rolls back together with the write it describes. Without `tx` the row is
   * written standalone through the shared `PrismaService`. Never opens a
   * transaction of its own (nest-prisma-patterns: no nested `$transaction`).
   */
  async log(input: AuditLogInput, tx?: Prisma.TransactionClient): Promise<AuditLog> {
    // §6.3 — join the caller's transaction when given one, else use the global client
    const client = tx ?? this.prisma;

    // §6.3 — one AuditLog row per call; `createdAt` defaults to now() in the schema
    return client.auditLog.create({
      data: {
        actorId: input.actorId,
        action: input.action,
        targetUserId: input.targetUserId ?? null,
        metadata: input.metadata ?? Prisma.JsonNull,
      },
    });
  }
}
