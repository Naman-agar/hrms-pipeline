# TPRD 03 — User management (list, search, filter, sort, paginate, CRUD)

Scope: the table on `/users` and the row-level create/read/update/delete behind it.
Depends on: 01-foundation, 02-authentication. Related: 04-user-invite (the Invite button).

## 1. What the UI needs (mapping)

| UI element | Backend |
| --- | --- |
| Search by name or email | `GET /users?search=` |
| Status / Role / Department dropdowns | `GET /users?status=&role_id=&department_id=` |
| Column sort (Name ↑ default) | `GET /users?sort=name&order=asc` |
| Status badge Active / Invited | `status` enum in response |
| Last login `20 Oct 2026, 13:45` / `Never` | `last_login_at` ISO UTC or `null` |
| 25 rows/page · Page 1 of 1 · 1–2 of 2 users | `page`, `page_size` → `meta` |
| Invite user button | 04-user-invite |

## 2. Endpoints

| Method & path | Permission | Purpose |
| --- | --- | --- |
| `GET /users` | users.read | list |
| `GET /users/{id}` | users.read | detail |
| `POST /users` | users.create | direct create with password (no email) |
| `PATCH /users/{id}` | users.update | partial update |
| `DELETE /users/{id}` | users.delete | soft delete |
| `POST /users/{id}/restore` | users.delete | undo soft delete |
| `PATCH /me` | any authenticated | own first/last name, avatar_url |

## 3. User DTO (every response uses this shape)

```json
{
  "id": "uuid",
  "first_name": "Asha",
  "last_name": "Mehta",
  "full_name": "Asha Mehta",
  "email": "asha.mehta@example.com",
  "avatar_url": null,
  "department": { "id": "uuid", "name": "Human Resources" },
  "role": { "id": "uuid", "name": "HR Admin" },
  "status": "active",
  "last_login_at": "2026-10-20T08:15:00Z",
  "created_at": "2026-09-01T10:00:00Z",
  "updated_at": "2026-10-20T08:15:00Z"
}
```

`toUserDto(user)` lives in `users/user.mapper.ts`. It never outputs `passwordHash`, `deletedAt`, or tokens. Detail (`GET /users/{id}`) adds `invitation: { expires_at, resent_count } | null` when status is `invited`.

## 4. Flow — `GET /users` (step by step)

### 4.1 Parse query (zod `ListUsersQuery`)
| param | rule | default |
| --- | --- | --- |
| search | string, trim, max 100; empty string = absent | — |
| status | enum invited/active/inactive/suspended | — |
| role_id | uuid | — |
| department_id | uuid | — |
| sort | enum name/email/department/role/status/last_login | name |
| order | enum asc/desc | asc |
| page / page_size | from pagination DTO | 1 / 25 |

Invalid → 400 `VALIDATION_ERROR`.

### 4.2 Build `where`
```ts
const where: Prisma.UserWhereInput = { deletedAt: null };
if (q.status)        where.status = q.status;
if (q.role_id)       where.roleId = q.role_id;
if (q.department_id) where.departmentId = q.department_id;
if (q.search) {
  const term = escapeLike(q.search.toLowerCase()); // escape % _ \
  where.OR = [
    { email:     { contains: term, mode: 'insensitive' } },
    { firstName: { contains: term, mode: 'insensitive' } },
    { lastName:  { contains: term, mode: 'insensitive' } },
    // full-name match ("asha me") — raw SQL fragment via Prisma $queryRaw if contains has a space
  ];
}
```
Manager scoping (from 02): if `req.user.role === 'Manager'` → force `where.departmentId = currentUser.departmentId`; if `q.department_id` is set to a different id → 403 `FORBIDDEN`.

### 4.3 Build `orderBy`
| sort | orderBy |
| --- | --- |
| name | `[{ firstName: order }, { lastName: order }]` |
| email | `{ email: order }` |
| department | `{ department: { name: order } }` |
| role | `{ role: { name: order } }` |
| status | `{ status: order }` |
| last_login | `{ lastLoginAt: { sort: order, nulls: 'last' } }` |

Always append `{ id: 'asc' }` as a tiebreaker so pagination is stable.

