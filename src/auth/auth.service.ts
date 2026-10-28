// TPRD 02 §3 — Authentication flows: login (§3.1), refresh (§3.2), logout (§3.3)
// and the revoke-all helper (§3.4) that 03 and 04 call on status change, delete
// and password set.
//
// Each numbered step of a flow is one commented block, in the TPRD's order,
// because the order is the error precedence (tprd-conventions rule 1/2): in
// §3.1 the password check (step 5) runs before the status check (step 6), so a
// wrong password on an `invited` account is 401 INVALID_CREDENTIALS, never 403
// INVITE_PENDING.
//
// Steps owned by other layers are NOT repeated here: §3.1 step 1 / §3.2 step 1
// (zod body validation) and §3.1 step 2 (rate limit, `LoginThrottleGuard`) run
// in the controller/guards; §3.3 step 1 (bearer required) is `JwtAuthGuard`;
// the HTTP status codes (200/204) are the controller's.
//
// Time always comes from `ClockService` so e2e tests can advance it; the
// refresh-token lifetime is `REFRESH_TOKEN_TTL` from config (§2), parsed once.
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { ClockService } from '../common/clock/clock.service';
import { verifyPassword } from '../common/crypto/password';
import { hashToken, newToken } from '../common/crypto/tokens';
import { AppError } from '../common/errors/app-error';
import { CONFIG, type Config } from '../config/config';
import { PrismaService } from '../prisma/prisma.service';
import { toUserDto, type UserDto } from '../users/user.mapper';
import { parseDurationMs } from './auth.constants';
import type { LoginDto, LogoutDto, RefreshDto } from './dto';
import { JwtTokenService } from './jwt-token.service';

/** Request context the login audit row records (§3.1 step 7 `metadata: { ip, userAgent }`). */
export interface LoginContext {
  ip: string;
  userAgent?: string;
}

/** §1 — `POST /auth/login` 200 body. */
export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: UserDto;
}

