# TPRD 04 — User invite (invite, email, accept, resend, expiry)

Scope: the **Invite user** button and everything until the invited user becomes `active`.
Depends on: 01-foundation (mail queue, Invitation table), 02-authentication (guards, token issue, revoke helper), 03-user-management (user DTO, EMAIL_TAKEN rule).

## 1. Endpoints

| Method & path | Auth | Body | Success |
| --- | --- | --- | --- |
| `POST /users/invite` | users.invite | `{ first_name, last_name, email, role_id, department_id }` | 201 UserDto (status `invited`) |
| `POST /users/{id}/resend-invite` | users.invite | — | 200 `{ expires_at, resent_count }` |
| `GET /auth/invite/{token}` | public | — | 200 `{ email, first_name, expires_at }` (UI pre-fill) |
| `POST /auth/accept-invite` | public | `{ token, password }` | 200 `{ accessToken, refreshToken, user }` |

## 2. State machine

```
[Admin posts invite] → User row created, status=invited, Invitation row (open)
                        │
                        ├─ token accepted within 72 h → status=active, Invitation.acceptedAt set   (done)
                        ├─ 72 h pass → Invitation expired (status stays invited) → admin resends → new Invitation, old revoked
                        └─ admin PATCH status=inactive → open Invitation revoked (03 handles)
```
The user never leaves `invited` except through accept-invite (→ active) or PATCH (→ inactive) / DELETE.

## 3. Token — how it is generated and stored
- `raw = base64url(crypto.randomBytes(32))` (43 chars).
- Stored: `Invitation.tokenHash = sha256(raw)` (hex). Raw is **only** placed in the email link.
- Link: `${FRONTEND_URL}/accept-invite?token=${raw}`.
- `expiresAt = now + INVITE_TTL_HOURS` (72).
- At most **one open** invitation per user (`acceptedAt IS NULL AND revokedAt IS NULL`). Creating a new one revokes the previous.

## 4. Flow — `POST /users/invite` (step by step)

1. Zod: `first_name` 1–100, `last_name` 1–100, `email` (email, lower-case, trim), `role_id` uuid, `department_id` uuid. Fail → 400.
2. Rate limit: key `invite:<actorId>`, 50 per hour → 429 `RATE_LIMITED`.
3. Load role and department → 404 `NOT_FOUND` with `fields.*` if missing; department must be `isActive`.
4. `existing = prisma.user.findUnique({ where:{ email } })` (includes soft-deleted).
   - exists → 409 `EMAIL_TAKEN`, `details: { deleted: existing.deletedAt != null, status: existing.status }`.
5. `raw`, `hash`, `expiresAt` as in §3.
6. Single transaction:
   ```ts
   const user = await tx.user.create({ data:{ firstName, lastName, email, roleId, departmentId, status:'invited', passwordHash:null }, include:{ role:true, department:true } });
   await tx.invitation.create({ data:{ userId:user.id, tokenHash:hash, invitedById:actor.id, expiresAt } });
   await tx.auditLog.create({ data:{ actorId:actor.id, action:'user.invited', targetUserId:user.id, metadata:{ role_id, department_id, expires_at } } });
   ```
7. **After** the transaction commits: `mail.send({ template:'invite', to:email, vars:{ firstName, inviteUrl, expiresInHours:72 } })` → enqueued on BullMQ (never awaited against the provider). If enqueue itself throws, log error with user id; do not roll back — admin can resend.
8. Return 201 `toUserDto(user)` (`status:"invited"`, `last_login_at:null`) — exactly what the table row shows.

Target latency < 300 ms regardless of mail provider.

## 5. Flow — mail processor (`mail.processor.ts`, queue `mail`)
1. Job `{ template, to, vars }`.
2. Render `templates/invite.hbs` → subject `"You're invited to HRMS"`, body with `inviteUrl` and expiry.
3. Provider adapter `send()`; throws on failure → BullMQ retries 3× (5s, 25s, 125s). After final failure → log `mail.failed` with `to` only (never the URL).

## 6. Flow — `GET /auth/invite/{token}` (UI pre-check before showing the password form)
1. `inv = prisma.invitation.findUnique({ where:{ tokenHash: sha256(token) }, include:{ user:true } })`.
2. Not found or `revokedAt` set → 404 `INVITE_INVALID`.
3. `acceptedAt` set → 409 `INVITE_ALREADY_ACCEPTED`.
4. `expiresAt < now` → 410 `INVITE_EXPIRED`.
5. User `deletedAt` set or status ≠ `invited` → 404 `INVITE_INVALID`.
6. 200 `{ email, first_name, expires_at }`.
No rate-limit bypass: key `invite-lookup:<ip>` 30/min.

## 7. Flow — `POST /auth/accept-invite`
1. Zod: `token` string 43 chars, `password` policy (≥10 chars, ≥1 digit, ≥1 symbol, ≠ email local part). Fail → 400.
2. Run the same lookup + checks as §6 steps 1–5 (same error codes).
3. `passwordHash = argon2.hash(password)`.
4. Transaction:
   ```ts
   await tx.user.update({ where:{ id:user.id }, data:{ passwordHash, status:'active', lastLoginAt: now } });
   await tx.invitation.update({ where:{ id:inv.id }, data:{ acceptedAt: now } });
   await tx.auditLog.create({ data:{ actorId:user.id, action:'user.activated', targetUserId:user.id, metadata:{ invitation_id: inv.id } } });
   await tx.auditLog.create({ data:{ actorId:user.id, action:'auth.login', metadata:{ via:'accept-invite' } } });
   ```
