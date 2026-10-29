// TPRD 03 §7 — body for `PATCH /users/{id}` (partial update).
//
// "Body zod (all optional, at least one): first_name, last_name, role_id,
//  department_id, status, avatar_url. email is rejected with 400 VALIDATION_ERROR
//  ('email cannot be changed')."
//
// `email` is deliberately NOT a field of this schema. Because a plain zod object
// strips unknown keys before refinements run, the raw body is inspected via
// `.passthrough()` + `superRefine`, which reports an issue at `path: ['email']`
// so the envelope reads `fields.email = "email cannot be changed"` (the envelope's
// top-level message is the fixed `Validation failed`, 01 §6.1 / docs/decisions.md).
// Any other unknown key is then dropped by the final `transform`, matching the
// strip behaviour of every other body schema in this codebase.
import { UserStatus } from '@prisma/client';
import { z } from 'zod';

/** §7 — the six updatable fields, in TPRD order. Also the key order of the audit diff. */
export const UPDATE_USER_FIELDS = [
  'first_name',
  'last_name',
  'role_id',
  'department_id',
  'status',
  'avatar_url',
] as const;
export type UpdateUserField = (typeof UPDATE_USER_FIELDS)[number];

/** `avatar_url` upper bound (not specified by the TPRD; see docs/decisions.md). */
export const AVATAR_URL_MAX = 2048;

const UpdateUserFieldsSchema = z.object({
  // §7 — same rule as §6: 1–100 chars, trimmed
  first_name: z.string().trim().min(1).max(100).optional(),
  // §7 — same rule as §6: 1–100 chars, trimmed
  last_name: z.string().trim().min(1).max(100).optional(),
  // §7 — uuid; existence is checked in the service (step 5)
  role_id: z.string().uuid().optional(),
  // §7 — uuid; existence is checked in the service (step 5)
  department_id: z.string().uuid().optional(),
  // §7 — enum (the Prisma `UserStatus` enum, 01 §4); the §7.3 transition table is step 3 in the service
  status: z.nativeEnum(UserStatus).optional(),
  // §7 — URL ≤ 2048 chars; `null` clears it (column is nullable, DTO shows `avatar_url: null`)
  avatar_url: z.string().trim().url().max(AVATAR_URL_MAX).nullable().optional(),
});

/** Parsed shape: every key optional, at least one present (enforced below). */
export type UpdateUserDto = z.infer<typeof UpdateUserFieldsSchema>;

export const UpdateUserSchema = UpdateUserFieldsSchema.passthrough()
  .superRefine((raw, ctx) => {
    // §7 — `email` is rejected: "email cannot be changed", reported under `fields.email`
    if ('email' in raw) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['email'],
        message: 'email cannot be changed',
      });
    }
    // §7 — "at least one": an empty (or all-unknown-keys) body → 400 VALIDATION_ERROR
    if (!UPDATE_USER_FIELDS.some((field) => raw[field] !== undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'at least one field is required',
      });
    }
  })
  // keep only the §7 fields (and only those actually supplied) — same strip semantics as `z.object`
  .transform((raw): UpdateUserDto => {
    const body: UpdateUserDto = {};
    for (const field of UPDATE_USER_FIELDS) {
      if (raw[field] !== undefined) {
        // `raw` is the validated passthrough output, so each known key already has its field type
        (body as Record<string, unknown>)[field] = raw[field];
      }
    }
    return body;
  });