### 4.4 Query
```ts
const [rows, total] = await prisma.$transaction([
  prisma.user.findMany({ where, orderBy, skip, take, include: { role: true, department: true } }),
  prisma.user.count({ where }),
]);
return paginate(rows.map(toUserDto), total, page, page_size);
```
One round-trip, no N+1. Target p95 < 200 ms at 10k users.

### 4.5 Response
```json
{ "data": [ ...UserDto ], "meta": { "page": 1, "page_size": 25, "total": 2, "total_pages": 1 } }
```
UI computes "1–2 of 2 users" as `(page-1)*page_size+1` – `min(page*page_size, total)` of `total`.

## 5. Flow — `GET /users/{id}`
1. Validate `id` is uuid.
2. `findFirst({ where:{ id, deletedAt:null }, include:{ role, department, invitations:{ where:{ revokedAt:null, acceptedAt:null }, take:1 } } })`.
3. Not found → 404 `NOT_FOUND`.
4. Manager: if `user.departmentId !== currentUser.departmentId` → 404 (not 403, to avoid leaking existence).
5. Return DTO (+ `invitation` block if status invited).

## 6. Flow — `POST /users` (direct create)
Body zod: `first_name` (1–100), `last_name` (1–100), `email` (email, lower/trim), `password` (policy below), `role_id` uuid, `department_id` uuid, `status` enum default `active` (cannot be `invited` here).

1. Load role and department; missing → 404 `NOT_FOUND` with `fields.role_id` / `fields.department_id`.
2. `existing = findUnique({ email })` (includes soft-deleted). Exists → 409 `EMAIL_TAKEN`, `details.deleted = existing.deletedAt != null`.
3. `passwordHash = argon2.hash(password)`.
4. Transaction: create user; `auditLog.create({ actorId, action:'user.created', targetUserId, metadata:{ role_id, department_id, status } })`.
5. 201 with DTO.

Password policy (shared with 04): ≥10 chars, ≥1 digit, ≥1 symbol, not equal to email local part.

## 7. Flow — `PATCH /users/{id}`
Body zod (all optional, at least one): `first_name`, `last_name`, `role_id`, `department_id`, `status`, `avatar_url`. `email` is rejected with 400 `VALIDATION_ERROR` ("email cannot be changed").

1. Load target (non-deleted) with role → 404 if missing.
2. Self-protection: if `target.id === currentUser.id` and body contains `role_id` or `status` → 409 `SELF_EDIT_FORBIDDEN`.
3. Status transition check (only if `status` present and different):
   | from | allowed to |
   | --- | --- |
   | invited | inactive |
   | active | inactive, suspended |
   | inactive | active |
   | suspended | active |
   Anything else (incl. `→ invited`, `invited → active`) → 409 `INVALID_TRANSITION`. `invited → active` happens only in 04.
4. Last-admin rule: if target is HR Admin **and** the change would remove that (role change away from HR Admin, or status → inactive/suspended), count active HR Admins excluding target; if 0 → 409 `LAST_ADMIN`.
5. Validate new `role_id` / `department_id` exist → 404.
6. Transaction:
   - compute `diff = { field: { from, to } }` for changed fields only
   - `user.update`
   - if status changed to `inactive`/`suspended` → `authService.revokeAllForUser(id, tx)`
   - audit: action `user.status_changed` if status in diff, else `user.updated`; `metadata = diff`
7. 200 with DTO.

## 8. Flow — `DELETE /users/{id}` (soft)
1. Load target → 404.
2. Self → 409 `SELF_EDIT_FORBIDDEN`. Last active HR Admin → 409 `LAST_ADMIN`.
3. Transaction: set `deletedAt = now`; revoke all refresh tokens; revoke open invitations (`revokedAt = now`); audit `user.deleted`.
4. 204.
Email stays unique → re-invite returns 409 `EMAIL_TAKEN` with `details.deleted = true`.

## 9. Flow — `POST /users/{id}/restore`
1. `findFirst({ id, deletedAt:{ not:null } })` → 404 if none.
2. Set `deletedAt = null`, `status = inactive` (admin must explicitly re-activate), audit `user.restored`.
3. 200 DTO.

## 10. Flow — `PATCH /me`
Body: `first_name?`, `last_name?`, `avatar_url?` only. Update, audit `user.updated`, return DTO.

