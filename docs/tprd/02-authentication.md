# TPRD 02 — Authentication & authorization

Scope: login, token refresh, logout, JWT guard, permission guard, `last_login_at` tracking.
Depends on: 01-foundation. Required by: 03-user-management, 04-user-invite.
Not in scope: invite acceptance (that is 04), password reset, SSO.

## 1. Endpoints

| Method & path | Auth | Body | Success |
| --- | --- | --- | --- |
| `POST /auth/login` | none | `{ email, password }` | 200 `{ accessToken, refreshToken, user }` |
| `POST /auth/refresh` | none | `{ refreshToken }` | 200 `{ accessToken, refreshToken }` |
| `POST /auth/logout` | bearer | `{ refreshToken }` | 204 |
| `GET /me` | bearer | — | 200 user object (same shape as 03 list item) |

## 2. Token design

**Access token** — JWT, RS256, TTL `ACCESS_TOKEN_TTL` (15m).
Claims: `{ sub: userId, role: roleName, perms: string[], iat, exp }`.
Never stored server-side. Verified with `JWT_PUBLIC_KEY` only.

**Refresh token** — 32 random bytes → base64url string. Only its SHA-256 hash is stored in `RefreshToken.tokenHash`. TTL `REFRESH_TOKEN_TTL` (7d). One row per issued token; rotated on every use.

## 3. Flows — step by step

### 3.1 Login (`POST /auth/login`)
1. Validate body with zod: `email` (string, email, lower-cased + trimmed), `password` (string, min 1).
2. Rate-limit check: key `login:<email>` and `login:<ip>`, limit 5 per 15 min (`@nestjs/throttler` with Redis store). Exceeded → 429 `RATE_LIMITED`.
3. `user = prisma.user.findFirst({ where: { email, deletedAt: null }, include: { role: true } })`.
4. If no user **or** `user.passwordHash` is null → do a dummy `argon2.verify` against a constant hash (constant-time), then throw 401 `INVALID_CREDENTIALS`. Never reveal which part failed.
5. `argon2.verify(user.passwordHash, password)` false → 401 `INVALID_CREDENTIALS`.
6. Status check, in this order:
   - `invited` → 403 `INVITE_PENDING` (message: "Accept your invitation first")
   - `inactive` → 403 `ACCOUNT_INACTIVE`
   - `suspended` → 403 `ACCOUNT_SUSPENDED`
7. In one transaction:
   - `tx.user.update({ where:{id}, data:{ lastLoginAt: now } })`
   - create `RefreshToken` row `{ userId, tokenHash: sha256(raw), expiresAt: now + 7d }`
   - `tx.auditLog.create({ actorId: user.id, action: 'auth.login', metadata: { ip, userAgent } })`
8. Sign access JWT with claims from step 2 of §2 (`perms = user.role.permissions`).
9. Return `{ accessToken, refreshToken: raw, user: toUserDto(user) }`.

### 3.2 Refresh (`POST /auth/refresh`)
1. Validate body `{ refreshToken }`.
2. `row = prisma.refreshToken.findUnique({ where:{ tokenHash: sha256(refreshToken) }, include:{ user:{ include:{ role:true } } } })`.
3. Reject with 401 `INVALID_REFRESH_TOKEN` if: no row, `row.revokedAt` set, `row.expiresAt < now`, user `deletedAt` set, or user status not `active`.
   - If `row.revokedAt` is set (token reuse): additionally revoke **all** refresh tokens for that user (possible theft).
4. Transaction: set `row.revokedAt = now`; insert new RefreshToken row for the same user.
5. Sign new access JWT; return both tokens.

### 3.3 Logout (`POST /auth/logout`)
1. Require valid bearer (JwtAuthGuard).
2. Find refresh row by hash; if it belongs to `req.user.id` and not revoked → set `revokedAt = now`.
3. Always return 204 (idempotent).

### 3.4 Revoke-all helper (used by 03 and 04)
`authService.revokeAllForUser(userId, tx?)` → `updateMany RefreshToken set revokedAt=now where userId and revokedAt is null`. Called when status becomes `inactive`/`suspended`, on delete, and on password set.

