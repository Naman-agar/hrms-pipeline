// TPRD 03 §6 — shared password policy (reused by 04 for invitation acceptance).
//
// "≥10 chars, ≥1 digit, ≥1 symbol, not equal to email local part."
//
// The first three rules depend only on the password and live in `PasswordSchema`.
// The fourth needs the email too, so it is exposed as a `superRefine` callback that a
// body schema containing both `email` and `password` attaches at the object level —
// the issue is reported under `path: ['password']` so the envelope shows
// `fields.password` (AC-U8). Usage:
//
//   export const CreateUserSchema = z
//     .object({ email: z.string().trim().toLowerCase().email(), password: PasswordSchema, … })
//     .superRefine(refinePasswordNotEmailLocalPart);

import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 10;

/** Any character that is neither a letter nor a digit counts as a symbol. */
const HAS_DIGIT = /\d/;
const HAS_SYMBOL = /[^A-Za-z0-9]/;

/** Password-only rules: length, digit, symbol (TPRD 03 §6). */
export const PasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .regex(HAS_DIGIT, 'must contain at least one digit')
  .regex(HAS_SYMBOL, 'must contain at least one symbol');

export type PasswordInput = z.infer<typeof PasswordSchema>;

/** The part of an email address before the first `@` (the whole string if there is none). */
export function emailLocalPart(email: string): string {
  const at = email.indexOf('@');
  return at === -1 ? email : email.slice(0, at);
}

/**
 * `true` when the password is the email's local part (case-insensitive — `email` is
 * lower-cased by the body schema, so an exact compare would let `Asha.Mehta` through).
 */
export function isPasswordEmailLocalPart(password: string, email: string): boolean {
  return password.toLowerCase() === emailLocalPart(email).toLowerCase();
}

/**
 * `superRefine` callback for any object schema with `email` and `password`.
 * Adds a `custom` issue at `['password']` when the password equals the email local part.
 */
export function refinePasswordNotEmailLocalPart(
  data: { email: string; password: string },
  ctx: z.RefinementCtx,
): void {
  if (isPasswordEmailLocalPart(data.password, data.email)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['password'],
      message: 'must not be the same as the email local part',
    });
  }
}
