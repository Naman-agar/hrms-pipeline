// TPRD 03 §10 — body for `PATCH /me` (own profile).
//
// "Body: first_name?, last_name?, avatar_url? only."
//
// Only those three keys exist on this schema — `role_id`, `department_id`,
// `status` and `email` are not fields here at all (not merely rejected), so a
// plain `z.object` strips them like any other unknown key. Field rules are the
// same as §6/§7 (names 1–100 trimmed; avatar_url a URL ≤ `AVATAR_URL_MAX`,
// `null` to clear). Like §7, an empty body is a 400 (at least one field).
import { z } from 'zod';
import { AVATAR_URL_MAX } from './update-user.schema';

/** §10 — the three self-updatable fields, in TPRD order. Also the key order of the audit diff. */
export const UPDATE_ME_FIELDS = ['first_name', 'last_name', 'avatar_url'] as const;
export type UpdateMeField = (typeof UPDATE_ME_FIELDS)[number];

export const UpdateMeSchema = z
  .object({
    // §10 — same rule as §6/§7: 1–100 chars, trimmed
    first_name: z.string().trim().min(1).max(100).optional(),
    // §10 — same rule as §6/§7: 1–100 chars, trimmed
    last_name: z.string().trim().min(1).max(100).optional(),
    // §10 — same rule as §7: URL ≤ 2048 chars; `null` clears it
    avatar_url: z.string().trim().url().max(AVATAR_URL_MAX).nullable().optional(),
  })
  // at least one field, as §7 requires for the admin PATCH (reported under `_root`)
  .refine((body) => UPDATE_ME_FIELDS.some((field) => body[field] !== undefined), {
    message: 'at least one field is required',
  });

/** Parsed shape: every key optional, at least one present. A strict subset of `UpdateUserDto`. */
export type UpdateMeDto = z.infer<typeof UpdateMeSchema>;