## 4. Guards — how requests are authorized

### 4.1 `JwtAuthGuard` (global, applied to every route except those marked `@Public()`)
1. Read `Authorization` header; must be `Bearer <token>` else 401 `UNAUTHENTICATED`.
2. `jwt.verify(token, JWT_PUBLIC_KEY, { algorithms:['RS256'] })`; failure/expiry → 401 `UNAUTHENTICATED`.
3. Attach `req.user = { id: sub, role, perms }`. **Do not hit the DB here** (keeps p95 low); status changes take effect within 15 min or immediately via refresh-token revocation.

### 4.2 `PermissionsGuard` + `@Permissions('users.invite')` decorator
1. Read required permissions from route metadata; none → allow.
2. Allow if every required permission is in `req.user.perms`; else 403 `FORBIDDEN`.

### 4.3 `@CurrentUser()` param decorator returns `req.user`.

## 5. Permission matrix (seeded in 01)

| Permission | HR Admin | Manager | Employee |
| --- | --- | --- | --- |
| users.read | ✓ | ✓ (own department only — enforced in 03) | ✗ |
| users.create / users.invite / users.update / users.delete | ✓ | ✗ | ✗ |
| roles.manage / departments.manage | ✓ | ✗ | ✗ |
| `GET /roles`, `GET /departments`, `GET /me` | any authenticated |

## 6. Error codes introduced

| HTTP | code |
| --- | --- |
| 401 | UNAUTHENTICATED, INVALID_CREDENTIALS, INVALID_REFRESH_TOKEN |
| 403 | FORBIDDEN, INVITE_PENDING, ACCOUNT_INACTIVE, ACCOUNT_SUSPENDED |
| 429 | RATE_LIMITED |

## 7. Tests required
- login happy path sets `lastLoginAt` and writes `auth.login` audit row
- wrong password, unknown email → identical 401 body and similar timing
- invited user → 403 INVITE_PENDING
- refresh rotates: old token 401 on second use, and reuse revokes all tokens
- 6th login attempt in 15 min → 429
- route without permission → 403; expired JWT → 401

## 8. Acceptance criteria

**AC-A1 Login success**
- Given an `active` user with a valid password, when they `POST /auth/login`, then 200 with `accessToken`, `refreshToken`, `user`; `user.last_login_at` equals now (±5 s); one `auth.login` audit row exists.

**AC-A2 Login failure**
- Given a wrong password or an unknown email, then 401 `INVALID_CREDENTIALS` with an identical body for both cases.
- Given an `invited` user, then 403 `INVITE_PENDING`; `inactive` → 403 `ACCOUNT_INACTIVE`; `suspended` → 403 `ACCOUNT_SUSPENDED`.
- Given 5 failed attempts for one email within 15 min, when a 6th is made, then 429 `RATE_LIMITED`.

**AC-A3 Access token**
- Given a valid access token, when any protected route is called, then it succeeds without a DB lookup for the user.
- Given an expired or tampered token, then 401 `UNAUTHENTICATED`.
- Given no `Authorization` header, then 401 `UNAUTHENTICATED`.

**AC-A4 Refresh rotation**
- Given a valid refresh token, when `POST /auth/refresh`, then 200 with a new pair and the old refresh token no longer works (401 on reuse).
- Given a refresh token that was already rotated, when it is used again, then 401 and all refresh tokens for that user are revoked.
- Given the user became `inactive`, when refreshing, then 401.

**AC-A5 Logout**
- Given a logged-in user, when `POST /auth/logout` with their refresh token, then 204 and that token can no longer be refreshed; calling logout again still returns 204.

**AC-A6 Permissions**
- Given an Employee, when calling `POST /users/invite`, then 403 `FORBIDDEN`.
- Given a Manager, when calling `GET /users`, then 200 (department scoping verified in 03).
- Given any authenticated user, when calling `GET /me`, then 200 with their own UserDto.

## 9. Done criteria
Seeded Asha can log in with `Admin#2026`, call `GET /me`, refresh, and log out; Rahul (invited) gets 403 `INVITE_PENDING`. Replace the `x-user-id` stub guard from 01 with `JwtAuthGuard`.
