# TPRD 01 — Foundation (project scaffold, database, shared infrastructure)

Scope: everything the other three TPRDs depend on. No business endpoints yet except `/health`, `/roles`, `/departments`.
Depends on: nothing. Required by: 02-auth, 03-user-management, 04-user-invite.

## 1. Stack (fixed — do not substitute)

| Concern | Choice |
| --- | --- |
| Runtime | Node 22 LTS, TypeScript 5, strict mode |
| Framework | NestJS 10 |
| Database | PostgreSQL 16 via Prisma 5 |
| Queue | BullMQ on Redis 7 |
| Validation | Zod + `nestjs-zod` |
| Password hashing | `argon2` (argon2id) |
| Logging | `pino` via `nestjs-pino` |
| API docs | `@nestjs/swagger`, served at `/api/docs` |
| Tests | Vitest + Supertest |

## 2. Folder structure (create exactly this)

```
hrms-api/
├─ docker-compose.yml          # postgres:16 (5432) + redis:7 (6379)
├─ .env.example
├─ package.json
├─ tsconfig.json
├─ prisma/
│  ├─ schema.prisma
│  ├─ migrations/
│  └─ seed.ts
├─ src/
│  ├─ main.ts
│  ├─ app.module.ts
│  ├─ config/config.ts            # typed env loader (zod)
│  ├─ prisma/prisma.service.ts
│  ├─ common/
│  │  ├─ filters/http-exception.filter.ts
│  │  ├─ dto/pagination.dto.ts
│  │  ├─ errors/app-error.ts      # AppError(code, status, message, fields?)
│  │  └─ decorators/current-user.decorator.ts
│  ├─ audit/audit.module.ts, audit.service.ts
│  ├─ mail/mail.module.ts, mail.service.ts, mail.processor.ts, templates/
│  ├─ roles/roles.module.ts, roles.controller.ts, roles.service.ts
│  ├─ departments/ (same shape as roles)
│  └─ health/health.controller.ts
└─ test/
```

## 3. Environment variables (`.env.example`)

```
PORT=3000
DATABASE_URL=postgresql://hrms:hrms@localhost:5432/hrms
REDIS_URL=redis://localhost:6379
JWT_PRIVATE_KEY=            # RS256 PEM, base64-encoded single line
JWT_PUBLIC_KEY=
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL=7d
INVITE_TTL_HOURS=72
FRONTEND_URL=http://localhost:5173
CORS_ORIGINS=http://localhost:5173
MAIL_PROVIDER=console       # console | ses | sendgrid
MAIL_FROM=no-reply@example.com
```

`config.ts` parses `process.env` with a zod schema at startup and throws if anything is missing. Nothing else reads `process.env` directly.

## 4. Database schema (`prisma/schema.prisma`)

```prisma
enum UserStatus { invited active inactive suspended }

model Department {
  id        String   @id @default(uuid())
  name      String   @unique
  isActive  Boolean  @default(true)
  users     User[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Role {
  id          String   @id @default(uuid())
  name        String   @unique
  permissions String[]            // e.g. ["users.read","users.invite"]
  isSystem    Boolean  @default(false)
  users       User[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model User {
  id           String     @id @default(uuid())
  firstName    String
  lastName     String
  email        String     @unique       // always stored lower-case
  passwordHash String?
  departmentId String
  roleId       String
  status       UserStatus @default(invited)
  avatarUrl    String?
  lastLoginAt  DateTime?
  deletedAt    DateTime?
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt
  department   Department @relation(fields: [departmentId], references: [id])
  role         Role       @relation(fields: [roleId], references: [id])
  invitations  Invitation[]
  refreshTokens RefreshToken[]
  @@index([status]) @@index([departmentId]) @@index([roleId]) @@index([lastLoginAt])
}

model Invitation {
  id          String    @id @default(uuid())
  userId      String
  tokenHash   String    @unique
  invitedById String
  expiresAt   DateTime
  acceptedAt  DateTime?
  revokedAt   DateTime?
  createdAt   DateTime  @default(now())
  user        User      @relation(fields: [userId], references: [id])
}

model RefreshToken {
  id        String    @id @default(uuid())
  userId    String
  tokenHash String    @unique
  expiresAt DateTime
  revokedAt DateTime?
  createdAt DateTime  @default(now())
  user      User      @relation(fields: [userId], references: [id])
}

model AuditLog {
  id           String   @id @default(uuid())
  actorId      String?
  action       String   // user.invited | user.activated | user.updated | user.status_changed | user.deleted | auth.login
  targetUserId String?
  metadata     Json?
  createdAt    DateTime @default(now())
  @@index([targetUserId]) @@index([createdAt])
}
```

After `prisma migrate dev --name init`, add one raw migration:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX users_search_trgm ON "User" USING gin ((lower("firstName" || ' ' || "lastName")) gin_trgm_ops);
CREATE INDEX users_email_trgm  ON "User" USING gin (lower(email) gin_trgm_ops);
```

## 5. Seed (`prisma/seed.ts`) — must produce exactly what the UI shows

1. Upsert departments: `Human Resources`, `Engineering`.
2. Upsert roles:
   - `HR Admin` — permissions `["users.read","users.create","users.invite","users.update","users.delete","roles.manage","departments.manage"]`, `isSystem=true`
   - `Manager` — `["users.read"]`
   - `Employee` — `[]`, `isSystem=true`
3. Upsert user Asha Mehta, `asha.mehta@example.com`, HR Admin, Human Resources, `status=active`, `passwordHash=argon2("Admin#2026")`, `lastLoginAt=2026-10-20T08:15:00Z`.
4. Upsert user Rahul Shah, `rahul.shah@example.com`, Employee, Engineering, `status=invited`, `passwordHash=null`, `lastLoginAt=null`, plus one open Invitation row (`expiresAt = now()+72h`).

## 6. Shared infrastructure — how each piece works

### 6.1 Error envelope (`http-exception.filter.ts`)
Every thrown `AppError` or Nest `HttpException` is converted to:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "email is invalid", "fields": { "email": "must be a valid address" } } }
```