## 11. Error codes introduced
400 VALIDATION_ERROR · 403 FORBIDDEN · 404 NOT_FOUND · 409 EMAIL_TAKEN, INVALID_TRANSITION, LAST_ADMIN, SELF_EDIT_FORBIDDEN

## 12. Tests required
- list: default returns Asha then Rahul (name asc); `search=rah` → Rahul only; `status=invited` → Rahul; `sort=last_login&order=desc` puts `null` last; `page_size=1&page=2` → Rahul with `total=2,total_pages=2`
- manager sees only own department; other department filter → 403
- PATCH invalid transition → 409; demoting last admin → 409; self role change → 409
- DELETE then list excludes; restore brings back as inactive
- every 4xx returns the error envelope

## 13. Acceptance criteria

**AC-U1 Default list**
- Given seeded data and an HR Admin, when `GET /users` with no params, then 200 with Asha first, Rahul second, `meta = { page:1, page_size:25, total:2, total_pages:1 }`.
- Then no item contains `passwordHash`, `deletedAt`, or token fields.

**AC-U2 Search**
- When `search=rah`, then only Rahul is returned; `search=EXAMPLE.COM` returns both (case-insensitive); `search=asha me` returns Asha (full-name match); `search=%` returns zero rows (escaped, not wildcard).
- When `search` is longer than 100 chars, then 400 `VALIDATION_ERROR`.

**AC-U3 Filters**
- When `status=invited`, then only Rahul; `role_id=<HR Admin>` → only Asha; `department_id=<Engineering>` → only Rahul; combined filters are ANDed.
- When `status=foo` or `role_id=not-a-uuid`, then 400.

**AC-U4 Sort**
- When `sort=name&order=desc`, then Rahul before Asha; `sort=last_login&order=desc` puts Asha first and `null` last; `sort=department` orders by department name; an unknown `sort` → 400.
- Given two users with identical sort keys, then their relative order is stable across pages.

**AC-U5 Pagination**
- When `page_size=1&page=2`, then one row (Rahul) and `meta.total=2, total_pages=2`.
- When `page=5` beyond range, then 200 with empty `data` and correct `meta`.
- When `page_size=30`, then 400 (only 10/25/50/100 allowed).

**AC-U6 Manager scoping**
- Given a Manager in Engineering, when `GET /users`, then only Engineering users; when `department_id=<Human Resources>`, then 403 `FORBIDDEN`; when `GET /users/<Asha id>`, then 404.

**AC-U7 Detail**
- When `GET /users/<Rahul id>`, then 200 with `status:"invited"` and `invitation.expires_at` present; for Asha `invitation` is `null`; unknown or soft-deleted id → 404.

**AC-U8 Create**
- Given valid body, when `POST /users`, then 201, user can log in with the given password, audit `user.created` exists.
- Given an email already used (including soft-deleted), then 409 `EMAIL_TAKEN` with `details.deleted` true/false accordingly.
- Given password `short1!`, then 400 with `fields.password`.

**AC-U9 Update**
- When `PATCH /users/{id} { first_name }`, then 200 and only that field changes; audit `user.updated` metadata contains `{ first_name:{ from, to } }`.
- When body includes `email`, then 400.
- When `status` goes `active→inactive`, then 200, audit `user.status_changed`, and that user's refresh tokens stop working.
- When `status` goes `invited→active` via PATCH, then 409 `INVALID_TRANSITION`.
- When the only active HR Admin is demoted or deactivated, then 409 `LAST_ADMIN`.
- When a user changes their own `role_id` or `status`, then 409 `SELF_EDIT_FORBIDDEN`.

**AC-U10 Delete / restore**
- When `DELETE /users/{id}`, then 204; the user no longer appears in list or detail; their tokens and open invitations are revoked; audit `user.deleted` exists.
- When re-inviting the deleted email, then 409 `EMAIL_TAKEN` with `details.deleted=true`.
- When `POST /users/{id}/restore`, then 200 with `status:"inactive"` and the user appears in lists again.
- Deleting yourself or the last HR Admin → 409.

**AC-U11 Performance**
- Given 10,000 seeded users, when `GET /users` with any combination of search, filters, and sort, then p95 latency < 200 ms and exactly 2 SQL statements are executed.

## 14. Done criteria
The existing frontend at `localhost:5173/users` renders the seeded two users and every control (search, three filters, sort, rows/page, page nav) works against this API with no client-side filtering.
