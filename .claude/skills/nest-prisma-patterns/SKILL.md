---
name: nest-prisma-patterns
description: Code patterns for this NestJS + Prisma + Zod + BullMQ backend — module layout, AppError and the error envelope, zod DTOs, the transaction + audit pattern, pagination helper, guards and decorators, e2e test setup. Load this before writing or reviewing any TypeScript in src/ or test/, including small edits, so new code matches what is already there instead of inventing a second way to do the same thing.
---

# nest-prisma-patterns

These patterns exist so every feature module looks the same. The TPRDs assume them; when a flow says "throw 409 EMAIL_TAKEN" or "inside one transaction", this is the shape it expects.

## Module layout

```
src/<feature>/
├─ <feature>.module.ts
├─ <feature>.controller.ts    # routes, guards, decorators only — no logic
├─ <feature>.service.ts       # flows from the TPRD, one method per endpoint
├─ <feature>.mapper.ts        # Prisma model → snake_case DTO
└─ dto/
   ├─ <name>.schema.ts        # zod schema + inferred type
   └─ index.ts
```

Controllers call exactly one service method and return its result. Services throw `AppError`; they never build HTTP responses.

## AppError + envelope

```ts
// src/common/errors/app-error.ts
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message?: string,
    public readonly fields?: Record<string, string>,
    public readonly details?: Record<string, unknown>,
  ) { super(message ?? code); }
}
```

Throw: `throw new AppError(409, 'EMAIL_TAKEN', 'email already in use', undefined, { deleted: true, status: 'active' })`.

The global filter (`src/common/filters/http-exception.filter.ts`) turns it into `{ error: { code, message, fields?, details? } }`. ZodError → 400 `VALIDATION_ERROR` with `fields` built from `issue.path.join('.')`. Anything else → 500 `INTERNAL` with the stack in the log only.

## Zod DTOs

```ts
export const InviteUserSchema = z.object({
  first_name: z.string().trim().min(1).max(100),
  last_name:  z.string().trim().min(1).max(100),
  email:      z.string().trim().toLowerCase().email(),
  role_id:    z.string().uuid(),
  department_id: z.string().uuid(),
});
export type InviteUserDto = z.infer<typeof InviteUserSchema>;
```

Use with `@Body(new ZodValidationPipe(InviteUserSchema))` or the global `ZodValidationPipe` from nestjs-zod. Query params go through the same mechanism with `z.coerce.number()` for ints. The shared `PasswordSchema` (≥10 chars, ≥1 digit, ≥1 symbol) lives in `src/common/dto/password.schema.ts` and is reused by 03 and 04.

## Transaction + audit

```ts
const user = await this.prisma.$transaction(async (tx) => {
  const u = await tx.user.update({ where: { id }, data, include: { role: true, department: true } });
  await tx.auditLog.create({ data: { actorId: actor.id, action: 'user.updated', targetUserId: id, metadata: diff } });
  return u;
});
// side effects that must not roll back the write (mail) go here, after commit
await this.mail.send({ template: 'invite', to: user.email, vars });
```

Pass `tx` into helpers that must join the transaction (`authService.revokeAllForUser(id, tx)`). Never open a nested `$transaction`.

## Pagination

```ts
// src/common/dto/pagination.dto.ts
export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().pipe(z.union([z.literal(10), z.literal(25), z.literal(50), z.literal(100)])).default(25),
});
export const paginate = <T>(data: T[], total: number, page: number, page_size: number) => ({
  data, meta: { page, page_size, total, total_pages: Math.ceil(total / page_size) || 1 },
});
```

List endpoints run `findMany` and `count` in one `prisma.$transaction([...])` so there are exactly two SQL statements.

## Guards & decorators

- `@Public()` marks a route exempt from `JwtAuthGuard` (which is registered as `APP_GUARD`).
- `@Permissions('users.invite')` + `PermissionsGuard` (also `APP_GUARD`, ordered after Jwt).
- `@CurrentUser()` returns `{ id, role, perms }` from the JWT — no DB hit. Load the full user in the service only when the flow needs `departmentId` (manager scoping).

## Tokens & hashing

- Opaque tokens: `base64url(randomBytes(32))`; store `sha256(raw)` hex. Helper `src/common/crypto/tokens.ts` exports `newToken()` and `hashToken(raw)`.
- Passwords: `argon2.hash(pw)` / `argon2.verify(hash, pw)`; on missing user, verify against `DUMMY_HASH` so timing is constant.

## Mail

`MailService.send({ template, to, vars })` only enqueues. `MailProcessor` (`@Processor('mail')`) renders Handlebars from `src/mail/templates/*.hbs` and calls the adapter chosen by `MAIL_PROVIDER`. In tests use `console` and assert on the queue (`Queue.getJobs`) or a spy, not on real email.

## e2e tests

```ts
// test/setup.ts — runs once
beforeAll(async () => { await resetDb(); await seed(); app = await createTestApp(); });
```

- `createTestApp()` builds the real Nest app with the real global filter/pipes against `DATABASE_URL_TEST`.
- `login(email, password)` helper returns `{ access, refresh }`; `as(user)` returns a supertest agent with the bearer set.
- Tests are named `'<AC-id> <what it asserts>'` and live in `test/<feature>.e2e.spec.ts`.
- Time-dependent rules (expiry, rate limits) use an injectable `Clock` service so tests advance time instead of sleeping.

## Things that look right but break the TPRD

- Filtering or sorting in JS after `findMany` (must be in SQL — AC-U11).
- Catching `AppError` in a controller to "customise" the response (envelope must be uniform — AC-F5).
- Awaiting the mail provider inside the invite request (latency rule — AC-I1).
- Returning the Prisma model directly (leaks `passwordHash` — AC-U1).