/** §1 — `POST /auth/refresh` 200 body. */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  /** §2 — `REFRESH_TOKEN_TTL` (7d) in milliseconds. */
  private readonly refreshTokenTtlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly jwt: JwtTokenService,
    private readonly audit: AuditService,
    @Inject(CONFIG) config: Config,
  ) {
    this.refreshTokenTtlMs = parseDurationMs('REFRESH_TOKEN_TTL', config.REFRESH_TOKEN_TTL);
  }

  // ---------------------------------------------------------------------------
  // §3.1 Login (`POST /auth/login`) — steps 3–9 (1–2 are the pipe and guard)
  // ---------------------------------------------------------------------------
  async login(input: LoginDto, ctx: LoginContext): Promise<LoginResult> {
    const { email, password } = input;

    // §3.1 step 3 — lookup by email, excluding soft-deleted rows. `department` is
    // included alongside `role` because `toUserDto` (step 9) needs both.
    const user = await this.prisma.user.findFirst({
      where: { email, deletedAt: null },
      include: { role: true, department: true },
    });

    // §3.1 step 4 — no user, or no password yet: dummy argon2 verify (constant
    // time), then the same 401 as a wrong password. Never reveal which part failed.
    if (!user || user.passwordHash === null) {
      await verifyPassword(null, password);
      throw new AppError(401, 'INVALID_CREDENTIALS');
    }

    // §3.1 step 5 — real password comparison
    const passwordOk = await verifyPassword(user.passwordHash, password);
    if (!passwordOk) {
      throw new AppError(401, 'INVALID_CREDENTIALS');
    }

    // §3.1 step 6 — status check, in this order: invited → inactive → suspended
    if (user.status === 'invited') {
      throw new AppError(403, 'INVITE_PENDING', 'Accept your invitation first');
    }
    if (user.status === 'inactive') {
      throw new AppError(403, 'ACCOUNT_INACTIVE');
    }
    if (user.status === 'suspended') {
      throw new AppError(403, 'ACCOUNT_SUSPENDED');
    }

    // §3.1 step 7 — one transaction: lastLoginAt, RefreshToken row, auth.login audit row
    const now = this.clock.now();
    const rawRefreshToken = newToken();
    const loggedInUser = await this.prisma.$transaction(async (tx) => {
      // `update` with the same includes returns the row with the fresh
      // `lastLoginAt`, so step 9 maps it without a second read.
      const updated = await tx.user.update({
        where: { id: user.id },
        data: { lastLoginAt: now },
        include: { role: true, department: true },
      });
      await tx.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(rawRefreshToken),
          expiresAt: this.refreshExpiry(now),
        },
      });
      await this.audit.log(
        {
          actorId: user.id,
          action: 'auth.login',
          metadata: { ip: ctx.ip, userAgent: ctx.userAgent ?? null },
        },
        tx,
      );
      return updated;
    });

    // §3.1 step 8 — access JWT with the §2 claims (`perms = user.role.permissions`)
    const accessToken = this.jwt.sign({
      sub: loggedInUser.id,
      role: loggedInUser.role.name,
      perms: loggedInUser.role.permissions,
    });

    // §3.1 step 9 — raw refresh token goes to the client exactly once
    return { accessToken, refreshToken: rawRefreshToken, user: toUserDto(loggedInUser) };
  }

  // ---------------------------------------------------------------------------
  // §3.2 Refresh (`POST /auth/refresh`) — steps 2–5 (1 is the pipe)
  // ---------------------------------------------------------------------------
  async refresh(input: RefreshDto): Promise<TokenPair> {
    // §3.2 step 2 — lookup by hash with the owning user and its role
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(input.refreshToken) },
      include: { user: { include: { role: true } } },
    });

    // §3.2 step 3 — reject (401 INVALID_REFRESH_TOKEN) if: no row, revoked, expired,
    // user soft-deleted, or user not active. The checks are in the TPRD's order.
    if (!row) {
      throw new AppError(401, 'INVALID_REFRESH_TOKEN');
    }
    if (row.revokedAt !== null) {
      // §3.2 step 3 — token reuse (possible theft): revoke ALL of this user's
      // refresh tokens before rejecting, so the attacker's rotated copy dies too.
      await this.revokeAllForUser(row.userId);
      throw new AppError(401, 'INVALID_REFRESH_TOKEN');
    }
    const now = this.clock.now();
    if (row.expiresAt < now) {
      throw new AppError(401, 'INVALID_REFRESH_TOKEN');
    }
    if (row.user.deletedAt !== null) {
      throw new AppError(401, 'INVALID_REFRESH_TOKEN');
    }
    if (row.user.status !== 'active') {
      throw new AppError(401, 'INVALID_REFRESH_TOKEN');
    }

    // §3.2 step 4 — rotate in one transaction: revoke this row, insert a new one for the same user
    const rawRefreshToken = newToken();
    await this.prisma.$transaction(async (tx) => {
      await tx.refreshToken.update({
        where: { id: row.id },
        data: { revokedAt: now },
      });
      await tx.refreshToken.create({
        data: {
          userId: row.userId,
          tokenHash: hashToken(rawRefreshToken),
          expiresAt: this.refreshExpiry(now),
        },
      });
    });

    // §3.2 step 5 — new access JWT from the (already loaded) role; return both tokens
    const accessToken = this.jwt.sign({
      sub: row.user.id,
      role: row.user.role.name,
      perms: row.user.role.permissions,
    });
    return { accessToken, refreshToken: rawRefreshToken };
  }

  // ---------------------------------------------------------------------------
  // §3.3 Logout (`POST /auth/logout`) — steps 2–3 (1 is JwtAuthGuard)
  // ---------------------------------------------------------------------------
  async logout(input: LogoutDto, currentUserId: string): Promise<void> {
    // §3.3 step 2 — find the row by hash; only if it belongs to the caller and is
    // not yet revoked, set `revokedAt = now`. One conditional `updateMany` is the
    // find + check + update in a single statement: it matches 0 or 1 rows
    // (`tokenHash` is unique) and touches nothing otherwise.
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(input.refreshToken), userId: currentUserId, revokedAt: null },
      data: { revokedAt: this.clock.now() },
    });

    // §3.3 step 3 — always resolve (idempotent); unknown/foreign/already-revoked
    // tokens are a no-op, never an error. The controller answers 204.
  }

  // ---------------------------------------------------------------------------
  // §1 `GET /me` — "200 user object (same shape as 03 list item)"
  // ---------------------------------------------------------------------------
  /**
   * Loads the caller's own row for `GET /me`. `JwtAuthGuard` deliberately never
   * touches the DB (§4.1 step 3), so this is the one place the token's `sub` is
   * resolved to a row. A user that was soft-deleted after the token was issued
   * is treated as unauthenticated (401 UNAUTHENTICATED — docs/decisions.md).
   */
  async getMe(userId: string): Promise<UserDto> {
    // §1 `GET /me` — own row, excluding soft-deleted; role + department for toUserDto
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: { role: true, department: true },
    });
    if (!user) {
      throw new AppError(401, 'UNAUTHENTICATED', 'user no longer exists');
    }
    return toUserDto(user);
  }

  // ---------------------------------------------------------------------------
  // §3.4 Revoke-all helper (used by 03 and 04)
  // ---------------------------------------------------------------------------
  /**
   * §3.4 — `updateMany RefreshToken set revokedAt = now where userId and revokedAt is null`.
   * Pass `tx` to join the caller's transaction (status change, delete, password set).
   */
  async revokeAllForUser(userId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    await client.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: this.clock.now() },
    });
  }

  /** §2 — `expiresAt = now + REFRESH_TOKEN_TTL` (7d). */
  private refreshExpiry(now: Date): Date {
    return new Date(now.getTime() + this.refreshTokenTtlMs);
  }
}