5. Issue tokens exactly as 02 §3.1 steps 7–8 (refresh row + access JWT).
6. 200 `{ accessToken, refreshToken, user }` — the UI logs the user straight in. From now on the table shows `Active` and a real last-login time.

Concurrency: the `tokenHash` unique + `acceptedAt` check inside the transaction (use `updateMany where acceptedAt IS NULL` and check count = 1) guarantees a token can be accepted once even under parallel requests.

## 8. Flow — `POST /users/{id}/resend-invite`
1. Load user (non-deleted) → 404.
2. `status !== 'invited'` → 409 `NOT_INVITED`.
3. Count invitations created for this user in the last 24 h; ≥ 5 → 429 `RATE_LIMITED`.
4. Transaction:
   - `invitation.updateMany({ where:{ userId, acceptedAt:null, revokedAt:null }, data:{ revokedAt: now } })`
   - create new Invitation (new raw/hash, new `expiresAt`)
   - audit `user.invite_resent` with `{ invitation_id }`
5. After commit: enqueue mail as in §4.7.
6. 200 `{ expires_at, resent_count }` where `resent_count = total invitations for user − 1`.

## 9. Expiry
No cron needed: expiry is evaluated at lookup time (`expiresAt < now`). Optional nightly job may set `revokedAt` on expired rows for hygiene; not required.

## 10. Error codes introduced
404 INVITE_INVALID · 409 INVITE_ALREADY_ACCEPTED, NOT_INVITED, EMAIL_TAKEN · 410 INVITE_EXPIRED · 429 RATE_LIMITED

## 11. Tests required
- invite creates user `invited` + one open invitation + audit row, enqueues one `mail` job, returns 201 within the DTO shape
- duplicate email (active, invited, and soft-deleted) → 409 with correct `details`
- accept: user becomes `active`, `lastLoginAt` set, `passwordHash` set, tokens returned, second accept → 409
- expired token → 410; tampered token → 404; weak password → 400
- resend revokes old token (old → 404), issues new, 6th resend in 24 h → 429
- invited user still cannot `POST /auth/login` (403 INVITE_PENDING from 02)

## 12. Acceptance criteria

**AC-I1 Invite creation**
- Given an HR Admin, when `POST /users/invite` with a valid body, then 201 with `status:"invited"`, `last_login_at:null`; the user appears in `GET /users` immediately; one open Invitation row and one `user.invited` audit row exist; exactly one `mail` job is enqueued; response time < 300 ms with the mail provider stubbed to sleep 5 s.
- Given the email already exists (active, invited, or soft-deleted), then 409 `EMAIL_TAKEN` with `details.status` and `details.deleted`.
- Given an inactive department or unknown role, then 404 with `fields.department_id` / `fields.role_id`.
- Given an Employee or Manager, then 403 `FORBIDDEN`.
- Given 50 invites by one admin within an hour, when a 51st is sent, then 429.

**AC-I2 Invite email**
- Given a queued invite job with `MAIL_PROVIDER=console`, then the log contains a link of the form `${FRONTEND_URL}/accept-invite?token=<43 chars>` and the raw token appears nowhere in the DB.

**AC-I3 Invite lookup**
- When `GET /auth/invite/{token}` with a valid open token, then 200 `{ email, first_name, expires_at }`.
- With a random or revoked token → 404 `INVITE_INVALID`; already accepted → 409 `INVITE_ALREADY_ACCEPTED`; expired → 410 `INVITE_EXPIRED`.

**AC-I4 Accept**
- Given a valid token and password `Strong#2026pw`, when `POST /auth/accept-invite`, then 200 with tokens and `user.status:"active"`; the user can now log in with that password; `last_login_at` is set; audit rows `user.activated` and `auth.login` exist; `GET /users` shows the row as `Active`.
- Given the same token used a second time (including two parallel requests), then exactly one succeeds and the other gets 409 `INVITE_ALREADY_ACCEPTED`.
- Given an expired token, then 410 and the user remains `invited`.
- Given a weak password, then 400 and no state changes.

**AC-I5 Resend**
- Given an `invited` user, when `POST /users/{id}/resend-invite`, then 200 `{ expires_at, resent_count }`; the previous token returns 404; a new mail job is enqueued; audit `user.invite_resent` exists.
- Given an `active` user, then 409 `NOT_INVITED`.
- Given 5 invitations for the user in 24 h, when a 6th resend is requested, then 429.

**AC-I6 Interaction with other features**
- Given an invited user, when they `POST /auth/login`, then 403 `INVITE_PENDING`.
- Given an invited user is set `inactive` via PATCH or deleted, then their open invitation is revoked and the token returns 404.

## 13. Done criteria
From the UI: click **Invite user** → new row appears as `Invited` / `Never`; open the link printed by the console mail adapter → set password → user is logged in and the row shows `Active` with a last-login timestamp.
