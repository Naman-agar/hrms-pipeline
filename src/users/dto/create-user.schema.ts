// TPRD 03 §6 — body for `POST /users` (direct create with password, no email).
//
// "Body zod: first_name (1–100), last_name (1–100), email (email, lower/trim),
//  password (policy below), role_id uuid, department_id uuid, status enum default
//  active (cannot be invited here)."
//
// The password policy is the shared `PasswordSchema` (length / digit / symbol) plus
// the object-level `refinePasswordNotEmailLocalPart` superRefine, which needs both
// fields and reports under `fields.password` (AC-U8). Anything invalid → 400
// VALIDATION_ERROR via the standard nestjs-zod pipe → global filter path.
import { UserStatus } from '@prisma/client';
import { z } from 'zod';
import { PasswordSchema, refinePasswordNotEmailLocalPart } from '../../common/dto/password.schema';

/** §6 — `status` default; `invited` is only ever set by the 04 invite flow. */
export const CREATE_USER_DEFAULT_STATUS = UserStatus.active;

export const CreateUserSchema = z
  .object({
    // §6 — 1–100 chars, trimmed
    first_name: z.string().trim().min(1).max(100),
    // §6 — 1–100 chars, trimmed
    last_name: z.string().trim().min(1).max(100),
    // §6 — email, lower/trim (the column is "always stored lower-case", 01 §4)
    email: z.string().trim().toLowerCase().email(),
    // §6 — ≥10 chars, ≥1 digit, ≥1 symbol (the email-local-part rule is the superRefine below)
    password: PasswordSchema,
    // §6 — uuid
    role_id: z.string().uuid(),
    // §6 — uuid
    department_id: z.string().uuid(),
    // §6 — enum, default `active`; `invited` is rejected specifically (it is 04's state)
    status: z
      .nativeEnum(UserStatus)
      .refine((value) => value !== UserStatus.invited, {
        message: 'cannot be invited here',
      })
      .default(CREATE_USER_DEFAULT_STATUS),
  })
  // §6 — "not equal to email local part", reported under `fields.password`
  .superRefine(refinePasswordNotEmailLocalPart);

/** Parsed (output) shape: `status` is always present after the default. */
export type CreateUserDto = z.infer<typeof CreateUserSchema>;