Mapping: Zod failure → 400 `VALIDATION_ERROR` with `fields`; `AppError` → its own status/code; unknown exception → 500 `INTERNAL` (message hidden, stack logged with request id).

### 6.2 Pagination DTO (`pagination.dto.ts`)
Zod schema: `page` int ≥1 default 1; `page_size` enum 10|25|50|100 default 25. Exposes `skip = (page-1)*page_size`, `take = page_size`. Response helper `paginate(data, total, page, page_size)` returns `{ data, meta:{ page, page_size, total, total_pages: ceil(total/page_size) } }`.

### 6.3 Audit service
`audit.log({ actorId, action, targetUserId?, metadata? })` → inserts one `AuditLog` row. Called explicitly by services inside the same Prisma transaction (`tx.auditLog.create`), never from an interceptor, so a failed write never produces an orphan audit row.

### 6.4 Mail service + queue
- `mail.service.send(job)` enqueues `{ template, to, vars }` onto BullMQ queue `mail` (attempts 3, exponential backoff 5s).
- `mail.processor.ts` renders `templates/<template>.hbs` and calls the provider adapter selected by `MAIL_PROVIDER`. `console` adapter just logs the rendered mail — use it in dev and tests.
- Templates required now: `invite.hbs` (vars: `firstName`, `inviteUrl`, `expiresInHours`).

### 6.5 Bootstrap (`main.ts`)
1. Load config (throws on missing env).
2. `app.enableCors({ origin: CORS_ORIGINS.split(','), credentials: true })`.
3. `helmet()`.
4. Global prefix `api/v1`.
5. Global Zod validation pipe + exception filter.
6. Swagger at `/api/docs`.
7. Listen on `PORT`.

## 7. Reference-data endpoints (needed by the dropdowns)

| Method & path | Permission | Behaviour |
| --- | --- | --- |
| `GET /roles` | any authenticated | all roles ordered by name: `[{id,name,isSystem}]` (permissions omitted) |
| `GET /departments` | any authenticated | all `isActive=true` departments ordered by name |
| `POST /roles` | `roles.manage` | body `{name, permissions[]}`; 409 `NAME_TAKEN` on duplicate |
| `PATCH /roles/{id}` | `roles.manage` | 409 `SYSTEM_ROLE` if `isSystem` and name changes |
| `DELETE /roles/{id}` | `roles.manage` | 409 `SYSTEM_ROLE` if system; 409 `IN_USE` if any user has it |
| `POST /departments` | `departments.manage` | `{name}`; 409 `NAME_TAKEN` |
| `PATCH /departments/{id}` | `departments.manage` | `{name?, isActive?}` |
| `DELETE /departments/{id}` | `departments.manage` | 409 `IN_USE` if any non-deleted user has it |

Until 02-auth exists, guard these with a temporary `AuthGuard` stub that reads `x-user-id` header and loads that user; replace in 02.

## 8. Acceptance criteria

**AC-F1 Local environment**
- Given a fresh clone with Docker running, when I run `docker compose up -d`, `npm run prisma:migrate`, `npm run seed`, `npm run dev`, then the API starts on `PORT` with no errors and `/api/docs` opens.
- Given a missing required env var, when the app starts, then it exits with a message naming the variable.

**AC-F2 Health**
- Given DB and Redis are up, when I call `GET /api/v1/health`, then I get 200 `{ status:"ok", db:"ok", redis:"ok" }`.
- Given Redis is down, then I get 503 with `redis:"down"`.

**AC-F3 Seed data**
- Given the seed has run, when I query the DB, then exactly 2 departments, 3 roles, 2 users exist and Rahul has one open invitation.
- Given the seed runs twice, then no duplicates are created (idempotent).

**AC-F4 Reference data**
- Given an authenticated user of any role, when I call `GET /roles` and `GET /departments`, then I receive the seeded rows sorted by name, and role permissions are not exposed.
- Given an HR Admin, when I `POST /departments {name:"Finance"}`, then 201; posting the same name again → 409 `NAME_TAKEN`.
- Given a department with users, when I `DELETE` it, then 409 `IN_USE`.
- Given a system role, when I `DELETE` or rename it, then 409 `SYSTEM_ROLE`.

**AC-F5 Error envelope**
- Given any 4xx/5xx, then the body is `{ error:{ code, message, fields? } }` and never includes a stack trace.
- Given invalid input, then 400 `VALIDATION_ERROR` with a `fields` object naming each bad field.

**AC-F6 Mail queue**
- Given `MAIL_PROVIDER=console`, when a mail job is enqueued, then the rendered email is logged within 5 s.
- Given the provider throws, then the job is retried 3 times before being marked failed.

## 9. Done criteria
- `docker compose up -d && npm run prisma:migrate && npm run seed && npm run dev` starts cleanly.
- `GET /api/v1/health` → `{ "status": "ok", "db": "ok", "redis": "ok" }`.
- `GET /api/v1/roles` and `/departments` return seeded data.
- Sending a test mail job with `MAIL_PROVIDER=console` logs the rendered template.
- `npm test` passes with a test DB (`DATABASE_URL_TEST`).
